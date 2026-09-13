#!/usr/bin/env python3
"""Mint a style pack from reference videos. Stage 1 of taste-forge.

This stage is deliberately offline: no API keys, no model calls, no network.
Everything here is numeric analysis of the reference footage, which means it
is cheap, deterministic, and re-runnable. The expensive generative work
happens later, against the pack this produces.

    python mint.py --genre flashethereal --refs a.mp4 b.mp4 c.mp4

Re-running with the same references reproduces the same pack byte-for-byte
apart from timestamps, so a pack can be regenerated rather than backed up.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

import numpy as np

from taste import cadence as cad_mod
from taste import frames as frame_mod
from taste import grade as grade_mod
from taste import pack as pack_mod
from taste import plates as plate_mod


def mint(
    genre: str,
    refs: list[str],
    root: str = "stylepacks",
    lut_size: int = 33,
    strength: float = 1.0,
    frames_per_ref: int = 48,
    max_stills: int = 12,
    mask_ui: bool = True,
) -> pack_mod.StylePack:
    sp = pack_mod.create(genre, root=root)
    print(f"minting '{genre}' from {len(refs)} reference(s) -> {sp.dir}")

    pooled_pixels: list[np.ndarray] = []
    pooled_frames: list[list[np.ndarray]] = []
    noise_frames: list[np.ndarray] = []
    cadences: list[cad_mod.Cadence] = []
    mask_report: list[str] = []

    for i, ref in enumerate(refs):
        ref_path = Path(ref)
        if not ref_path.exists():
            print(f"  !! missing reference, skipping: {ref}", file=sys.stderr)
            continue
        ref_id = f"genre1_{i + 1}" if i else "genre1"

        print(f"  [{ref_id}] {ref_path.name}")
        fr = frame_mod.sample_frames(ref_path, n=frames_per_ref)

        if mask_ui:
            m = frame_mod.content_mask(fr)
            y0, y1, x0, x1 = frame_mod.mask_bbox(m)
            pooled_pixels.append(frame_mod.apply_mask(fr, m))
            noise_frames.extend(f[y0:y1, x0:x1] for f in fr[:8])
            mask_report.append(f"{100 * m.mean():.0f}%")
            print(f"      masked to {100 * m.mean():.0f}% moving pixels "
                  f"(dropped static UI / letterbox)")
        else:
            pooled_pixels.append(np.concatenate([f.reshape(-1, 3) for f in fr]))
            noise_frames.extend(fr[:8])

        pooled_frames.append(fr)

        c = cad_mod.detect(ref_path)
        cadences.append(c)
        print(f"      {c.n_shots} shots, mean {c.mean_shot:.2f}s, {c.cuts_per_min:.0f} cuts/min")

        # Stills come from the longest shots of each reference, spread across
        # the whole set rather than taken from whichever ref happens to be first.
        ts = cad_mod.keyframe_timestamps(c, limit=max(1, max_stills // max(1, len(refs))))
        wrote = frame_mod.export_stills(ref_path, sp.stills_dir, ts, prefix=ref_id)
        print(f"      {len(wrote)} stills")

        sp.add_ref(ref_id, str(ref_path), c.total_duration, c.n_shots)

    if not pooled_pixels:
        raise SystemExit("no readable references - nothing to mint")

    print("  analyzing grade across pooled frames ...")
    stacked = np.concatenate(pooled_pixels, axis=0)
    g = grade_mod.analyze_pixels(stacked, noise_frames=noise_frames)
    merged = cad_mod.merge(cadences)

    print(f"  baking {lut_size}^3 LUT ...")
    cube = grade_mod.bake_cube(g, size=lut_size, strength=strength, title=genre)
    grade_mod.write_cube(sp.lut_path, cube)

    # Overlay plates - the composable assets, as distinct from the stills,
    # which only ever condition the generator.
    plate_frames = []
    for pix in pooled_frames[:3]:
        plate_frames.extend(pix)
    plate_dir = sp.dir / "plates"
    made = plate_mod.mint_plates(plate_frames, plate_dir, noise_sigma=g.noise_sigma)
    print(f"  minted {len(made)} overlay plate(s) -> {plate_dir}")

    sp.write_json(sp.grade_path, g.to_dict())
    cad_mod.save(merged, sp.cadence_path)
    sp.manifest["mint"] = {
        "lut_size": lut_size,
        "strength": strength,
        "pixels_analyzed": int(stacked.shape[0]),
        "ui_masked": mask_ui,
    }
    sp.save()

    _report(g, merged, sp)
    return sp



_HUE_WHEEL = [
    (0, "magenta"), (30, "warm pink"), (60, "amber"), (90, "yellow-green"),
    (120, "green"), (150, "teal-green"), (180, "cyan"), (210, "steel blue"),
    (240, "blue"), (270, "violet"), (300, "periwinkle violet"), (330, "orchid"),
]


def _hue_name(a: float, b: float) -> str:
    """Rough perceptual name for a Lab a*/b* direction."""
    import math
    if (a * a + b * b) ** 0.5 < 3.0:
        return "near-neutral"
    ang = math.degrees(math.atan2(b, a)) % 360.0
    return min(_HUE_WHEEL, key=lambda h: min(abs(ang - h[0]), 360 - abs(ang - h[0])))[1]


def _report(g: grade_mod.GradeStats, c: cad_mod.Cadence, sp: pack_mod.StylePack) -> None:
    print(f"\n  === {sp.name} ===")
    print(f"  black/white pt : {g.black_point:.1f} / {g.white_point:.1f}  (L*)")
    print(f"  contrast       : {g.contrast:.1f}")
    print(f"  saturation     : {g.saturation:.1f}")
    print(f"  cast           : warmth {g.warmth:+.1f}  tint {g.tint:+.1f}")
    print(f"  grain sigma    : {g.noise_sigma:.4f}")
    print(f"  palette        : {', '.join(h for h, _ in g.palette[:5])}")
    if g.zones:
        # Report the whole curve, not just the endpoints. Comparing only the
        # darkest and lightest zones is actively misleading: both ends tend
        # toward neutral (there is little room for chroma near black or near
        # white), so a look whose entire color identity lives in the midtones
        # reads as "uniform cast" when it is anything but.
        print("  chroma by zone :")
        peak_i, peak_c = 0, 0.0
        for i, (zl, z) in enumerate(zip(grade_mod.ZONE_CENTERS, g.zones)):
            chroma = (z[0] ** 2 + z[2] ** 2) ** 0.5
            if chroma > peak_c:
                peak_i, peak_c = i, chroma
            bar = "#" * min(40, int(chroma / 1.5))
            print(f"      L~{zl:5.1f}  a*{z[0]:+7.2f} b*{z[2]:+7.2f}  {bar}")
        pz = g.zones[peak_i]
        tail = (
            ", neutral at both ends"
            if peak_i not in (0, len(g.zones) - 1)
            else ""
        )
        print(
            f"  signature      : {_hue_name(pz[0], pz[2])} at "
            f"L~{grade_mod.ZONE_CENTERS[peak_i]:.0f}{tail}"
        )
    print(f"  cadence        : {c.n_shots} shots, mean {c.mean_shot:.2f}s, "
          f"{c.cuts_per_min:.0f} cuts/min, variance {c.rhythm_variance:.2f}")
    print(f"  stills / props : {len(sp.stills())} / {len(sp.props())}")
    plates = sorted((sp.dir / "plates").glob("*.png")) if (sp.dir / "plates").exists() else []
    print(f"  overlay plates : {len(plates)}  ({', '.join(p.stem for p in plates[:4])}"
          f"{' ...' if len(plates) > 4 else ''})")
    print(f"\n  pack -> {sp.dir}")
    print(f"  LUT  -> {sp.lut_path}   (drag into Resolve as a node LUT)")


def main() -> None:
    ap = argparse.ArgumentParser(description="Mint a style pack from reference videos.")
    ap.add_argument("--genre", required=True, help="pack name, e.g. flashethereal")
    ap.add_argument("--refs", required=True, nargs="+", help="reference video paths")
    ap.add_argument("--root", default="stylepacks")
    ap.add_argument("--lut-size", type=int, default=33, choices=[17, 25, 33, 65])
    ap.add_argument("--strength", type=float, default=1.0,
                    help="0-1; how hard to push toward the reference look")
    ap.add_argument("--frames-per-ref", type=int, default=48)
    ap.add_argument("--max-stills", type=int, default=12)
    ap.add_argument("--no-mask-ui", action="store_true",
                    help="disable temporal-variance masking of static screen-recording UI")
    a = ap.parse_args()
    mint(a.genre, a.refs, a.root, a.lut_size, a.strength, a.frames_per_ref,
         a.max_stills, mask_ui=not a.no_mask_ui)


if __name__ == "__main__":
    main()
