from al_iyaal_worker.moderation.llm import (
    _build_analysis_prompt,
    _enrich_flagged_items,
    _parse_llm_json,
    describe_llm_request,
)
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
