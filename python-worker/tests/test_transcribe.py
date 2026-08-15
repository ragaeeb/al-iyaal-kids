from pathlib import Path

from al_iyaal_worker.models import StartTranscriptionBatchCommand
from al_iyaal_worker.tasks.transcribe import (
    _sanitize_command_preview,
    parse_yap_progress_line,
    process_transcription_batch,
)


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


def test_should_replace_a_transcript_only_after_success(
    tmp_path: Path,
    monkeypatch,
) -> None:
    video_path = tmp_path / "episode.mp4"
    video_path.write_text("video", encoding="utf-8")
    srt_path = tmp_path / "episode.srt"
    srt_path.write_text("old transcript", encoding="utf-8")

    class FakeProcess:
        stdout = iter(["[ 100%] Complete\n"])

        def wait(self) -> int:
            return 0

    def fake_popen(command: list[str], **_kwargs: object) -> FakeProcess:
        Path(command[-1]).write_text("new transcript", encoding="utf-8")
        return FakeProcess()

    monkeypatch.setattr("al_iyaal_worker.tasks.transcribe.subprocess.Popen", fake_popen)
    events: list[dict[str, object]] = []

    process_transcription_batch(
        StartTranscriptionBatchCommand(
            task_id="task-1",
            input_paths=[str(video_path)],
            yap_mode="auto",
        ),
        events.append,
        lambda: False,
    )

    assert srt_path.read_text(encoding="utf-8") == "new transcript"
    assert any(event.get("type") == "job_done" for event in events)


def test_should_preserve_a_transcript_when_a_rerun_fails(
    tmp_path: Path,
    monkeypatch,
) -> None:
    video_path = tmp_path / "episode.mp4"
    video_path.write_text("video", encoding="utf-8")
    srt_path = tmp_path / "episode.srt"
    srt_path.write_text("valid transcript", encoding="utf-8")

    class FakeProcess:
        stdout = iter([])

        def wait(self) -> int:
            return 1

    def fake_popen(command: list[str], **_kwargs: object) -> FakeProcess:
        Path(command[-1]).write_text("partial transcript", encoding="utf-8")
        return FakeProcess()

    monkeypatch.setattr("al_iyaal_worker.tasks.transcribe.subprocess.Popen", fake_popen)
    events: list[dict[str, object]] = []

    process_transcription_batch(
        StartTranscriptionBatchCommand(
            task_id="task-1",
            input_paths=[str(video_path)],
            yap_mode="auto",
        ),
        events.append,
        lambda: False,
    )

    assert srt_path.read_text(encoding="utf-8") == "valid transcript"
    assert not list(tmp_path.glob(".episode-*.srt"))
    assert any(event.get("type") == "job_error" for event in events)
