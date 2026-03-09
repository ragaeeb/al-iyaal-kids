from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any
from urllib import parse, request

from ..subtitles import SubtitleEntry

GEMINI_API_URL = "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
NOVA_API_URL = "https://api.nova.amazon.com/v1/chat/completions"

ANALYZE_PROMPT = """You are analyzing subtitle content for a children's video to identify inappropriate material.

Video being analyzed: {{videoFileName}}

Analyze the following subtitles and flag any content that contains:

{{criteria}}

{{guidelines}}

For each problematic subtitle, identify the exact timestamp, assign a priority level, and provide a brief reason for flagging it.

Additionally, provide a summary of the overall storyline based on the subtitles.

Subtitles:
{{subtitles}}

Respond ONLY with a valid JSON object in this exact format, with no additional text or markdown or code fences:
{
  "flagged": [
    {
      "startTime": 12.5,
      "reason": "brief explanation",
      "priority": "high"
    }
  ],
  "summary": "Brief storyline summary based on all subtitles"
}

If no issues are found, respond with: {"flagged": [], "summary": "your summary here"}"""


@dataclass(slots=True)
class LlmAnalysisResult:
    engine: str
    flagged: list[dict[str, Any]]
    summary: str


@dataclass(slots=True)
class LlmRequestConfig:
    engine: str
    endpoint: str
    model: str
    strategy: str


def _sanitize_response(text: str) -> str:
    cleaned = text.strip()
    if cleaned.startswith("```json"):
        cleaned = cleaned[7:]
    elif cleaned.startswith("```"):
        cleaned = cleaned[3:]

    if cleaned.endswith("```"):
        cleaned = cleaned[:-3]

    return cleaned.strip()


def _validate_priority(value: Any) -> str:
    lowered = str(value).strip().lower()
    if lowered in {"high", "medium", "low"}:
        return lowered
    return "medium"


def _format_subtitles_for_prompt(subtitles: list[SubtitleEntry]) -> str:
    return "\n".join([f"[{item.start_time:.2f}s]: {item.text}" for item in subtitles])


def _build_analysis_prompt(
    video_file_name: str,
    criteria: str,
    guidelines: str,
    subtitles: list[SubtitleEntry],
) -> str:
    return (
        ANALYZE_PROMPT.replace("{{videoFileName}}", video_file_name)
        .replace("{{criteria}}", criteria)
        .replace("{{guidelines}}", guidelines)
        .replace("{{subtitles}}", _format_subtitles_for_prompt(subtitles))
    )


def _parse_llm_json(raw_text: str) -> dict[str, Any]:
    sanitized = _sanitize_response(raw_text)
    payload = json.loads(sanitized)
    if not isinstance(payload, dict):
        raise ValueError("LLM response was not a JSON object.")
    flagged = payload.get("flagged")
    summary = payload.get("summary")
    if not isinstance(flagged, list) or not isinstance(summary, str):
        raise ValueError("LLM response did not contain flagged[] and summary.")
    return payload


def _find_subtitle(subtitles: list[SubtitleEntry], start_time: float) -> SubtitleEntry | None:
    for subtitle in subtitles:
        if abs(subtitle.start_time - start_time) <= 0.15:
            return subtitle
    return None


def _enrich_flagged_items(
    engine: str,
    subtitles: list[SubtitleEntry],
    flagged_items: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    enriched: list[dict[str, Any]] = []

    for item in flagged_items:
        start_time = float(item.get("startTime", 0))
        subtitle = _find_subtitle(subtitles, start_time)
        text = subtitle.text if subtitle else str(item.get("text", "")).strip()
        enriched.append(
            {
                "category": "llm",
                "endTime": subtitle.end_time if subtitle else start_time + 1,
                "priority": _validate_priority(item.get("priority")),
                "reason": str(item.get("reason", "Flagged by provider analysis.")),
                "ruleId": engine,
                "startTime": subtitle.start_time if subtitle else start_time,
                "text": text,
            }
        )

    enriched.sort(key=lambda item: (item["startTime"], item["priority"] != "high"))
    return enriched


def _post_json(
    url: str,
    payload: dict[str, Any],
    headers: dict[str, str],
    timeout_seconds: float = 600.0,
) -> dict[str, Any]:
    parsed = parse.urlparse(url)
    if parsed.scheme not in {"http", "https"}:
        raise ValueError(f"Unsupported URL scheme: {parsed.scheme}")

    body = json.dumps(payload).encode("utf-8")
    request_headers = {"Content-Type": "application/json", **headers}
    http_request = request.Request(url, data=body, headers=request_headers, method="POST")

    with request.urlopen(http_request, timeout=timeout_seconds) as response:
        return json.loads(response.read().decode("utf-8"))


def _resolve_strategy(settings: dict[str, Any]) -> str:
    strategy = str(settings.get("analysisStrategy", "fast")).strip().lower()
    return "deep" if strategy == "deep" else "fast"


def _gemini_model_for_strategy(strategy: str) -> str:
    return "gemini-2.5-pro" if strategy == "deep" else "gemini-2.5-flash"


def _nova_model_for_strategy(strategy: str) -> str:
    return "nova-pro-v1" if strategy == "deep" else "nova-2-lite-v1"


def describe_llm_request(settings: dict[str, Any]) -> LlmRequestConfig:
    engine = str(settings.get("engine", "blacklist")).strip().lower()
    strategy = _resolve_strategy(settings)

    if engine == "gemini":
        model = _gemini_model_for_strategy(strategy)
        return LlmRequestConfig(
            engine=engine,
            endpoint=GEMINI_API_URL.format(model=model),
            model=model,
            strategy=strategy,
        )

    if engine == "nova_pro":
        model = _nova_model_for_strategy(strategy)
        return LlmRequestConfig(
            engine=engine,
            endpoint=NOVA_API_URL,
            model=model,
            strategy=strategy,
        )

    raise ValueError(f"Unsupported LLM engine: {engine}")


def _call_gemini(prompt: str, api_key: str, strategy: str) -> str:
    model = _gemini_model_for_strategy(strategy)
    query = parse.urlencode({"key": api_key})
    response = _post_json(
        f"{GEMINI_API_URL.format(model=model)}?{query}",
        {
            "contents": [{"parts": [{"text": prompt}]}],
            "generationConfig": {"temperature": 0.1},
        },
        {},
    )
    candidates = response.get("candidates", [])
    if not isinstance(candidates, list) or not candidates:
        raise ValueError("Gemini response did not contain candidates.")

    parts = candidates[0].get("content", {}).get("parts", [])
    text = "".join(
        [str(part.get("text", "")) for part in parts if isinstance(part, dict)]
    ).strip()
    if not text:
        raise ValueError("Gemini response did not contain text.")
    return text


def _call_nova(prompt: str, api_key: str, strategy: str) -> str:
    model = _nova_model_for_strategy(strategy)
    payload: dict[str, Any] = {
        "messages": [
            {
                "content": "You are a helpful assistant that analyzes content and returns JSON.",
                "role": "system",
            },
            {"content": prompt, "role": "user"},
        ],
        "model": model,
    }

    if strategy == "deep":
        payload["reasoning_effort"] = "high"
    else:
        payload["reasoning_effort"] = "low"

    response = _post_json(
        NOVA_API_URL,
        payload,
        {"Authorization": f"Bearer {api_key}"},
    )
    choices = response.get("choices", [])
    if not isinstance(choices, list) or not choices:
        raise ValueError("Nova response did not contain choices.")

    message_content = choices[0].get("message", {}).get("content")
    if isinstance(message_content, str):
        return message_content
    if isinstance(message_content, list):
        text = "".join(
            [
                str(item.get("text", ""))
                for item in message_content
                if isinstance(item, dict)
            ]
        ).strip()
        if text:
            return text

    raise ValueError("Nova response did not contain text content.")


def analyze_with_llm(
    subtitles: list[SubtitleEntry],
    settings: dict[str, Any],
    video_file_name: str,
) -> LlmAnalysisResult:
    request_config = describe_llm_request(settings)
    prompt = _build_analysis_prompt(
        video_file_name,
        str(settings.get("contentCriteria", "")),
        str(settings.get("priorityGuidelines", "")),
        subtitles,
    )

    if request_config.engine == "gemini":
        api_key = str(settings.get("googleApiKey", "")).strip()
        if not api_key:
            raise ValueError("Gemini API key is missing. Save it in Settings.")
        raw_text = _call_gemini(prompt, api_key, request_config.strategy)
    elif request_config.engine == "nova_pro":
        api_key = str(settings.get("amazonNovaApiKey", "")).strip()
        if not api_key:
            raise ValueError("Amazon Nova API key is missing. Save it in Settings.")
        raw_text = _call_nova(prompt, api_key, request_config.strategy)
    else:
        raise ValueError(f"Unsupported LLM engine: {request_config.engine}")

    payload = _parse_llm_json(raw_text)
    flagged_items = payload.get("flagged", [])
    summary = str(payload.get("summary", ""))

    return LlmAnalysisResult(
        engine=request_config.engine,
        flagged=_enrich_flagged_items(request_config.engine, subtitles, flagged_items),
        summary=summary,
    )


__all__ = ["LlmAnalysisResult", "LlmRequestConfig", "analyze_with_llm", "describe_llm_request"]
