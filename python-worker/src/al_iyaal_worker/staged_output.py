from collections.abc import Iterator
from contextlib import contextmanager
import os
from pathlib import Path
import tempfile


@contextmanager
def staged_output_path(destination: Path) -> Iterator[Path]:
    destination.parent.mkdir(parents=True, exist_ok=True)
    descriptor, raw_path = tempfile.mkstemp(
        dir=destination.parent,
        prefix=f".{destination.stem}-",
        suffix=destination.suffix,
    )
    os.close(descriptor)
    staged_path = Path(raw_path)
    staged_path.unlink()

    try:
        yield staged_path
    finally:
        staged_path.unlink(missing_ok=True)


def commit_staged_output(staged_path: Path, destination: Path) -> None:
    if not staged_path.is_file():
        raise FileNotFoundError(f"Expected output was not created: {staged_path.name}")
    staged_path.replace(destination)
