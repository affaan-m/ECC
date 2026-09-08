"""Color-grade distillation: reference frames in, .cube LUT out.

The look of a reference is split into two separable parts:

* **Tone** - the shape of the luminance distribution (crushed blacks, milky
  lifted shadows, blown highlights). Captured as a 256-bin CDF of L* and
  transferred by histogram matching, which reproduces curve *shape*, not
  merely mean and spread.
* **Chroma** - the color cast and saturation, captured per luminance zone
  as the MEDIAN and MAD of the a*/b* opponent channels, and transferred
  affinely. Robust estimators matter here: chroma distributions are
  right-skewed and a mean-based target over-saturates (see _zone_stats).

Splitting them this way matters: mean/std alone cannot represent an S-curve
or a crushed toe, while CDF-matching the chroma channels tends to produce
garish results because a*/b* are near-zero-centered and their tails are noise.

Two artifacts come out of this module:

* ``look.cube`` - baked against a canonical neutral source, so it is usable
  immediately as a starting grade node in Resolve without knowing what
  footage it will land on.
* ``grade.json`` - the raw reference statistics, so ``apply.py`` can bake a
  *clip-specific* LUT later once the actual source footage is known. That one
  is materially more accurate; the canonical bake is the convenience path.
"""

from __future__ import annotations

import json
import subprocess
from dataclasses import dataclass, asdict, field
from pathlib import Path

import cv2
import numpy as np

LUT_SIZE_DEFAULT = 33
_CDF_BINS = 256

# L* occupies [0, 100]; a*/b* roughly [-127, 127] in OpenCV's float32 Lab.
_L_MAX = 100.0

# Below this L*, a pixel reads on screen as unlit background rather than as a
# dark tone. Chosen against the material: the flashethereal references sit
# between 24% and 55% of frame under it, and a grade that moves an output
# outside that band is visibly wrong however good its other numbers look.
SHADOW_L = 10.0


# --------------------------------------------------------------------------
# statistics
# --------------------------------------------------------------------------


@dataclass
class GradeStats:
    """Distilled color statistics of a reference set."""

    lab_mean: list[float] = field(default_factory=lambda: [0.0, 0.0, 0.0])
    lab_std: list[float] = field(default_factory=lambda: [1.0, 1.0, 1.0])
    l_cdf: list[float] = field(default_factory=list)  # len == _CDF_BINS
    black_point: float = 0.0    # 1st percentile of L*
    white_point: float = 100.0  # 99th percentile of L*
    contrast: float = 0.0       # std of L*
    saturation: float = 0.0     # mean chroma sqrt(a^2 + b^2)
    warmth: float = 0.0         # mean b* (+ yellow / - blue)
    tint: float = 0.0           # mean a* (+ magenta / - green)
    noise_sigma: float = 0.0    # grain estimate, luma MAD of high-pass residual
    palette: list[list] = field(default_factory=list)  # [["#rrggbb", weight], ...]
    # Per-luminance-zone chroma: [[a_mu, a_sd, b_mu, b_sd], ...] over ZONE_EDGES.
    # This is what encodes split-toning (teal shadows + warm highlights); a
    # single global a*/b* affine mathematically cannot represent it.
    zones: list[list] = field(default_factory=list)
    # Share of pixels below SHADOW_L*, i.e. how much of the frame reads as
    # unlit background. Recorded because no moment of the distribution can
    # see it: a clip can hold the right mean, std and chroma while its blacks
    # have been lifted into grey, which is exactly the failure that once
    # produced a muddy purple frame at a chroma error of 1.88.
    bg_share: float = 0.0
    n_frames: int = 0

    def to_dict(self) -> dict:
        return asdict(self)

    @classmethod
    def from_dict(cls, d: dict) -> "GradeStats":
        known = {k: v for k, v in d.items() if k in cls.__dataclass_fields__}
        return cls(**known)


def _to_lab(rgb: np.ndarray) -> np.ndarray:
    """float32 RGB in [0,1] -> Lab (L in [0,100], a/b about [-127,127])."""
    return cv2.cvtColor(np.ascontiguousarray(rgb, dtype=np.float32), cv2.COLOR_RGB2LAB)


def _to_rgb(lab: np.ndarray) -> np.ndarray:
    rgb = cv2.cvtColor(np.ascontiguousarray(lab, dtype=np.float32), cv2.COLOR_LAB2RGB)
    return np.clip(rgb, 0.0, 1.0)


def _cdf_of_l(l_chan: np.ndarray) -> np.ndarray:
    """Normalized cumulative distribution of L* over _CDF_BINS bins."""
    hist, _ = np.histogram(
        np.clip(l_chan, 0.0, _L_MAX), bins=_CDF_BINS, range=(0.0, _L_MAX)
    )
    total = hist.sum()
    if total == 0:
        return np.linspace(0.0, 1.0, _CDF_BINS)
    return np.cumsum(hist).astype(np.float64) / float(total)


def _estimate_noise(frames: list[np.ndarray]) -> float:
    """Grain estimate: MAD of the high-pass luma residual, in [0,1] units."""
    sigmas = []
    for f in frames[: min(len(frames), 12)]:
        luma = cv2.cvtColor(f, cv2.COLOR_RGB2GRAY)
        blur = cv2.GaussianBlur(luma, (0, 0), sigmaX=1.2)
        resid = luma - blur
        mad = np.median(np.abs(resid - np.median(resid)))
        sigmas.append(float(mad * 1.4826))
    return float(np.median(sigmas)) if sigmas else 0.0


def _palette(frames: list[np.ndarray], k: int = 6) -> list[list]:
    """Dominant colors via k-means, returned as [hex, weight] sorted by weight."""
    pix = np.concatenate([f.reshape(-1, 3)[::37] for f in frames], axis=0)
    if len(pix) > 60000:
        pix = pix[np.random.default_rng(0).choice(len(pix), 60000, replace=False)]
    pix = np.ascontiguousarray(pix, dtype=np.float32)
    k = int(min(k, max(1, len(np.unique(pix, axis=0)))))
    criteria = (cv2.TERM_CRITERIA_EPS + cv2.TERM_CRITERIA_MAX_ITER, 20, 0.5)
    _, labels, centers = cv2.kmeans(pix, k, None, criteria, 3, cv2.KMEANS_PP_CENTERS)
    labels = labels.ravel()
    out = []
    for i, c in enumerate(centers):
        weight = float((labels == i).sum()) / float(len(labels))
        r, g, b = (int(round(float(v) * 255)) for v in np.clip(c, 0, 1))
        out.append([f"#{r:02x}{g:02x}{b:02x}", round(weight, 4)])
    out.sort(key=lambda x: -x[1])
    return out


# Luminance zone edges in L*: shadows -> midtones -> highlights.
ZONE_EDGES = np.array([0.0, 15.0, 35.0, 55.0, 75.0, 100.0], dtype=np.float64)
ZONE_CENTERS = 0.5 * (ZONE_EDGES[:-1] + ZONE_EDGES[1:])
_N_ZONES = len(ZONE_CENTERS)
_MIN_ZONE_PIX = 64



def _mad_sigma(x: np.ndarray) -> float:
    """Robust spread: MAD rescaled to be comparable to a standard deviation.

    Falls back to std when MAD collapses to zero, which happens on flat
    synthetic regions where more than half the pixels share one value.
    """
    med = np.median(x)
    mad = float(np.median(np.abs(x - med)))
    s = 1.4826 * mad
    return s if s > 1e-3 else float(np.std(x))


def _zone_stats(L: np.ndarray, a: np.ndarray, b: np.ndarray) -> list[list]:
    """Robust chroma statistics within each luminance zone.

    Sparse zones (a clip with no true blacks, say) are backfilled from the
    nearest populated zone so downstream interpolation stays well-defined
    instead of snapping chroma to zero where there was simply no data.
    """
    idx = np.digitize(L, ZONE_EDGES[1:-1])
    raw: list[list | None] = []
    for z in range(_N_ZONES):
        m = idx == z
        if int(m.sum()) < _MIN_ZONE_PIX:
            raw.append(None)
            continue
        az, bz = a[m], b[m]
        # Median and MAD, not mean and standard deviation. Chroma in real
        # reference sets is strongly right-skewed: a minority of highly
        # saturated frames drags the mean far above what a typical frame
        # shows. On one measured reel the mean chroma in the midtone zone was
        # 36.9 against a median of 17.5, so a mean-based LUT pushed colour
        # roughly three times harder than the material warranted. The median
        # tracks the dominant look, and the saturated tail stays in the
        # reference without setting the target.
        raw.append(
            [
                float(np.median(az)),
                float(_mad_sigma(az)),
                float(np.median(bz)),
                float(_mad_sigma(bz)),
            ]
        )

    populated = [i for i, v in enumerate(raw) if v is not None]
    if not populated:
        g = [float(a.mean()), float(a.std()), float(b.mean()), float(b.std())]
        return [list(g) for _ in range(_N_ZONES)]

    out: list[list] = []
    for z in range(_N_ZONES):
        if raw[z] is not None:
            out.append(raw[z])
        else:
            nearest = min(populated, key=lambda p: abs(p - z))
            out.append(list(raw[nearest]))
    return out


def analyze(frames: list[np.ndarray]) -> GradeStats:
    """Distill grade statistics from a list of float32 RGB frames in [0,1]."""
    if not frames:
        raise ValueError("analyze() needs at least one frame")

    labs = [_to_lab(f) for f in frames]
    stacked = np.concatenate([l.reshape(-1, 3) for l in labs], axis=0)
    L, a, b = stacked[:, 0], stacked[:, 1], stacked[:, 2]

    chroma = np.sqrt(a.astype(np.float64) ** 2 + b.astype(np.float64) ** 2)

    return GradeStats(
        zones=_zone_stats(L, a, b),
        lab_mean=[float(L.mean()), float(a.mean()), float(b.mean())],
        lab_std=[float(L.std()), float(a.std()), float(b.std())],
        l_cdf=[float(v) for v in _cdf_of_l(L)],
        black_point=float(np.percentile(L, 1)),
        white_point=float(np.percentile(L, 99)),
        contrast=float(L.std()),
        saturation=float(chroma.mean()),
        warmth=float(b.mean()),
        tint=float(a.mean()),
        noise_sigma=_estimate_noise(frames),
        palette=_palette(frames),
        bg_share=float((L < SHADOW_L).mean()),
        n_frames=len(frames),
    )


# --------------------------------------------------------------------------
# canonical neutral source
# --------------------------------------------------------------------------

_NEUTRAL_CACHE: "GradeStats | None" = None


def neutral_stats(size: int = 24) -> GradeStats:
    """Statistics of a uniformly-sampled sRGB cube.

    This is the assumed source when baking a source-agnostic LUT. It is
    deterministic and unbiased, which is the best available stand-in when the
    footage the LUT will be applied to is not yet known.
    """
    global _NEUTRAL_CACHE
    if _NEUTRAL_CACHE is not None:
        return _NEUTRAL_CACHE
    grid = _identity_grid(size)
    _NEUTRAL_CACHE = analyze([grid.reshape(size, size * size, 3)])
    return _NEUTRAL_CACHE


def _identity_grid(size: int) -> np.ndarray:
    """(size**3, 3) identity RGB lattice, red index varying fastest."""
    ramp = np.linspace(0.0, 1.0, size, dtype=np.float32)
    b, g, r = np.meshgrid(ramp, ramp, ramp, indexing="ij")
    return np.stack([r, g, b], axis=-1).reshape(-1, 3)


# --------------------------------------------------------------------------
# LUT baking
# --------------------------------------------------------------------------


_D65 = np.array([0.95047, 1.00000, 1.08883], dtype=np.float32)
_XYZ_TO_LRGB = np.array(
    [
        [3.2404542, -1.5371385, -0.4985314],
        [-0.9692660, 1.8760108, 0.0415560],
        [0.0556434, -0.2040259, 1.0572252],
    ],
    dtype=np.float32,
)
_XYZ_TO_LRGB_T = np.ascontiguousarray(_XYZ_TO_LRGB.T)
_EPS = np.float32(216.0 / 24389.0)
_KAPPA = np.float32(24389.0 / 27.0)


def _lab_to_linear_rgb(L: np.ndarray, a: np.ndarray, b: np.ndarray) -> np.ndarray:
    """Lab -> linear sRGB **without clamping**, for honest gamut testing.

    ``cv2.cvtColor(..., COLOR_LAB2RGB)`` silently clamps to [0,1], so it
    cannot be used to detect out-of-gamut colors: everything looks in-gamut
    after the fact. This does the conversion by hand so the caller can see
    values that fall outside the cube.
    """
    fy = (L + 16.0) / 116.0
    fx = fy + a / 500.0
    fz = fy - b / 200.0
    f = np.stack([fx, fy, fz], axis=-1)
    f3 = f ** 3
    xyz_r = np.where(f3 > _EPS, f3, (116.0 * f - 16.0) / _KAPPA)
    # Y uses the L* form directly for better accuracy near black.
    xyz_r[..., 1] = np.where(L > _KAPPA * _EPS, ((L + 16.0) / 116.0) ** 3, L / _KAPPA)
    xyz = xyz_r * _D65
    return xyz @ _XYZ_TO_LRGB_T


def _gamut_compress(L: np.ndarray, a: np.ndarray, b: np.ndarray, iters: int = 10):
    """Scale chroma toward the neutral axis until the color fits in sRGB.

    Hue and lightness are preserved exactly; only saturation gives way. This
    is what keeps a crushed, very dark grade from going muddy: hard RGB
    clipping shifts hue unpredictably, whereas compressing along the chroma
    axis degrades gracefully.
    """
    inside_full = _in_gamut(L, a, b)
    lo = np.zeros_like(L, dtype=np.float32)
    hi = np.ones_like(L, dtype=np.float32)
    for _ in range(iters):
        mid = 0.5 * (lo + hi)
        ok = _in_gamut(L, a * mid, b * mid)
        lo = np.where(ok, mid, lo)
        hi = np.where(ok, hi, mid)
    s = np.where(inside_full, np.float32(1.0), lo)
    return a * s, b * s


def _in_gamut(L: np.ndarray, a: np.ndarray, b: np.ndarray, tol: float = 1e-4) -> np.ndarray:
    lin = _lab_to_linear_rgb(L, a, b)
    return np.all((lin >= -tol) & (lin <= 1.0 + tol), axis=-1)


def _subsample_idx(n: int, cap: int = 120_000) -> slice:
    """Stride that keeps at most ``cap`` samples - enough for a stable mean."""
    return slice(None, None, max(1, n // cap))




def _post_tone_anchor(source: GradeStats, target: GradeStats,
                      lo_pct: float = 1.0, hi_pct: float = 99.0):
    """Percentiles the SOURCE will occupy after tone matching, as fixed numbers.

    :func:`_anchor_endpoints` measures percentiles of whatever array it is
    handed. That is correct when transferring real pixels and silently wrong
    when baking a LUT, because the array is then a uniform RGB lattice whose
    luminance distribution is nothing like the footage. The stretch baked in
    is computed for the wrong distribution, and the LUT cannot recover the
    endpoints it was supposed to set.

    A 3D LUT can only encode per-pixel functions of RGB. Any operation that
    depends on the image as a whole has to be reduced to fixed constants
    first. This reconstructs the source's luminance quantiles from its stored
    CDF, pushes them through the same tone match, and returns the resulting
    endpoints so the stretch becomes a plain affine that a LUT can hold.
    """
    if not source.l_cdf or not target.l_cdf:
        return None
    edges = np.linspace(0.0, _L_MAX, _CDF_BINS)
    src_cdf = np.asarray(source.l_cdf, dtype=np.float64)
    mono = np.maximum.accumulate(src_cdf) + np.linspace(0.0, 1e-6, _CDF_BINS)
    # Representative sample of the source's own luminance distribution.
    qs = np.linspace(0.0, 1.0, 2048)
    l_sample = np.interp(qs, mono, edges).astype(np.float32)
    l_after = _match_cdf(l_sample, src_cdf, np.asarray(target.l_cdf, dtype=np.float64))
    return float(np.percentile(l_after, lo_pct)), float(np.percentile(l_after, hi_pct))


def _anchor_endpoints(L: np.ndarray, target: GradeStats, lo_pct=1.0, hi_pct=99.0,
                      fixed: "tuple[float, float] | None" = None) -> np.ndarray:
    """Linearly stretch L* so its black and white points land on the target's.

    CDF matching alone cannot always reach the target spread. Where a source
    has a large mass of pixels sharing one luminance - a flat unlit background,
    a blown highlight - that mass is an atom: it maps to a single output value
    and cannot be spread across the range the target occupies. Measured on a
    flattened clip, pure CDF matching reached contrast 31.6 against a target of
    34.7 with the black point stranded at 3.7 instead of 0.0.

    A linear stretch anchored on the 1st and 99th percentiles fixes the
    endpoints without disturbing the curve shape the CDF match produced. It is
    the same move a colorist makes last: set the black and white, having
    already shaped everything between them.
    """
    if fixed is not None:
        lo, hi = fixed
    else:
        lo = float(np.percentile(L, lo_pct))
        hi = float(np.percentile(L, hi_pct))
    if hi - lo < 1e-3:
        return L
    t_lo, t_hi = float(target.black_point), float(target.white_point)
    scaled = (L - lo) / (hi - lo) * (t_hi - t_lo) + t_lo
    return np.clip(scaled, 0.0, _L_MAX).astype(np.float32)


def transfer(
    rgb: np.ndarray,
    target: GradeStats,
    source: GradeStats,
    strength: float = 1.0,
    tone: bool = True,
    chroma: bool = True,
    gamut_iters: int = 0,
    chroma_mode: str = "offset",
    anchor: bool = True,
    anchor_range: "tuple[float, float] | None" = None,
    gamut: bool = True,
    tone_mode: str = "anchor",
) -> np.ndarray:
    """Map ``rgb`` (float32 [0,1], any shape ending in 3) from source to target look.

    After the affine chroma move, the result is gamut-compressed rather than
    hard-clipped, then the chroma is re-solved a few times to recover as much
    of the target's color as the sRGB cube can actually hold at the new
    lightness. Without that recovery loop a strong dark grade loses most of
    its color cast, because the chroma the reference carries in its highlights
    has nowhere to live once those pixels are pushed down.
    """
    shape = rgb.shape
    flat = np.ascontiguousarray(rgb.reshape(1, -1, 3), dtype=np.float32)
    lab = _to_lab(flat).reshape(-1, 3)
    L, a, b = lab[:, 0].copy(), lab[:, 1].copy(), lab[:, 2].copy()

    if tone:
        # "cdf" forces the source's luminance histogram onto the target's. That
        # is right only when the two have similar COMPOSITION. Measured on
        # generated footage that was mostly black against a busy full-frame
        # reference, it dragged the black background up into the midtones,
        # where the pack's violet lives, and produced a muddy purple wash with
        # visible banding - while still scoring well on zone error and
        # contrast, because neither metric knows the background was meant to
        # stay black.
        #
        # "anchor" sets black and white and leaves the shape of everything
        # between them alone. It cannot import the reference's tonal
        # personality, and that is the point: it also cannot destroy the
        # image's own.
        if tone_mode == "cdf" and target.l_cdf and source.l_cdf:
            L_new = _match_cdf(L, np.asarray(source.l_cdf), np.asarray(target.l_cdf))
            L = (L + (L_new - L) * strength).astype(np.float32)
        if anchor:
            L = L + (_anchor_endpoints(L, target, fixed=anchor_range) - L) * strength

    if chroma:
        if target.zones and source.zones:
            # Luminance-conditioned: look up source params at the pixel's
            # ORIGINAL lightness and target params at its NEW lightness, so a
            # shadow pushed into the midtones picks up midtone coloring.
            a_t, b_t = _zone_transfer(
                lab[:, 0], L, a, b, source=source, target=target,
                strength=strength, mode=chroma_mode,
            )
        else:
            a_t, b_t = a.copy(), b.copy()
            for idx, ch in ((1, a_t), (2, b_t)):
                s_mu, s_sd = source.lab_mean[idx], max(source.lab_std[idx], 1e-4)
                t_mu, t_sd = target.lab_mean[idx], target.lab_std[idx]
                new = (ch - s_mu) / s_sd * t_sd + t_mu
                ch += (new - ch) * strength

        want_a = target.lab_mean[1] * strength + source.lab_mean[1] * (1 - strength)
        want_b = target.lab_mean[2] * strength + source.lab_mean[2] * (1 - strength)

        # Solve the chroma gain on a subsample - the full-resolution binary
        # search is the expensive part and the mean converges long before
        # every pixel is needed.
        sub = _subsample_idx(len(L))
        Ls, as_, bs_ = L[sub], a_t[sub], b_t[sub]
        ga = gb = np.float32(1.0)
        for _ in range(max(0, gamut_iters)):
            ca, cb = _gamut_compress(Ls, as_ * ga, bs_ * gb)
            na, nb = _mean_gain(ca, want_a), _mean_gain(cb, want_b)
            if abs(na - 1.0) < 5e-3 and abs(nb - 1.0) < 5e-3:
                break
            ga, gb = ga * na, gb * nb

        if gamut:
            a, b = _gamut_compress(L, a_t * ga, b_t * gb)
        else:
            # Hard clip in _to_rgb instead. Cheap, and adequate when the
            # chroma shift is modest enough that little leaves the cube.
            a, b = a_t * ga, b_t * gb

    out_lab = np.stack([L, a, b], axis=-1).reshape(1, -1, 3).astype(np.float32)
    return _to_rgb(out_lab).reshape(shape)


def _zone_transfer(
    L_src: np.ndarray,
    L_dst: np.ndarray,
    a: np.ndarray,
    b: np.ndarray,
    source: GradeStats,
    target: GradeStats,
    strength: float,
    mode: str = "offset",
):
    """Affine chroma transfer whose parameters vary smoothly with lightness.

    Zone statistics are interpolated across ZONE_CENTERS rather than applied
    as hard bands, which avoids visible banding at the zone boundaries.
    """
    s = np.asarray(source.zones, dtype=np.float64)
    t = np.asarray(target.zones, dtype=np.float64)

    s_amu = np.interp(L_src, ZONE_CENTERS, s[:, 0])
    s_asd = np.maximum(np.interp(L_src, ZONE_CENTERS, s[:, 1]), 1e-4)
    s_bmu = np.interp(L_src, ZONE_CENTERS, s[:, 2])
    s_bsd = np.maximum(np.interp(L_src, ZONE_CENTERS, s[:, 3]), 1e-4)

    t_amu = np.interp(L_dst, ZONE_CENTERS, t[:, 0])
    t_asd = np.interp(L_dst, ZONE_CENTERS, t[:, 1])
    t_bmu = np.interp(L_dst, ZONE_CENTERS, t[:, 2])
    t_bsd = np.interp(L_dst, ZONE_CENTERS, t[:, 3])

    if mode == "offset":
        # Shift the whole distribution by the measured difference, leaving its
        # spread alone. The affine alternative rescales by the ratio of
        # standard deviations, which amplifies whatever spread the source
        # happens to have; when that spread is small the multiplier explodes
        # and the result overshoots hard enough to flip sign. Measured on a
        # real clip: affine put midtone b* at +11.6 against a target of -17.5,
        # while the offset form landed inside 1.4 mean absolute error.
        a_new = a + (t_amu - s_amu)
        b_new = b + (t_bmu - s_bmu)
    else:
        a_new = (a - s_amu) / s_asd * t_asd + t_amu
        b_new = (b - s_bmu) / s_bsd * t_bsd + t_bmu
    return (
        (a + (a_new - a) * strength).astype(np.float32),
        (b + (b_new - b) * strength).astype(np.float32),
    )


def _mean_gain(ch: np.ndarray, target_mean: float, cap: float = 4.0) -> float:
    """Multiplier that would move ``ch``'s mean onto ``target_mean``."""
    cur = float(ch.mean())
    if abs(cur) < 1e-6:
        return 1.0
    return float(np.clip(target_mean / cur, 1.0 / cap, cap))


def _match_cdf(values: np.ndarray, src_cdf: np.ndarray, tgt_cdf: np.ndarray) -> np.ndarray:
    """Histogram-match L* values from the source CDF onto the target CDF."""
    edges = np.linspace(0.0, _L_MAX, _CDF_BINS)
    # forward: value -> quantile under the source distribution
    q = np.interp(np.clip(values, 0.0, _L_MAX), edges, src_cdf)
    # inverse: quantile -> value under the target distribution. tgt_cdf is
    # non-decreasing; nudge it strictly increasing so np.interp is stable.
    tgt_mono = np.maximum.accumulate(np.asarray(tgt_cdf, dtype=np.float64))
    tgt_mono = tgt_mono + np.linspace(0.0, 1e-6, len(tgt_mono))
    return np.interp(q, tgt_mono, edges)


def bake_cube(
    target: GradeStats,
    source: GradeStats | None = None,
    size: int = LUT_SIZE_DEFAULT,
    strength: float = 1.0,
    title: str = "taste-forge",
    gamut_iters: int = 0,
    chroma_mode: str = "offset",
    anchor: bool = False,
) -> str:
    """Bake a 3D LUT in Adobe .cube format.

    ``source=None`` bakes against the canonical neutral (source-agnostic).
    Pass a real ``GradeStats`` measured from the footage you are grading for a
    clip-specific LUT, which is meaningfully more accurate.
    """
    src = source if source is not None else neutral_stats()
    # The grid is not the footage; anchor on what the SOURCE becomes post-tone.
    fixed_anchor = _post_tone_anchor(src, target)
    grid = _identity_grid(size)
    mapped = np.clip(transfer(grid, target=target, source=src, strength=strength,
                              gamut_iters=gamut_iters, chroma_mode=chroma_mode,
                              anchor=anchor, anchor_range=fixed_anchor), 0.0, 1.0)

    lines = [
        f'TITLE "{title}"',
        f"LUT_3D_SIZE {size}",
        "DOMAIN_MIN 0.0 0.0 0.0",
        "DOMAIN_MAX 1.0 1.0 1.0",
        "",
    ]
    lines.extend(f"{r:.6f} {g:.6f} {b:.6f}" for r, g, b in mapped)
    return "\n".join(lines) + "\n"


def write_cube(path: str | Path, text: str) -> Path:
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")
    return path


def load_stats(path: str | Path) -> GradeStats:
    return GradeStats.from_dict(json.loads(Path(path).read_text(encoding="utf-8")))


def analyze_pixels(
    pixels: np.ndarray,
    noise_frames: list[np.ndarray] | None = None,
    palette_pixels: np.ndarray | None = None,
) -> GradeStats:
    """Same statistics as :func:`analyze`, but from a flat (N, 3) pixel array.

    This is the masked path: callers pool only the pixels that survived
    content masking, across references of differing frame sizes, and pass
    them here. Grain still needs 2-D neighbourhoods, so ``noise_frames``
    carries a handful of cropped frames purely for that estimate.
    """
    if pixels.ndim != 2 or pixels.shape[1] != 3:
        raise ValueError(f"expected (N, 3) pixels, got {pixels.shape}")

    lab = _to_lab(np.ascontiguousarray(pixels.reshape(1, -1, 3), np.float32)).reshape(-1, 3)
    L, a, b = lab[:, 0], lab[:, 1], lab[:, 2]
    chroma = np.sqrt(a.astype(np.float64) ** 2 + b.astype(np.float64) ** 2)

    pal_src = palette_pixels if palette_pixels is not None else pixels
    pal = _palette([pal_src.reshape(1, -1, 3)])

    return GradeStats(
        zones=_zone_stats(L, a, b),
        lab_mean=[float(L.mean()), float(a.mean()), float(b.mean())],
        lab_std=[float(L.std()), float(a.std()), float(b.std())],
        l_cdf=[float(v) for v in _cdf_of_l(L)],
        black_point=float(np.percentile(L, 1)),
        white_point=float(np.percentile(L, 99)),
        contrast=float(L.std()),
        saturation=float(chroma.mean()),
        warmth=float(b.mean()),
        tint=float(a.mean()),
        noise_sigma=_estimate_noise(noise_frames) if noise_frames else 0.0,
        palette=pal,
        bg_share=float((L < SHADOW_L).mean()),
        n_frames=0,
    )


def grade_clip(
    src: str | Path,
    dst: str | Path,
    lut: str | Path,
    strength: float = 1.0,
    crf: int = 16,
) -> Path:
    """Apply a pack's .cube to a clip with ffmpeg. This is where the look happens.

    Measured on three generations against the flashethereal pack: prompting
    for the grade moved midtone a* from +1.9 to +2.8 across two paid attempts
    and never touched contrast (23.4 / 19.3 / 19.2 against a target of 34.7).
    Running the same footage through this function put chroma within a mean
    absolute error of 1.4 and contrast at 34.9 against 34.7 - in one pass, at
    no marginal cost, and identically every time.

    ``strength`` below 1.0 blends the graded result back toward the original,
    for when the full pack look is too much for a particular shot.
    """
    src, dst, lut = Path(src), Path(dst), Path(lut)
    if not lut.exists():
        raise FileNotFoundError(f"LUT not found: {lut}")
    dst.parent.mkdir(parents=True, exist_ok=True)

    s = max(0.0, min(1.0, float(strength)))
    if s >= 0.999:
        vf = f"lut3d=file='{lut.as_posix()}'"
    else:
        # Blend graded over original so partial looks stay available.
        vf = (
            f"split=2[a][b];[b]lut3d=file='{lut.as_posix()}'[g];"
            f"[a][g]blend=all_mode=normal:all_opacity={s:.3f}"
        )

    cmd = [
        "ffmpeg", "-nostdin", "-loglevel", "error", "-y", "-i", str(src),
        "-vf", vf, "-c:v", "libx264", "-crf", str(crf), "-pix_fmt", "yuv420p",
        "-c:a", "copy", str(dst),
    ]
    proc = subprocess.run(cmd, capture_output=True, text=True)
    if proc.returncode != 0:
        raise RuntimeError(f"ffmpeg grade failed: {proc.stderr[-400:]}")
    return dst


def grade_clip_adaptive(
    src: str | Path,
    dst: str | Path,
    target: GradeStats,
    strength: float = 1.0,
    lut_size: int = 33,
    n_frames: int = 32,
    keep_lut: str | Path | None = None,
) -> Path:
    """Measure the clip, bake a LUT *for that clip*, then apply it.

    Prefer this over :func:`grade_clip` for anything generated.

    ``look.cube`` is baked against a canonical neutral stand-in, because when
    a pack is minted there is no way to know what footage it will meet. That
    makes it a good starting node in Resolve and a poor automatic grade. Tested
    on a deliberately flattened clip, the canonical LUT nailed tone - contrast
    22.6 -> 35.1 against a target of 34.7 - while putting midtone a* at -0.8
    where the target was +24.9, because the real source was far less saturated
    than the assumed one and a fixed affine cannot know that.

    Measuring the actual source first removes the guess. The transfer is then
    solving a known problem instead of an assumed one.
    """
    src, dst = Path(src), Path(dst)
    frames_mod = __import__("taste.frames", fromlist=["sample_frames"])
    source = analyze(frames_mod.sample_frames(src, n=n_frames))

    cube = bake_cube(target, source=source, size=lut_size, strength=strength,
                     title=f"{src.stem}-adaptive")
    lut_path = Path(keep_lut) if keep_lut else dst.with_suffix(".cube")
    write_cube(lut_path, cube)

    out = grade_clip(src, dst, lut_path, strength=1.0)
    if keep_lut is None:
        try:
            lut_path.unlink()
        except OSError:
            pass
    return out


def grade_clip_direct(
    src: str | Path,
    dst: str | Path,
    target: GradeStats,
    strength: float = 1.0,
    n_measure: int = 40,
    crf: int = 15,
    batch: int = 6,
    gamut: bool = False,
    tone_mode: str = "anchor",
) -> Path:
    """Grade by transferring every frame's pixels, with no LUT in the path.

    A 3D LUT is a lossy container for this transform. Measured on real
    generated footage against the flashethereal pack, transferring pixels
    directly reached chroma MAE 1.58 and contrast 34.0 against a target of
    34.7, while the same transform routed through a baked LUT reached only
    2.98 and 30.5. Raising the LUT to 65^3 did not help (3.09), so it is
    interpolation error across a steep, highly non-linear mapping rather than
    grid resolution.

    ``gamut`` defaults off. The chroma-compression binary search costs 3.8x
    the runtime - 282s against 75s on a 5s 720p clip - and on measured footage
    changed nothing at all: identical MAE of 1.88, identical zone values, white
    point within 0.2. It earns its place only when a pack pushes chroma hard
    enough to drive a lot of pixels out of the sRGB cube; hard clipping is
    indistinguishable below that, so pay for it deliberately rather than by
    default.

    ``batch`` is small on purpose. The transfer allocates roughly a dozen
    float32 intermediates per call, so at 720p a batch of 48 frames needs
    several gigabytes and the process is killed; six keeps peak memory near
    half a gigabyte at no real cost in throughput.

    Use this for the automated pipeline, where accuracy is what matters and
    nobody is looking at the intermediate. Keep ``look.cube`` for Resolve,
    where an artist wants a node they can dial back, reorder, or override -
    and where a couple of units of chroma error is a starting point, not a
    defect.
    """
    import cv2 as _cv2

    src, dst = Path(src), Path(dst)
    from . import frames as _frames

    source = analyze(_frames.sample_frames(src, n=n_measure))
    info = _frames.probe(src)

    cap = _cv2.VideoCapture(str(src))
    if not cap.isOpened():
        raise RuntimeError(f"cannot open {src}")

    dst.parent.mkdir(parents=True, exist_ok=True)
    cmd = [
        "ffmpeg", "-nostdin", "-loglevel", "error", "-y",
        "-f", "rawvideo", "-pix_fmt", "rgb24",
        "-s", f"{info.width}x{info.height}", "-r", f"{info.fps:.6f}", "-i", "-",
        "-i", str(src), "-map", "0:v", "-map", "1:a?", "-c:a", "copy",
        "-c:v", "libx264", "-crf", str(crf), "-pix_fmt", "yuv420p", str(dst),
    ]
    proc = subprocess.Popen(cmd, stdin=subprocess.PIPE, stderr=subprocess.PIPE)

    buf: list[np.ndarray] = []

    def flush() -> None:
        if not buf:
            return
        arr = np.stack(buf)
        out = transfer(arr, target=target, source=source, strength=strength,
                       chroma_mode="offset", anchor=True, gamut=gamut,
                       tone_mode=tone_mode)
        proc.stdin.write((np.clip(out, 0, 1) * 255).astype(np.uint8).tobytes())
        buf.clear()

    try:
        while True:
            ok, bgr = cap.read()
            if not ok:
                break
            buf.append(_cv2.cvtColor(bgr, _cv2.COLOR_BGR2RGB).astype(np.float32) / 255.0)
            if len(buf) >= batch:
                flush()
        flush()
    finally:
        cap.release()
        proc.stdin.close()
        err = proc.stderr.read().decode()[-400:]
        if proc.wait() != 0:
            raise RuntimeError(f"ffmpeg encode failed: {err}")
    return dst
