from pathlib import Path


def build_ffmpeg_command(
    ffmpeg_path: str,
    video_path: Path,
    vocals_path: Path,
    output_path: Path,
) -> list[str]:
    return [
        ffmpeg_path,
        "-y",
        "-hide_banner",
        "-loglevel",
        "error",
        "-nostats",
        "-i",
        str(video_path),
        "-i",
        str(vocals_path),
        "-c:v",
        "copy",
        "-c:a",
        "aac",
        "-b:a",
        "192k",
        "-map",
        "0:v:0",
        "-map",
        "1:a:0",
        str(output_path),
    ]


def build_transcribe_command(
    yap_path: str,
    video_path: Path,
    output_srt_path: Path,
) -> list[str]:
    return [
        yap_path,
        "transcribe",
        str(video_path),
        "--srt",
        "-o",
        str(output_srt_path),
    ]


_COMPRESSION_PRESETS: dict[str, list[str]] = {
    "apple_silicon": [
        "-c:v",
        "hevc_videotoolbox",
        "-q:v",
        "75",
        "-prio_speed",
        "0",
        "-spatial_aq",
        "1",
        "-allow_sw",
        "0",
        "-tag:v",
        "hvc1",
        "-c:a",
        "aac",
        "-b:a",
        "192k",
    ],
    "max_compression": [
        "-c:v",
        "libx265",
        "-crf",
        "28",
        "-preset",
        "slow",
        "-tag:v",
        "hvc1",
        "-c:a",
        "aac",
        "-b:a",
        "64k",
        "-ac",
        "1",
    ],
    "balanced": [
        "-c:v",
        "libx264",
        "-crf",
        "20",
        "-preset",
        "veryslow",
        "-c:a",
        "aac",
        "-b:a",
        "160k",
    ],
}


def _compression_args(compression_preset: str) -> list[str]:
    return _COMPRESSION_PRESETS.get(compression_preset, _COMPRESSION_PRESETS["apple_silicon"])


def build_ffmpeg_cut_command(
    ffmpeg_path: str,
    concat_file_path: Path,
    output_path: Path,
    compression_preset: str = "apple_silicon",
) -> list[str]:
    return [
        ffmpeg_path,
        "-y",
        "-hide_banner",
        "-loglevel",
        "error",
        "-copyts",
        "-segment_time_metadata",
        "1",
        "-f",
        "concat",
        "-safe",
        "0",
        "-i",
        str(concat_file_path),
        "-vf",
        "select=concatdec_select,setpts=PTS-STARTPTS",
        "-af",
        "aselect=concatdec_select,asetpts=PTS-STARTPTS",
        "-fps_mode",
        "passthrough",
        "-progress",
        "pipe:1",
        "-nostats",
        *_compression_args(compression_preset),
        str(output_path),
    ]


def _to_safe_concat_path(path: Path) -> str:
    sanitized = str(path).replace("\n", "").replace("\r", "")
    return sanitized.replace("'", "'\\''")


def generate_cut_concat_file_content(
    video_path: Path,
    ranges: list[tuple[float, float]],
) -> str:
    safe_video_path = _to_safe_concat_path(video_path)
    lines = ["ffconcat version 1.0"]
    for start_seconds, end_seconds in ranges:
        lines.extend(
            [
                f"file '{safe_video_path}'",
                f"inpoint {start_seconds}",
                f"outpoint {end_seconds}",
            ]
        )
    return "\n".join(lines)


def build_video_cleaned_output_path(video_path: Path) -> Path:
    return video_path.parent / "video_cleaned" / video_path.name
