from __future__ import annotations

import json
import math
import socket
import time
from bisect import bisect_left
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
from typing import Any
from urllib import error, parse, request

from ..subtitles import SubtitleEntry
from ..timecode import parse_time_to_seconds
from .agents import AGENT_ENGINES, run_analysis_agent

GEMINI_API_URL = "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
NOVA_API_URL = "https://api.nova.amazon.com/v1/chat/completions"
RETRYABLE_HTTP_STATUS_CODES = {429, 500, 502, 503, 504}
LLM_REQUEST_MAX_ATTEMPTS = 3
MAX_LLM_RESPONSE_CHARS = 2_000_000
MAX_LLM_RESPONSE_BYTES = 2_000_000

PROMPT_DIRECTORY = Path(__file__).with_name("prompts")
ANALYZE_PROMPT = (PROMPT_DIRECTORY / "cloud.txt").read_text(encoding="utf-8").rstrip()
AGENT_ANALYZE_PROMPT = (PROMPT_DIRECTORY / "agent.txt").read_text(encoding="utf-8").rstrip()


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


def _reject_nonstandard_json_constant(value: str) -> None:
    raise ValueError(f"LLM response contains non-standard numeric value: {value}")


def _validate_priority(value: Any) -> str:
    lowered = str(value).strip().lower()
    if lowered in {"high", "medium", "low"}:
        return lowered
    return "medium"


def _format_subtitles_for_prompt(subtitles: list[SubtitleEntry]) -> str:
    def format_srt_time(seconds: float) -> str:
        milliseconds = round(seconds * 1000)
        hours, remainder = divmod(milliseconds, 3_600_000)
        minutes, remainder = divmod(remainder, 60_000)
        whole_seconds, millis = divmod(remainder, 1000)
        return f"{hours:02d}:{minutes:02d}:{whole_seconds:02d},{millis:03d}"

    return "\n\n".join(
        [
            f"{item.index}\n{format_srt_time(item.start_time)} --> {format_srt_time(item.end_time)}\n{item.text}"
            for item in subtitles
        ]
    )


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


def _build_agent_analysis_prompt(
    video_file_name: str,
    criteria: str,
    guidelines: str,
) -> str:
    return (
        AGENT_ANALYZE_PROMPT.replace("{{videoFileName}}", video_file_name)
        .replace("{{criteria}}", criteria)
        .replace("{{guidelines}}", guidelines)
    )


def _normalize_start_time(value: Any) -> float | None:
    if isinstance(value, bool):
        return None
    try:
        numeric_value = (
            parse_time_to_seconds(value) if isinstance(value, str) else float(value)
        )
    except (OverflowError, TypeError, ValueError):
        return None
    return numeric_value if math.isfinite(numeric_value) and numeric_value >= 0 else None


def _parse_llm_json(raw_text: str) -> dict[str, Any]:
    if len(raw_text) > MAX_LLM_RESPONSE_CHARS:
        raise ValueError(
            f"LLM response exceeds the {MAX_LLM_RESPONSE_CHARS} character limit."
        )

    sanitized = _sanitize_response(raw_text)
    decoder = json.JSONDecoder(parse_constant=_reject_nonstandard_json_constant)
    object_start = sanitized.find("{")
    if object_start < 0:
        payload, object_end = decoder.raw_decode(sanitized)
    else:
        payload, object_end = decoder.raw_decode(sanitized, object_start)

    if sanitized[object_end:].strip():
        raise ValueError("LLM response contains trailing content after the JSON object.")

    if not isinstance(payload, dict):
        raise ValueError("LLM response did not contain a JSON object.")

    flagged = payload.get("flagged")
    summary = payload.get("summary")
    if (
        not isinstance(flagged, list)
        or not isinstance(summary, str)
        or not summary.strip()
    ):
        raise ValueError("LLM response did not contain flagged[] and summary.")

    for index, item in enumerate(flagged):
        if not isinstance(item, dict):
            raise ValueError(f"LLM flagged item {index} must be an object.")
        cue_index = item.get("cueIndex")
        if isinstance(cue_index, bool) or not isinstance(cue_index, int) or cue_index < 0:
            normalized_start_time = _normalize_start_time(item.get("startTime"))
            if normalized_start_time is None:
                raise ValueError(
                    f"LLM flagged item {index} requires a valid cueIndex or legacy startTime."
                )
            item["startTime"] = normalized_start_time
        reason = item.get("reason")
        priority = item.get("priority")
        if not isinstance(reason, str) or not reason.strip():
            raise ValueError(f"LLM flagged item {index} has an invalid reason.")
        if not isinstance(priority, str) or priority.strip().lower() not in {
            "high",
            "medium",
            "low",
        }:
            raise ValueError(f"LLM flagged item {index} has an invalid priority.")
    return payload


def _find_subtitle(
    subtitles: list[SubtitleEntry], start_times: list[float], start_time: float
) -> SubtitleEntry | None:
    index = bisect_left(start_times, start_time)
    candidate_indexes = [index - 1, index, index + 1]
    for candidate_index in candidate_indexes:
        if candidate_index < 0 or candidate_index >= len(subtitles):
            continue

        subtitle = subtitles[candidate_index]
        if abs(subtitle.start_time - start_time) <= 0.15:
            return subtitle
    return None


def _enrich_flagged_items(
    engine: str,
    subtitles: list[SubtitleEntry],
    flagged_items: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    enriched: list[dict[str, Any]] = []
    sorted_subtitles = sorted(subtitles, key=lambda subtitle: subtitle.start_time)
    start_times = [subtitle.start_time for subtitle in sorted_subtitles]
    subtitles_by_index: dict[int, list[SubtitleEntry]] = {}
    for subtitle in sorted_subtitles:
        subtitles_by_index.setdefault(subtitle.index, []).append(subtitle)

    for item in flagged_items:
        cue_index = item.get("cueIndex")
        if isinstance(cue_index, int) and not isinstance(cue_index, bool):
            cue_matches = subtitles_by_index.get(cue_index, [])
            if len(cue_matches) != 1:
                raise ValueError(
                    f"LLM cueIndex {cue_index} did not uniquely match a subtitle cue."
                )
            subtitle = cue_matches[0]
        else:
            start_time = float(item.get("startTime", 0))
            subtitle = _find_subtitle(sorted_subtitles, start_times, start_time)
            if subtitle is None:
                raise ValueError(
                    f"LLM flagged timestamp {start_time:.3f} did not match a subtitle cue."
                )
        enriched.append(
            {
                "category": "llm",
                "cueIndex": subtitle.index,
                "endTime": subtitle.end_time,
                "priority": _validate_priority(item.get("priority")),
                "reason": str(item.get("reason", "Flagged by provider analysis.")),
                "ruleId": engine,
                "startTime": subtitle.start_time,
                "text": subtitle.text,
            }
        )

    enriched.sort(key=lambda item: (item["startTime"], item["priority"] != "high"))
    return enriched


def _post_json(
    url: str,
    payload: dict[str, Any],
    headers: dict[str, str],
    timeout_seconds: float = 600.0,
    urlopen_fn: Callable[..., Any] = request.urlopen,
    sleep_fn: Callable[[float], None] = time.sleep,
) -> dict[str, Any]:
    parsed = parse.urlparse(url)
    if parsed.scheme not in {"http", "https"}:
        raise ValueError(f"Unsupported URL scheme: {parsed.scheme}")

    body = json.dumps(payload, allow_nan=False).encode("utf-8")
    request_headers = {"Content-Type": "application/json", **headers}
    http_request = request.Request(url, data=body, headers=request_headers, method="POST")

    for attempt in range(LLM_REQUEST_MAX_ATTEMPTS):
        try:
            with urlopen_fn(http_request, timeout=timeout_seconds) as response:
                response_body = response.read(MAX_LLM_RESPONSE_BYTES + 1)
                if len(response_body) > MAX_LLM_RESPONSE_BYTES:
                    raise ValueError(
                        f"LLM provider response exceeds the {MAX_LLM_RESPONSE_BYTES}-byte limit."
                    )
                decoded = json.loads(
                    response_body.decode("utf-8"),
                    parse_constant=_reject_nonstandard_json_constant,
                )
                if not isinstance(decoded, dict):
                    raise ValueError("LLM provider response must be a JSON object.")
                return decoded
        except error.HTTPError as http_error:
            is_last_attempt = attempt == LLM_REQUEST_MAX_ATTEMPTS - 1
            if http_error.code not in RETRYABLE_HTTP_STATUS_CODES or is_last_attempt:
                raise ValueError(
                    f"LLM provider request failed with HTTP status {http_error.code}."
                ) from None
            sleep_fn(float(2**attempt))
        except (error.URLError, TimeoutError, socket.timeout):
            is_last_attempt = attempt == LLM_REQUEST_MAX_ATTEMPTS - 1
            if is_last_attempt:
                raise ValueError(
                    "LLM provider request failed after transient network errors."
                ) from None
            sleep_fn(float(2**attempt))

    raise RuntimeError("LLM request exhausted all attempts.")


def _resolve_strategy(settings: dict[str, Any]) -> str:
    strategy = str(settings.get("analysisStrategy", "fast")).strip().lower()
    return "deep" if strategy == "deep" else "fast"


def _gemini_model_for_strategy(strategy: str) -> str:
    return "gemini-2.5-pro" if strategy == "deep" else "gemini-3.6-flash"


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

    if engine in AGENT_ENGINES:
        model = str(settings.get("agentModel", "")).strip()
        if not model:
            raise ValueError("Agent model is missing. Select one in Settings.")
        reasoning_level = str(settings.get("agentReasoningLevel", "")).strip()
        return LlmRequestConfig(
            engine=engine,
            endpoint=f"cli://{engine}",
            model=model,
            strategy=reasoning_level or "agent-default",
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

    first_candidate = candidates[0]
    if not isinstance(first_candidate, dict):
        raise ValueError("Gemini response contained an invalid candidate envelope.")
    content = first_candidate.get("content")
    if not isinstance(content, dict):
        raise ValueError("Gemini response contained an invalid content envelope.")
    parts = content.get("parts", [])
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

    first_choice = choices[0]
    if not isinstance(first_choice, dict):
        raise ValueError("Nova response contained an invalid choice envelope.")
    message = first_choice.get("message")
    if not isinstance(message, dict):
        raise ValueError("Nova response contained an invalid message envelope.")
    message_content = message.get("content")
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
    agent_executable_path: str | None = None,
    agent_subtitle_path: str | Path | None = None,
) -> LlmAnalysisResult:
    request_config = describe_llm_request(settings)
    criteria = str(settings.get("contentCriteria", ""))
    guidelines = str(settings.get("priorityGuidelines", ""))

    if request_config.engine == "gemini":
        prompt = _build_analysis_prompt(
            video_file_name, criteria, guidelines, subtitles
        )
        api_key = str(settings.get("googleApiKey", "")).strip()
        if not api_key:
            raise ValueError("Gemini API key is missing. Save it in Settings.")
        raw_text = _call_gemini(prompt, api_key, request_config.strategy)
    elif request_config.engine == "nova_pro":
        prompt = _build_analysis_prompt(
            video_file_name, criteria, guidelines, subtitles
        )
        api_key = str(settings.get("amazonNovaApiKey", "")).strip()
        if not api_key:
            raise ValueError("Amazon Nova API key is missing. Save it in Settings.")
        raw_text = _call_nova(prompt, api_key, request_config.strategy)
    elif request_config.engine in AGENT_ENGINES:
        if not agent_executable_path:
            raise ValueError(
                f"{request_config.engine} is unavailable. Refresh Analysis Providers in Settings."
            )
        if agent_subtitle_path is None:
            raise ValueError("Subtitle file is required for local agent analysis.")
        prompt = _build_agent_analysis_prompt(video_file_name, criteria, guidelines)
        raw_text = run_analysis_agent(
            request_config.engine,
            agent_executable_path,
            request_config.model,
            str(settings.get("agentReasoningLevel", "")).strip(),
            prompt,
            agent_subtitle_path,
        )
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
