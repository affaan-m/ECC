#!/usr/bin/env python3
"""Mint 3D props from a style pack, and render them back into footage.

Stage 2b of taste-forge, and the branch that used to dead-end.

Two ways in:

``--from-stills``
    Lift a prop out of the reference itself. The pack's stills are frames of
    the same world from different shots, so several of them can be passed as
    multi-view input, which is the single biggest quality lever on the
    endpoint - given one view the model invents the back of the object, and
    invents it wrong.
``--prompt``
    Generate a prop the reference implies but never shows cleanly. The pack's
    distilled spec supplies the world; the prompt names the object in it.

Then the part that makes it a pipeline rather than an asset dump: the minted
mesh is rendered to a turntable locally and encoded to a clip. fal has no
endpoint that renders a mesh - the whole 3D category consumes 2D and emits
3D, or consumes 3D and emits 3D - so without a local renderer a minted GLB
can never re-enter the video graph. With one, a prop becomes footage, and
footage is something every later stage already handles: grade it with the
pack, cut it at the reference's cadence, screen it over a shot as an element,
or upload it as a conditioning reference for the video model.

    python mint3d.py --genre flashethereal --from-stills 3 --render
    python mint3d.py --genre flashethereal --prompt "a cracked chrome visor" --render

``--retopo`` adds a quad-remesh pass, which is what makes the prop editable
and riggable in Blender rather than merely renderable.
"""

from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

from taste import falapi
from taste import pack as pack_mod
from taste import render3d as r3


# The endpoint's own input guidance, turned into prompt text: "simple
# background, single object, object >50% of frame". This is not stylistic - a
# busy plate produces a busy mesh. The flashethereal stills are glitch collages
# with several subjects and heavy overlay graphics, which is close to the worst
# possible input, so lifting a prop straight from them yields sculpted noise.
#
# Generating a clean plate first costs ~$0.15 and is the difference between a
# usable mesh and a discarded one.
PLATE_RULES = (
    "A single isolated object centred on a plain neutral mid-grey seamless "
    "background, filling most of the frame, evenly lit from three quarters, no "
    "other objects, no text, no logos, no props, no shadows cast on the "
    "backdrop, product-photography framing, sharp focus edge to edge, the whole "
    "object visible with nothing cropped. Neutral colour, no colour grading."
)


def _asset_name(name: str | None, prompt: str) -> str:
    words = prompt.split()
    asset = name if name is not None else "prop_" + (words[0] if words else "lifted")
    if (not asset or asset in {".", ".."} or len(asset) > 120
            or any(not (c.isalnum() or c in "_-. ") for c in asset)
            or asset != asset.strip()):
        raise ValueError("asset name must be a simple filename stem (letters, digits, spaces, _.-)")
    return asset


def _check_outputs(sp, asset: str) -> None:
    """Reject existing artifacts for this stem before any billable work."""
    props = sp.dir / "props"
    candidates = [props / f"{asset}{suffix}" for suffix in
                  (".glb", ".json", "_plate.png", "_retopo.glb")]
    candidates += list(props.glob(f"{asset}_part*.glb"))
    candidates += [sp.dir / "turntables" / asset,
                   sp.dir / "turntables" / f"{asset}.mp4"]
    for path in candidates:
        if path.exists() or path.is_symlink():
            raise FileExistsError(f"asset output already exists; choose a new --name: {path}")


def mint3d(
    genre: str,
    root: str = "stylepacks",
    from_stills: int = 0,
    prompt: str = "",
    plate: bool = False,
    name: str | None = None,
    pbr: bool = True,
    retopo: bool = False,
    split: bool = False,
    render: bool = True,
    frames: int = 48,
    size: int = 768,
    backend: str = "auto",
    face_count: int | None = None,
) -> dict:
    asset = _asset_name(name, prompt)
    sp = pack_mod.load(genre, root=root)
    _check_outputs(sp, asset)
    props_dir = sp.dir / "props"
    props_dir.mkdir(parents=True, exist_ok=True)

    mode = "DRY RUN" if falapi.is_dry_run() else "live"
    print(f"minting 3D for '{genre}' [{mode}] -> {asset}")

    record: dict = {
        "genre": genre,
        "asset": asset,
        "created": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "dry_run": falapi.is_dry_run(),
        "endpoints": {k: falapi.ENDPOINTS[k] for k in
                      ("image_to_3d", "text_to_3d", "retopology", "part_split")},
    }

    if prompt and not plate:
        spec = sp.read_json(sp.spec_path) or {}
        # Ground the prompt in the pack so the prop belongs to the same world
        # the footage does. Colour is deliberately excluded for the same
        # reason apply.py excludes it: the LUT owns colour, and colour words
        # here would bake a cast into the texture that then gets graded twice.
        world = ", ".join(
            str(v) for v in (spec.get("mood_adjectives") or [])[:3]
        )
        full = prompt if not world else f"{prompt}. Setting: {world}. Neutral colour, PBR materials."
        print(f"  text-to-3d     : {full[:90]}")
        mesh_url = falapi.text_to_3d(full, pbr=pbr)
        record["prompt"] = full
    elif plate:
        # Two-step: text -> clean single-object plate -> mesh. This is the
        # path to use unless the pack's stills genuinely are clean product
        # shots, which reference reels almost never are.
        spec = sp.read_json(sp.spec_path) or {}
        world = ", ".join(str(v) for v in (spec.get("mood_adjectives") or [])[:3])
        plate_prompt = f"{prompt}. {PLATE_RULES}"
        if world:
            plate_prompt += f" The object belongs to a world that reads as: {world}."
        print(f"  plate          : generating clean single-object reference ...")
        plate_urls = falapi.text_to_image(plate_prompt)
        record["plate_prompt"] = plate_prompt
        record["plate_url"] = plate_urls[0]
        if not falapi.is_dry_run():
            plate_path = props_dir / f"{asset}_plate.png"
            falapi.download(plate_urls[0], plate_path)
            record["plate"] = str(plate_path)
            print(f"      plate -> {plate_path}")
        print(f"  image-to-3d    : from generated plate")
        mesh_url = falapi.image_to_3d(plate_urls[0], pbr=pbr, face_count=face_count)
    else:
        stills = sp.stills()
        if not stills:
            raise SystemExit(f"pack '{genre}' has no stills - run mint.py first")
        n = max(1, min(int(from_stills or 1), 8, len(stills)))
        chosen = stills[:n]
        print(f"  image-to-3d    : {n} view(s) - {', '.join(p.name for p in chosen)}")
        urls = [falapi.upload(p) for p in chosen]
        mesh_url = falapi.image_to_3d(urls, pbr=pbr, face_count=face_count)
        record["stills"] = [p.name for p in chosen]

    record["mesh_url"] = mesh_url
    # The generated PBR original remains canonical, even if remeshing loses
    # materials. Persist it before requesting any optional derivative.
    mesh_path = props_dir / f"{asset}.glb"
    falapi.download(mesh_url, mesh_path)
    record["mesh"] = str(mesh_path)
    print(f"  mesh           : {mesh_path}")

    if retopo:
        print("  retopology     : quad remesh ...")
        try:
            retopo_url = falapi.retopologize(mesh_url, quad=True)
            record["retopo_url"] = retopo_url
            retopo_path = props_dir / f"{asset}_retopo.glb"
            falapi.download(retopo_url, retopo_path)
            record["retopo_mesh"] = str(retopo_path)
        except falapi.FalError as exc:
            print(f"  !! retopology failed, keeping raw mesh: {exc}", file=sys.stderr)

    if split:
        print("  part split     : segmenting ...")
        try:
            parts = falapi.split_parts(mesh_url)
            paths = []
            for i, u in enumerate(parts):
                pp = props_dir / f"{asset}_part{i:02d}.glb"
                falapi.download(u, pp)
                paths.append(str(pp))
            record["parts"] = paths
            print(f"      {len(paths)} part(s)")
        except falapi.FalError as exc:
            print(f"  !! part split failed: {exc}", file=sys.stderr)

    if render:
        # The step that closes the loop. Skipped automatically on a dry run,
        # where the "mesh" on disk is a text placeholder rather than a GLB.
        if falapi.is_dry_run():
            print("  render         : skipped (dry run mesh is a placeholder)")
        else:
            turn_dir = sp.dir / "turntables" / asset
            print(f"  render         : {frames} frames @ {size}px ...")
            fr, used = r3.turntable(mesh_path, turn_dir, n_frames=frames,
                                    size=size, backend=backend)
            clip = sp.dir / "turntables" / f"{asset}.mp4"
            r3.frames_to_video(fr, clip)
            record["turntable"] = {"backend": used, "frames": len(fr), "clip": str(clip)}
            print(f"      {used} backend, {len(fr)} frames -> {clip}")
            print("      this clip is now ordinary footage: grade it, cut it, "
                  "screen it, or use it as a conditioning reference")

    manifest = props_dir / f"{asset}.json"
    manifest.write_text(json.dumps(record, indent=2), encoding="utf-8")
    print(f"  manifest       : {manifest}")
    return record


def main() -> None:
    ap = argparse.ArgumentParser(description="Mint 3D props from a style pack (stage 2b).")
    ap.add_argument("--genre", required=True)
    ap.add_argument("--root", default="stylepacks")
    ap.add_argument("--from-stills", type=int, default=0,
                    help="lift a prop from N pack stills as multi-view input (1-8)")
    ap.add_argument("--prompt", default="", help="generate a prop from text instead")
    ap.add_argument("--plate", action="store_true",
                    help="with --prompt: generate a clean single-object image first, "
                         "then mesh THAT. Almost always better than text-to-3d or than "
                         "lifting from busy reference stills")
    ap.add_argument("--name", default=None, help="asset name (default derived)")
    ap.add_argument("--no-pbr", action="store_true", help="skip PBR texture maps")
    ap.add_argument("--retopo", action="store_true", help="quad remesh for editability")
    ap.add_argument("--split", action="store_true", help="segment into editable parts")
    ap.add_argument("--no-render", action="store_true", help="skip the turntable render")
    ap.add_argument("--frames", type=int, default=48)
    ap.add_argument("--size", type=int, default=768)
    ap.add_argument("--backend", default="auto", choices=["auto", "blender", "software"])
    ap.add_argument("--face-count", type=int, default=None,
                    help="polygon budget, 40k-1.5M on the pro endpoint")
    ap.add_argument("--tier", default=None, choices=["best", "fast", "value", "game"],
                    help="cost/quality tier for the 3D endpoints")
    ap.add_argument("--dry-run", action="store_true")
    a = ap.parse_args()

    if a.dry_run:
        falapi.enable_dry_run()
    if a.tier:
        for slot in ("image_to_3d", "text_to_3d"):
            try:
                print(f"  {slot} -> {falapi.use_tier(slot, a.tier)}")
            except falapi.FalError:
                pass
    if not a.prompt and not a.from_stills:
        a.from_stills = 3

    mint3d(a.genre, a.root, a.from_stills, a.prompt, a.plate, a.name, not a.no_pbr,
           a.retopo, a.split, not a.no_render, a.frames, a.size, a.backend,
           a.face_count)


if __name__ == "__main__":
    main()
