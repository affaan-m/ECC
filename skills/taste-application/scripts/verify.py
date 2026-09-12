#!/usr/bin/env python3
"""Measure a finished video against the pack it was supposed to match.

Every other stage of this pipeline claims a result. This one checks it, and it
exists because of a specific failure: a graded clip once scored a chroma mean
absolute error of 1.88 and a contrast of 33.7 against a 34.7 target - both
excellent - while the actual frame was a muddy purple mess with visible
banding. The numbers were real and the picture was wrong.

The cause was that CDF tone matching forced a generated clip whose frame was
68% pure black onto a reference histogram that was not, which lifted the entire
background out of black and spread quantisation error across it. No chroma or
contrast statistic can see that, because both are computed over all pixels and
the background is still, on average, dark.

So this suite checks distribution *shape*, not just distribution *moments*:

* ``background`` - share of the frame below L*10, source vs output vs target.
  A source that was 68% black and an output that is 26% black is a broken
  grade regardless of what the other numbers say.
* ``chroma`` - per-zone a*/b* error, which is what the grade is actually for.
* ``tone`` - contrast, black and white points.
* ``cadence`` - detected cut rhythm against the reference's.
* ``banding`` - count of L* histogram bins that are empty between occupied
  neighbours; comb-like gaps are the signature of a stretched tone curve.

Exit status is non-zero if any check fails, so it can gate a pipeline run.

    python verify.py --genre flashethereal out/FINAL.mp4 --source gen/run3.mp4
"""

from __future__ import annotations

import argparse
import json
import math
import sys
from pathlib import Path

import cv2
import numpy as np

from taste import cadence as cad_mod
from taste import frames as frame_mod
from taste import grade as grade_mod
from taste import pack as pack_mod

SHADOW_L = 10.0  # L* below this reads as "black background" on screen


def _lab(path: str | Path, n: int = 40) -> np.ndarray:
    """Pooled Lab pixels. Float32 input, so L* is 0-100 and a*/b* are signed.

    Worth stating explicitly because OpenCV changes convention with dtype:
    on uint8 input it packs L into 0-255 and biases a*/b* by +128, and mixing
    the two conventions silently reports chroma errors in the hundreds.
    """
    fr = frame_mod.sample_frames(path, n=n)
    pix = np.concatenate([f.reshape(-1, 3) for f in fr], axis=0).astype(np.float32)
    return cv2.cvtColor(pix.reshape(-1, 1, 3), cv2.COLOR_RGB2LAB).reshape(-1, 3)


def background_share(lab: np.ndarray, thresh: float = SHADOW_L) -> float:
    """Share of pixels dark enough to read as unlit background."""
    return float((lab[:, 0] < thresh).mean())


def banding_score(lab: np.ndarray, bins: int = 256) -> int:
    """Empty L* histogram bins that sit between two occupied ones.

    A tone curve that stretches a narrow input range leaves periodic gaps -
    the comb pattern you see on a scope right before banding shows up on the
    picture. Counting interior holes catches it; counting total empty bins
    does not, because a legitimately dark clip has empty highlight bins.
    """
    h, _ = np.histogram(lab[:, 0], bins=bins, range=(0, 100))
    occ = h > 0
    idx = np.flatnonzero(occ)
    if len(idx) < 3:
        return 0
    return int((~occ[idx[0]:idx[-1] + 1]).sum())


def zone_chroma(lab: np.ndarray) -> list[tuple[float, float]]:
    out = []
    for lo, hi in zip(grade_mod.ZONE_EDGES[:-1], grade_mod.ZONE_EDGES[1:]):
        m = (lab[:, 0] >= lo) & (lab[:, 0] < hi)
        if m.sum() < 64:
            out.append((0.0, 0.0))
            continue
        sel = lab[m]
        # Median, matching how the pack's own zone targets were measured;
        # a mean here would compare a skew-sensitive statistic against a
        # robust one and report an error that is really a definition mismatch.
        out.append((float(np.median(sel[:, 1])), float(np.median(sel[:, 2]))))
    return out


def verify(
    video: str,
    genre: str,
    root: str = "stylepacks",
    source: str | None = None,
    bg_tolerance: float = 0.20,
    chroma_tolerance: float = 6.0,
    contrast_tolerance: float = 5.0,
    cadence_tolerance: float = 0.35,
    check_cadence: bool = True,
) -> dict:
    sp = pack_mod.load(genre, root=root)
    tgt = grade_mod.load_stats(sp.grade_path)
    ref_cad = cad_mod.load(sp.cadence_path)

    out_lab = _lab(video)
    src_lab = _lab(source) if source and Path(source).exists() else None

    checks: list[dict] = []

    def check(name: str, ok: bool, got, want, note: str = "") -> None:
        checks.append({"check": name, "pass": bool(ok), "got": got, "want": want,
                       "note": note})

    # ---- tone ----------------------------------------------------------
    L = out_lab[:, 0]
    black = float(np.percentile(L, 1))
    white = float(np.percentile(L, 99))
    # Contrast is the standard deviation of L*, which is what GradeStats
    # records - NOT the white-minus-black range. The range is nearly always
    # ~100 on real footage and so discriminates nothing.
    contrast = float(L.std())
    check("contrast", abs(contrast - tgt.contrast) <= contrast_tolerance,
          round(contrast, 2), round(tgt.contrast, 2))
    check("black_point", black <= tgt.black_point + 3.0,
          round(black, 2), f"<= {tgt.black_point + 3.0:.1f}")
    check("white_point", abs(white - tgt.white_point) <= 8.0,
          round(white, 2), round(tgt.white_point, 2))

    # ---- chroma by zone --------------------------------------------------
    got_zones = zone_chroma(out_lab)
    errs = []
    for (ga, gb), z in zip(got_zones, tgt.zones):
        errs.append(abs(ga - z[0]) + abs(gb - z[2]))
    mae = float(np.mean(errs) / 2.0) if errs else 0.0
    check("chroma_mae", mae <= chroma_tolerance, round(mae, 2),
          f"<= {chroma_tolerance}")

    # ---- background preservation ----------------------------------------
    # The comparison is against the REFERENCE, not against the source clip.
    # Anchoring on the source is the tempting version and it is wrong in both
    # directions: this pack's references are 24-55% black while one generated
    # source came in at 68%, so "preserve the source's blacks" would demand an
    # output blacker than anything the reference ever was, and would equally
    # excuse a grade that lifted an already-crushed source. What matters is
    # landing where the reference lives.
    bg_out = background_share(out_lab)
    # GradeStats defaults absent legacy fields to zero. Inspect the stored
    # field so a measured zero remains a real target rather than a missing one.
    bg_value = json.loads(Path(sp.grade_path).read_text(encoding="utf-8")).get("bg_share")
    bg_valid = (isinstance(bg_value, (int, float)) and not isinstance(bg_value, bool)
                and math.isfinite(bg_value) and 0 <= bg_value <= 1)
    if bg_valid:
        bg_tgt = float(bg_value)
        drift = abs(bg_out - bg_tgt)
        note = "share of frame reading as unlit background"
        if src_lab is not None:
            bg_src = background_share(src_lab)
            note += f"; source was {100 * bg_src:.1f}%"
        check("background", drift <= bg_tolerance,
              f"{100 * bg_out:.1f}%", f"{100 * bg_tgt:.1f}% +/- {100 * bg_tolerance:.0f}",
              note)
    elif bg_value is not None:
        check("background", False, f"{100 * bg_out:.1f}%", "finite bg_share in [0, 1]",
              "pack contains an invalid bg_share; re-run mint.py")
    else:
        checks.append({"check": "background", "pass": None,
                       "got": f"{100 * bg_out:.1f}%", "want": "n/a",
                       "note": "pack predates bg_share; re-run mint.py"})

    # ---- banding ---------------------------------------------------------
    holes = banding_score(out_lab)
    src_holes = banding_score(src_lab) if src_lab is not None else 0
    check("banding", holes <= max(8, src_holes + 8), holes,
          f"<= {max(8, src_holes + 8)}",
          "interior gaps in the L* histogram")

    # ---- cadence ---------------------------------------------------------
    if check_cadence:
        got_cad = cad_mod.detect(video)
        rel = abs(got_cad.mean_shot - ref_cad.mean_shot) / max(1e-6, ref_cad.mean_shot)
        check("cadence", rel <= cadence_tolerance,
              f"{got_cad.mean_shot:.2f}s / {got_cad.cuts_per_min:.0f} cpm",
              f"{ref_cad.mean_shot:.2f}s / {ref_cad.cuts_per_min:.0f} cpm",
              f"{100 * rel:.0f}% off")

    passed = [c for c in checks if c["pass"] is True]
    failed = [c for c in checks if c["pass"] is False]

    print(f"\n  === verify {Path(video).name} against '{genre}' ===")
    for c in checks:
        mark = "ok  " if c["pass"] else ("SKIP" if c["pass"] is None else "FAIL")
        note = f"   ({c['note']})" if c["note"] else ""
        print(f"  [{mark}] {c['check']:22s} got {c['got']}  want {c['want']}{note}")
    print(f"\n  {len(passed)} passed, {len(failed)} failed, "
          f"{len(checks) - len(passed) - len(failed)} skipped")

    return {"video": str(video), "genre": genre, "checks": checks,
            "passed": len(passed), "failed": len(failed)}


def main() -> None:
    ap = argparse.ArgumentParser(description="Verify a finished video against its style pack.")
    ap.add_argument("video")
    ap.add_argument("--genre", required=True)
    ap.add_argument("--root", default="stylepacks")
    ap.add_argument("--source", default=None,
                    help="the ungraded clip; adds background context and a banding baseline")
    ap.add_argument("--no-cadence", action="store_true", help="skip shot detection (slow)")
    ap.add_argument("--json", dest="json_out", default=None)
    a = ap.parse_args()

    res = verify(a.video, a.genre, a.root, a.source, check_cadence=not a.no_cadence)
    if a.json_out:
        Path(a.json_out).write_text(json.dumps(res, indent=2), encoding="utf-8")
    sys.exit(1 if res["failed"] else 0)


if __name__ == "__main__":
    main()
