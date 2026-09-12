"""Mint overlay plates: composable graphic assets, not just conditioning stills.

Stills exported by ``mint.py`` serve one purpose - they condition the video
model. They are whole frames, so compositing one over a shot just puts a
second picture on top of the first.

An overlay *plate* is different: it is the reference's graphic vocabulary -
light streaks, flare, glow, glitch fragments - lifted off its background onto
black, so it can be screen-blended over anything without a matte. That is the
asset a colourist or editor actually drops on a timeline, and it is what the
original design meant by minting usable assets rather than reference images.

Three plate types, each isolating a different layer of the look:

``glow``
    Bright, high-chroma elements only. Screen-blends as light.
``streak``
    Directional smear of those elements, which is what reads as motion energy.
``grain``
    The reference's measured noise, rendered as a tileable plate, so footage
    that was denoised by a generative model can be given the reference's
    texture back.

All three are written with alpha, so they also work as straight overlays in
Resolve or After Effects, and all three are premultiplied against black so
``blend=screen`` in ffmpeg needs no keying step.
"""

from __future__ import annotations

from pathlib import Path

import cv2
import numpy as np

from . import grade as grade_mod


def _lab(rgb: np.ndarray) -> np.ndarray:
    return cv2.cvtColor(np.ascontiguousarray(rgb, np.float32), cv2.COLOR_RGB2LAB)


def _write_rgba(path: Path, rgb: np.ndarray, alpha: np.ndarray) -> Path:
    """Write straight (non-premultiplied) RGBA as PNG.

    ffmpeg's screen blend ignores alpha and reads the RGB, so the RGB is
    already black where alpha is zero; the alpha channel is carried purely
    for compositors that do respect it.
    """
    path.parent.mkdir(parents=True, exist_ok=True)
    bgr = cv2.cvtColor((np.clip(rgb, 0, 1) * 255).astype(np.uint8), cv2.COLOR_RGB2BGR)
    a = (np.clip(alpha, 0, 1) * 255).astype(np.uint8)
    cv2.imwrite(str(path), np.dstack([bgr, a]))
    return path


def _energy(frame: np.ndarray) -> np.ndarray:
    """Per-pixel "is this a graphic element" score: bright AND saturated.

    Both factors are required. Brightness alone selects blown highlights that
    carry no colour identity; chroma alone selects dark saturated fill.
    """
    lab = _lab(frame)
    L = lab[..., 0]
    chroma = np.sqrt(lab[..., 1].astype(np.float64) ** 2 + lab[..., 2].astype(np.float64) ** 2)
    return ((L / 100.0).clip(0, 1) * (chroma / 60.0).clip(0, 1)).astype(np.float32)


# A plate is an ELEMENT lifted off a frame. Past roughly this share of frame
# it stops being an element and becomes the frame - which is not a reusable
# asset, and on this material produced plates dominated by a recognisable
# face from the reference. Absolute thresholds cannot enforce this because
# they behave completely differently on a dark reel and a bright one, so the
# selection is a percentile and the coverage is checked afterwards.
_MAX_COVERAGE = 0.22
_SELECT_PCT = 96.5


def _selection(frame: np.ndarray, feather: int, pct: float = _SELECT_PCT) -> np.ndarray:
    e = _energy(frame)
    thr = float(np.percentile(e, pct))
    if thr <= 1e-6:
        return np.zeros_like(e)
    alpha = ((e - thr) / max(1e-6, e.max() - thr)).clip(0, 1).astype(np.float32)
    k = max(3, feather) | 1
    alpha = cv2.GaussianBlur(alpha, (k, k), 0)
    m = alpha.max()
    return alpha / m if m > 1e-6 else alpha


def glow_plate(frame: np.ndarray, dest: str | Path, feather: int = 21) -> Path:
    """Lift the frame's brightest, most saturated elements onto black."""
    alpha = _selection(frame, feather)
    return _write_rgba(Path(dest), frame * alpha[..., None], alpha)


def streak_plate(
    frame: np.ndarray,
    dest: str | Path,
    angle: float = 0.0,
    length: int = 121,
    gain: float = 1.6,
) -> Path:
    """Directional smear of the glow elements - anamorphic-style light streaks."""
    sel = _selection(frame, 5, pct=98.5)

    n = length | 1
    kern = np.zeros((n, n), np.float32)
    kern[n // 2, :] = 1.0
    M = cv2.getRotationMatrix2D((n / 2 - 0.5, n / 2 - 0.5), angle, 1.0)
    kern = cv2.warpAffine(kern, M, (n, n))
    kern /= max(1e-6, kern.sum())

    smear = np.clip(cv2.filter2D(sel, -1, kern) * gain * n / 8.0, 0, 1)
    src = frame * sel[..., None]
    rgb = np.dstack([cv2.filter2D(src[..., i], -1, kern) for i in range(3)])
    if rgb.max() > 1e-6:
        rgb = np.clip(rgb / rgb.max(), 0, 1)
    return _write_rgba(Path(dest), rgb, smear)


def grain_plate(
    dest: str | Path,
    sigma: float,
    width: int = 1080,
    height: int = 1920,
    seed: int = 7,
) -> Path:
    """A plate of the reference's measured grain, centred on mid-grey.

    Generative video is conspicuously clean, and a clean image graded toward a
    grainy reference still does not look like the reference. Overlaying this
    at ``blend=overlay`` puts the measured texture back at the amplitude
    ``mint.py`` actually recorded, instead of at whatever a plugin defaults to.
    """
    rng = np.random.default_rng(seed)
    noise = rng.normal(0.5, max(1e-4, sigma), size=(height, width)).astype(np.float32)
    noise = np.clip(noise, 0, 1)
    rgb = np.dstack([noise] * 3)
    return _write_rgba(Path(dest), rgb, np.ones_like(noise))


def mint_plates(
    frames: list[np.ndarray],
    dest: str | Path,
    noise_sigma: float = 0.0,
    max_plates: int = 4,
    mask: np.ndarray | None = None,
) -> list[Path]:
    """Pick the most graphic frames in the set and render plates from them.

    "Most graphic" is scored as the share of pixels that are both bright and
    saturated - the frames that actually have something to lift. A dark,
    low-chroma frame yields an empty plate, so ranking beats taking the first
    N frames.
    """
    dest = Path(dest)

    # Mask before scoring, not after. Reference reels carry burnt-in
    # typography - titles, captions, watermarks - and it is bright, saturated
    # and high-contrast, so it is exactly what a glow plate selects. The first
    # unmasked run produced two plates whose dominant element was the word
    # "HYPER MOTION" lifted cleanly off its background: a perfect plate of
    # someone else's title card, which is worse than useless as a reusable
    # asset. Temporal-variance masking removes it because the text is static
    # while the footage under it is not.
    if mask is not None:
        frames = [f * mask[..., None].astype(np.float32) for f in frames]

    # Rank by how GRAPHIC a frame is, not by how much of it is bright.
    # "Share of bright saturated pixels" sounds like the same thing and is
    # the opposite: it ranks a washed-out near-white frame top, because
    # almost all of it qualifies, and ranks a black frame with one intense
    # cyan flare - the actual signature of this look - near the bottom. The
    # ratio of peak energy to median energy measures separation instead, and
    # separation is what makes a liftable element.
    scored = []
    for i, f in enumerate(frames):
        e = _energy(f)
        peak = float(np.percentile(e, 99.5))
        floor = float(np.median(e)) + 1e-3
        scored.append((peak / floor, i))
    scored.sort(reverse=True)

    out: list[Path] = []
    rank = 0
    for sep, i in scored:
        if rank >= max_plates or sep < 3.0:
            break
        alpha = _selection(frames[i], 21)
        coverage = float((alpha > 0.08).mean())
        if coverage > _MAX_COVERAGE or coverage < 0.001:
            # Not an element: either the whole frame, or nothing.
            continue
        out.append(glow_plate(frames[i], dest / f"glow_{rank:02d}.png"))
        out.append(streak_plate(frames[i], dest / f"streak_{rank:02d}.png",
                                angle=0.0 if rank % 2 == 0 else 90.0))
        rank += 1

    if noise_sigma > 0:
        h, w = frames[0].shape[:2]
        out.append(grain_plate(dest / "grain.png", noise_sigma,
                               width=max(640, w), height=max(640, h)))
    return out


def tighten(path: str | Path, dest: str | Path | None = None, pad: float = 0.06) -> Path:
    """Crop a plate to its own content, so the element fills the file.

    A glow plate is mostly empty by construction - the selection keeps the top
    few percent of pixels by energy, so a typical plate is 2-7% covered and
    97% transparent black. Compositing that at full frame produces a small
    bright dot floating in the middle of the shot, which reads as a sticker
    rather than as light. Measured on the first cut: a plate covering 1.7% of
    its own frame, screen-blended full-frame, was visible only as a coloured
    blob near centre.

    Cropping to the alpha bounding box means the caller controls the element's
    size on screen by scaling, instead of inheriting whatever fraction of the
    source frame the element happened to occupy.
    """
    path = Path(path)
    im = cv2.imread(str(path), cv2.IMREAD_UNCHANGED)
    if im is None:
        raise ValueError(f"cannot read plate: {path}")
    alpha = im[..., 3] if im.shape[2] == 4 else im[..., :3].max(axis=2)
    ys, xs = np.where(alpha > 12)
    if len(ys) == 0:
        return path
    h, w = alpha.shape
    py, px = int(h * pad), int(w * pad)
    y0 = max(0, int(ys.min()) - py); y1 = min(h, int(ys.max()) + py + 1)
    x0 = max(0, int(xs.min()) - px); x1 = min(w, int(xs.max()) + px + 1)
    out = Path(dest) if dest else path.with_name(path.stem + "_tight.png")
    out.parent.mkdir(parents=True, exist_ok=True)
    cv2.imwrite(str(out), im[y0:y1, x0:x1])
    return out


def plate_coverage(path: str | Path) -> float:
    """Share of the plate that is actually lit. Drives element-vs-wash choice."""
    im = cv2.imread(str(path), cv2.IMREAD_UNCHANGED)
    if im is None:
        return 0.0
    alpha = im[..., 3] if im.shape[2] == 4 else im[..., :3].max(axis=2)
    return float((alpha > 12).mean())
