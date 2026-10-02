"""Animate an image between normalized crop rectangles using local FFmpeg."""

import argparse
import math
import subprocess
from pathlib import Path

from .common import geometry, output_file


def filter_graph(start, end, frames, width, height, fps):
    for crop in (start, end):
        if len(crop) != 4 or any(not math.isfinite(v) for v in crop):
            raise ValueError("Crop must contain four finite values")
        x, y, w, h = crop
        if min(x, y) < 0 or min(w, h) <= 0 or x + w > 1 or y + h > 1:
            raise ValueError("Crop must fit within normalized image coordinates")
    # Coordinates refer to the image after scale-cover to output aspect.
    # Expand each requested rectangle to output aspect, then interpolate its
    # width and center; zoompan clamps the window at image boundaries.
    fraction = f"on/{max(1, frames - 1)}"

    def interpolate(a, b):
        return f"({a}+({b}-{a})*{fraction})"

    zoom = f"1/{interpolate(max(start[2], start[3]), max(end[2], end[3]))}"
    cx = interpolate(start[0] + start[2] / 2, end[0] + end[2] / 2)
    cy = interpolate(start[1] + start[3] / 2, end[1] + end[3] / 2)
    return (
        f"scale={width * 2}:{height * 2}:force_original_aspect_ratio=increase,"
        f"crop={width * 2}:{height * 2},zoompan=z='{zoom}':"
        f"x='iw*{cx}-iw/zoom/2':y='ih*{cy}-ih/zoom/2':"
        f"d={frames}:s={width}x{height}:fps={fps},format=yuv420p"
    )


def make_clip(
    source,
    output,
    duration=4,
    start_crop=(0, 0, 1, 1),
    end_crop=(0.1, 0.1, 0.8, 0.8),
    width=1920,
    height=1080,
    fps=30,
    overwrite=False,
    runner=subprocess.run,
):
    geometry(width, height, fps, duration)
    graph = filter_graph(
        start_crop, end_crop, max(1, round(duration * fps)), width, height, fps
    )
    if not Path(source).is_file():
        raise FileNotFoundError(source)
    if Path(source).resolve() == Path(output).resolve():
        raise ValueError("Output must differ from the original source media")
    with output_file(output, overwrite) as temporary:
        runner(
            [
                "ffmpeg",
                "-nostdin",
                "-y",
                "-v",
                "error",
                "-i",
                str(source),
                "-vf",
                graph,
                "-an",
                "-t",
                str(duration),
                "-c:v",
                "libx264",
                "-preset",
                "veryfast",
                "-crf",
                "19",
                str(temporary),
            ],
            check=True,
        )
    return str(output)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source")
    parser.add_argument("output")
    parser.add_argument("--duration", type=float, default=4)
    parser.add_argument("--width", type=int, default=1920)
    parser.add_argument("--height", type=int, default=1080)
    parser.add_argument("--fps", type=float, default=30)
    parser.add_argument("--overwrite", action="store_true")
    args = parser.parse_args(argv)
    make_clip(**vars(args))


if __name__ == "__main__":
    main()
