from pathlib import Path

from al_iyaal_worker.commands import (
    build_demucs_command,
    build_ffmpeg_command,
    expected_vocals_path,
)


def test_should_build_demucs_command_with_two_stems_vocals() -> None:
    command = build_demucs_command("demucs", Path("/tmp/a.mov"), Path("/tmp"), "mps")

    assert command == [
        "demucs",
        "--two-stems=vocals",
        "-j",
        "2",
        "--device",
        "mps",
        "/tmp/a.mov",
        "-o",
        "/tmp",
    ]


def test_should_resolve_expected_vocals_path() -> None:
    path = expected_vocals_path(Path("/tmp/a.mov"), Path("/tmp"))
    assert path == Path("/tmp/htdemucs/a/vocals.wav")


def test_should_build_ffmpeg_remux_command() -> None:
    command = build_ffmpeg_command(
        ffmpeg_path="/usr/local/bin/ffmpeg",
        video_path=Path("/tmp/a.mov"),
        vocals_path=Path("/tmp/htdemucs/a/vocals.wav"),
        output_path=Path("/tmp/audio_replaced/a.mov"),
    )

    assert command == [
        "/usr/local/bin/ffmpeg",
        "-y",
        "-i",
        "/tmp/a.mov",
        "-i",
        "/tmp/htdemucs/a/vocals.wav",
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
        "/tmp/audio_replaced/a.mov",
    ]
