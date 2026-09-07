"""Final edit: takes in, finished video out.

This is the last stage of the original design - distil taste, mint assets,
generate against them, then *cut the thing together*. Everything upstream
produces material; this produces the deliverable.

Three inputs the earlier stages did not handle:

* **overlay images** composited over the cut, so minted stills, grain plates
  and graphic elements can ride on top;
* **a base video to supplement**, where the point is not to generate a new
  piece but to push an existing one toward the distilled look and intercut
  new material into it;
* **the cut itself**, at the reference's measured cadence rather than at
  whatever length the generator happened to emit.
"""

from __future__ import annotations

import json
import subprocess
from pathlib import Path

from . import cadence as cad_mod
from . import frames as frame_mod


def _run(cmd: list[str]) -> None:
    proc = subprocess.run(cmd, capture_output=True, text=True)
    if proc.returncode != 0:
        raise RuntimeError(f"ffmpeg failed: {' '.join(cmd[:6])}...\n{proc.stderr[-400:]}")


def cut_take(
    src: str | Path,
    shots: list[dict],
    dest_dir: str | Path,
    prefix: str = "shot",
    fps: float | None = None,
) -> list[Path]:
    """Slice one generated take into its planned sub-shots.

    Re-encodes rather than stream-copying. Stream copy can only cut on
    keyframes, and at a mean shot length of 0.78s that rounds every boundary
    to the nearest GOP - which is precisely the rhythm this whole pipeline
    exists to preserve.
    """
    src, dest_dir = Path(src), Path(dest_dir)
    dest_dir.mkdir(parents=True, exist_ok=True)
    info = frame_mod.probe(src)
    r = fps or info.fps or 24.0

    out: list[Path] = []
    for i, sh in enumerate(shots):
        start, dur = float(sh["start"]), float(sh["duration"])
        if start >= info.duration - 0.02:
            break
        dur = min(dur, max(0.04, info.duration - start))
        dst = dest_dir / f"{prefix}_{i:03d}.mp4"
        _run([
            "ffmpeg", "-nostdin", "-loglevel", "error", "-y",
            "-ss", f"{start:.4f}", "-i", str(src), "-t", f"{dur:.4f}",
            "-vf", f"fps={r:.6f},setpts=PTS-STARTPTS",
            "-an", "-c:v", "libx264", "-crf", "14", "-preset", "veryfast",
            "-pix_fmt", "yuv420p", str(dst),
        ])
        out.append(dst)
    return out


def overlay(
    clip: str | Path,
    image: str | Path,
    dst: str | Path,
    opacity: float = 0.35,
    scale: float = 0.55,
    position: str | tuple[float, float] = "center",
    blend: str = "screen",
    width: int | None = None,
    height: int | None = None,
    rotate: float = 0.0,
) -> Path:
    """Composite a plate over a clip as a placed ELEMENT, not a full-frame wash.

    The earlier version stretched every plate to fill the frame with
    ``scale2ref``. That is right for a diffuse wash and wrong for everything
    else: a tightened flare stretched edge to edge reads as a smear, and an
    untightened one - 97% empty by construction - reads as a coloured dot
    parked in the middle of the shot. Both showed up in a delivered cut.

    So the element is scaled to a fraction of frame width, optionally rotated,
    placed at a point, and only then blended. ``position`` is either a named
    anchor or an ``(x, y)`` pair in frame fractions of the element's top-left
    corner, which lets a caller vary placement per shot instead of stamping
    the same mark in the same place every time.

    ``screen`` is the default because plates are premultiplied against black,
    so screen drops their blacks for free and no matte is needed.
    """
    clip, image, dst = Path(clip), Path(image), Path(dst)
    if width is None or height is None:
        from . import frames as _fm
        info = _fm.probe(clip)
        width, height = info.width, info.height

    # Resolve the element's pixel size here rather than in ffmpeg expressions.
    # pad() rejects a negative offset and cannot pad to a size smaller than its
    # input, so an element that lands oversized or off-frame kills the whole
    # filtergraph - which it did on the first attempt.
    import cv2 as _cv2
    _im = _cv2.imread(str(image), _cv2.IMREAD_UNCHANGED)
    if _im is None:
        raise ValueError(f"cannot read overlay image: {image}")
    ih0, iw0 = _im.shape[:2]
    ew = max(2, int(width * max(0.02, min(1.0, scale))))
    eh = max(2, int(ew * ih0 / max(1, iw0)))
    if eh > height:  # fit tall elements to the frame instead of overflowing
        eh = height
        ew = max(2, int(eh * iw0 / max(1, ih0)))
    ew, eh = min(ew, width), min(eh, height)
    if isinstance(position, tuple):
        px = int(width * position[0])
        py = int(height * position[1])
    else:
        anchors = {
            "center": (0.5, 0.5), "top": (0.5, 0.12), "bottom": (0.5, 0.88),
            "left": (0.14, 0.5), "right": (0.86, 0.5),
            "topleft": (0.16, 0.16), "topright": (0.84, 0.16),
            "bottomleft": (0.16, 0.84), "bottomright": (0.84, 0.84),
        }
        ax, ay = anchors.get(position, (0.5, 0.5))
        px, py = int(width * ax), int(height * ay)

    # Rotation grows the bounding box, so bake it in before computing offsets.
    if rotate:
        import math as _math
        c, sn = abs(_math.cos(rotate)), abs(_math.sin(rotate))
        rw, rh = int(ew * c + eh * sn), int(ew * sn + eh * c)
        if rw > width or rh > height:
            k = min(width / max(1, rw), height / max(1, rh))
            ew, eh = max(2, int(ew * k)), max(2, int(eh * k))
            rw, rh = int(ew * c + eh * sn), int(ew * sn + eh * c)
        ew_f, eh_f = rw, rh
    else:
        ew_f, eh_f = ew, eh

    ox = max(0, min(width - ew_f, px - ew_f // 2))
    oy = max(0, min(height - eh_f, py - eh_f // 2))

    a = max(0.0, min(1.0, opacity))
    rot = (f"rotate={rotate:.4f}:fillcolor=black@0:"
           f"ow=rotw({rotate:.4f}):oh=roth({rotate:.4f}),") if rotate else ""
    # Scale, rotate, fade, then pad out to full frame on transparent black so a
    # full-frame blend only lights up where the element actually sits.
    fc = (
        f"[1:v]format=rgba,scale={ew}:{eh},{rot}"
        f"colorchannelmixer=aa={a:.3f},"
        f"pad={width}:{height}:{ox}:{oy}:black@0,"
        # Blend RGB planes explicitly: screening neutral YUV chroma produces
        # a magenta cast even where the overlay is transparent. Premultiply
        # alpha after applying opacity so transparent RGB stays invisible.
        f"format=gbrap,premultiply=inplace=1,format=gbrp[ov];"
        f"[0:v]format=gbrp[base];"
        f"[base][ov]blend=all_mode={blend or 'screen'}:shortest=1,format=yuv420p"
    )
    _run([
        "ffmpeg", "-nostdin", "-loglevel", "error", "-y",
        # Keep the still alive until the video ends; shortest=1 otherwise
        # terminates every shot after the image's single decoded frame.
        "-i", str(clip), "-loop", "1", "-i", str(image), "-filter_complex", fc,
        "-c:v", "libx264", "-crf", "14", "-preset", "veryfast",
        "-pix_fmt", "yuv420p", "-an", str(dst),
    ])
    return Path(dst)


def concat(clips: list[str | Path], dst: str | Path, fps: float = 24.0) -> Path:
    """Join clips into one file. Assumes they already share codec and size."""
    clips = [Path(c) for c in clips]
    if not clips:
        raise ValueError("nothing to concatenate")
    dst = Path(dst)
    dst.parent.mkdir(parents=True, exist_ok=True)
    listing = dst.parent / f"{dst.stem}_concat.txt"
    listing.write_text("".join(f"file '{c.resolve().as_posix()}'\n" for c in clips))
    _run([
        "ffmpeg", "-nostdin", "-loglevel", "error", "-y",
        "-f", "concat", "-safe", "0", "-i", str(listing),
        "-vf", f"fps={fps:.6f}",
        "-c:v", "libx264", "-crf", "16", "-pix_fmt", "yuv420p", str(dst),
    ])
    listing.unlink(missing_ok=True)
    return dst


def normalize(
    src: str | Path,
    dst: str | Path,
    width: int,
    height: int,
    fps: float,
    crop: tuple[float, float, float, float] | None = None,
    fit: str = "pad",
) -> Path:
    """Force a clip to one size and rate so it can be concatenated with others.

    Generated takes and a supplied base video rarely agree on resolution or
    frame rate. Scaling with letterbox padding rather than cropping keeps the
    supplied footage intact, since the caller chose it deliberately.
    """
    dst = Path(dst)
    dst.parent.mkdir(parents=True, exist_ok=True)
    pre = ""
    if crop:
        # Crop BEFORE scaling, in fractions of the source frame.
        #
        # Screen-recorded references carry the capturing app's interface baked
        # into the pixels - a like button, a view counter, a comment bubble.
        # Borrowing a shot from that footage without cropping ships someone
        # else's UI in the finished piece, which is exactly what happened in an
        # earlier cut. Fractions rather than pixels because the crop is measured
        # on downscaled analysis frames and applied to full-resolution video.
        fy0, fy1, fx0, fx1 = crop
        pre = (f"crop=w=iw*{max(0.0, fx1 - fx0):.6f}:h=ih*{max(0.0, fy1 - fy0):.6f}"
               f":x=iw*{fx0:.6f}:y=ih*{fy0:.6f},")
    if fit == "cover":
        # Scale up until the frame is covered, then centre-crop the excess.
        #
        # Padding is the safe default and the wrong one for portrait source in
        # a landscape cut. Screen-recorded reference is 9:16; after the UI crop
        # it is narrower still, and padding that into 16:9 left roughly 60% of
        # frame as black bars - one delivered shot was very nearly an empty
        # rectangle. It also poisoned the background measurement, since bars
        # are pure black and count as unlit background.
        #
        # Covering loses the sides of the source, which is the correct trade:
        # the subject is centre-framed in this material, and a full frame of
        # real picture beats a letterboxed thumbnail of all of it.
        geom = (f"scale={width}:{height}:force_original_aspect_ratio=increase,"
                f"crop={width}:{height}")
    else:
        geom = (f"scale={width}:{height}:force_original_aspect_ratio=decrease,"
                f"pad={width}:{height}:(ow-iw)/2:(oh-ih)/2:black")
    vf = pre + geom + f",setsar=1,fps={fps:.6f}"
    _run([
        "ffmpeg", "-nostdin", "-loglevel", "error", "-y", "-i", str(src),
        "-vf", vf, "-an", "-c:v", "libx264", "-crf", "14", "-preset", "veryfast",
        "-pix_fmt", "yuv420p", str(dst),
    ])
    return dst


def weave(generated: list[Path], base: list[Path], ratio: float = 0.5) -> list[Path]:
    """Interleave generated shots with shots cut from a supplied base video.

    ``ratio`` is the share of the finished cut that should come from the base
    footage. Shots alternate on a running quota rather than strictly A/B, so
    a 0.25 ratio yields occasional base shots scattered through generated
    material instead of a rigid every-fourth pattern.
    """
    if not base:
        return list(generated)
    if not generated:
        return list(base)

    out: list[Path] = []
    gi = bi = 0
    debt = 0.0
    while gi < len(generated) or bi < len(base):
        take_base = debt >= 1.0 and bi < len(base)
        if not take_base and gi >= len(generated):
            take_base = bi < len(base)
        if take_base:
            out.append(base[bi]); bi += 1; debt -= 1.0
        else:
            if gi >= len(generated):
                break
            out.append(generated[gi]); gi += 1; debt += ratio / max(1e-6, 1.0 - ratio)
    return out


def write_manifest(path: str | Path, payload: dict) -> Path:
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    return path
