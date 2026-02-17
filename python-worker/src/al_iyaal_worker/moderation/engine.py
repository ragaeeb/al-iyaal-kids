from collections import Counter
from dataclasses import dataclass
import re
from typing import Any, Literal

try:
    from better_profanity import profanity
except Exception:  # pragma: no cover - fallback for dev environments without runtime extras
    class _FallbackProfanity:
        _words = {"damn", "hell", "crap", "stupid"}

        @classmethod
        def contains_profanity(cls, text: str) -> bool:
            words = re.findall(r"[a-zA-Z']+", text.lower())
            return any(word in cls._words for word in words)

    profanity = _FallbackProfanity()

from ..subtitles import SubtitleEntry

Priority = Literal["high", "medium", "low"]


@dataclass(slots=True)
class ModerationRule:
    rule_id: str
    category: str
    priority: Priority
    reason: str
    patterns: list[str]


def default_rules() -> list[ModerationRule]:
    return [
        ModerationRule(
            rule_id="aqeedah_christmas",
            category="aqeedah",
            priority="high",
            reason="Promotes non-Islamic religious celebration.",
            patterns=["christmas", "xmas", "easter"],
        ),
        ModerationRule(
            rule_id="aqeedah_shirk",
            category="aqeedah",
            priority="high",
            reason="Contains shirk-related expressions.",
            patterns=["worship", "pray to", "god of", "goddess"],
        ),
        ModerationRule(
            rule_id="magic_sorcery",
            category="magic",
            priority="high",
            reason="References magic or sorcery.",
            patterns=["spell", "sorcery", "magic ritual", "witchcraft", "summon"],
        ),
        ModerationRule(
            rule_id="romance_dating",
            category="relationships",
            priority="medium",
            reason="References romantic relationship themes.",
            patterns=["boyfriend", "girlfriend", "date", "kiss", "romantic"],
        ),
        ModerationRule(
            rule_id="violent_language",
            category="violence",
            priority="medium",
            reason="Contains violent phrasing.",
            patterns=["kill", "murder", "stab", "blood", "beat up"],
        ),
    ]


def _to_priority(value: str) -> Priority:
    lowered = value.strip().lower()
    if lowered in {"high", "medium", "low"}:
        return lowered  # type: ignore[return-value]
    return "medium"


def _normalize_rules(raw_rules: Any) -> list[ModerationRule]:
    if not isinstance(raw_rules, list):
        return default_rules()

    normalized: list[ModerationRule] = []
    for raw_rule in raw_rules:
        if not isinstance(raw_rule, dict):
            continue
        patterns = raw_rule.get("patterns", [])
        if not isinstance(patterns, list):
            continue

        normalized.append(
            ModerationRule(
                rule_id=str(raw_rule.get("ruleId", "custom_rule")),
                category=str(raw_rule.get("category", "custom")),
                priority=_to_priority(str(raw_rule.get("priority", "medium"))),
                reason=str(raw_rule.get("reason", "Matched moderation rule.")),
                patterns=[str(pattern).strip().lower() for pattern in patterns if str(pattern).strip()],
            )
        )

    return normalized if normalized else default_rules()


def _extract_custom_profanity_words(settings: dict[str, Any]) -> set[str]:
    raw_words = settings.get("profanityWords", [])
    if not isinstance(raw_words, list):
        return set()
    return {str(word).strip().lower() for word in raw_words if str(word).strip()}


def _contains_custom_word(text: str, custom_words: set[str]) -> bool:
    if not custom_words:
        return False

    words = re.findall(r"[a-zA-Z']+", text.lower())
    return any(word in custom_words for word in words)


def _priority_rank(priority: Priority) -> int:
    if priority == "high":
        return 3
    if priority == "medium":
        return 2
    return 1


def analyze_subtitles(
    subtitles: list[SubtitleEntry],
    settings: dict[str, Any],
) -> tuple[list[dict[str, Any]], str]:
    rules = _normalize_rules(settings.get("rules"))
    custom_profanity_words = _extract_custom_profanity_words(settings)

    flagged: list[dict[str, Any]] = []
    seen: set[tuple[int, str]] = set()
    for entry in subtitles:
        lowered_text = entry.text.lower()

        if profanity.contains_profanity(lowered_text) or _contains_custom_word(
            lowered_text, custom_profanity_words
        ):
            key = (int(entry.start_time * 1000), "profanity")
            if key not in seen:
                seen.add(key)
                flagged.append(
                    {
                        "startTime": entry.start_time,
                        "endTime": entry.end_time,
                        "text": entry.text,
                        "reason": "Contains profanity or offensive language.",
                        "priority": "medium",
                        "category": "language",
                        "ruleId": "profanity",
                    }
                )

        for rule in rules:
            if not rule.patterns:
                continue
            if not any(pattern in lowered_text for pattern in rule.patterns):
                continue

            key = (int(entry.start_time * 1000), rule.rule_id)
            if key in seen:
                continue

            seen.add(key)
            flagged.append(
                {
                    "startTime": entry.start_time,
                    "endTime": entry.end_time,
                    "text": entry.text,
                    "reason": rule.reason,
                    "priority": rule.priority,
                    "category": rule.category,
                    "ruleId": rule.rule_id,
                }
            )

    flagged.sort(
        key=lambda item: (
            item["startTime"],
            -_priority_rank(item["priority"]),  # high first when startTime matches
        )
    )

    priority_counts = Counter([item["priority"] for item in flagged])
    summary = (
        "No concerning content detected."
        if not flagged
        else (
            f"Flagged {len(flagged)} subtitle item(s). "
            f"high={priority_counts.get('high', 0)}, "
            f"medium={priority_counts.get('medium', 0)}, "
            f"low={priority_counts.get('low', 0)}."
        )
    )

    return flagged, summary
