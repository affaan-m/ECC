#!/usr/bin/env python3
"""Final stage: material in, finished video out.

    python forge.py --genre flashethereal --takes gen/a.mp4 gen/b.mp4 \
        --base-video existing.mp4 --overlays stills/x.png --duration 15 \
        --out out/final.mp4

Takes generated clips (from the fal apply workflow, or anywhere), grades them
with the pack, cuts them at the reference's measured cadence, optionally weaves
in shots from an existing video being supplemented, composites overlay images,
and concatenates the result.

The grade happens here rather than in the prompt because that is what the
measurements support: three paid generations with escalating colour direction
moved midtone a* from +1.9 to +2.8 against a +24.9 target and never shifted
contrast off ~19 against 34.7, while applying the pack reached MAE 1.88 and
contrast 33.7 deterministically.
"""

from __future__ import annotations

import argparse
import math
import tempfile
from datetime import datetime, timezone
from pathlib import Path

import numpy as np

from taste import assemble as asm
from taste import cadence as cad_mod
from taste import frames as frame_mod
from taste import grade as grade_mod
from taste import pack as pack_mod
from taste import plates as plate_mod
from taste import timeline as tl_mod


def validate_output(out_path: Path) -> None:
    """Refuse to replace either a viewing copy or any part of its handoff."""
    outputs = [out_path, *(out_path.with_suffix(s) for s in (".fcpxml", ".edl", ".json"))]
    if len(set(outputs)) != len(outputs):
        raise ValueError("output must have a video suffix distinct from timeline/manifest files")
    for path in outputs:
        if path.exists() or path.is_symlink():
            raise FileExistsError(f"output already exists; choose a new --out: {path}")


def forge(
    genre: str,
    takes: list[str],
    out: str,
    root: str = "stylepacks",
    base_video: str | None = None,
    base_ratio: float = 0.35,
    overlays: list[str] | None = None,
    overlay_every: int = 4,
    overlay_opacity: float = 0.3,
    duration: float | None = None,
    strength: float = 1.0,
    grade_base: bool = True,
    width: int | None = None,
    height: int | None = None,
    work: str = "out/forge_work",
    plan: list[dict] | None = None,
    fps: float | None = None,
) -> Path:
    out_path = Path(out)
    validate_output(out_path)
    if not takes or any(not Path(t).is_file() for t in takes):
        raise ValueError("all takes must be readable local files")
    if base_video and not Path(base_video).is_file():
        raise ValueError("base video must be a readable local file")
    if any(not Path(o).is_file() for o in (overlays or [])):
        raise ValueError("all overlays must be readable local files")
    if fps is not None and (not math.isfinite(fps) or fps <= 0):
        raise ValueError("fps must be finite and positive")
    sp = pack_mod.load(genre, root=root)
    tgt = grade_mod.load_stats(sp.grade_path)
    cad = cad_mod.load(sp.cadence_path)

    # Geometry comes from the first take unless overridden; everything else is
    # normalized to it so concat does not silently fail on a size mismatch.
    info0 = frame_mod.probe(takes[0])
    W = width or info0.width
    H = height or info0.height
    FPS = fps if fps is not None else info0.fps
    if not math.isfinite(FPS) or FPS <= 0:
        raise ValueError("source fps must be finite and positive; provide --fps")
    if W <= 0 or H <= 0:
        raise ValueError("output width and height must be positive")
    # Prior timelines reference these shot files. Each run owns a fresh child,
    # including failed runs, so retries cannot erase an existing edit.
    work_root = Path(work)
    work_root.mkdir(parents=True, exist_ok=True)
    work_dir = Path(tempfile.mkdtemp(prefix="run-", dir=work_root)).resolve()
    print(f"forging '{genre}'  ->  {W}x{H} @ {FPS:g}fps")
    print(f"  cadence: mean {cad.mean_shot:.2f}s, {cad.cuts_per_min:.0f} cuts/min, "
          f"variance {cad.rhythm_variance:.2f}")

    total_target = duration or sum(frame_mod.probe(t).duration for t in takes)
    # When apply.py generated these takes it already decided where the cuts
    # fall, and it told the model so ("cut into 6 pieces of ~0.8s"). Re-planning
    # here would silently cut somewhere else, against footage shot for the
    # original plan - so the caller's plan wins when there is one.
    if plan is None:
        # Plan PER TAKE against each take's own length, not by splitting the
        # target across an arbitrary number of groups.
        #
        # plan_takes() answers "how do I fill N seconds": for a 12s target it
        # returns 4 groups whose shot counts taper (8, 3, 1, ...). Handing
        # those groups to three 5-second takes cuts the first take into 8
        # shots and the third into 1, throwing away most of the footage that
        # was just paid for. Each supplied take is 5 seconds of usable
        # material and should be cut as such.
        plan = []
        for i, t in enumerate(takes):
            tdur = frame_mod.probe(t).duration
            cursor, shots = 0.0, []
            for d in cad.plan_shots(tdur):
                if cursor + d > tdur:
                    break
                shots.append({"start": round(cursor, 3), "duration": round(d, 3)})
                cursor += d
            plan.append({"index": i, "shots": shots or
                         [{"start": 0.0, "duration": round(tdur, 3)}]})
        print(f"  plan: {sum(len(t['shots']) for t in plan)} shots across "
              f"{len(plan)} takes, cut to each take's own length (re-planned)")
    else:
        print(f"  plan: {sum(len(t['shots']) for t in plan)} shots across "
              f"{len(plan)} takes (from generation plan)")

    # ---- grade + cut each take -------------------------------------------
    gen_shots: list[Path] = []
    for i, take_path in enumerate(takes):
        norm = asm.normalize(take_path, work_dir / f"take{i}_norm.mp4", W, H, FPS)
        graded = work_dir / f"take{i}_graded.mp4"
        print(f"  [take {i}] grading {Path(take_path).name} ...")
        grade_mod.grade_clip_direct(norm, graded, tgt, strength=strength)
        shots = plan[i % len(plan)]["shots"]
        cuts = asm.cut_take(graded, shots, work_dir / f"take{i}_shots", prefix=f"g{i}", fps=FPS)
        print(f"      {len(cuts)} shots cut")
        gen_shots.extend(cuts)

    # ---- optional: shots from the video being supplemented ---------------
    base_shots: list[Path] = []
    if base_video and Path(base_video).exists():
        print(f"  [base] supplementing {Path(base_video).name} ...")
        # Detect and cut off the capture app's interface before anything else
        # touches this footage. Skipping it ships a like button and a view
        # counter into the finished piece.
        bframes = frame_mod.sample_frames(base_video, n=48, max_edge=720)
        bcrop = frame_mod.crop_fractions(bframes)
        kept = (bcrop[1] - bcrop[0]) * (bcrop[3] - bcrop[2])
        print(f"      UI crop: keeping {100 * (bcrop[3] - bcrop[2]):.0f}% wide x "
              f"{100 * (bcrop[1] - bcrop[0]):.0f}% tall ({100 * kept:.0f}% of frame)")
        norm = asm.normalize(base_video, work_dir / "base_norm.mp4", W, H, FPS,
                             crop=bcrop, fit="cover")
        src = norm
        if grade_base:
            src = work_dir / "base_graded.mp4"
            grade_mod.grade_clip_direct(norm, src, tgt, strength=strength)
        bdur = frame_mod.probe(src).duration
        # Use the base video's OWN shot boundaries, not synthetic ones.
        #
        # Slicing it into contiguous pieces and playing them in order simply
        # reassembles the original: every "cut" falls mid-shot and is
        # invisible. Measured that way, a 20-shot assembly registered only 12
        # detected cuts, because the base segments rejoined seamlessly. Real
        # boundaries make each borrowed piece an actual shot, and taking every
        # Nth one guarantees a visible discontinuity between consecutive picks.
        bcad = cad_mod.detect(base_video)
        real = [s for s in bcad.shots if s.get("duration", 0) > 0.15]
        print(f"      base has {len(real)} real shots")
        want = max(1, int(total_target * (base_ratio / max(1e-6, 1 - base_ratio)) / max(0.2, cad.mean_shot)))
        step = max(1, len(real) // max(1, want))
        picked = real[::step][:want]
        flat = []
        for k, s in enumerate(picked):
            dur = min(float(s["duration"]), max(0.25, cad.plan_shots(cad.mean_shot * 1.2)[0]))
            st = float(s["start"])
            if st >= bdur - 0.1:
                continue
            flat.append({"start": round(st, 3), "duration": round(min(dur, bdur - st), 3)})
        base_shots = asm.cut_take(src, flat, work_dir / "base_shots", prefix="b", fps=FPS)
        print(f"      {len(base_shots)} base shots taken (every {step}th real shot)")

    order = asm.weave(gen_shots, base_shots, ratio=base_ratio) if base_shots else gen_shots

    # ---- overlays ---------------------------------------------------------
    ov = [o for o in (overlays or []) if Path(o).exists()]
    if ov:
        # Tighten every plate to its own content first. A glow plate is ~4%
        # covered by construction, so compositing it at frame size puts a small
        # bright dot in the middle of the shot - it reads as a sticker, not as
        # light. Tightening raises coverage to 15-35% and hands size control to
        # the caller.
        tight = []
        for o in ov:
            try:
                t = plate_mod.tighten(o, work_dir / "plates" / (Path(o).stem + ".png"))
                tight.append((t, plate_mod.plate_coverage(t)))
            except Exception:
                tight.append((Path(o), 0.15))

        print(f"  [overlay] {len(tight)} plate(s) every {overlay_every} shots @ {overlay_opacity:.2f}")
        # Deterministic variation: the same inputs give the same cut, but no two
        # stamped shots share a placement. Stamping one mark in one spot every
        # Nth shot is what made the earlier cut look like a watermark.
        rng = np.random.default_rng(11)
        anchors = ["center", "topright", "bottomleft", "topleft", "bottomright",
                   "left", "right", "top", "bottom"]
        stamped: list[Path] = []
        for i, clip in enumerate(order):
            if overlay_every > 0 and i % overlay_every == 0:
                plate, cov = tight[(i // max(1, overlay_every)) % len(tight)]
                # Diffuse plates work as a full-frame wash; concentrated ones
                # are elements and want to be placed and kept smallish.
                wash = cov < 0.10
                sc = float(rng.uniform(0.85, 1.0) if wash else rng.uniform(0.35, 0.7))
                pos = "center" if wash else anchors[int(rng.integers(len(anchors)))]
                rot = 0.0 if wash else float(rng.uniform(-0.6, 0.6))
                opa = overlay_opacity * (0.75 if wash else 1.25)
                dst = work_dir / f"ov_{i:03d}.mp4"
                # Requested overlays are part of the output contract. A failed
                # composite must not produce a successful, unstamped handoff.
                stamped.append(asm.overlay(
                    clip, plate, dst, opacity=min(0.95, opa), scale=sc,
                    position=pos, rotate=rot, width=W, height=H))
                continue
            stamped.append(clip)
        order = stamped

    # ---- assemble ---------------------------------------------------------
    if duration:
        kept, acc = [], 0.0
        for c in order:
            d = frame_mod.probe(c).duration
            if acc + d > duration * 1.08 and kept:
                break
            kept.append(c); acc += d
        if kept:
            print(f"  trimmed {len(order)} -> {len(kept)} shots toward target {duration:.1f}s")
            order = kept

    out_path = Path(out)
    asm.concat(order, out_path, fps=FPS)
    final = frame_mod.probe(out_path)
    duration_delta = final.duration - duration if duration is not None else 0.0
    duration_contract = {
        "policy": "cadence_target",
        "requested_seconds": duration,
        "actual_seconds": round(final.duration, 6),
        "shortfall_seconds": round(max(0.0, -duration_delta), 6),
        "overrun_seconds": round(max(0.0, duration_delta), 6),
    }
    if duration is not None and abs(duration_delta) + 1e-9 >= 1.0 / FPS:
        print(f"  WARNING: cadence target {duration:.3f}s produced {final.duration:.3f}s "
              f"(shortfall {duration_contract['shortfall_seconds']:.3f}s, "
              f"overrun {duration_contract['overrun_seconds']:.3f}s); "
              "whole cadence shots are preserved without padding or duplication")

    # Ship an EDITABLE timeline beside the flattened mp4.
    #
    # The mp4 is a viewing copy; it is the one thing a colourist cannot work
    # with, because every cut is baked in and the shots are no longer separable.
    # The FCPXML and EDL carry the same 24 cuts as real edit points referencing
    # the individual graded shot files, so the piece lands in Resolve as a
    # timeline that can be re-cut, re-ordered and re-graded rather than as a
    # single clip somebody has to razor by hand.
    #
    # Shot files are kept: the timeline references them by absolute path, so
    # deleting work_dir breaks the handoff even though the mp4 still plays.
    tl_clips = [
        {"path": str(Path(c).resolve()),
         "duration": frame_mod.probe(c).duration,
         "name": Path(c).stem}
        for c in order
    ]
    timelines = {}
    for fmt in ("fcpxml", "edl"):
        tp = tl_mod.write_timeline(
            tl_clips, fps=FPS, out_path=out_path.with_suffix("." + fmt),
            fmt=fmt, title=f"{genre}_cut", width=W, height=H,
        )
        if not Path(tp).is_file():
            raise RuntimeError(f"{fmt} export did not create a timeline: {tp}")
        timelines[fmt] = str(tp)
        print(f"  timeline -> {tp}")

    asm.write_manifest(out_path.with_suffix(".json"), {
        "genre": genre,
        "work_directory": str(work_dir),
        "created": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "geometry": {"width": W, "height": H, "fps": FPS},
        "takes": [str(t) for t in takes],
        "base_video": base_video,
        "base_ratio": base_ratio if base_shots else 0.0,
        "overlays": ov,
        "shots": len(order),
        "generated_shots": len(gen_shots),
        "base_shots": len(base_shots),
        "duration": round(final.duration, 3),
        "duration_contract": duration_contract,
        "grade_strength": strength,
        "timelines": timelines,
        "shot_files": [str(Path(c).resolve()) for c in order],
        "pack": {"contrast": tgt.contrast, "black": tgt.black_point, "white": tgt.white_point},
    })

    print(f"\n  {len(order)} shots -> {final.duration:.2f}s @ {final.width}x{final.height}")
    print(f"  final -> {out_path}")
    return out_path


def main() -> None:
    ap = argparse.ArgumentParser(description="Assemble a finished video from generated takes.")
    ap.add_argument("--genre", required=True)
    ap.add_argument("--takes", required=True, nargs="+", help="generated clips to cut from")
    ap.add_argument("--out", default="out/final.mp4")
    ap.add_argument("--root", default="stylepacks")
    ap.add_argument("--base-video", default=None, help="existing video to supplement")
    ap.add_argument("--base-ratio", type=float, default=0.35, help="share of cut from base video")
    ap.add_argument("--no-grade-base", action="store_true", help="leave base video ungraded")
    ap.add_argument("--overlays", nargs="*", default=None, help="overlay image paths")
    ap.add_argument("--overlay-every", type=int, default=4)
    ap.add_argument("--overlay-opacity", type=float, default=0.3)
    ap.add_argument("--duration", type=float, default=None,
                    help="best-effort cadence target in seconds, not an exact output duration")
    ap.add_argument("--strength", type=float, default=1.0, help="0-1 grade intensity")
    ap.add_argument("--width", type=int, default=None)
    ap.add_argument("--take-len", type=float, default=5.0)
    ap.add_argument("--fps", type=float, default=None, help="output frame rate; defaults to first take")
    ap.add_argument("--work", default="out/forge_work", help="parent of preserved per-run shot directories")
    ap.add_argument("--height", type=int, default=None)
    a = ap.parse_args()
    forge(a.genre, a.takes, a.out, a.root, a.base_video, a.base_ratio, a.overlays,
          a.overlay_every, a.overlay_opacity, a.duration, a.strength,
          not a.no_grade_base, a.width, a.height, work=a.work, fps=a.fps)


if __name__ == "__main__":
    main()
