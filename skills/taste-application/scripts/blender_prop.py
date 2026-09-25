#!/usr/bin/env python3
"""Load a minted prop into a Blender scene lit by the pack's measurements.

    blender -b --python blender_prop.py -- --pack stylepacks/flashethereal \
        --mesh stylepacks/flashethereal/props/prop_lifted.glb --out out/prop.blend

    # or interactively, to keep working in the UI:
    blender --python blender_prop.py -- --pack stylepacks/flashethereal --mesh prop.glb

This is the handoff point between the generative half of the pipeline and a
real 3D application. It exists because fal has no endpoint that renders a mesh -
the whole 3D category consumes 2D and emits 3D, or consumes 3D and emits 3D -
so anything beyond the software turntable in ``taste/render3d.py`` has to happen
here.

What it sets up, and why each piece is derived rather than guessed:

* **World is black, film is transparent.** The pack's references sit between
  24% and 55% pure black; a default grey world would light the prop from every
  direction and destroy the silhouette the look depends on. Transparent film
  also means the render composites straight over footage with no keying.
* **Key and rim, no fill.** A single key leaves the silhouette to die against
  the black world wherever the surface turns away. The rim is what keeps the
  object readable, and it is the same reason the software rasteriser carries a
  rim term.
* **Rim colour comes from the pack's measured signature zone**, converted from
  Lab to linear sRGB - so the prop picks up the same cast the footage is graded
  to instead of a colourist having to match it by eye afterwards.
* **No colour grading in Blender.** Render neutral and let ``look.cube`` do it
  downstream, for exactly the reason the generation prompts carry no colour
  language: grading twice compounds, and the LUT is the single source of truth.
  The script sets the view transform to Standard rather than Filmic/AgX for the
  same reason - AgX would apply its own tone curve before the LUT ever sees the
  pixels.
"""

from __future__ import annotations

import argparse
import hashlib
import os
import tempfile
import json
import math
import sys
from pathlib import Path


def _argv() -> list[str]:
    """Blender passes script args after a bare '--'."""
    return sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []


def _lab_to_linear_srgb(L: float, a: float, b: float) -> tuple[float, float, float]:
    """Lab -> linear sRGB, unclamped except at the end.

    Written out rather than pulled from OpenCV because Blender ships its own
    Python without the pipeline's dependencies, and because cv2's LAB2RGB
    clamps internally - which is the same trap that once made an out-of-gamut
    measurement read 0% when the true figure was 83%.
    """
    fy = (L + 16.0) / 116.0
    fx = fy + a / 500.0
    fz = fy - b / 200.0

    def finv(t: float) -> float:
        return t ** 3 if t > 6.0 / 29.0 else 3.0 * (6.0 / 29.0) ** 2 * (t - 4.0 / 29.0)

    # D65 white point.
    X = 0.95047 * finv(fx)
    Y = 1.00000 * finv(fy)
    Z = 1.08883 * finv(fz)

    r = 3.2404542 * X - 1.5371385 * Y - 0.4985314 * Z
    g = -0.9692660 * X + 1.8760108 * Y + 0.0415560 * Z
    bl = 0.0556434 * X - 0.2040259 * Y + 1.0572252 * Z
    return tuple(max(0.0, min(1.0, v)) for v in (r, g, bl))


def rim_colour(pack_dir: Path) -> tuple[float, float, float]:
    """The pack's peak-chroma zone, as a linear-sRGB light colour."""
    grade = pack_dir / "grade.json"
    if not grade.exists():
        return (0.55, 0.75, 1.0)
    zones = json.loads(grade.read_text()).get("zones") or []
    if not zones:
        return (0.55, 0.75, 1.0)
    # Zone centres for ZONE_EDGES [0,15,35,55,75,100].
    centres = [7.5, 25.0, 45.0, 65.0, 87.5]
    peak = max(range(len(zones)), key=lambda i: (zones[i][0] ** 2 + zones[i][2] ** 2))
    L = centres[peak] if peak < len(centres) else 50.0
    # Push L up: this is a LIGHT, not a surface, so it needs to be emissive
    # bright while keeping the measured hue direction.
    return _lab_to_linear_srgb(min(95.0, L * 2.4), zones[peak][0], zones[peak][2])


def validate_settings(frames: int, width: int, height: int, fps: float) -> None:
    for name, value, limit in (("frames", frames, 108000), ("width", width, 16384),
                               ("height", height, 16384), ("fps", fps, 240)):
        if (isinstance(value, bool) or not isinstance(value, (int, float))
                or not math.isfinite(value) or not 1 <= value <= limit
                or (name != "fps" and int(value) != value)):
            raise ValueError(f"{name} must be finite, positive and within {limit}")


def validate_output(path: Path) -> None:
    if any(part.is_symlink() for part in (path, *path.parents)):
        raise ValueError(f"symlink output is not allowed: {path}")
    if path.exists():
        raise ValueError(f"refusing to overwrite existing output: {path}")


def validate_bounds(lower, upper) -> None:
    dimensions = [upper[i] - lower[i] for i in range(3)]
    if (not all(math.isfinite(v) for v in (*lower, *upper))
            or any(v < 0 for v in dimensions) or not 1e-9 < max(dimensions) < 1e12):
        raise ValueError("mesh has invalid or empty geometry bounds")


def camera_distance(radius: float, width: int, height: int) -> float:
    """Fit the original bounding sphere with the original 50 mm / 36 mm camera."""
    horizontal_half = math.atan(36 / (2 * 50))
    vertical_half = math.atan(math.tan(horizontal_half) * height / width)
    return max(radius * math.hypot(3.2, 0.8),
               radius / math.sin(min(horizontal_half, vertical_half)) * 1.05)


def linearize_action(action) -> None:
    """Blender 4 legacy actions and Blender 5 slotted action channel bags."""
    if hasattr(action, "fcurves"):
        curves = action.fcurves
    else:
        curves = [curve for layer in action.layers for strip in layer.strips
                  for bag in getattr(strip, "channelbags", ()) for curve in bag.fcurves]
    for curve in curves:
        for point in curve.keyframe_points:
            point.interpolation = "LINEAR"


def verify_render(status, render_dir: Path, frames: int) -> None:
    expected = [render_dir / f"turn_{frame:04d}.png" for frame in range(1, frames + 1)]
    if "FINISHED" not in status or not all(path.is_file() and path.stat().st_size > 0 for path in expected):
        raise RuntimeError("Blender did not complete every requested render frame")


def _sha256(path: Path) -> str:
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def build(mesh: Path, pack: Path, out: Path | None, frames: int, size: int,
          render_dir: Path | None, *, width: int | None = None,
          height: int | None = None, fps: float = 24,
          receipt: Path | None = None) -> None:
    width = size if width is None else width
    height = size if height is None else height
    validate_settings(frames, width, height, fps)
    if not mesh.is_file():
        raise ValueError(f"mesh is not a regular file: {mesh}")
    for path in (out, receipt, render_dir):
        if path is not None:
            validate_output(path)
    if receipt is not None and out is None:
        raise ValueError("receipt requires a saved --out scene")
    if out is not None and out.suffix.lower() != ".blend":
        raise ValueError("scene output must use .blend extension")
    if out is not None and receipt is not None and out.absolute() == receipt.absolute():
        raise ValueError("receipt and scene output must be distinct")
    source_hash = _sha256(mesh)
    grade = pack / "grade.json"
    grade_hash = _sha256(grade) if grade.is_file() else None
    import bpy
    import mathutils

    bpy.ops.wm.read_factory_settings(use_empty=True)

    suffix = mesh.suffix.lower()
    if suffix in (".glb", ".gltf"):
        bpy.ops.import_scene.gltf(filepath=str(mesh))
    elif suffix == ".obj":
        bpy.ops.wm.obj_import(filepath=str(mesh))
    elif suffix == ".fbx":
        bpy.ops.import_scene.fbx(filepath=str(mesh))
    else:
        raise SystemExit(f"unsupported mesh format: {suffix}")

    objs = [o for o in bpy.context.scene.objects if o.type == "MESH"]
    if not objs:
        raise SystemExit(f"no mesh geometry found in {mesh}")

    mn = mathutils.Vector((float("inf"),) * 3)
    mx = mathutils.Vector((-float("inf"),) * 3)
    for o in objs:
        for c in o.bound_box:
            w = o.matrix_world @ mathutils.Vector(c)
            mn = mathutils.Vector(min(mn[i], w[i]) for i in range(3))
            mx = mathutils.Vector(max(mx[i], w[i]) for i in range(3))
    validate_bounds(mn, mx)
    center = (mn + mx) / 2.0
    radius = max((mx - mn).length / 2.0, 1e-4)
    print(f"[prop] {len(objs)} mesh object(s), radius {radius:.4f}")

    pivot = bpy.data.objects.new("turntable_pivot", None)
    bpy.context.collection.objects.link(pivot)
    pivot.location = center
    # Preserve imported hierarchy and world transforms, including PBR meshes.
    roots = [o for o in bpy.context.scene.objects if o.parent is None and o != pivot]
    bpy.context.view_layer.update()
    for o in roots:
        world = o.matrix_world.copy()
        o.parent = pivot
        o.matrix_world = world

    cam_data = bpy.data.cameras.new("cam")
    cam = bpy.data.objects.new("cam", cam_data)
    bpy.context.collection.objects.link(cam)
    bpy.context.scene.camera = cam
    cam_data.lens = 50
    cam_data.sensor_width = 36
    cam_data.sensor_fit = "HORIZONTAL"
    direction = mathutils.Vector((0.0, -3.2, 0.8)).normalized()
    cam.location = center + direction * camera_distance(radius, width, height)
    tr = cam.constraints.new(type="TRACK_TO")
    tr.target = pivot
    tr.track_axis = "TRACK_NEGATIVE_Z"
    tr.up_axis = "UP_Y"

    rim = rim_colour(pack)
    print(f"[prop] rim colour from pack: {tuple(round(c, 3) for c in rim)}")
    lights = (
        ("key", (radius * 2.5, -radius * 2.0, radius * 2.5), 900.0, (1.0, 1.0, 1.0)),
        ("rim", (-radius * 2.5, radius * 1.5, radius * 1.2), 700.0, rim),
    )
    for name, loc, energy, colour in lights:
        ld = bpy.data.lights.new(name, type="AREA")
        ld.energy = energy
        ld.size = radius * 2.0
        ld.color = colour
        lo = bpy.data.objects.new(name, ld)
        bpy.context.collection.objects.link(lo)
        lo.location = center + mathutils.Vector(loc)
        c = lo.constraints.new(type="TRACK_TO")
        c.target = pivot
        c.track_axis = "TRACK_NEGATIVE_Z"
        c.up_axis = "UP_Y"

    sc = bpy.context.scene
    sc.render.resolution_x = int(width)
    sc.render.resolution_y = int(height)
    sc.render.resolution_percentage = 100
    sc.render.fps = round(fps)
    sc.render.fps_base = sc.render.fps / fps
    sc.render.film_transparent = True
    sc.render.image_settings.file_format = "PNG"
    sc.render.image_settings.color_mode = "RGBA"
    sc.world = bpy.data.worlds.new("black")
    sc.world.use_nodes = True
    sc.world.node_tree.nodes["Background"].inputs[1].default_value = 0.0

    # Standard, not Filmic/AgX: look.cube is applied downstream and a second
    # tone curve in front of it compounds.
    sc.view_settings.view_transform = "Standard"

    sc.frame_start = 1
    sc.frame_end = frames
    pivot.rotation_mode = "XYZ"
    for i in range(frames):
        pivot.rotation_euler = (0.0, 0.0, 2 * math.pi * i / frames)
        pivot.keyframe_insert("rotation_euler", frame=i + 1)
    linearize_action(pivot.animation_data.action)
    sc.frame_set(1)
    bpy.context.view_layer.update()

    if render_dir:
        sc.render.filepath = str(render_dir.absolute() / "turn_")
        try:
            sc.render.engine = "BLENDER_EEVEE_NEXT"
        except TypeError:
            sc.render.engine = "BLENDER_EEVEE"

    if out:
        out.parent.mkdir(parents=True, exist_ok=True)
        # Pack textures, then publish on the same filesystem without clobbering.
        bpy.ops.file.pack_all()
        with tempfile.TemporaryDirectory(prefix=".taste-blender-", dir=out.parent) as temporary:
            staged = Path(temporary) / "scene.blend"
            bpy.ops.wm.save_as_mainfile(filepath=str(staged), check_existing=False, copy=True)
            if not staged.is_file() or staged.stat().st_size == 0:
                raise RuntimeError("Blender failed to save scene")
            validate_output(out)
            os.link(staged, out)
        print(f"[prop] scene -> {out}")

    if render_dir:
        validate_output(render_dir)
        render_dir.mkdir(parents=True, exist_ok=False)
        status = bpy.ops.render.render(animation=True)
        verify_render(status, render_dir, frames)
        print(f"[prop] frames -> {render_dir}")

    if receipt:
        if _sha256(mesh) != source_hash or (_sha256(grade) if grade.is_file() else None) != grade_hash:
            raise RuntimeError("input changed during scene build")
        payload = {
            "schema_version": 1, "blender_version": bpy.app.version_string,
            "source": {"path": str(mesh.absolute()), "sha256": source_hash},
            "grade": {"path": str(grade.absolute()), "sha256": grade_hash},
            "scene": {"meshes": [o.name for o in objs], "mesh_count": len(objs),
                      "materials": sorted({slot.material.name for o in objs for slot in o.material_slots if slot.material}),
                      "textures": [{"name": image.name, "packed": bool(image.packed_file)}
                                   for image in bpy.data.images if image.source == "FILE"],
                      "bounds": [list(mn), list(mx)], "dimensions": list(mx - mn),
                      "rim_colour": list(rim), "width": sc.render.resolution_x,
                      "height": sc.render.resolution_y, "fps": sc.render.fps / sc.render.fps_base,
                      "frame_start": sc.frame_start, "frame_end": sc.frame_end,
                      "view_transform": sc.view_settings.view_transform,
                      "render_engine": sc.render.engine, "render_filepath": sc.render.filepath},
            "output": {"path": str(out.absolute()), "sha256": _sha256(out), "bytes": out.stat().st_size},
            "saved": True, "rendered": render_dir is not None,
            "render_dir": str(render_dir.absolute()) if render_dir else None,
            "rendered_frame_count": frames if render_dir else 0,
            "provider_execution": False, "provider_calls": 0,
        }
        receipt.parent.mkdir(parents=True, exist_ok=True)
        validate_output(receipt)
        with receipt.open("x") as stream:
            json.dump(payload, stream, indent=2, allow_nan=False)


def main() -> None:
    ap = argparse.ArgumentParser(description="Load a minted prop into a lit Blender scene.")
    ap.add_argument("--mesh", required=True)
    ap.add_argument("--pack", required=True, help="style pack dir, for the rim colour")
    ap.add_argument("--out", default=None, help="save a .blend here")
    ap.add_argument("--render", default=None, help="render the turntable into this dir")
    ap.add_argument("--frames", type=int, default=48)
    ap.add_argument("--size", type=int, default=1024)
    ap.add_argument("--width", type=int, default=None, help="overrides square --size")
    ap.add_argument("--height", type=int, default=None, help="overrides square --size")
    ap.add_argument("--fps", type=float, default=24, help="explicit scene FPS; legacy default 24")
    ap.add_argument("--receipt", default=None, help="write verified scene metadata JSON")
    a = ap.parse_args(_argv())
    build(Path(a.mesh), Path(a.pack), Path(a.out) if a.out else None,
          a.frames, a.size, Path(a.render) if a.render else None,
          width=a.width, height=a.height, fps=a.fps,
          receipt=Path(a.receipt) if a.receipt else None)


if __name__ == "__main__":
    main()
