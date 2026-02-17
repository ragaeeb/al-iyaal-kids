import json
from pathlib import Path

from al_iyaal_worker.models import StartFlagBatchCommand
from al_iyaal_worker.tasks.flag import process_flag_batch


def test_should_emit_job_error_when_srt_sidecar_missing(tmp_path: Path) -> None:
    video_path = tmp_path / "missing_srt.mov"
    video_path.write_text("video")

    events: list[dict[str, object]] = []
    process_flag_batch(
        command=StartFlagBatchCommand(
            task_id="task-1",
            input_paths=[str(video_path)],
            settings={},
        ),
        emit=lambda payload: events.append(payload),
        should_cancel=lambda: False,
    )

    job_error = next(event for event in events if event.get("type") == "job_error")
    assert "Missing subtitle sidecar" in str(job_error.get("error"))
    task_done = next(event for event in events if event.get("type") == "task_done")
    assert task_done["summary"] == {"ok": 0, "failed": 1, "cancelled": 0}


def test_should_flag_profanity_and_aqeedah_keywords(tmp_path: Path) -> None:
    video_path = tmp_path / "clip.mp4"
    fixtures_dir = Path(__file__).parent / "fixtures"
    video_path.write_bytes((fixtures_dir / "sample.mp4").read_bytes())
    srt_path = tmp_path / "clip.srt"
    srt_path.write_text((fixtures_dir / "sample.srt").read_text())

    events: list[dict[str, object]] = []
    process_flag_batch(
        command=StartFlagBatchCommand(
            task_id="task-2",
            input_paths=[str(video_path)],
            settings={},
        ),
        emit=lambda payload: events.append(payload),
        should_cancel=lambda: False,
    )

    done_event = next(event for event in events if event.get("type") == "job_done")
    analysis_path = Path(str(done_event["outputPath"]))
    assert analysis_path.exists()

    payload = json.loads(analysis_path.read_text())
    assert payload["engine"] == "local_rules"
    assert len(payload["flagged"]) >= 2
    categories = {item["category"] for item in payload["flagged"]}
    assert "language" in categories
    assert "aqeedah" in categories
