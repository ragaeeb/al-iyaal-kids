from pathlib import Path

import al_iyaal_worker.bs_roformer_mlx as bs_roformer_mlx
from al_iyaal_worker.audio_separation import create_vocal_separator
from al_iyaal_worker.bs_roformer_mlx import (
    MODEL_FILENAME,
    BsRoformerMlxSeparator,
    find_vocals_path,
)


def test_should_create_the_configured_backend_through_the_facade(
    tmp_path: Path, monkeypatch
) -> None:
    created_with: list[Path] = []

    class FakeSeparator:
        def __init__(self, model_dir: Path) -> None:
            created_with.append(model_dir)

    monkeypatch.setattr(bs_roformer_mlx, "BsRoformerMlxSeparator", FakeSeparator)

    separator = create_vocal_separator(tmp_path / "models")

    assert isinstance(separator, FakeSeparator)
    assert created_with == [tmp_path / "models"]


def test_should_find_the_vocals_stem(tmp_path: Path) -> None:
    output_dir = tmp_path / "outputs"
    output_dir.mkdir()
    vocals_path = output_dir / "clip_(Vocals).flac"
    vocals_path.write_text("vocals")

    assert find_vocals_path([str(output_dir / "clip_(Other).flac"), str(vocals_path)]) == vocals_path


def test_should_load_bs_roformer_once_and_reuse_it(tmp_path: Path) -> None:
    created: list[FakeSeparator] = []

    class FakeModelInstance:
        output_dir = ""

    class FakeSeparator:
        def __init__(self, **kwargs: object) -> None:
            self.kwargs = kwargs
            self.model_instance = FakeModelInstance()
            self.loaded_models: list[str] = []
            created.append(self)

        def load_model(self, model_filename: str) -> None:
            self.loaded_models.append(model_filename)

        def separate(self, input_path: str) -> list[str]:
            output_path = Path(self.output_dir) / f"{Path(input_path).stem}_(Vocals).flac"
            output_path.write_text("vocals")
            return [str(output_path)]

    engine = BsRoformerMlxSeparator(tmp_path / "models", separator_factory=FakeSeparator)
    first = engine.separate_vocals(tmp_path / "first.mov")
    second = engine.separate_vocals(tmp_path / "second.mov")

    assert len(created) == 1
    assert created[0].loaded_models == [MODEL_FILENAME]
    assert created[0].kwargs["output_single_stem"] == "Vocals"
    assert created[0].kwargs["save_converted_safetensors"] is True
    assert first.vocals_path.is_file()
    assert second.vocals_path.is_file()

    engine.cleanup(first)
    engine.cleanup(second)
