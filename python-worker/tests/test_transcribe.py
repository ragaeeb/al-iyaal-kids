from pathlib import Path

from al_iyaal_worker.tasks.transcribe import _sanitize_command_preview, parse_yap_progress_line


def test_should_parse_yap_progress_line() -> None:
    progress = parse_yap_progress_line("⠹ [  3%] Touch struggles, finding a box of rainbow.")
    assert progress == (3, "Touch struggles, finding a box of rainbow.")


def test_should_map_success_line_to_100_percent() -> None:
    progress = parse_yap_progress_line("✔ Success")
    assert progress == (100, "Transcription complete")


def test_should_return_none_for_non_progress_line() -> None:
    progress = parse_yap_progress_line("random log line")
    assert progress is None


def test_should_redact_local_paths_from_command_preview() -> None:
    video_path = Path("/Users/example/Movies/sample.mp4")
    srt_path = Path("/Users/example/Movies/sample.srt")

    preview = _sanitize_command_preview(
        [
            "yap",
            "transcribe",
            str(video_path),
            "--srt",
            "-o",
            str(srt_path),
        ],
        video_path,
        srt_path,
    )

    assert "/Users/example" not in preview
    assert "sample.mp4" in preview
    assert "sample.srt" in preview
