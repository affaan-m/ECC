#!/usr/bin/env python3
"""The whole chain in one command: references in, finished video out.

    python pipeline.py --genre flashethereal \
        --refs refs/a.mov refs/b.mov refs/c.mov \
        --brief "a courier weaves through night traffic" \
        --duration 12 --base-video existing.mp4 --out out/FINAL.mp4

Stages, each of which is also a standalone tool:

1. ``mint.py``     - measure the references: grade, cadence, stills, LUT, plates
2. ``distill.py``  - describe the look in words a generator can act on
3. ``mint3d.py``   - optional: lift a prop, render it back into footage
4. ``apply.py``    - generate takes against the pack
5. ``forge.py``    - grade, cut at the reference's cadence, weave, overlay, concat
6. ``verify.py``   - measure the result against the pack and fail loudly if off

Stages 1-3 are offline or cheap and are cached: re-running with an existing
pack skips straight to generation unless ``--remint`` is passed. That matters
because stage 4 is the only expensive one, and the whole point of separating
the pack from the generation is that you can iterate on briefs without
re-measuring anything.
"""

from __future__ import annotations

import argparse
import math
import subprocess
import sys
import time
from pathlib import Path


SCRIPTS = Path(__file__).resolve().parent


def _command(cmd: list[str]) -> list[str]:
    """Resolve tools, while retaining caller-relative media and output paths."""
    return [sys.executable, str(SCRIPTS / cmd[0]), *cmd[1:]]


def _run(label: str, cmd: list[str]) -> None:
    print(f"\n{'=' * 70}\n[{label}] {' '.join(cmd[:6])} ...\n{'=' * 70}")
    t = time.time()
    proc = subprocess.run(_command(cmd))
    if proc.returncode != 0:
        raise SystemExit(f"stage '{label}' failed with exit {proc.returncode}")
    print(f"[{label}] done in {time.time() - t:.0f}s")


def main() -> None:
    ap = argparse.ArgumentParser(description="Run the full taste-forge chain.")
    ap.add_argument("--genre", required=True)
    ap.add_argument("--refs", nargs="*", default=None,
                    help="reference videos; omit to reuse an existing pack")
    ap.add_argument("--takes", nargs="+", help="existing local takes; skips every provider stage")
    ap.add_argument("--fps", type=float, default=None, help="output frame rate")
    ap.add_argument("--brief", default="", help="WHAT HAPPENS in the new piece")
    ap.add_argument("--style-steer", default="", help="HOW IT LOOKS, per-run nudge")
    ap.add_argument("--duration", type=float, default=12.0,
                    help="best-effort cadence target in seconds, not an exact duration; actual result is reported")
    ap.add_argument("--base-video", default=None, help="existing footage to supplement")
    ap.add_argument("--base-ratio", type=float, default=0.35)
    ap.add_argument("--out", default=None)
    ap.add_argument("--root", default="stylepacks")
    ap.add_argument("--take-len", type=float, default=5.0)
    ap.add_argument("--tier", default=None, help="cost tier for generation, e.g. value")
    ap.add_argument("--remint", action="store_true", help="re-measure even if a pack exists")
    ap.add_argument("--no-distill", action="store_true", help="skip the VLM spec stage")
    ap.add_argument("--prop", default=None,
                    help="also mint a 3D prop from this text prompt and render it")
    ap.add_argument("--dry-run", action="store_true")
    a = ap.parse_args()

    if a.fps is not None and (not math.isfinite(a.fps) or a.fps <= 0):
        ap.error("--fps must be finite and positive")
    if a.takes and (a.prop or a.tier):
        ap.error("--takes cannot be combined with --prop or --tier")
    if a.takes and a.dry_run:
        print("[dry run] offline passthrough planned; no stages or files produced")
        return

    pack_dir = Path(a.root) / a.genre
    out = a.out or f"out/FINAL_{a.genre}.mp4"
    # Catch handoff collisions before optional distillation or prop spending.
    from forge import validate_output
    validate_output(Path(out))
    if not a.takes:
        for destination in (Path(out).with_suffix(".generation.json"),
                            Path(out).parent / f"{Path(out).stem}_takes"):
            if destination.exists() or destination.is_symlink():
                raise FileExistsError(f"output already exists; choose a new --out: {destination}")
    dry = ["--dry-run"] if a.dry_run else []

    # ---- 1. mint -------------------------------------------------------
    if a.remint or not (pack_dir / "grade.json").exists():
        if not a.refs:
            raise SystemExit(
                f"no pack at {pack_dir} and no --refs given; nothing to measure"
            )
        _run("mint", ["mint.py", "--genre", a.genre, "--root", a.root,
                      "--refs", *a.refs])
    else:
        print(f"[mint] reusing existing pack at {pack_dir} (--remint to re-measure)")

    # ---- 2. distill ----------------------------------------------------
    if not a.takes and not a.no_distill and (a.remint or not (pack_dir / "spec.json").exists()):
        _run("distill", ["distill.py", "--genre", a.genre, "--root", a.root, *dry])
    elif a.takes:
        print("[distill] skipped (offline passthrough)")
    else:
        print("[distill] reusing existing spec.json or explicitly skipped")

    # ---- 3. optional 3D ------------------------------------------------
    if a.prop:
        _run("mint3d", ["mint3d.py", "--genre", a.genre, "--root", a.root,
                        "--prompt", a.prop, *dry])

    # ---- 4+5. apply (generates takes, then calls forge to assemble) -----
    apply_cmd = ["apply.py", "--genre", a.genre, "--root", a.root,
                 "--brief", a.brief, "--style-steer", a.style_steer,
                 "--duration", str(a.duration), "--take-len", str(a.take_len),
                 "--out", out, *dry]
    if a.base_video:
        apply_cmd += ["--base-video", a.base_video, "--base-ratio", str(a.base_ratio)]
    if a.tier:
        apply_cmd += ["--tier", a.tier]
    if a.fps is not None:
        apply_cmd += ["--fps", str(a.fps)]
    if a.takes:
        forge_cmd = ["forge.py", "--genre", a.genre, "--root", a.root,
                     "--takes", *a.takes, "--duration", str(a.duration), "--out", out]
        if a.base_video:
            forge_cmd += ["--base-video", a.base_video, "--base-ratio", str(a.base_ratio)]
        if a.fps is not None:
            forge_cmd += ["--fps", str(a.fps)]
        _run("forge (offline passthrough)", forge_cmd)
    else:
        _run("apply+forge", apply_cmd)

    # ---- 6. verify -----------------------------------------------------
    if a.dry_run:
        print("\n[verify] skipped (dry run produced a placeholder, not footage)")
        return
    takes = a.takes or sorted((Path(out).parent / f"{Path(out).stem}_takes").glob("take_*.mp4"))
    vcmd = ["verify.py", out, "--genre", a.genre, "--root", a.root]
    if takes:
        vcmd += ["--source", str(takes[0])]
    print(f"\n{'=' * 70}\n[verify]\n{'=' * 70}")
    rc = subprocess.run(_command(vcmd)).returncode
    print(f"\nfinal -> {out}")
    # A failed check is information, not a crash: the video exists either way,
    # and the operator decides whether the miss matters for this piece.
    if rc != 0:
        raise SystemExit(2)


if __name__ == "__main__":
    main()
