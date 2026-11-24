from __future__ import annotations

import os
import tempfile
from pathlib import Path


class UnsafeOutputPathError(ValueError):
    """Raised when an output path is not a safe regular file destination."""


def prepare_output_directory(directory: Path) -> Path:
    if directory.is_symlink():
        raise UnsafeOutputPathError("Output directory must not be a symlink")
    try:
        directory.mkdir(parents=True, exist_ok=True)
    except OSError as exc:
        raise UnsafeOutputPathError("Unable to create output directory") from exc
    if directory.is_symlink():
        raise UnsafeOutputPathError("Output directory must not be a symlink")
    resolved = directory.resolve(strict=True)
    if not resolved.is_dir():
        raise UnsafeOutputPathError("Output path is not a directory")
    return resolved


def safe_output_file(directory: Path, filename: str) -> Path:
    if Path(filename).name != filename:
        raise UnsafeOutputPathError("Output filename must not include a path")
    target = directory / filename
    if target.is_symlink():
        raise UnsafeOutputPathError("Output file must not be a symlink")
    if target.exists() and not target.is_file():
        raise UnsafeOutputPathError("Output file must be a regular file")
    return target


def atomic_write_text(target: Path, content: str) -> None:
    directory = prepare_output_directory(target.parent)
    target = safe_output_file(directory, target.name)
    temporary_path: Path | None = None
    try:
        with tempfile.NamedTemporaryFile(
            mode="w",
            encoding="utf-8",
            dir=directory,
            prefix=f".{target.name}.",
            delete=False,
        ) as temporary:
            temporary_path = Path(temporary.name)
            temporary.write(content)
            temporary.flush()
            os.fsync(temporary.fileno())
        safe_output_file(directory, target.name)
        os.replace(temporary_path, target)
    except OSError:
        if temporary_path is not None:
            temporary_path.unlink(missing_ok=True)
        raise
    except UnsafeOutputPathError:
        if temporary_path is not None:
            temporary_path.unlink(missing_ok=True)
        raise
