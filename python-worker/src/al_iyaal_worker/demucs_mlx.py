"""Demucs MLX vocal separation implementation.

The third-party package returns in-memory NumPy stems. This adapter writes the
vocal stem to the same temporary-file contract used by the existing engine so
the worker's ffmpeg/remux path remains unchanged.
"""

import shutil
import tempfile
from collections.abc import Callable
from pathlib import Path
from typing import Any

from .audio_separation import SeparatedAudio

MODEL_NAME = "htdemucs"


class DemucsMlxSeparator:
    engine_name = "Demucs MLX"

    def __init__(
        self,
        model_dir: Path,
        separator_factory: Callable[..., Any] | None = None,
    ) -> None:
        # demucs-mlx owns its cache under the standard user cache directory;
        # retain model_dir in the adapter for the stable facade contract.
        self._model_dir = model_dir
        self._separator_factory = separator_factory
        self._separator: Any | None = None

    def separate_vocals(self, input_path: Path) -> SeparatedAudio:
        separator = self._get_separator()
        work_dir = Path(tempfile.mkdtemp(prefix="al-iyaal-demucs-mlx-separation-"))
        try:
            _, stems = separator.separate_audio_file(input_path)
            vocals = stems.get("vocals")
            if vocals is None:
                raise RuntimeError("Demucs MLX did not produce a vocals stem.")

            vocals_path = work_dir / f"{input_path.stem}_(Vocals).wav"
            self._write_audio(vocals_path, vocals, int(separator.samplerate))
            return SeparatedAudio(vocals_path=vocals_path, work_dir=work_dir)
        except Exception:
            shutil.rmtree(work_dir, ignore_errors=True)
            raise

    def cleanup(self, separated_audio: SeparatedAudio) -> None:
        shutil.rmtree(separated_audio.work_dir, ignore_errors=True)

    def _get_separator(self) -> Any:
        if self._separator is None:
            factory = self._separator_factory or self._load_separator_factory()
            self._separator = factory(model=MODEL_NAME, shifts=1, overlap=0.25, split=True)
        return self._separator

    @staticmethod
    def _write_audio(path: Path, audio: Any, samplerate: int) -> None:
        try:
            import soundfile
        except ImportError as error:
            raise RuntimeError("Demucs MLX requires the soundfile package.") from error

        # demucs-mlx returns [channels, samples]; soundfile expects
        # [samples, channels]. Mono arrays are accepted unchanged.
        array = audio
        if getattr(array, "ndim", 0) == 2 and array.shape[0] <= 8:
            array = array.T
        soundfile.write(str(path), array, samplerate, subtype="PCM_16")

    @staticmethod
    def _load_separator_factory() -> Callable[..., Any]:
        try:
            from demucs_mlx import Separator
        except ImportError as error:
            raise RuntimeError(
                "Demucs MLX is unavailable. Reinstall the app runtime on an Apple Silicon Mac."
            ) from error
        return Separator
