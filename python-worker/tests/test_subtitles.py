import pytest

from al_iyaal_worker.subtitles import parse_srt


def test_should_parse_and_order_valid_srt_cues() -> None:
    entries = parse_srt(
        "2\n00:00:03,000 --> 00:00:04,000\nLater\n\n"
        "1\n00:00:01,000 --> 00:00:02,000\nEarlier"
    )

    assert [entry.text for entry in entries] == ["Earlier", "Later"]


@pytest.mark.parametrize(
    "content, message",
    [
        (
            "1\n00:99:00,000 --> 01:00:01,000\nBad minute",
            "Invalid SRT timestamp",
        ),
        (
            "2\n00:00:05,000 --> 00:00:04,000\nBackwards",
            "Invalid SRT range",
        ),
        ("not a cue", "Invalid SRT cue block"),
        ("1\n00:00:01,000 --> 00:00:02,000\n   ", "Empty SRT cue text"),
    ],
)
def test_should_reject_malformed_nonempty_srt_cues(
    content: str, message: str
) -> None:
    with pytest.raises(ValueError, match=message):
        parse_srt(content)
