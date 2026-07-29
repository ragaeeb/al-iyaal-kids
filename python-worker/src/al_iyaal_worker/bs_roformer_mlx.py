import logging
import shutil
import tempfile
from collections.abc import Callable
from pathlib import Path
from typing import Any

from .audio_separation import SeparatedAudio

MODEL_FILENAME = "BS-Roformer-SW.ckpt"


def find_vocals_path(output_paths: list[str]) -> Path | None:
    return next(
        (
            output_path
            for raw_path in output_paths
            if (output_path := Path(raw_path)).is_file() and "vocal" in output_path.name.lower()
        ),
        None,
    )


class BsRoformerMlxSeparator:
    def __init__(
        self,
        model_dir: Path,
        separator_factory: Callable[..., Any] | None = None,
    ) -> None:
        self._model_dir = model_dir
        self._separator_factory = separator_factory
        self._separator: Any | None = None

    def separate_vocals(self, input_path: Path) -> SeparatedAudio:
        separator = self._get_separator()
        work_dir = Path(tempfile.mkdtemp(prefix="al-iyaal-mlx-separation-"))
        try:
            self._set_output_dir(separator, work_dir)
            output_paths = separator.separate(str(input_path))
            vocals_path = find_vocals_path(output_paths)
            if vocals_path is None:
                raise RuntimeError("BS-RoFormer-SW did not produce a vocals stem.")
            return SeparatedAudio(vocals_path=vocals_path, work_dir=work_dir)
        except Exception:
            shutil.rmtree(work_dir, ignore_errors=True)
            raise

    def cleanup(self, separated_audio: SeparatedAudio) -> None:
        shutil.rmtree(separated_audio.work_dir, ignore_errors=True)

    def _get_separator(self) -> Any:
        if self._separator is not None:
            return self._separator

        self._model_dir.mkdir(parents=True, exist_ok=True)
        factory = self._separator_factory or self._load_separator_factory()
        separator = factory(
            log_level=logging.WARNING,
            model_file_dir=str(self._model_dir),
            output_format="FLAC",
            output_single_stem="Vocals",
            performance_params={"speed_mode": "latency_safe_v3"},
            save_converted_safetensors=True,
        )
        separator.load_model(MODEL_FILENAME)
        self._separator = separator
        return separator

    @staticmethod
    def _load_separator_factory() -> Callable[..., Any]:
        try:
            from mlx_audio_separator import Separator
        except ImportError as error:
            raise RuntimeError(
                "MLX audio separator is unavailable. Reinstall the app runtime on an Apple Silicon Mac."
            ) from error
        return Separator

    @staticmethod
    def _set_output_dir(separator: Any, output_dir: Path) -> None:
        separator.output_dir = str(output_dir)
        if getattr(separator, "model_instance", None) is not None:
            separator.model_instance.output_dir = str(output_dir)
