from pathlib import Path
import subprocess

import al_iyaal_worker.processor as processor
from al_iyaal_worker.models import StartBatchCommand


def test_should_write_each_remove_music_output_into_sibling_audio_replaced_dir(
    tmp_path: Path, monkeypatch
) -> None:
    left_dir = tmp_path / "left"
    right_dir = tmp_path / "right"
    left_dir.mkdir()
    right_dir.mkdir()

    left_input = left_dir / "clip-a.mp4"
    right_input = right_dir / "clip-b.mov"
    left_input.write_text("a")
    right_input.write_text("b")

    for input_path in (left_input, right_input):
        stem_dir = input_path.parent / "htdemucs" / input_path.stem
        stem_dir.mkdir(parents=True)
        (stem_dir / "vocals.wav").write_text("vocals")

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

    monkeypatch.setattr(
        processor,
        "run_demucs_command_with_progress",
        lambda **_kwargs: subprocess.CompletedProcess(["demucs"], 0, "", ""),
    )

    processor.process_batch(command, emit, lambda: False, command_runner=command_runner)

    assert observed_outputs == [
      str(left_dir / "audio_replaced" / left_input.name),
      str(right_dir / "audio_replaced" / right_input.name),
    ]
    assert any(
        event.get("type") == "job_done"
        and event.get("outputPath") == str(left_dir / "audio_replaced" / left_input.name)
        for event in emitted_events
    )
    assert any(
        event.get("type") == "job_done"
        and event.get("outputPath") == str(right_dir / "audio_replaced" / right_input.name)
        for event in emitted_events
    )
