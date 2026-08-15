from collections import Counter
from dataclasses import dataclass
import re
from typing import Any, Literal, Protocol, cast


Priority = Literal["high", "medium", "low"]


class _ProfanityChecker(Protocol):
    def contains_profanity(self, text: str) -> bool: ...


try:
    from better_profanity import profanity as _better_profanity
except ImportError:  # pragma: no cover - fallback for dev environments without runtime extras
    class _FallbackProfanity:
        _words = {"damn", "hell", "crap", "stupid"}

        @classmethod
        def contains_profanity(cls, text: str) -> bool:
            words = re.findall(r"[a-zA-Z']+", text.lower())
            return any(word in cls._words for word in words)


    profanity: _ProfanityChecker = _FallbackProfanity()
else:
    profanity = cast("_ProfanityChecker", _better_profanity)

from ..subtitles import SubtitleEntry


@dataclass(slots=True)
class ModerationRule:
    rule_id: str
    category: str
    priority: Priority
    reason: str
    patterns: list[str]


PRIORITY_BY_NAME: dict[str, Priority] = {
    "high": "high",
    "medium": "medium",
    "low": "low",
}


def _to_priority(value: str) -> Priority:
    return PRIORITY_BY_NAME.get(value.strip().lower(), "medium")


def _normalize_rules(raw_rules: Any) -> list[ModerationRule]:
    if not isinstance(raw_rules, list):
        raise ValueError("Moderation settings must include a rules array.")

    normalized: list[ModerationRule] = []
    for index, raw_rule in enumerate(raw_rules):
        if not isinstance(raw_rule, dict):
            raise ValueError(f"Moderation rule {index} must be an object.")

        rule_id = raw_rule.get("ruleId")
        category = raw_rule.get("category")
        reason = raw_rule.get("reason")
        priority = raw_rule.get("priority")
        patterns = raw_rule.get("patterns")
        if not all(
            isinstance(value, str) and value.strip()
            for value in (rule_id, category, reason, priority)
        ):
            raise ValueError(f"Moderation rule {index} has invalid metadata.")
        if priority.strip().lower() not in PRIORITY_BY_NAME:
            raise ValueError(f"Moderation rule {index} has invalid priority.")
        if not isinstance(patterns, list) or not patterns or any(
            not isinstance(pattern, str) or not pattern.strip() for pattern in patterns
        ):
            raise ValueError(f"Moderation rule {index} must contain non-empty patterns.")

        normalized.append(
            ModerationRule(
                rule_id=rule_id.strip(),
                category=category.strip(),
                priority=_to_priority(priority),
                reason=reason.strip(),
                patterns=[pattern.strip().lower() for pattern in patterns],
            )
        )

    return normalized


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


def _compile_rule_pattern(pattern: str) -> re.Pattern[str]:
    return re.compile(rf"(?<!\w){re.escape(pattern)}(?!\w)", re.IGNORECASE)


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
    compiled_rules = [
        (rule, tuple(_compile_rule_pattern(pattern) for pattern in rule.patterns))
        for rule in rules
    ]
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

        for rule, patterns in compiled_rules:
            if not any(pattern.search(lowered_text) for pattern in patterns):
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
