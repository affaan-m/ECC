"""Frame sampling and lightweight video probing."""

from __future__ import annotations

import json
import subprocess
from dataclasses import dataclass
from pathlib import Path

import cv2
import numpy as np


@dataclass
class VideoInfo:
    path: Path
    width: int
    height: int
    fps: float
    frame_count: int

    @property
    def duration(self) -> float:
        return self.frame_count / self.fps if self.fps else 0.0


def probe(path: str | Path) -> VideoInfo:
    path = Path(path)
    cap = cv2.VideoCapture(str(path))
    if not cap.isOpened():
        raise RuntimeError(f"cannot open video: {path}")
    info = VideoInfo(
        path=path,
        width=int(cap.get(cv2.CAP_PROP_FRAME_WIDTH)),
        height=int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT)),
        fps=float(cap.get(cv2.CAP_PROP_FPS)) or 24.0,
        frame_count=int(cap.get(cv2.CAP_PROP_FRAME_COUNT)),
    )
    cap.release()
    return info


def sample_frames(
    path: str | Path,
    n: int = 48,
    max_edge: int = 512,
    skip_edges: float = 0.02,
) -> list[np.ndarray]:
    """Evenly sample ``n`` frames as float32 RGB in [0, 1].

    ``skip_edges`` trims the head/tail fraction, which is usually slate,
    fade-in, or credits and would poison the grade statistics.
    """
    path = Path(path)
    cap = cv2.VideoCapture(str(path))
    if not cap.isOpened():
        raise RuntimeError(f"cannot open video: {path}")

    total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    if total <= 0:
        # Some containers lie about frame count; fall back to full decode.
        frames = _sequential_sample(cap, n, max_edge)
        cap.release()
        return frames

    lo = int(total * skip_edges)
    hi = int(total * (1.0 - skip_edges))
    idxs = np.linspace(lo, max(lo + 1, hi - 1), num=min(n, max(1, hi - lo)))
    idxs = np.unique(idxs.astype(int))

    out: list[np.ndarray] = []
    for i in idxs:
        cap.set(cv2.CAP_PROP_POS_FRAMES, int(i))
        ok, bgr = cap.read()
        if not ok:
            continue
        out.append(_prep(bgr, max_edge))
    cap.release()

    if not out:
        raise RuntimeError(f"decoded zero frames from {path}")
    return out


def _sequential_sample(cap, n: int, max_edge: int) -> list[np.ndarray]:
    frames = []
    while True:
        ok, bgr = cap.read()
        if not ok:
            break
        frames.append(bgr)
    if not frames:
        return []
    idxs = np.unique(np.linspace(0, len(frames) - 1, num=min(n, len(frames))).astype(int))
    return [_prep(frames[i], max_edge) for i in idxs]


def _prep(bgr: np.ndarray, max_edge: int) -> np.ndarray:
    h, w = bgr.shape[:2]
    scale = max_edge / max(h, w)
    if scale < 1.0:
        bgr = cv2.resize(bgr, (int(w * scale), int(h * scale)), interpolation=cv2.INTER_AREA)
    rgb = cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB)
    return rgb.astype(np.float32) / 255.0


def export_stills(
    path: str | Path,
    dest: str | Path,
    timestamps: list[float],
    prefix: str = "still",
) -> list[Path]:
    """Write full-resolution stills at the given timestamps (seconds).

    These frames are what actually carry the look into image-to-video
    models, so they are exported at native resolution rather than at the
    downscaled analysis size.
    """
    dest = Path(dest)
    dest.mkdir(parents=True, exist_ok=True)
    written: list[Path] = []
    for i, ts in enumerate(timestamps):
        outfile = dest / f"{prefix}_{i:03d}.png"
        cmd = [
            "ffmpeg", "-nostdin", "-loglevel", "error", "-y",
            "-ss", f"{ts:.3f}", "-i", str(path),
            "-frames:v", "1", str(outfile),
        ]
        proc = subprocess.run(cmd, capture_output=True)
        if proc.returncode == 0 and outfile.exists():
            written.append(outfile)
    return written


def ffprobe_json(path: str | Path) -> dict:
    cmd = [
        "ffprobe", "-v", "quiet", "-print_format", "json",
        "-show_format", "-show_streams", str(path),
    ]
    proc = subprocess.run(cmd, capture_output=True, text=True)
    if proc.returncode != 0:
        return {}
    return json.loads(proc.stdout or "{}")


# --------------------------------------------------------------------------
# content masking
# --------------------------------------------------------------------------


def content_mask(
    frames_list: list[np.ndarray],
    var_percentile: float = 35.0,
    min_keep: float = 0.15,
) -> np.ndarray:
    """Boolean mask of pixels that actually change over time.

    Screen-recorded references carry baked-in furniture: letterbox bars, a
    phone status bar, like/comment icons, caption text. All of it is static
    across the whole clip, and all of it lands in the grade statistics as if
    it were part of the look. Black bars inflate the shadow weight and pull
    the whole tone curve down; a red heart icon skews a* toward magenta.

    Temporal variance separates them cleanly - the video content moves, the
    interface does not - so no hand-tuned crop rectangle is needed and the
    same code works regardless of which app the capture came from.

    ``min_keep`` guards the degenerate case: a genuinely static reference
    (a locked-off shot) would otherwise mask itself out entirely.
    """
    if len(frames_list) < 4:
        return np.ones(frames_list[0].shape[:2], dtype=bool)

    stack = np.stack([f.mean(axis=2) for f in frames_list], axis=0)
    var = stack.std(axis=0)

    thresh = np.percentile(var, var_percentile)
    mask = var > max(thresh, 1e-4)

    if mask.mean() < min_keep:
        # Too aggressive for this material; fall back to keeping everything.
        return np.ones_like(mask, dtype=bool)
    return mask


def apply_mask(frames_list: list[np.ndarray], mask: np.ndarray) -> np.ndarray:
    """Flatten frames to only the masked pixels: (n_frames * n_kept, 3)."""
    return np.concatenate([f[mask] for f in frames_list], axis=0)


def mask_bbox(mask: np.ndarray) -> tuple[int, int, int, int]:
    """Tight bounding box (y0, y1, x0, x1) of the moving region."""
    rows = np.where(mask.any(axis=1))[0]
    cols = np.where(mask.any(axis=0))[0]
    if len(rows) == 0 or len(cols) == 0:
        return 0, mask.shape[0], 0, mask.shape[1]
    return int(rows[0]), int(rows[-1]) + 1, int(cols[0]), int(cols[-1]) + 1


def reject_outliers(
    frames_list: list[np.ndarray],
    z: float = 3.5,
    max_drop: float = 0.25,
) -> tuple[list[np.ndarray], list[int]]:
    """Drop frames whose color statistics are alien to the rest of the set.

    Screen-recorded reference reels pick up material that is not reference
    material: a Control Center panel pulled down mid-capture, a home screen,
    an app-switcher card, a white flash between clips. These frames are not a
    style signal, but they are weighted equally with everything else, and a
    single bright neutral frame drags the pooled grade toward grey.

    Robust statistics are what make this safe. Each frame is reduced to its
    mean L*, a*, b*, then scored by median absolute deviation rather than
    standard deviation - MAD does not get inflated by the very outliers it is
    meant to detect, so one extreme frame cannot hide behind the variance it
    creates. ``max_drop`` caps how much can be discarded, so a genuinely
    diverse reel degrades to keeping everything rather than eating itself.

    Returns ``(kept_frames, dropped_indices)``.
    """
    if len(frames_list) < 8:
        return frames_list, []

    feats = []
    for f in frames_list:
        lab = cv2.cvtColor(np.ascontiguousarray(f, np.float32), cv2.COLOR_RGB2LAB)
        feats.append(lab.reshape(-1, 3).mean(axis=0))
    feats = np.asarray(feats, dtype=np.float64)

    med = np.median(feats, axis=0)
    mad = np.median(np.abs(feats - med), axis=0)
    mad = np.maximum(mad, 1e-3)
    # 1.4826 rescales MAD into a consistent estimator of sigma for normal data.
    score = np.max(np.abs(feats - med) / (1.4826 * mad), axis=1)

    order = np.argsort(-score)
    cap = int(len(frames_list) * max_drop)
    dropped = [int(i) for i in order if score[i] > z][:cap]
    dset = set(dropped)
    kept = [f for i, f in enumerate(frames_list) if i not in dset]
    return kept, sorted(dropped)


def ui_safe_crop(
    frames_list: list[np.ndarray],
    strength: float = 1.6,
    max_trim: float = 0.22,
    pad: int = 2,
) -> tuple[int, int, int, int]:
    """Crop rectangle (y0, y1, x0, x1) that excludes baked-in interface chrome.

    ``content_mask`` is the wrong tool for this and its bounding box is worse.
    Temporal variance keeps a like button, because the button *animates* - the
    heart pulses, the view counter ticks over - so the mask marks it as moving
    content and its bbox spans nearly the whole frame. Measured on real
    material, the bbox kept 100% of the width on all three references while the
    interface sat plainly in the right-hand margin.

    The separating signal is the temporal MEDIAN, not the variance. Real
    footage moves, so the median of many frames averages into mush with almost
    no edge energy. Interface chrome sits at fixed pixel coordinates, so its
    edges survive the median intact. Sobel energy on the median frame therefore
    lights up on chrome and goes quiet on content: on one reference the
    right-hand column measured 0.23 against an interior background of 0.03,
    and on another 0.31 against 0.15.

    Trimming walks inward from each edge while that row or column is an outlier
    against the interior median, so it removes letterbox and chrome without
    touching a frame that has neither. ``max_trim`` caps each side, because a
    reference that is genuinely brighter at its edges should degrade to keeping
    everything rather than eating itself.
    """
    if len(frames_list) < 8:
        h, w = frames_list[0].shape[:2]
        return 0, h, 0, w

    stack = np.stack([f.mean(axis=2) for f in frames_list], axis=0)
    med = np.median(stack, axis=0).astype(np.float32)
    gx = cv2.Sobel(med, cv2.CV_32F, 1, 0, ksize=3)
    gy = cv2.Sobel(med, cv2.CV_32F, 0, 1, ksize=3)
    energy = cv2.GaussianBlur(np.sqrt(gx * gx + gy * gy), (15, 15), 0)

    h, w = energy.shape
    rows = energy.mean(axis=1)
    cols = energy.mean(axis=0)

    def _trim(profile: np.ndarray, limit: int) -> tuple[int, int]:
        """Trim past the INNERMOST outlier in each outer band, not from the edge in.

        Walking inward while the current line is hot stops immediately here,
        because the outermost lines are letterbox - flat black, so zero edge
        energy - and the interface sits *inside* that, around 90-95% of the
        width. The first version of this did exactly that and trimmed 1% of
        frame while the like button stayed in shot.
        """
        n = len(profile)
        core = profile[n // 4: 3 * n // 4]
        base = float(np.median(core)) + 1e-6
        thresh = base * strength

        lo = 0
        head = np.where(profile[:limit] > thresh)[0]
        if len(head):
            lo = int(head[-1]) + 1  # just inside the innermost hot line

        hi = n
        tail_off = n - limit
        tail = np.where(profile[tail_off:] > thresh)[0]
        if len(tail):
            hi = tail_off + int(tail[0])

        return lo, min(hi, n)

    y0, y1 = _trim(rows, int(h * max_trim))
    x0, x1 = _trim(cols, int(w * max_trim))

    y0 = min(y0 + pad, h - 1)
    x0 = min(x0 + pad, w - 1)
    y1 = max(y1 - pad, y0 + 1)
    x1 = max(x1 - pad, x0 + 1)
    return int(y0), int(y1), int(x0), int(x1)


def crop_fractions(frames_list: list[np.ndarray], **kw) -> tuple[float, float, float, float]:
    """``ui_safe_crop`` as fractions of frame, so it transfers across resolutions.

    The detector runs on downscaled analysis frames; the crop has to be applied
    to full-resolution video. Fractions survive that, absolute pixels do not.
    """
    y0, y1, x0, x1 = ui_safe_crop(frames_list, **kw)
    h, w = frames_list[0].shape[:2]
    return y0 / h, y1 / h, x0 / w, x1 / w
