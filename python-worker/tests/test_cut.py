from pathlib import Path

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

    class FakeProcess:
        returncode = 0
        stdout = iter(["out_time_us=1000000\n", "progress=end\n"])

        def wait(self) -> int:
            return self.returncode

    def fake_popen(command: list[str], **_kwargs: object) -> FakeProcess:
        output_path = Path(command[-1])
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_text("slice")
        return FakeProcess()

    monkeypatch.setattr("al_iyaal_worker.tasks.cut.tempfile.mkdtemp", fake_mkdtemp)
    monkeypatch.setattr("al_iyaal_worker.tasks.cut.subprocess.Popen", fake_popen)

    events: list[dict[str, object]] = []
    process_cut_job(
        command=StartCutJobCommand(
            task_id="cut-task",
            video_path=str(video_path),
            ranges=[CutRange(start="0:01", end="0:02")],
            output_mode="video_cleaned_default",
            compression_preset="max_compression",
        ),
        emit=lambda payload: events.append(payload),
        should_cancel=lambda: False,
    )

    done_event = next(event for event in events if event.get("type") == "job_done")
    output_path = Path(str(done_event["outputPath"]))
    assert output_path.exists()
    assert output_path.parent.name == "video_cleaned"
    assert not temp_dir.exists()


def test_should_emit_live_ffmpeg_progress_during_a_cut(
    tmp_path: Path, monkeypatch
) -> None:
    video_path = tmp_path / "clip.mp4"
    video_path.write_text("video")

    class FakeProcess:
        returncode = 0
        stdout = iter(
            [
                "out_time_us=500000\n",
                "progress=continue\n",
                "out_time_us=1000000\n",
                "progress=end\n",
            ]
        )

        def wait(self) -> int:
            return self.returncode

    def fake_popen(command: list[str], **_kwargs: object) -> FakeProcess:
        output_path = Path(command[-1])
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_text("slice")
        return FakeProcess()

    monkeypatch.setattr("al_iyaal_worker.tasks.cut.subprocess.Popen", fake_popen)

    events: list[dict[str, object]] = []
    process_cut_job(
        command=StartCutJobCommand(
            task_id="cut-task",
            video_path=str(video_path),
            ranges=[CutRange(start="0:01", end="0:03")],
            output_mode="video_cleaned_default",
            compression_preset="max_compression",
        ),
        emit=events.append,
        should_cancel=lambda: False,
    )

    progress_values = [
        int(event["progressPct"])
        for event in events
        if event.get("type") == "job_progress"
    ]
    assert progress_values == [5, 27, 50, 95]


def test_should_export_multiple_ranges_with_one_ffmpeg_process(
    tmp_path: Path, monkeypatch
) -> None:
    video_path = tmp_path / "episode.mp4"
    video_path.write_text("video", encoding="utf-8")
    commands: list[list[str]] = []
    manifests: list[str] = []

    class FakeProcess:
        returncode = 0
        stdout = iter(["out_time_us=7000000\n", "progress=end\n"])

        def wait(self) -> int:
            return self.returncode

    def fake_popen(command: list[str], **_kwargs: object) -> FakeProcess:
        commands.append(command)
        concat_path = Path(command[command.index("-i") + 1])
        manifests.append(concat_path.read_text(encoding="utf-8"))
        Path(command[-1]).write_text("cut", encoding="utf-8")
        return FakeProcess()

    monkeypatch.setattr("al_iyaal_worker.tasks.cut.subprocess.Popen", fake_popen)
    events: list[dict[str, object]] = []

    process_cut_job(
        command=StartCutJobCommand(
            task_id="cut-task",
            video_path=str(video_path),
            ranges=[
                CutRange(start="0:01", end="0:04"),
                CutRange(start="0:07", end="0:11"),
            ],
            output_mode="video_cleaned_default",
            compression_preset="apple_silicon",
        ),
        emit=events.append,
        should_cancel=lambda: False,
    )

    assert len(commands) == 1
    assert manifests == [
        "\n".join(
            [
                "ffconcat version 1.0",
                f"file '{video_path}'",
                "inpoint 1.0",
                "outpoint 4.0",
                f"file '{video_path}'",
                "inpoint 7.0",
                "outpoint 11.0",
            ]
        )
    ]
    assert any(event.get("type") == "job_done" for event in events)


def test_should_preserve_an_existing_cut_when_export_fails(
    tmp_path: Path,
    monkeypatch,
) -> None:
    video_path = tmp_path / "clip.mp4"
    video_path.write_text("video", encoding="utf-8")
    output_path = tmp_path / "video_cleaned" / "clip.mp4"
    output_path.parent.mkdir()
    output_path.write_text("valid cut", encoding="utf-8")

    class FakeProcess:
        returncode = 1
        stdout = iter(["fatal ffmpeg error\n"])

        def wait(self) -> int:
            return self.returncode

    def fake_popen(command: list[str], **_kwargs: object) -> FakeProcess:
        Path(command[-1]).write_text("partial slice", encoding="utf-8")
        return FakeProcess()

    monkeypatch.setattr("al_iyaal_worker.tasks.cut.subprocess.Popen", fake_popen)
    events: list[dict[str, object]] = []

    process_cut_job(
        command=StartCutJobCommand(
            task_id="cut-task",
            video_path=str(video_path),
            ranges=[CutRange(start="0:01", end="0:02")],
            output_mode="video_cleaned_default",
            compression_preset="max_compression",
        ),
        emit=events.append,
        should_cancel=lambda: False,
    )

    assert output_path.read_text(encoding="utf-8") == "valid cut"
    assert not list(output_path.parent.glob(".clip-*.mp4"))
    assert any(event.get("type") == "job_error" for event in events)
    assert not any(event.get("type") == "job_done" for event in events)
