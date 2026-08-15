import re
from dataclasses import dataclass
from pathlib import Path

SRT_TIME_RE = re.compile(
    r"\s*(?P<start>\d{2}:\d{2}:\d{2},\d{3})\s*-->\s*(?P<end>\d{2}:\d{2}:\d{2},\d{3})\s*"
)


@dataclass(slots=True)
class SubtitleEntry:
    index: int
    start_time: float
    end_time: float
    text: str


def parse_srt_timestamp(value: str) -> float:
    hh_mm, ms = value.rsplit(",", maxsplit=1)
    hours, minutes, seconds = [int(part) for part in hh_mm.split(":")]
    millis = int(ms)
    if minutes >= 60 or seconds >= 60 or millis >= 1000:
        raise ValueError(f"Invalid SRT timestamp: {value}")
    return hours * 3600 + minutes * 60 + seconds + millis / 1000


def parse_srt(content: str) -> list[SubtitleEntry]:
    normalized = content.replace("\r\n", "\n").replace("\r", "\n")
    if not normalized.strip():
        return []
    normalized = normalized.strip("\n")

    blocks = re.split(r"\n{2,}", normalized)
    entries: list[SubtitleEntry] = []
    for block_number, block in enumerate(blocks, start=1):
        lines = block.split("\n")
        if len(lines) < 3:
            raise ValueError(
                f"Invalid SRT cue block {block_number}: expected index, timestamp, and text."
            )

        time_match = SRT_TIME_RE.fullmatch(lines[1])
        if time_match is None:
            raise ValueError(
                f"Invalid SRT timestamp in cue block {block_number}: {lines[1]!r}"
            )

        try:
            index = int(lines[0])
        except ValueError:
            raise ValueError(
                f"Invalid SRT cue index in block {block_number}: {lines[0]!r}"
            ) from None
        if index < 0:
            raise ValueError(f"Invalid SRT cue index in block {block_number}: {index}")

        try:
            start_time = parse_srt_timestamp(time_match.group("start"))
            end_time = parse_srt_timestamp(time_match.group("end"))
        except ValueError as error:
            raise ValueError(f"Invalid SRT timestamp in cue block {block_number}: {error}") from error
        if end_time <= start_time:
            raise ValueError(
                f"Invalid SRT range in cue block {block_number}: end must be after start."
            )

        text = "\n".join(lines[2:]).strip()
        if not text:
            raise ValueError(f"Empty SRT cue text in block {block_number}.")

        entries.append(
            SubtitleEntry(
                index=index,
                start_time=start_time,
                end_time=end_time,
                text=text,
            )
        )

    return sorted(entries, key=lambda entry: (entry.start_time, entry.index))


def sidecar_srt_path(video_path: Path) -> Path:
    return video_path.with_suffix(".srt")


def sidecar_analysis_path(video_path: Path) -> Path:
    return video_path.with_suffix(".analysis.json")
