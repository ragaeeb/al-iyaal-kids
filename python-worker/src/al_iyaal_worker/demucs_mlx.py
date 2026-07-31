"""Demucs MLX vocal separation implementation.

This adapter runs the worker's vocals-only separation loop (see
``demucs_mlx_apply``) against the library-loaded model, transfers only the
vocal stem to CPU, and writes it to the worker's temporary-file contract so
the existing ffmpeg/remux path remains unchanged.
"""

import os
import shutil
import tempfile
from collections.abc import Callable
from pathlib import Path
from typing import Any

from .audio_separation import SeparatedAudio

DEFAULT_MODEL_NAME = "htdemucs"


def disable_fused_metal_kernels() -> None:
    """Force demucs-mlx's pure-MLX fallback ops.

    The library's fused groupnorm Metal kernels are nondeterministic: identical
    forwards disagree at roughly 20 dB SNR run-to-run, audibly perturbing every
    output. The compiled forward in ``demucs_mlx_apply`` recovers the fused
    kernels' speed, so keep them off unless explicitly re-enabled via
    ``AIYAAL_DEMUCS_MLX_FUSED_KERNELS=1``.
    """
    if os.getenv("AIYAAL_DEMUCS_MLX_FUSED_KERNELS") == "1":
        return
    try:
        from demucs_mlx import metal_kernels
    except ImportError:
        return
    metal_kernels.HAS_METAL = False


class DemucsMlxSeparator:
    engine_name = "Demucs MLX"

    def __init__(
        self,
        model_dir: Path,
        separator_factory: Callable[..., Any] | None = None,
        apply_fn: Callable[[Any, Path], Any] | None = None,
    ) -> None:
        # demucs-mlx owns its cache under the standard user cache directory;
        # retain model_dir in the adapter for the stable facade contract.
        self._model_dir = model_dir
        self._separator_factory = separator_factory
        self._apply_fn = apply_fn
        self._separator: Any | None = None

    def separate_vocals(self, input_path: Path) -> SeparatedAudio:
        separator = self._get_separator()
        work_dir = Path(tempfile.mkdtemp(prefix="al-iyaal-demucs-mlx-separation-"))
        try:
            apply_fn = self._apply_fn or self._load_apply_fn()
            vocals = apply_fn(separator, input_path)
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
            self._separator = factory(
                model=os.getenv("AIYAAL_DEMUCS_MLX_MODEL", DEFAULT_MODEL_NAME),
                shifts=int(os.getenv("AIYAAL_DEMUCS_MLX_SHIFTS", "1")),
                overlap=float(os.getenv("AIYAAL_DEMUCS_MLX_OVERLAP", "0.10")),
                split=True,
                jobs=int(os.getenv("AIYAAL_DEMUCS_MLX_JOBS", "0")),
                batch_size=int(os.getenv("AIYAAL_DEMUCS_MLX_BATCH_SIZE", "8")),
            )
        return self._separator

    @staticmethod
    def _write_audio(path: Path, audio: Any, samplerate: int) -> None:
        try:
            import numpy as np
            import soundfile
        except ImportError as error:
            raise RuntimeError("Demucs MLX requires the soundfile package.") from error

        # demucs-mlx returns [channels, samples]; soundfile expects
        # [samples, channels]. Mono arrays are accepted unchanged.
        array = np.asarray(audio)
        if getattr(array, "ndim", 0) == 2 and array.shape[0] <= 8:
            array = array.T
        soundfile.write(str(path), array, samplerate, subtype="PCM_16")

    @staticmethod
    def _load_apply_fn() -> Callable[[Any, Path], Any]:
        from .demucs_mlx_apply import separate_vocals_from_file

        return separate_vocals_from_file

    @staticmethod
    def _load_separator_factory() -> Callable[..., Any]:
        try:
            from demucs_mlx import Separator
        except ImportError as error:
            raise RuntimeError(
                "Demucs MLX is unavailable. Reinstall the app runtime on an Apple Silicon Mac."
            ) from error
        disable_fused_metal_kernels()
        return Separator
