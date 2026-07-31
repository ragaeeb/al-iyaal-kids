"""Stable facade for music-removal audio separation engines."""

from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
from typing import Protocol


@dataclass(slots=True)
class SeparatedAudio:
    vocals_path: Path
    work_dir: Path


class VocalSeparator(Protocol):
    def separate_vocals(self, input_path: Path) -> SeparatedAudio: ...

    def cleanup(self, separated_audio: SeparatedAudio) -> None: ...


SeparatorFactory = Callable[[Path], VocalSeparator]


def create_vocal_separator(model_dir: Path) -> VocalSeparator:
    """Create the Demucs MLX engine behind the worker-facing API."""
    from .demucs_mlx import DemucsMlxSeparator

    return DemucsMlxSeparator(model_dir=model_dir)
