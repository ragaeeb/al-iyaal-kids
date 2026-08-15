from pathlib import Path

import pytest

from al_iyaal_worker.staged_output import commit_staged_output, staged_output_path


def test_should_atomically_replace_an_existing_output(tmp_path: Path) -> None:
    destination = tmp_path / "episode.srt"
    destination.write_text("old", encoding="utf-8")

    with staged_output_path(destination) as staged_path:
        assert staged_path.suffix == destination.suffix
        staged_path.write_text("new", encoding="utf-8")
        commit_staged_output(staged_path, destination)

    assert destination.read_text(encoding="utf-8") == "new"


def test_should_remove_a_partial_stage_without_touching_the_destination(
    tmp_path: Path,
) -> None:
    destination = tmp_path / "episode.mp4"
    destination.write_text("valid", encoding="utf-8")
    staged_path: Path | None = None

    with pytest.raises(RuntimeError, match="failed"):
        with staged_output_path(destination) as current_stage:
            staged_path = current_stage
            current_stage.write_text("partial", encoding="utf-8")
            raise RuntimeError("failed")

    assert destination.read_text(encoding="utf-8") == "valid"
    assert staged_path is not None
    assert not staged_path.exists()
