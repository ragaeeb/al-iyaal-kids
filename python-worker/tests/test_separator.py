from pathlib import Path

import al_iyaal_worker.demucs_mlx as demucs_mlx
from al_iyaal_worker.audio_separation import create_vocal_separator


def test_should_create_demucs_mlx_through_the_facade(tmp_path: Path, monkeypatch) -> None:
    class FakeDemucs:
        def __init__(self, model_dir: Path) -> None:
            self.model_dir = model_dir

    monkeypatch.setattr(demucs_mlx, "DemucsMlxSeparator", FakeDemucs)

    separator = create_vocal_separator(tmp_path / "models")

    assert isinstance(separator, FakeDemucs)
    assert separator.model_dir == tmp_path / "models"


def test_should_write_demucs_mlx_vocals_to_the_facade_file_contract(tmp_path: Path) -> None:
    import numpy as np
    import soundfile

    class FakeSeparator:
        samplerate = 44_100

        def separate_audio_file(self, input_path: Path, *, return_mx: bool = False):
            assert input_path.name == "clip.mp4"
            assert return_mx is True
            return None, {"vocals": np.zeros((2, 16), dtype=np.float32)}

    engine = demucs_mlx.DemucsMlxSeparator(
        tmp_path / "models", separator_factory=lambda **_: FakeSeparator()
    )

    separated = engine.separate_vocals(tmp_path / "clip.mp4")
    samples, samplerate = soundfile.read(separated.vocals_path)

    assert separated.vocals_path.is_file()
    assert samples.shape == (16, 2)
    assert samplerate == 44_100
    engine.cleanup(separated)
    assert not separated.work_dir.exists()


def test_should_pass_demucs_mlx_tuning_knobs_to_the_library(tmp_path: Path, monkeypatch) -> None:
    created: list[dict[str, object]] = []

    class FakeSeparator:
        def __init__(self, **kwargs: object) -> None:
            created.append(kwargs)

    monkeypatch.setenv("AIYAAL_DEMUCS_MLX_SHIFTS", "2")
    monkeypatch.setenv("AIYAAL_DEMUCS_MLX_OVERLAP", "0.1")
    monkeypatch.setenv("AIYAAL_DEMUCS_MLX_JOBS", "1")
    monkeypatch.setenv("AIYAAL_DEMUCS_MLX_BATCH_SIZE", "4")
    monkeypatch.setenv("AIYAAL_DEMUCS_MLX_MODEL", "hdemucs_mmi")
    engine = demucs_mlx.DemucsMlxSeparator(tmp_path / "models", separator_factory=FakeSeparator)

    engine._get_separator()

    assert created == [
        {
            "model": "hdemucs_mmi",
            "shifts": 2,
            "overlap": 0.1,
            "split": True,
            "jobs": 1,
            "batch_size": 4,
        }
    ]
