"""Render a minted mesh to frames, so 3D can re-enter the video pipeline.

This module exists because of a hard platform limit. fal splits 3D into
``image-to-3d``, ``text-to-3d`` and ``3d-to-3d``, and every endpoint in
``3d-to-3d`` emits another mesh - there is no ``3d-to-image`` or
``3d-to-video`` category anywhere in the catalogue. A GLB minted on fal
therefore cannot be fed back into a fal video graph: nothing there can look
at it.

Rendering locally closes the loop. Once a turntable exists as frames it is
just footage, and everything downstream already knows what to do with
footage: grade it with the pack, cut it at the reference's cadence, screen it
over a shot as an element, or upload it as a conditioning reference for the
video model.

Two backends, tried in order:

``blender``
    Used when a ``blender`` binary is on PATH. Real PBR shading, so the
    material maps that cost $0.15 extra on the mint actually show up.
``software``
    A dependency-light rasteriser built on trimesh + numpy. No GPU, no GL
    context, no system packages - it runs in any container. Flat-shaded with
    a key/rim setup rather than PBR, which is enough for a conditioning
    reference or a matte element, and honest about being a preview.

The software path is the default because a headless GL context is the single
most common thing missing from a container, and a renderer that only works on
a workstation is not part of a pipeline.
"""

from __future__ import annotations

import json
import math
import shutil
import subprocess
import tempfile
from pathlib import Path

import numpy as np


def have_blender() -> bool:
    return shutil.which("blender") is not None


# --------------------------------------------------------------------------
# software rasteriser
# --------------------------------------------------------------------------


def _load_mesh(path: str | Path):
    import trimesh

    scene = trimesh.load(str(path), force="scene")
    if hasattr(scene, "dump"):
        geoms = [g for g in scene.dump() if hasattr(g, "faces")]
        if not geoms:
            raise ValueError(f"no triangle geometry in {path}")
        mesh = geoms[0] if len(geoms) == 1 else trimesh.util.concatenate(geoms)
    else:
        mesh = scene
    mesh = mesh.copy()

    # Normalise to a unit sphere at the origin so framing does not depend on
    # whatever scale the generator happened to emit - meshes come back in
    # metres, centimetres and arbitrary units with no way to tell which.
    mesh.vertices -= mesh.vertices.mean(axis=0)
    radius = float(np.linalg.norm(mesh.vertices, axis=1).max()) or 1.0
    mesh.vertices /= radius
    return mesh


def _shade(normals: np.ndarray, base: np.ndarray) -> np.ndarray:
    """Key + rim + ambient on face normals.

    A rim term matters more than it looks: with a key light alone, a mesh
    rendered on black loses its silhouette entirely wherever it turns away
    from the light, which is exactly the framing this pack uses.
    """
    key = np.array([0.4, 0.7, 0.6]); key /= np.linalg.norm(key)
    rim = np.array([-0.6, 0.2, -0.7]); rim /= np.linalg.norm(rim)

    kd = np.clip(normals @ key, 0, 1)
    kr = np.clip(normals @ rim, 0, 1) ** 3
    lit = 0.08 + 0.85 * kd[:, None] * base + 0.55 * kr[:, None] * np.array([0.55, 0.75, 1.0])
    return np.clip(lit, 0, 1)


def _render_frame(mesh, angle: float, size: int, elevation: float, base_rgb) -> np.ndarray:
    """Painter's-algorithm rasterisation of one view. Returns float RGB [0,1]."""
    import cv2

    ca, sa = math.cos(angle), math.sin(angle)
    ce, se = math.cos(elevation), math.sin(elevation)
    Ry = np.array([[ca, 0, sa], [0, 1, 0], [-sa, 0, ca]])
    Rx = np.array([[1, 0, 0], [0, ce, -se], [0, se, ce]])
    R = Rx @ Ry

    V = mesh.vertices @ R.T
    N = mesh.face_normals @ R.T

    # Weak perspective: enough to read as dimensional, cheap enough to stay
    # a pure matrix multiply.
    z = V[:, 2]
    f = 2.6
    scale = f / (f - z)
    x = V[:, 0] * scale
    y = V[:, 1] * scale

    px = ((x * 0.42 + 0.5) * size).astype(np.int32)
    py = ((-y * 0.42 + 0.5) * size).astype(np.int32)
    pts = np.stack([px, py], axis=1)

    colors = _shade(N, np.asarray(base_rgb, dtype=float)[None, :])

    faces = mesh.faces
    depth = V[faces][:, :, 2].mean(axis=1)
    order = np.argsort(depth)  # far to near

    img = np.zeros((size, size, 3), np.float32)
    # Back-face culling before sorting halves the fill work and removes the
    # interior surfaces that otherwise punch through thin geometry.
    front = N[:, 2] > -0.15
    for fi in order:
        if not front[fi]:
            continue
        tri = pts[faces[fi]]
        cv2.fillConvexPoly(img, tri, tuple(float(c) for c in colors[fi]), lineType=cv2.LINE_AA)
    return img


def turntable_software(
    mesh_path: str | Path,
    dest: str | Path,
    n_frames: int = 48,
    size: int = 768,
    elevation_deg: float = 12.0,
    base_rgb=(0.72, 0.74, 0.82),
) -> list[Path]:
    mesh = _load_mesh(mesh_path)
    dest = Path(dest)
    dest.mkdir(parents=True, exist_ok=True)

    import cv2

    out: list[Path] = []
    for i in range(n_frames):
        img = _render_frame(mesh, 2 * math.pi * i / n_frames, size,
                            math.radians(elevation_deg), base_rgb)
        p = dest / f"turn_{i:04d}.png"
        cv2.imwrite(str(p), cv2.cvtColor((img * 255).astype(np.uint8), cv2.COLOR_RGB2BGR))
        out.append(p)
    return out


# --------------------------------------------------------------------------
# blender backend
# --------------------------------------------------------------------------


_BLENDER_SCRIPT = r'''
import bpy, sys, math, json
argv = sys.argv[sys.argv.index("--") + 1:]
cfg = json.loads(argv[0])

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=cfg["mesh"])

objs = [o for o in bpy.context.scene.objects if o.type == "MESH"]
if not objs:
    raise SystemExit("no mesh in file")

import mathutils
mn = mathutils.Vector((1e9,) * 3); mx = mathutils.Vector((-1e9,) * 3)
for o in objs:
    for c in o.bound_box:
        w = o.matrix_world @ mathutils.Vector(c)
        mn = mathutils.Vector((min(mn[i], w[i]) for i in range(3)))
        mx = mathutils.Vector((max(mx[i], w[i]) for i in range(3)))
center = (mn + mx) / 2.0
radius = max((mx - mn).length / 2.0, 1e-4)

pivot = bpy.data.objects.new("pivot", None)
bpy.context.collection.objects.link(pivot)
pivot.location = center
for o in objs:
    o.parent = pivot
    o.matrix_parent_inverse = pivot.matrix_world.inverted()

cam_data = bpy.data.cameras.new("cam"); cam = bpy.data.objects.new("cam", cam_data)
bpy.context.collection.objects.link(cam); bpy.context.scene.camera = cam
cam.location = center + mathutils.Vector((0, -radius * 3.2, radius * 0.8))
tr = cam.constraints.new(type="TRACK_TO"); tr.target = pivot
tr.track_axis = "TRACK_NEGATIVE_Z"; tr.up_axis = "UP_Y"

# Two area lights, key and rim. A single sun leaves the silhouette to die
# against a black world, which is the background this pack renders onto.
for name, loc, energy, sz in (
    ("key", (radius*2.5, -radius*2.0, radius*2.5), 900.0, radius*2),
    ("rim", (-radius*2.5, radius*1.5, radius*1.2), 600.0, radius*2),
):
    ld = bpy.data.lights.new(name, type="AREA"); ld.energy = energy; ld.size = sz
    lo = bpy.data.objects.new(name, ld); bpy.context.collection.objects.link(lo)
    lo.location = center + mathutils.Vector(loc)
    c = lo.constraints.new(type="TRACK_TO"); c.target = pivot
    c.track_axis = "TRACK_NEGATIVE_Z"; c.up_axis = "UP_Y"

sc = bpy.context.scene
sc.render.engine = cfg.get("engine", "BLENDER_EEVEE_NEXT")
sc.render.resolution_x = sc.render.resolution_y = cfg["size"]
sc.render.film_transparent = True
sc.render.image_settings.file_format = "PNG"
sc.render.image_settings.color_mode = "RGBA"
sc.world = bpy.data.worlds.new("w")
sc.world.use_nodes = True
sc.world.node_tree.nodes["Background"].inputs[1].default_value = 0.0

n = cfg["frames"]
for i in range(n):
    pivot.rotation_euler = (0.0, 0.0, 2 * math.pi * i / n)
    sc.render.filepath = cfg["dest"] + "/turn_%04d" % i
    bpy.ops.render.render(write_still=True)
'''


def turntable_blender(
    mesh_path: str | Path,
    dest: str | Path,
    n_frames: int = 48,
    size: int = 768,
    engine: str = "BLENDER_EEVEE_NEXT",
    timeout: int = 1800,
) -> list[Path]:
    dest = Path(dest)
    dest.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile("w", suffix=".py", delete=False) as fh:
        fh.write(_BLENDER_SCRIPT)
        script = fh.name
    cfg = json.dumps({
        "mesh": str(Path(mesh_path).resolve()),
        "dest": str(dest.resolve()),
        "frames": n_frames, "size": size, "engine": engine,
    })
    proc = subprocess.run(
        ["blender", "-b", "--python", script, "--", cfg],
        capture_output=True, text=True, timeout=timeout,
    )
    Path(script).unlink(missing_ok=True)
    frames = sorted(dest.glob("turn_*.png"))
    if not frames:
        raise RuntimeError(f"blender rendered nothing:\n{proc.stdout[-800:]}\n{proc.stderr[-800:]}")
    return frames


def turntable(
    mesh_path: str | Path,
    dest: str | Path,
    n_frames: int = 48,
    size: int = 768,
    backend: str = "auto",
) -> tuple[list[Path], str]:
    """Render a turntable. Returns ``(frames, backend_used)``."""
    if backend == "auto":
        backend = "blender" if have_blender() else "software"
    if backend == "blender":
        try:
            return turntable_blender(mesh_path, dest, n_frames, size), "blender"
        except Exception:
            # A failed Blender render must not lose the asset; the software
            # path always works, so degrade instead of raising.
            pass
    return turntable_software(mesh_path, dest, n_frames, size), "software"


def frames_to_video(frames: list[Path], dst: str | Path, fps: float = 24.0) -> Path:
    """Encode rendered frames into a clip the rest of the pipeline can eat."""
    dst = Path(dst)
    dst.parent.mkdir(parents=True, exist_ok=True)
    pattern = str(frames[0].parent / "turn_%04d.png")
    proc = subprocess.run([
        "ffmpeg", "-nostdin", "-loglevel", "error", "-y",
        "-framerate", f"{fps:g}", "-i", pattern,
        "-c:v", "libx264", "-crf", "14", "-pix_fmt", "yuv420p", str(dst),
    ], capture_output=True, text=True)
    if proc.returncode != 0:
        raise RuntimeError(f"ffmpeg failed: {proc.stderr[-400:]}")
    return dst
