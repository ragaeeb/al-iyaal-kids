from pathlib import Path


def build_demucs_command(
    demucs_path: str,
    input_path: Path,
    output_root: Path,
    device: str,
) -> list[str]:
    return [
        demucs_path,
        "--two-stems=vocals",
        "-j",
        "2",
        "--device",
        device,
        str(input_path),
        "-o",
        str(output_root),
    ]


def expected_vocals_path(input_path: Path, output_root: Path) -> Path:
    return output_root / "htdemucs" / input_path.stem / "vocals.wav"


def build_ffmpeg_command(
    ffmpeg_path: str,
    video_path: Path,
    vocals_path: Path,
    output_path: Path,
) -> list[str]:
    return [
        ffmpeg_path,
        "-y",
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


def build_ffmpeg_slice_command(
    ffmpeg_path: str,
    video_path: Path,
    output_path: Path,
    start_seconds: float,
    duration_seconds: float,
) -> list[str]:
    return [
        ffmpeg_path,
        "-y",
        "-ss",
        str(start_seconds),
        "-i",
        str(video_path),
        "-t",
        str(duration_seconds),
        "-c:v",
        "libx264",
        "-c:a",
        "aac",
        str(output_path),
    ]


def build_ffmpeg_concat_command(
    ffmpeg_path: str,
    concat_file_path: Path,
    output_path: Path,
) -> list[str]:
    return [
        ffmpeg_path,
        "-y",
        "-f",
        "concat",
        "-safe",
        "0",
        "-i",
        str(concat_file_path),
        "-c",
        "copy",
        str(output_path),
    ]


def generate_concat_file_content(slice_paths: list[Path]) -> str:
    def to_safe_concat_path(slice_path: Path) -> str:
        sanitized = str(slice_path).replace("\n", "").replace("\r", "")
        return sanitized.replace("'", "'\\''")

    return "\n".join(f"file '{to_safe_concat_path(slice_path)}'" for slice_path in slice_paths)


def build_video_cleaned_output_path(video_path: Path) -> Path:
    return video_path.parent / "video_cleaned" / video_path.name
