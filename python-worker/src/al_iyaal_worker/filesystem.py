from pathlib import Path

SUPPORTED_EXTENSIONS = {".mp4", ".mov"}


def normalize_extension(extension: str) -> str:
    extension = extension.strip().lower()
    if extension.startswith("."):
        return extension
    return f".{extension}"


def discover_input_paths(input_dir: Path, allowed_extensions: list[str]) -> list[Path]:
    normalized_extensions = {normalize_extension(extension) for extension in allowed_extensions}
    files = [
        path
        for path in input_dir.iterdir()
        if path.is_file() and path.suffix.lower() in normalized_extensions
    ]
    files.sort()
    return files


def to_job_id(path: str) -> str:
    normalized = path.lower()
    mapped = [character if character.isalnum() else "-" for character in normalized]
    compacted = "".join(mapped).strip("-")
    return compacted if compacted else "job"
