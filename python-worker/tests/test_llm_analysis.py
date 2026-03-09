import json

from al_iyaal_worker.moderation.llm import (
    _build_analysis_prompt,
    _enrich_flagged_items,
    _parse_llm_json,
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
    assert "[3.20s]: Christmas is here." in prompt


def test_should_parse_json_wrapped_in_code_fences() -> None:
    payload = _parse_llm_json(
        """```json
{"flagged":[{"startTime":3.2,"reason":"aqeedah","priority":"high"}],"summary":"summary"}
```"""
    )

    assert payload["summary"] == "summary"
    assert payload["flagged"][0]["priority"] == "high"


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


def test_should_describe_gemini_fast_request_config() -> None:
    request_config = describe_llm_request({"analysisStrategy": "fast", "engine": "gemini"})

    assert request_config.engine == "gemini"
    assert request_config.model == "gemini-2.5-flash"
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


def test_should_normalize_invalid_priority_to_medium() -> None:
    assert _validate_priority("urgent") == "medium"
    assert _validate_priority("") == "medium"
    assert _validate_priority(None) == "medium"
    assert _validate_priority(" HIGH ") == "high"
