import json
from email.message import Message
from pathlib import Path
from urllib.error import HTTPError, URLError

import al_iyaal_worker.moderation.llm as llm_module
from al_iyaal_worker.moderation.llm import (
    _build_agent_analysis_prompt,
    _build_analysis_prompt,
    _enrich_flagged_items,
    _parse_llm_json,
    _post_json,
    _validate_priority,
    describe_llm_request,
)
import pytest
from al_iyaal_worker.subtitles import SubtitleEntry


def test_should_build_analysis_prompt_with_video_and_guidance() -> None:
    prompt = _build_analysis_prompt(
        "episode.mp4",
        "No profanity",
        "HIGH for aqeedah violations",
        [SubtitleEntry(index=1, start_time=3.2, end_time=4.0, text="Christmas is here.")],
    )

    assert "episode.mp4" in prompt
    assert "No profanity" in prompt
    assert "HIGH for aqeedah violations" in prompt
    assert "1\n00:00:03,200 --> 00:00:04,000\nChristmas is here." in prompt
    assert '"cueIndex": 1' in prompt
    assert '"startTime"' not in prompt
    assert "validation pass" in prompt
    assert "copy its cue index" in prompt


def test_should_build_agent_prompt_that_points_to_the_subtitle_file() -> None:
    prompt = _build_agent_analysis_prompt(
        "episode.mp4",
        "No profanity",
        "HIGH for aqeedah violations",
    )

    assert "episode.mp4" in prompt
    assert "`subtitles.srt`" in prompt
    assert "No profanity" in prompt
    assert "HIGH for aqeedah violations" in prompt
    assert "`cat subtitles.srt`" in prompt
    assert "Christmas is here." not in prompt
    assert '"cueIndex": 1' in prompt
    assert '"startTime"' not in prompt
    assert "validation pass" in prompt


def test_should_pass_the_subtitle_file_to_a_local_agent(
    tmp_path: Path, monkeypatch
) -> None:
    subtitle_path = tmp_path / "episode.srt"
    subtitle_path.write_text("Christmas is here.", encoding="utf-8")
    captured: dict[str, object] = {}

    def fake_run_analysis_agent(
        engine: str,
        executable_path: str,
        model: str,
        reasoning_level: str,
        prompt: str,
        agent_subtitle_path: str | Path,
    ) -> str:
        captured.update(
            {
                "engine": engine,
                "executable_path": executable_path,
                "model": model,
                "reasoning_level": reasoning_level,
                "prompt": prompt,
                "subtitle_path": agent_subtitle_path,
            }
        )
        return '{"flagged":[],"summary":"safe"}'

    monkeypatch.setattr(llm_module, "run_analysis_agent", fake_run_analysis_agent)

    result = llm_module.analyze_with_llm(
        [
            SubtitleEntry(
                index=1,
                start_time=3.2,
                end_time=4.0,
                text="Christmas is here.",
            )
        ],
        {
            "agentModel": "gpt-test",
            "agentReasoningLevel": "low",
            "contentCriteria": "No profanity",
            "engine": "codex",
            "priorityGuidelines": "HIGH for aqeedah violations",
        },
        "episode.mp4",
        "/tools/codex",
        agent_subtitle_path=subtitle_path,
    )

    assert result.summary == "safe"
    assert captured["subtitle_path"] == subtitle_path
    assert "`subtitles.srt`" in str(captured["prompt"])
    assert "Christmas is here." not in str(captured["prompt"])


def test_should_parse_json_wrapped_in_code_fences() -> None:
    payload = _parse_llm_json(
        """```json
{"flagged":[{"startTime":3.2,"reason":"aqeedah","priority":"high"}],"summary":"summary"}
```"""
    )

    assert payload["summary"] == "summary"
    assert payload["flagged"][0]["priority"] == "high"


def test_should_resolve_model_cue_indexes_without_timestamp_math() -> None:
    payload = _parse_llm_json(
        '{"flagged":[{"cueIndex":588,"reason":"aqeedah","priority":"high"}],"summary":"summary"}'
    )
    subtitles = [
        SubtitleEntry(index=588, start_time=2791.186, end_time=2795.987, text="energy of the universe")
    ]

    enriched = _enrich_flagged_items("gemini", subtitles, payload["flagged"])

    assert enriched[0]["cueIndex"] == 588
    assert enriched[0]["startTime"] == 2791.186
    assert enriched[0]["text"] == "energy of the universe"


def test_should_reject_missing_or_ambiguous_model_cue_indexes() -> None:
    duplicate_cues = [
        SubtitleEntry(index=1, start_time=1, end_time=2, text="one"),
        SubtitleEntry(index=1, start_time=3, end_time=4, text="duplicate"),
    ]

    with pytest.raises(ValueError, match="did not uniquely match"):
        _enrich_flagged_items(
            "gemini",
            duplicate_cues,
            [{"cueIndex": 1, "reason": "reason", "priority": "high"}],
        )


@pytest.mark.parametrize(
    ("value", "expected"),
    [
        ("00:46:31,186", 2791.186),
        ("46:31.186", 2791.186),
        ("2791.186", 2791.186),
        (2791.186, 2791.186),
    ],
)
def test_should_normalize_supported_llm_timestamp_formats(value: object, expected: float) -> None:
    payload = _parse_llm_json(
        json.dumps(
            {
                "flagged": [
                    {"startTime": value, "reason": "reason", "priority": "high"}
                ],
                "summary": "summary",
            }
        )
    )

    assert payload["flagged"][0]["startTime"] == expected


def test_should_reject_trailing_cli_status_output_after_json() -> None:
    with pytest.raises(ValueError, match="trailing content"):
        _parse_llm_json(
            '> json\n{"flagged":[],"summary":"A safe episode."}\nCredits: 0.02'
        )


def test_should_enrich_flagged_items_with_subtitle_text_and_times() -> None:
    subtitles = [SubtitleEntry(index=1, start_time=3.2, end_time=4.0, text="Christmas is here.")]

    enriched = _enrich_flagged_items(
        "gemini",
        subtitles,
        [{"startTime": 3.2, "reason": "aqeedah", "priority": "high"}],
    )

    assert enriched[0]["text"] == "Christmas is here."
    assert enriched[0]["endTime"] == 4.0
    assert enriched[0]["category"] == "llm"
    assert enriched[0]["ruleId"] == "gemini"


def test_should_enrich_flagged_items_when_subtitles_are_unsorted() -> None:
    subtitles = [
        SubtitleEntry(index=2, start_time=6.0, end_time=7.0, text="Second"),
        SubtitleEntry(index=1, start_time=3.2, end_time=4.0, text="First"),
    ]

    enriched = _enrich_flagged_items(
        "gemini",
        subtitles,
        [{"startTime": 3.2, "reason": "aqeedah", "priority": "high"}],
    )

    assert enriched[0]["text"] == "First"
    assert enriched[0]["startTime"] == 3.2


def test_should_describe_gemini_fast_request_config() -> None:
    request_config = describe_llm_request({"analysisStrategy": "fast", "engine": "gemini"})

    assert request_config.engine == "gemini"
    assert request_config.model == "gemini-3.6-flash"
    assert "generativelanguage.googleapis.com" in request_config.endpoint
    assert request_config.strategy == "fast"


def test_should_describe_nova_pro_deep_request_config() -> None:
    request_config = describe_llm_request({"analysisStrategy": "deep", "engine": "nova_pro"})

    assert request_config.engine == "nova_pro"
    assert request_config.model == "nova-pro-v1"
    assert request_config.endpoint == "https://api.nova.amazon.com/v1/chat/completions"
    assert request_config.strategy == "deep"


def test_should_describe_nova_fast_request_config() -> None:
    request_config = describe_llm_request({"analysisStrategy": "fast", "engine": "nova_pro"})

    assert request_config.engine == "nova_pro"
    assert request_config.model == "nova-2-lite-v1"
    assert request_config.endpoint == "https://api.nova.amazon.com/v1/chat/completions"
    assert request_config.strategy == "fast"


def test_should_describe_agent_model_and_reasoning_config() -> None:
    request_config = describe_llm_request(
        {
            "agentModel": "gpt-test",
            "agentReasoningLevel": "low",
            "engine": "codex",
        }
    )

    assert request_config.engine == "codex"
    assert request_config.endpoint == "cli://codex"
    assert request_config.model == "gpt-test"
    assert request_config.strategy == "low"


def test_should_raise_for_unsupported_llm_engine() -> None:
    with pytest.raises(ValueError, match="Unsupported LLM engine"):
        describe_llm_request({"analysisStrategy": "fast", "engine": "unknown"})


def test_should_raise_for_malformed_llm_json() -> None:
    with pytest.raises(json.JSONDecodeError):
        _parse_llm_json("{not valid json}")


def test_should_raise_for_fenced_non_json_payload() -> None:
    with pytest.raises(json.JSONDecodeError):
        _parse_llm_json("```text\nnot json\n```")


def test_should_raise_when_flagged_field_is_missing() -> None:
    with pytest.raises(ValueError, match="flagged\\[] and summary"):
        _parse_llm_json('{"summary":"ok"}')


def test_should_raise_when_summary_field_is_missing() -> None:
    with pytest.raises(ValueError, match="flagged\\[] and summary"):
        _parse_llm_json('{"flagged":[]}')


def test_should_raise_when_summary_is_empty() -> None:
    with pytest.raises(ValueError, match="flagged\\[] and summary"):
        _parse_llm_json('{"flagged":[],"summary":"  "}')


def test_should_reject_a_flagged_timestamp_without_a_matching_subtitle() -> None:
    with pytest.raises(ValueError, match="did not match a subtitle cue"):
        _enrich_flagged_items(
            "gemini",
            [SubtitleEntry(index=1, start_time=3.2, end_time=4.0, text="First")],
            [{"startTime": 9.0, "reason": "bad", "priority": "low"}],
        )


@pytest.mark.parametrize(
    "payload",
    [
        '{"flagged":["not-an-object"],"summary":"ok"}',
        '{"flagged":[{"startTime":NaN,"reason":"bad","priority":"low"}],"summary":"ok"}',
        '{"flagged":[{"startTime":Infinity,"reason":"bad","priority":"low"}],"summary":"ok"}',
        '{"flagged":[{"startTime":-1.0,"reason":"bad","priority":"low"}],"summary":"ok"}',
        '{"flagged":[{"startTime":1.0,"reason":"bad"}],"summary":"ok"}',
    ],
)
def test_should_reject_malformed_flagged_items(payload: str) -> None:
    with pytest.raises(ValueError, match="LLM"):
        _parse_llm_json(payload)


def test_should_reject_an_integer_start_time_that_cannot_be_represented_as_float() -> None:
    huge_integer = "9" * 400
    payload = (
        f'{{"flagged":[{{"startTime":{huge_integer},'
        '"reason":"bad","priority":"low"}],"summary":"ok"}'
    )

    with pytest.raises(ValueError, match="startTime"):
        _parse_llm_json(payload)


def test_should_normalize_invalid_priority_to_medium() -> None:
    assert _validate_priority("urgent") == "medium"
    assert _validate_priority("") == "medium"
    assert _validate_priority(None) == "medium"
    assert _validate_priority(" HIGH ") == "high"


class StubResponse:
    def __init__(
        self, payload: dict[str, object] | None = None, body: bytes | None = None
    ) -> None:
        self.payload = payload
        self.body = body

    def __enter__(self) -> "StubResponse":
        return self

    def __exit__(self, *_args: object) -> None:
        return None

    def read(self, _limit: int) -> bytes:
        if self.body is not None:
            return self.body
        return json.dumps(self.payload).encode("utf-8")


def test_should_retry_transient_llm_http_errors() -> None:
    attempts = 0
    delays: list[float] = []

    def urlopen_with_transient_failures(_request: object, timeout: float) -> StubResponse:
        nonlocal attempts
        attempts += 1
        assert timeout == 600.0
        if attempts < 3:
            raise HTTPError(
                "https://example.test",
                503,
                "Service Unavailable",
                Message(),
                None,
            )
        return StubResponse({"ok": True})

    result = _post_json(
        "https://example.test",
        {"prompt": "test"},
        {},
        urlopen_fn=urlopen_with_transient_failures,
        sleep_fn=delays.append,
    )

    assert result == {"ok": True}
    assert attempts == 3
    assert delays == [1.0, 2.0]


def test_should_not_retry_permanent_llm_http_errors() -> None:
    attempts = 0

    def urlopen_with_client_error(_request: object, timeout: float) -> StubResponse:
        nonlocal attempts
        attempts += 1
        raise HTTPError("https://example.test", 400, "Bad Request", Message(), None)

    with pytest.raises(ValueError, match="HTTP status 400"):
        _post_json(
            "https://example.test",
            {"prompt": "test"},
            {},
            urlopen_fn=urlopen_with_client_error,
            sleep_fn=lambda _delay: None,
        )

    assert attempts == 1


def test_should_not_include_provider_urls_or_keys_in_http_errors() -> None:
    def urlopen_with_auth_error(_request: object, timeout: float) -> StubResponse:
        del timeout
        raise HTTPError(
            "https://example.test?key=secret-api-key",
            401,
            "Unauthorized",
            Message(),
            None,
        )

    with pytest.raises(ValueError) as raised:
        _post_json(
            "https://example.test",
            {"prompt": "test"},
            {},
            urlopen_fn=urlopen_with_auth_error,
        )

    assert "secret-api-key" not in str(raised.value)


def test_should_retry_transient_network_errors() -> None:
    attempts = 0
    delays: list[float] = []

    def urlopen_with_network_failures(_request: object, timeout: float) -> StubResponse:
        nonlocal attempts
        attempts += 1
        assert timeout == 600.0
        if attempts < 3:
            raise URLError("temporary network failure")
        return StubResponse({"ok": True})

    result = _post_json(
        "https://example.test",
        {"prompt": "test"},
        {},
        urlopen_fn=urlopen_with_network_failures,
        sleep_fn=delays.append,
    )

    assert result == {"ok": True}
    assert attempts == 3
    assert delays == [1.0, 2.0]


def test_should_reject_an_unbounded_provider_response() -> None:
    with pytest.raises(ValueError, match="provider response exceeds"):
        _post_json(
            "https://example.test",
            {"prompt": "test"},
            {},
            urlopen_fn=lambda _request, timeout: StubResponse(
                body=b"x" * (llm_module.MAX_LLM_RESPONSE_BYTES + 1)
            ),
        )


def test_should_reject_a_non_object_provider_response() -> None:
    with pytest.raises(ValueError, match="provider response must be a JSON object"):
        _post_json(
            "https://example.test",
            {"prompt": "test"},
            {},
            urlopen_fn=lambda _request, timeout: StubResponse(body=b"[]"),
        )
