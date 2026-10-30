"""Validation and transactional output for local media tools."""

import math
import os
import tempfile
from contextlib import contextmanager
from pathlib import Path


def geometry(width, height, fps, duration=1):
    for value in (width, height, fps, duration):
        if isinstance(value, bool) or not math.isfinite(value) or value <= 0:
            raise ValueError("Geometry, fps and duration must be finite and positive")
    if width != int(width) or height != int(height) or width % 2 or height % 2:
        raise ValueError("Width and height must be even integers")


@contextmanager
def output_file(destination, overwrite=False):
    destination = Path(destination)
    if os.path.lexists(destination) and not overwrite:
        raise FileExistsError(destination)
    destination.parent.mkdir(parents=True, exist_ok=True)
    fd, filename = tempfile.mkstemp(
        prefix=".media-", suffix=destination.suffix, dir=destination.parent
    )
    os.close(fd)
    temporary = Path(filename)
    try:
        yield temporary
        if temporary.stat().st_size == 0:
            raise RuntimeError("Media command produced an empty output")
        if overwrite:
            os.replace(temporary, destination)
        else:
            os.link(temporary, destination)
    finally:
        temporary.unlink(missing_ok=True)
