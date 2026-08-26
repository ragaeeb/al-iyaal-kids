from pathlib import Path

from al_iyaal_worker.commands import (
    build_ffmpeg_cut_command,
    build_ffmpeg_command,
    build_transcribe_command,
    build_video_cleaned_output_path,
    generate_cut_concat_file_content,
)


def test_should_build_ffmpeg_remux_command() -> None:
    command = build_ffmpeg_command(
        ffmpeg_path="/usr/local/bin/ffmpeg",
        video_path=Path("/tmp/a.mov"),
        vocals_path=Path("/tmp/separation/a_(Vocals).flac"),
        output_path=Path("/tmp/audio_replaced/a.mov"),
    )

    assert command == [
        "/usr/local/bin/ffmpeg",
        "-y",
        "-hide_banner",
        "-loglevel",
        "error",
        "-nostats",
        "-i",
        "/tmp/a.mov",
        "-i",
        "/tmp/separation/a_(Vocals).flac",
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


def test_should_build_ffmpeg_cut_command_with_max_compression() -> None:
    command = build_ffmpeg_cut_command(
        ffmpeg_path="/usr/local/bin/ffmpeg",
        concat_file_path=Path("/tmp/ranges.ffconcat"),
        output_path=Path("/tmp/output.mp4"),
        compression_preset="max_compression",
    )

    assert "libx265" in command
    assert "28" in command
    assert "slow" in command


def test_should_build_single_pass_apple_silicon_cut_command() -> None:
    command = build_ffmpeg_cut_command(
        ffmpeg_path="/opt/homebrew/bin/ffmpeg",
        concat_file_path=Path("/tmp/ranges.ffconcat"),
        output_path=Path("/tmp/output.mp4"),
        compression_preset="apple_silicon",
    )

    assert command == [
        "/opt/homebrew/bin/ffmpeg",
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
        "/tmp/ranges.ffconcat",
        "-vf",
        "select=concatdec_select,setpts=PTS-STARTPTS",
        "-af",
        "aselect=concatdec_select,asetpts=PTS-STARTPTS",
        "-fps_mode",
        "passthrough",
        "-progress",
        "pipe:1",
        "-nostats",
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
        "/tmp/output.mp4",
    ]


def test_should_build_ffmpeg_cut_command_with_balanced_preset() -> None:
    command = build_ffmpeg_cut_command(
        ffmpeg_path="/usr/local/bin/ffmpeg",
        concat_file_path=Path("/tmp/ranges.ffconcat"),
        output_path=Path("/tmp/output.mp4"),
        compression_preset="balanced",
    )

    assert "libx264" in command
    assert "20" in command
    assert "veryslow" in command


def test_should_generate_cut_ranges_for_the_concat_demuxer() -> None:
    content = generate_cut_concat_file_content(
        Path("/tmp/children's episode.mp4"),
        [(1.25, 3.5), (10.0, 12.75)],
    )

    assert content == "\n".join(
        [
            "ffconcat version 1.0",
            "file '/tmp/children'\\''s episode.mp4'",
            "inpoint 1.25",
            "outpoint 3.5",
            "file '/tmp/children'\\''s episode.mp4'",
            "inpoint 10.0",
            "outpoint 12.75",
        ]
    )


def test_should_build_video_cleaned_output_path(tmp_path: Path) -> None:
    video_path = tmp_path / "clip.mov"
    video_path.write_text("data")

    output_path = build_video_cleaned_output_path(video_path)
    assert output_path == tmp_path / "video_cleaned" / "clip.mov"
    assert not output_path.parent.exists()
