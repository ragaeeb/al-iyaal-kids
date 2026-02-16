from pathlib import Path

from al_iyaal_worker.filesystem import discover_input_paths, normalize_extension, to_job_id


def test_should_normalize_extensions_with_dot_prefix() -> None:
    assert normalize_extension("mov") == ".mov"
    assert normalize_extension(".MP4") == ".mp4"


def test_should_build_stable_job_ids() -> None:
    assert to_job_id("/tmp/My Clip 01.mov") == "tmp-my-clip-01-mov"


def test_should_discover_only_allowed_video_files(tmp_path: Path) -> None:
    (tmp_path / "a.mov").write_text("test")
    (tmp_path / "b.mp4").write_text("test")
    (tmp_path / "ignore.mkv").write_text("test")

    paths = discover_input_paths(tmp_path, [".mov", ".mp4"])

    assert [path.name for path in paths] == ["a.mov", "b.mp4"]
