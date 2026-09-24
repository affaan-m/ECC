"""Create an explicitly named CapCut draft from local media paths."""

import argparse
import math
import re
import shlex
import subprocess
from pathlib import Path

from .common import geometry


def duration_of(path):
    result = subprocess.run(
        [
            "ffprobe",
            "-v",
            "error",
            "-show_entries",
            "format=duration",
            "-of",
            "csv=p=0",
            str(path),
        ],
        check=True,
        capture_output=True,
        text=True,
    )
    return float(result.stdout.strip())


def read_concat(path):
    path = Path(path).resolve()
    files = []
    for line in path.read_text().splitlines():
        fields = shlex.split(line, comments=True)
        if fields and fields[0] == "file":
            if len(fields) != 2:
                raise ValueError("Invalid concat file entry")
            files.append((path.parent / fields[1]).resolve())
    return files


def export_draft(
    files,
    drafts,
    name,
    width=1920,
    height=1080,
    fps=30,
    overwrite=False,
    cc=None,
    probe=duration_of,
):
    geometry(width, height, fps)
    if overwrite:
        raise ValueError("CapCut draft replacement is unsafe; choose a new name")
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_. -]{0,99}", name) or name.endswith(
        "."
    ):
        raise ValueError("Draft name must be a plain file name")
    if not files:
        raise ValueError("At least one video is required")
    prepared = []
    for filename in files:
        path = Path(filename).resolve(strict=True)
        duration = probe(path)
        if not math.isfinite(duration) or duration <= 0:
            raise ValueError(f"Invalid media duration: {path.name}")
        prepared.append((str(path), duration))
    if cc is None:
        import pycapcut as cc
    folder = cc.DraftFolder(str(drafts))
    script = folder.create_draft(name, width, height, fps=fps, allow_replace=False)
    script.add_track(cc.TrackType.video)
    elapsed = 0
    for filename, duration in prepared:
        script.add_segment(
            cc.VideoSegment(filename, cc.trange(f"{elapsed:.6f}s", f"{duration:.6f}s"))
        )
        elapsed += duration
    script.save()
    return {"name": name, "segments": len(prepared), "duration": elapsed, "saved": True}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("concat")
    parser.add_argument("--drafts", required=True)
    parser.add_argument("--name", required=True)
    parser.add_argument("--width", type=int, default=1920)
    parser.add_argument("--height", type=int, default=1080)
    parser.add_argument("--fps", type=int, default=30)
    args = vars(parser.parse_args(argv))
    args["files"] = read_concat(args.pop("concat"))
    export_draft(**args)


if __name__ == "__main__":
    main()
