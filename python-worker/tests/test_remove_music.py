from pathlib import Path
import subprocess

import al_iyaal_worker.processor as processor
from al_iyaal_worker.models import StartBatchCommand
from al_iyaal_worker.audio_separation import SeparatedAudio


def test_should_write_each_remove_music_output_into_sibling_audio_replaced_dir(
    tmp_path: Path,
) -> None:
    left_dir = tmp_path / "left"
    right_dir = tmp_path / "right"
    left_dir.mkdir()
    right_dir.mkdir()

    left_input = left_dir / "clip-a.mp4"
    right_input = right_dir / "clip-b.mov"
    left_input.write_text("a")
    right_input.write_text("b")

    command = StartBatchCommand(
        batch_id="batch-1",
        input_paths=[str(left_input), str(right_input)],
        output_dir=str(tmp_path / "unused"),
        compute_mode="auto",
    )

    emitted_events: list[dict[str, object]] = []
    observed_outputs: list[str] = []

    def emit(event: dict[str, object]) -> None:
        emitted_events.append(event)

    def command_runner(raw_command: list[str]) -> subprocess.CompletedProcess[str]:
        observed_outputs.append(raw_command[-1])
        Path(raw_command[-1]).write_text("out")
        return subprocess.CompletedProcess(raw_command, 0, "", "")

    separator_instances: list[object] = []

    class FakeSeparator:
        def __init__(self, model_dir: Path) -> None:
            self.model_dir = model_dir
            separator_instances.append(self)

        def separate_vocals(self, input_path: Path, _on_progress) -> SeparatedAudio:
            work_dir = input_path.parent / f"{input_path.stem}-separation"
            work_dir.mkdir()
            vocals_path = work_dir / "audio_(Vocals).flac"
            vocals_path.write_text("vocals")
            return SeparatedAudio(vocals_path=vocals_path, work_dir=work_dir)

        def cleanup(self, separated_audio: SeparatedAudio) -> None:
            assert separated_audio.vocals_path.exists()

        def release(self) -> None:
            self.released = True

    processor.process_batch(
        command,
        emit,
        lambda: False,
        command_runner=command_runner,
        separator_factory=FakeSeparator,
    )

    assert [Path(path).parent for path in observed_outputs] == [
        left_dir / "audio_replaced",
        right_dir / "audio_replaced",
    ]
    assert [Path(path).suffix for path in observed_outputs] == [".mp4", ".mov"]
    assert any(
        event.get("type") == "job_done"
        and event.get("outputPath") == str(left_dir / "audio_replaced" / left_input.name)
        for event in emitted_events
    )
    assert len(separator_instances) == 1
    assert separator_instances[0].released is True
    assert any(
        event.get("type") == "job_done"
        and event.get("outputPath") == str(right_dir / "audio_replaced" / right_input.name)
        for event in emitted_events
    )


def test_should_emit_incremental_demucs_progress_during_separation(tmp_path: Path) -> None:
    input_path = tmp_path / "clip.mp4"
    input_path.write_text("video", encoding="utf-8")

    class ProgressSeparator:
        def __init__(self, _model_dir: Path) -> None:
            pass

        def separate_vocals(self, input_file: Path, on_progress) -> SeparatedAudio:
            for progress in (0.25, 0.5, 0.75, 1.0):
                on_progress(progress)
            work_dir = input_file.parent / "separation"
            work_dir.mkdir()
            vocals_path = work_dir / "vocals.flac"
            vocals_path.write_text("vocals", encoding="utf-8")
            return SeparatedAudio(vocals_path=vocals_path, work_dir=work_dir)

        def cleanup(self, _separated_audio: SeparatedAudio) -> None:
            pass

        def release(self) -> None:
            pass

    def successful_runner(command: list[str]) -> subprocess.CompletedProcess[str]:
        Path(command[-1]).write_text("output", encoding="utf-8")
        return subprocess.CompletedProcess(command, 0, "", "")

    events: list[dict[str, object]] = []
    processor.process_batch(
        StartBatchCommand(
            batch_id="batch-1",
            input_paths=[str(input_path)],
            output_dir=str(tmp_path / "unused"),
            compute_mode="auto",
        ),
        events.append,
        lambda: False,
        command_runner=successful_runner,
        separator_factory=ProgressSeparator,
    )

    progress = [
        event["progressPct"]
        for event in events
        if event.get("type") == "job_progress"
    ]
    assert progress == [5, 20, 35, 50, 64, 65]


def test_should_preserve_an_existing_output_when_remux_fails(tmp_path: Path) -> None:
    input_path = tmp_path / "clip.mp4"
    input_path.write_text("video", encoding="utf-8")
    output_path = tmp_path / "audio_replaced" / input_path.name
    output_path.parent.mkdir()
    output_path.write_text("valid output", encoding="utf-8")

    class FakeSeparator:
        def __init__(self, _model_dir: Path) -> None:
            pass

        def separate_vocals(self, _input_path: Path, _on_progress) -> SeparatedAudio:
            work_dir = tmp_path / "separation"
            work_dir.mkdir()
            vocals_path = work_dir / "vocals.flac"
            vocals_path.write_text("vocals", encoding="utf-8")
            return SeparatedAudio(vocals_path=vocals_path, work_dir=work_dir)

        def cleanup(self, separated_audio: SeparatedAudio) -> None:
            assert separated_audio.vocals_path.exists()

        def release(self) -> None:
            pass

    def failing_runner(raw_command: list[str]) -> subprocess.CompletedProcess[str]:
        Path(raw_command[-1]).write_text("partial", encoding="utf-8")
        return subprocess.CompletedProcess(raw_command, 1, "", "ffmpeg failed")

    events: list[dict[str, object]] = []
    processor.process_batch(
        StartBatchCommand(
            batch_id="batch-1",
            input_paths=[str(input_path)],
            output_dir=str(tmp_path / "unused"),
            compute_mode="auto",
        ),
        events.append,
        lambda: False,
        command_runner=failing_runner,
        separator_factory=FakeSeparator,
    )

    assert output_path.read_text(encoding="utf-8") == "valid output"
    assert not list(output_path.parent.glob(".clip-*.mp4"))
    assert any(event.get("type") == "job_error" for event in events)


def test_should_fail_every_job_when_the_separator_cannot_load(tmp_path: Path) -> None:
    input_paths = [tmp_path / "a.mp4", tmp_path / "b.mov"]
    for input_path in input_paths:
        input_path.write_text("video", encoding="utf-8")

    def failing_factory(_model_dir: Path):
        raise RuntimeError("model unavailable")

    events: list[dict[str, object]] = []
    processor.process_batch(
        StartBatchCommand(
            batch_id="batch-1",
            input_paths=[str(path) for path in input_paths],
            output_dir=str(tmp_path / "unused"),
            compute_mode="auto",
        ),
        events.append,
        lambda: False,
        separator_factory=failing_factory,
    )

    errors = [event for event in events if event.get("type") == "job_error"]
    done = next(event for event in events if event.get("type") == "batch_done")
    assert len(errors) == 2
    assert done["summary"] == {"ok": 0, "failed": 2, "cancelled": 0}


def test_should_release_separator_when_batch_is_cancelled_before_first_job(
    tmp_path: Path,
) -> None:
    input_path = tmp_path / "clip.mp4"
    input_path.write_text("video", encoding="utf-8")
    released: list[bool] = []

    class FakeSeparator:
        def __init__(self, _model_dir: Path) -> None:
            pass

        def separate_vocals(self, _input_path: Path, _on_progress) -> SeparatedAudio:
            raise AssertionError("cancelled batches must not start separation")

        def cleanup(self, _separated_audio: SeparatedAudio) -> None:
            pass

        def release(self) -> None:
            released.append(True)

    events: list[dict[str, object]] = []
    processor.process_batch(
        StartBatchCommand(
            batch_id="cancelled-batch",
            input_paths=[str(input_path)],
            output_dir=str(tmp_path / "unused"),
            compute_mode="auto",
        ),
        events.append,
        lambda: True,
        separator_factory=FakeSeparator,
    )

    assert released == [True]
    done = next(event for event in events if event.get("type") == "batch_done")
    assert done["summary"] == {"ok": 0, "failed": 0, "cancelled": 1}
