import json
from pathlib import Path

from al_iyaal_worker.subtitles import SubtitleEntry
from al_iyaal_worker.vision_scan import (
    build_frame_entries,
    frame_analysis_path,
    merge_visual_rules,
    run_scan,
)


def test_should_build_frame_analysis_sidecar_path() -> None:
    path = frame_analysis_path(Path("/tmp/example.clip.mp4"))
    assert path == Path("/tmp/example.clip.frames.analysis.json")


def test_should_collapse_repeated_frame_captions() -> None:
    entries = build_frame_entries(
        [
            "A child sits in a classroom.",
            "A child sits in a classroom.",
            "A wizard casts a spell.",
        ],
        interval_seconds=2.0,
    )

    assert entries == [
        SubtitleEntry(index=1, start_time=0.0, end_time=4.0, text="A child sits in a classroom."),
        SubtitleEntry(index=3, start_time=4.0, end_time=6.0, text="A wizard casts a spell."),
    ]


def test_should_merge_visual_rules_without_overwriting_existing_rules() -> None:
    merged = merge_visual_rules(
        {
            "rules": [
                {
                    "ruleId": "custom_rule",
                    "category": "custom",
                    "priority": "low",
                    "reason": "custom",
                    "patterns": ["custom"],
                }
            ]
        }
    )

    rule_ids = {rule["ruleId"] for rule in merged["rules"]}
    assert "custom_rule" in rule_ids
    assert "vision_magic" in rule_ids


def test_should_run_local_frame_scan_and_write_sidecar(tmp_path: Path, monkeypatch) -> None:
    video_path = tmp_path / "episode.mp4"
    video_path.write_text("video")

    frame_paths = [tmp_path / "frame-000001.jpg", tmp_path / "frame-000002.jpg"]
    for frame_path in frame_paths:
        frame_path.write_text("frame")

    class FakeCaptioner:
        def __init__(self, model_id: str) -> None:
            self.model_id = model_id

        def caption(self, image_path: str) -> str:
            return (
                "Two characters kiss while dancing on stage with a guitar."
                if image_path.endswith("frame-000001.jpg")
                else "A child studies in a classroom."
            )

    monkeypatch.setattr(
        "al_iyaal_worker.vision_scan.extract_frames",
        lambda video_path, output_dir, interval_seconds, ffmpeg_path: frame_paths,
    )
    monkeypatch.setattr("al_iyaal_worker.vision_scan.MlxCaptioner", FakeCaptioner)

    result = run_scan(video_path=video_path, settings={}, interval_seconds=2.0)

    assert result["flaggedCount"] >= 2
    output_path = Path(str(result["outputPath"]))
    assert output_path.exists()

    payload = json.loads(output_path.read_text())
    assert payload["captionModel"].endswith("Qwen2.5-VL-7B-Instruct-4bit")
    assert payload["scanMode"] == "local_vision_poc"
    assert payload["captions"][0]["startTime"] == 0.0
    rule_ids = {item["ruleId"] for item in payload["flagged"]}
    assert "vision_romance" in rule_ids
    assert "vision_music" in rule_ids


def test_should_skip_model_loading_when_no_frames_are_extracted(
    tmp_path: Path, monkeypatch
) -> None:
    video_path = tmp_path / "episode.mp4"
    video_path.write_text("video")

    class FailingCaptioner:
        def __init__(self, model_id: str) -> None:
            raise AssertionError("caption model should not load when no frames are extracted")

    monkeypatch.setattr(
        "al_iyaal_worker.vision_scan.extract_frames",
        lambda video_path, output_dir, interval_seconds, ffmpeg_path: [],
    )
    monkeypatch.setattr("al_iyaal_worker.vision_scan.MlxCaptioner", FailingCaptioner)

    result = run_scan(video_path=video_path, settings={}, interval_seconds=2.0)

    assert result["flaggedCount"] == 0
    output_path = Path(str(result["outputPath"]))
    payload = json.loads(output_path.read_text())
    assert payload["captions"] == []
    assert payload["summary"] == "No frame captions were produced."
