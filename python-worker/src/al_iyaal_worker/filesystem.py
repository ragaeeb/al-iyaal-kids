from pathlib import Path

SUPPORTED_EXTENSIONS = {".mp4", ".mov"}
MAX_JOB_SLUG_LENGTH = 48
FNV1A_128_OFFSET_BASIS = 0x6C62272E07BB014262B821756295C58D
FNV1A_128_PRIME = 0x0000000001000000000000000000013B
FNV1A_128_MASK = (1 << 128) - 1

# Keep this format byte-for-byte aligned with Rust and the frontend: a
# collapsed ASCII slug (capped at 48 characters) plus an FNV-1a 128-bit
# digest of the original UTF-8 path.


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
    slug: list[str] = []
    for character in path:
        if character.isascii() and character.isalnum():
            slug.append(character.lower())
        elif not slug or slug[-1] != "-":
            slug.append("-")

    readable_slug = "".join(slug).strip("-")[:MAX_JOB_SLUG_LENGTH].rstrip("-") or "job"
    digest = FNV1A_128_OFFSET_BASIS
    for byte in path.encode("utf-8"):
        digest = ((digest ^ byte) * FNV1A_128_PRIME) & FNV1A_128_MASK
    return f"{readable_slug}-{digest:032x}"
