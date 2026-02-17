from pathlib import Path
import subprocess

from al_iyaal_worker.models import CutRange, StartCutJobCommand
from al_iyaal_worker.tasks.cut import process_cut_job


def test_should_clean_temp_artifacts_after_cut_completion(
    tmp_path: Path, monkeypatch
) -> None:
    video_path = tmp_path / "clip.mp4"
    video_path.write_text("video")
    temp_dir = tmp_path / "temp-cut-dir"

    def fake_mkdtemp(prefix: str) -> str:
        temp_dir.mkdir(parents=True, exist_ok=True)
        return str(temp_dir)

    def fake_run(command: list[str], check: bool, capture_output: bool, text: bool):
        output_path = Path(command[-1])
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_text("slice")
        return subprocess.CompletedProcess(command, returncode=0, stdout="", stderr="")

    monkeypatch.setattr("al_iyaal_worker.tasks.cut.tempfile.mkdtemp", fake_mkdtemp)
    monkeypatch.setattr("al_iyaal_worker.tasks.cut.subprocess.run", fake_run)

    events: list[dict[str, object]] = []
    process_cut_job(
        command=StartCutJobCommand(
            task_id="cut-task",
            video_path=str(video_path),
            ranges=[CutRange(start="0:01", end="0:02")],
            output_mode="video_cleaned_default",
        ),
        emit=lambda payload: events.append(payload),
        should_cancel=lambda: False,
    )

    done_event = next(event for event in events if event.get("type") == "job_done")
    output_path = Path(str(done_event["outputPath"]))
    assert output_path.exists()
    assert output_path.parent.name == "video_cleaned"
    assert not temp_dir.exists()
