from pathlib import Path

from al_iyaal_worker.commands import (
    build_ffmpeg_concat_command,
    build_demucs_command,
    build_ffmpeg_command,
    build_ffmpeg_slice_command,
    build_transcribe_command,
    build_video_cleaned_output_path,
    expected_vocals_path,
    generate_concat_file_content,
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


def test_should_build_transcribe_command() -> None:
    command = build_transcribe_command(
        yap_path="/opt/bin/yap",
        video_path=Path("/tmp/kids.mp4"),
        output_srt_path=Path("/tmp/kids.srt"),
    )

    assert command == [
        "/opt/bin/yap",
        "transcribe",
        "/tmp/kids.mp4",
        "--srt",
        "-o",
        "/tmp/kids.srt",
    ]


def test_should_build_ffmpeg_slice_command() -> None:
    command = build_ffmpeg_slice_command(
        ffmpeg_path="/usr/local/bin/ffmpeg",
        video_path=Path("/tmp/input.mp4"),
        output_path=Path("/tmp/slice-0.mp4"),
        start_seconds=12.5,
        duration_seconds=5.0,
    )

    assert command == [
        "/usr/local/bin/ffmpeg",
        "-y",
        "-ss",
        "12.5",
        "-i",
        "/tmp/input.mp4",
        "-t",
        "5.0",
        "-c:v",
        "libx264",
        "-c:a",
        "aac",
        "/tmp/slice-0.mp4",
    ]


def test_should_build_ffmpeg_concat_command() -> None:
    command = build_ffmpeg_concat_command(
        ffmpeg_path="/usr/local/bin/ffmpeg",
        concat_file_path=Path("/tmp/concat.txt"),
        output_path=Path("/tmp/output.mp4"),
    )

    assert command == [
        "/usr/local/bin/ffmpeg",
        "-y",
        "-f",
        "concat",
        "-safe",
        "0",
        "-i",
        "/tmp/concat.txt",
        "-c",
        "copy",
        "/tmp/output.mp4",
    ]


def test_should_generate_concat_file_content() -> None:
    content = generate_concat_file_content([Path("/tmp/slice-0.mp4"), Path("/tmp/slice-1.mp4")])
    assert content == "file '/tmp/slice-0.mp4'\nfile '/tmp/slice-1.mp4'"


def test_should_build_video_cleaned_output_path(tmp_path: Path) -> None:
    video_path = tmp_path / "clip.mov"
    video_path.write_text("data")

    output_path = build_video_cleaned_output_path(video_path)
    assert output_path == tmp_path / "video_cleaned" / "clip.mov"
    assert output_path.parent.exists()
