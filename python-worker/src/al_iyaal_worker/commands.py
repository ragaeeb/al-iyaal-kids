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
