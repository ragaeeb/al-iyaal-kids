import json
from pathlib import Path

import al_iyaal_worker.tasks.flag as flag_module
from al_iyaal_worker.models import StartFlagBatchCommand
from al_iyaal_worker.moderation.llm import LlmAnalysisResult
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
            settings={
                "profanityWords": ["damn"],
                "rules": [
                    {
                        "ruleId": "aqeedah_christmas",
                        "category": "aqeedah",
                        "priority": "high",
                        "reason": "Promotes non-Islamic religious celebration.",
                        "patterns": ["christmas"],
                    }
                ],
            },
        ),
        emit=lambda payload: events.append(payload),
        should_cancel=lambda: False,
    )

    done_event = next(event for event in events if event.get("type") == "job_done")
    analysis_path = Path(str(done_event["outputPath"]))
    assert analysis_path.exists()

    payload = json.loads(analysis_path.read_text())
    assert payload["schemaVersion"] == 2
    assert payload["sourceFile"] == "clip.mp4"
    assert payload["analyses"][0]["provider"] == "blacklist"
    assert len(payload["analyses"][0]["flagged"]) >= 2
    categories = {item["category"] for item in payload["analyses"][0]["flagged"]}
    assert "language" in categories
    assert "aqeedah" in categories


def test_should_append_analysis_runs_and_migrate_an_existing_array(tmp_path: Path) -> None:
    video_path = tmp_path / "episode.mp4"
    video_path.write_text("video", encoding="utf-8")
    subtitle_path = tmp_path / "episode.srt"
    subtitle_path.write_text(
        "1\n00:00:01,000 --> 00:00:02,000\nSafe subtitle.\n",
        encoding="utf-8",
    )
    analysis_path = tmp_path / "episode.analysis.json"
    analysis_path.write_text(
        json.dumps([{"flagged": [], "provider": "chatgpt", "summary": "External."}]),
        encoding="utf-8",
    )

    process_flag_batch(
        command=StartFlagBatchCommand(
            task_id="task-append",
            input_paths=[str(video_path)],
            settings={"rules": []},
        ),
        emit=lambda _payload: None,
        should_cancel=lambda: False,
    )

    payload = json.loads(analysis_path.read_text(encoding="utf-8"))
    assert payload["schemaVersion"] == 2
    assert [run["provider"] for run in payload["analyses"]] == ["chatgpt", "blacklist"]
    assert "model" not in payload["analyses"][1]


def test_should_pass_the_sibling_srt_and_resolved_agent_to_llm_analysis(
    tmp_path: Path, monkeypatch
) -> None:
    video_path = tmp_path / "episode.mp4"
    video_path.write_text("video", encoding="utf-8")
    subtitle_path = tmp_path / "episode.srt"
    subtitle_path.write_text(
        "1\n00:00:01,000 --> 00:00:02,000\nUntrusted subtitle text.\n",
        encoding="utf-8",
    )
    captured: dict[str, object] = {}

    def fake_analyze_with_llm(
        subtitles: object,
        settings: dict[str, object],
        video_file_name: str,
        agent_executable_path: str | None,
        agent_subtitle_path: str | Path | None = None,
    ) -> LlmAnalysisResult:
        captured.update(
            {
                "subtitles": subtitles,
                "settings": settings,
                "video_file_name": video_file_name,
                "agent_executable_path": agent_executable_path,
                "agent_subtitle_path": agent_subtitle_path,
            }
        )
        return LlmAnalysisResult(engine="codex", flagged=[], summary="safe")

    monkeypatch.setattr(flag_module, "analyze_with_llm", fake_analyze_with_llm)

    process_flag_batch(
        command=StartFlagBatchCommand(
            task_id="task-agent-1",
            input_paths=[str(video_path)],
            settings={"agentModel": "gpt-test", "engine": "codex"},
            agent_executable_path="/resolved/codex",
        ),
        emit=lambda _payload: None,
        should_cancel=lambda: False,
    )

    assert captured["agent_executable_path"] == "/resolved/codex"
    assert captured["agent_subtitle_path"] == subtitle_path
    assert captured["video_file_name"] == "episode.mp4"
    assert "Untrusted subtitle text." not in str(captured["settings"])
    assert "Untrusted subtitle text." not in str(captured["video_file_name"])


def test_should_preserve_an_existing_analysis_when_staging_write_fails(
    tmp_path: Path, monkeypatch
) -> None:
    video_path = tmp_path / "episode.mp4"
    video_path.write_text("video", encoding="utf-8")
    subtitle_path = tmp_path / "episode.srt"
    subtitle_path.write_text(
        "1\n00:00:01,000 --> 00:00:02,000\nSafe subtitle.\n",
        encoding="utf-8",
    )
    analysis_path = tmp_path / "episode.analysis.json"
    original_content = '{"engine":"blacklist","flagged":[],"summary":"old"}'
    analysis_path.write_text(original_content, encoding="utf-8")
    original_write_text = Path.write_text

    def fail_staged_write(path: Path, data: str, *args: object, **kwargs: object) -> int:
        if path.name.startswith(".episode.analysis-"):
            raise OSError("simulated staged write failure")
        return original_write_text(path, data, *args, **kwargs)

    monkeypatch.setattr(Path, "write_text", fail_staged_write)
    events: list[dict[str, object]] = []

    process_flag_batch(
        command=StartFlagBatchCommand(
            task_id="task-atomicity",
            input_paths=[str(video_path)],
            settings={"rules": []},
        ),
        emit=events.append,
        should_cancel=lambda: False,
    )

    assert analysis_path.read_text(encoding="utf-8") == original_content
    assert not any(event.get("type") == "job_done" for event in events)
    error_event = next(event for event in events if event.get("type") == "job_error")
    assert "simulated staged write failure" in str(error_event["error"])
