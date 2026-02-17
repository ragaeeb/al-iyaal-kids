import re
from dataclasses import dataclass
from pathlib import Path

SRT_TIME_RE = re.compile(
    r"(?P<start>\d{2}:\d{2}:\d{2},\d{3})\s*-->\s*(?P<end>\d{2}:\d{2}:\d{2},\d{3})"
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
    return hours * 3600 + minutes * 60 + seconds + millis / 1000


def parse_srt(content: str) -> list[SubtitleEntry]:
    normalized = content.replace("\r\n", "\n").replace("\r", "\n").strip()
    if not normalized:
        return []

    blocks = normalized.split("\n\n")
    entries: list[SubtitleEntry] = []
    for block in blocks:
        lines = [line for line in block.split("\n") if line]
        if len(lines) < 3:
            continue

        time_match = SRT_TIME_RE.search(lines[1])
        if time_match is None:
            continue

        try:
            index = int(lines[0])
        except ValueError:
            continue

        entries.append(
            SubtitleEntry(
                index=index,
                start_time=parse_srt_timestamp(time_match.group("start")),
                end_time=parse_srt_timestamp(time_match.group("end")),
                text="\n".join(lines[2:]).strip(),
            )
        )

    return entries


def sidecar_srt_path(video_path: Path) -> Path:
    return video_path.with_suffix(".srt")


def sidecar_analysis_path(video_path: Path) -> Path:
    return video_path.with_suffix(".analysis.json")
