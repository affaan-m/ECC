"""Seeded local RGB drift, feedback, pixel sorting and stripe distortion."""

import argparse
import math
import subprocess
from pathlib import Path

import numpy as np

from .common import geometry, output_file


def transform_stream(dec, enc, duration, width, height, fps, seed, mode):
    rng = np.random.default_rng(seed)
    frame_bytes = width * height * 3
    acc = None
    n = 0

    def fx_pixelsort(f, p):
        from PIL import Image
        from pixelsort import pixelsort

        lo = max(0.08, 0.45 - 0.35 * p)
        img = pixelsort(
            Image.fromarray(f),
            interval_function="threshold",
            sorting_function="lightness",
            lower_threshold=lo,
            upper_threshold=0.95,
            angle=90,
            randomness=0,
        )
        return np.asarray(img.convert("RGB"))

    def fx_feedback(f, p):
        nonlocal acc
        from PIL import Image

        if acc is None:
            acc = f.astype(np.float32)
        z = Image.fromarray(acc.astype(np.uint8)).resize(
            (int(width * 1.008), int(height * 1.008))
        )
        x0 = (z.width - width) // 2
        y0 = (z.height - height) // 2
        zoomed = np.asarray(z.crop((x0, y0, x0 + width, y0 + height)), dtype=np.float32)
        decay = 0.90 + 0.06 * p
        acc = np.maximum(f.astype(np.float32), zoomed * decay)
        return acc.astype(np.uint8)

    def fx_drift(f, p):
        # subtle horizontal shift + RGB separation, very light
        shift = int(rng.integers(2, 18) * p) * (1 if rng.random() < 0.5 else -1)
        f = f.copy()
        f[:, :, 0] = np.roll(f[:, :, 0], shift, axis=1)
        f[:, :, 2] = np.roll(f[:, :, 2], -shift // 2, axis=1)
        return f

    while True:
        buf = dec.stdout.read(frame_bytes)
        if not buf:
            break
        if len(buf) != frame_bytes:
            raise RuntimeError("Decoder produced a truncated frame")
        f = np.frombuffer(buf, np.uint8).reshape(height, width, 3).copy()
        total = max(1, int(duration * fps))
        p = min(1.0, (n + 1) / (total * 0.6))

        if mode == "pixelsort":
            out = fx_pixelsort(f, p)
        elif mode == "feedback":
            out = fx_feedback(f, p)
        elif mode == "drift":
            out = fx_drift(f, p)
        else:
            # very light mosh
            out = f
            y = 0
            while y < height:
                bh = int(rng.integers(8, 28))
                if rng.random() < 0.12 * p:
                    shift = int(rng.integers(4, 40) * p) * (
                        1 if rng.random() < 0.5 else -1
                    )
                    out[y : y + bh] = np.roll(out[y : y + bh], shift, axis=1)
                y += bh
            if p > 0.2:
                r = int(2 + 8 * p)
                b = int(1 + 6 * p)
                out[:, :, 0] = np.roll(out[:, :, 0], r, axis=1)
                out[:, :, 2] = np.roll(out[:, :, 2], -b, axis=1)
        enc.stdin.write(out.tobytes())
        n += 1

    if not n:
        raise RuntimeError("Decoder produced no frames")
    return n


def render(
    source,
    start,
    duration,
    output,
    seed,
    mode="drift",
    width=1920,
    height=1080,
    fps=30,
    overwrite=False,
):
    geometry(width, height, fps, duration)
    if not math.isfinite(start) or start < 0:
        raise ValueError("Start must be finite and nonnegative")
    if mode not in ("drift", "feedback", "pixelsort", "mosh"):
        raise ValueError("Unknown effect mode")
    if not Path(source).is_file():
        raise FileNotFoundError(source)
    if isinstance(seed, bool) or not isinstance(seed, int) or seed < 0:
        raise ValueError("Seed must be a nonnegative integer")
    if Path(source).resolve() == Path(output).resolve():
        raise ValueError("Output must differ from the original source media")
    with output_file(output, overwrite) as temporary:
        dec = subprocess.Popen(
            [
                "ffmpeg",
                "-nostdin",
                "-v",
                "error",
                "-ss",
                str(start),
                "-t",
                str(duration),
                "-i",
                str(source),
                "-f",
                "rawvideo",
                "-pix_fmt",
                "rgb24",
                "-s",
                f"{width}x{height}",
                "-r",
                str(fps),
                "-",
            ],
            stdout=subprocess.PIPE,
        )
        enc = None
        try:
            enc = subprocess.Popen(
                [
                    "ffmpeg",
                    "-nostdin",
                    "-y",
                    "-v",
                    "error",
                    "-f",
                    "rawvideo",
                    "-pix_fmt",
                    "rgb24",
                    "-s",
                    f"{width}x{height}",
                    "-r",
                    str(fps),
                    "-i",
                    "-",
                    "-c:v",
                    "libx264",
                    "-preset",
                    "veryfast",
                    "-crf",
                    "19",
                    "-pix_fmt",
                    "yuv420p",
                    "-color_primaries",
                    "bt709",
                    "-color_trc",
                    "bt709",
                    "-colorspace",
                    "bt709",
                    str(temporary),
                ],
                stdin=subprocess.PIPE,
            )
            count = transform_stream(dec, enc, duration, width, height, fps, seed, mode)
            enc.stdin.close()
            dec.stdout.close()
            for process in (enc, dec):
                if process.wait() != 0:
                    raise subprocess.CalledProcessError(
                        process.returncode, process.args
                    )
        finally:
            for process in (enc, dec):
                if process is not None:
                    if process.poll() is None:
                        process.kill()
                    process.wait()
                    for pipe in (process.stdin, process.stdout):
                        if pipe and not pipe.closed:
                            pipe.close()
    return count


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source")
    parser.add_argument("start", type=float)
    parser.add_argument("duration", type=float)
    parser.add_argument("output")
    parser.add_argument("seed", type=int)
    parser.add_argument(
        "mode",
        nargs="?",
        default="drift",
        choices=["drift", "feedback", "pixelsort", "mosh"],
    )
    parser.add_argument("--width", type=int, default=1920)
    parser.add_argument("--height", type=int, default=1080)
    parser.add_argument("--fps", type=float, default=30)
    parser.add_argument("--overwrite", action="store_true")
    args = parser.parse_args(argv)
    count = render(**vars(args))
    print(f"{args.mode}: {count} frames -> {args.output}")


if __name__ == "__main__":
    main()
