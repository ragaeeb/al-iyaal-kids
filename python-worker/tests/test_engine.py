import pytest

import al_iyaal_worker.moderation.engine as engine_module
from al_iyaal_worker.moderation.engine import analyze_subtitles
from al_iyaal_worker.subtitles import SubtitleEntry


def _subtitle(text: str) -> SubtitleEntry:
    return SubtitleEntry(index=1, start_time=1.0, end_time=2.0, text=text)


def _rule(pattern: str) -> dict[str, object]:
    return {
        "ruleId": "test-rule",
        "category": "test",
        "priority": "high",
        "reason": "Matched test rule.",
        "patterns": [pattern],
    }


def test_should_match_rule_words_without_matching_substrings(monkeypatch) -> None:
    class NoProfanity:
        @staticmethod
        def contains_profanity(_text: str) -> bool:
            return False

    monkeypatch.setattr(engine_module, "profanity", NoProfanity())
    settings = {
        "rules": [_rule("date"), _rule("kill"), _rule("spell")],
    }

    flagged, _summary = analyze_subtitles(
        [_subtitle("update skill spelling date")], settings
    )

    assert len(flagged) == 1
    assert flagged[0]["reason"] == "Matched test rule."


def test_should_match_escaped_phrases_at_lexical_boundaries() -> None:
    settings = {"rules": [_rule("magic ritual") ]}

    flagged, _summary = analyze_subtitles(
        [_subtitle("A magic ritual happened.")], settings
    )

    assert len(flagged) == 1


def test_should_allow_an_explicitly_empty_rule_list() -> None:
    flagged, summary = analyze_subtitles(
        [_subtitle("date skill spelling")], {"rules": []}
    )

    assert flagged == []
    assert summary == "No concerning content detected."


@pytest.mark.parametrize(
    "settings",
    [
        {},
        {"rules": "not-a-list"},
        {"rules": ["not-an-object"]},
        {"rules": [{"ruleId": "missing-fields"}]},
        {"rules": [_rule(" ")]},
        {"rules": [{**_rule("date"), "priority": "urgent"}]},
    ],
)
def test_should_reject_missing_or_structurally_invalid_rules(
    settings: dict[str, object],
) -> None:
    with pytest.raises(ValueError, match="Moderation"):
        analyze_subtitles([_subtitle("safe")], settings)
