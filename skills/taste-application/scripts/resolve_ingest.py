#!/usr/bin/env python3
"""Drive DaVinci Resolve from a style pack - and degrade gracefully when it is absent.

    python3 resolve_ingest.py --genre flashethereal --media out/renders/
    python3 resolve_ingest.py --genre flashethereal --dry-run

Stage 3 of taste-forge. Stage 1 (``mint.py``) distils a reference into a pack;
stage 2 generates footage against it; this stage puts the two back together
inside a colourist's actual tool: a Resolve project whose timeline carries the
reference's cut rhythm and whose grade starts from the pack's baked ``look.cube``.

**The fallback is the point.** Resolve's Python API only exists inside a Resolve
installation, and only when the user has ticked *Preferences > System > General >
External scripting using*. On a render farm, in CI, on a machine that has never
had Resolve installed - and, notably, on the box this script was developed on -
none of that is true. So this script *always* writes an FCPXML next to the pack
first, before it goes anywhere near the automation API. That file is a complete,
frame-exact handoff: double-click-importable into Resolve, Premiere, or Final
Cut. Resolve automation, when it is available, is a convenience on top of a
deliverable that already exists - never a precondition for producing one.

What the automated path does when Resolve *is* reachable:

1. create or open the project,
2. set the timeline frame rate (must happen before any timeline exists),
3. import the media into the media pool,
4. build the timeline - preferring ``ImportTimelineFromFile`` on the FCPXML we
   just wrote, so the cadence survives instead of being flattened to one clip
   per equal slot,
5. copy ``look.cube`` into Resolve's LUT directory and apply it to node 1 of
   every clip's grade.
"""

from __future__ import annotations

import argparse
import os
import platform
import shutil
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from taste import cadence as cad_mod  # noqa: E402
from taste import pack as pack_mod  # noqa: E402
from taste import timeline as tl_mod  # noqa: E402

VIDEO_EXT = {".mov", ".mp4", ".mxf", ".m4v", ".avi", ".mkv", ".webm", ".prores", ".r3d"}
IMAGE_EXT = {".png", ".jpg", ".jpeg", ".tif", ".tiff", ".exr", ".dpx"}


# ---------------------------------------------------------------------------
# DaVinciResolveScript discovery
# ---------------------------------------------------------------------------

def _scripting_module_dirs() -> list[Path]:
    """Documented per-platform locations of ``DaVinciResolveScript.py``.

    Resolve ships the module inside the app bundle rather than installing it
    into site-packages, so an unqualified ``import`` only works if the user has
    already exported ``PYTHONPATH``. These are the vendor defaults.
    """
    system = platform.system()
    dirs: list[Path] = []

    # Honour the officially documented override first.
    env_api = os.environ.get("RESOLVE_SCRIPT_API")
    if env_api:
        dirs.append(Path(env_api) / "Modules")

    if system == "Darwin":
        dirs.append(
            Path("/Library/Application Support/Blackmagic Design/DaVinci Resolve"
                 "/Developer/Scripting/Modules")
        )
        dirs.append(
            Path.home()
            / "Library/Application Support/Blackmagic Design/DaVinci Resolve"
              "/Developer/Scripting/Modules"
        )
    elif system == "Windows":
        programdata = Path(os.environ.get("PROGRAMDATA", r"C:\ProgramData"))
        dirs.append(
            programdata
            / "Blackmagic Design" / "DaVinci Resolve" / "Support"
            / "Developer" / "Scripting" / "Modules"
        )
    else:  # Linux
        dirs.append(Path("/opt/resolve/Developer/Scripting/Modules"))
        dirs.append(Path("/home/resolve/Developer/Scripting/Modules"))

    return dirs


def load_resolve_module():
    """Import ``DaVinciResolveScript`` defensively. Returns the module or ``None``.

    Never raises: a missing Resolve install is the normal case for this script,
    not an error condition, and a traceback here would be noise.
    """
    try:
        import DaVinciResolveScript as dvr  # type: ignore

        return dvr
    except ImportError:
        pass

    import importlib.util

    for d in _scripting_module_dirs():
        candidate = d / "DaVinciResolveScript.py"
        try:
            if not candidate.exists():
                continue
            spec = importlib.util.spec_from_file_location("DaVinciResolveScript", candidate)
            if spec is None or spec.loader is None:
                continue
            mod = importlib.util.module_from_spec(spec)
            sys.modules["DaVinciResolveScript"] = mod
            spec.loader.exec_module(mod)
            return mod
        except Exception:  # a broken/partial install must not take us down
            continue
    return None


def resolve_unavailable_message() -> str:
    searched = "\n".join(f"    {d}" for d in _scripting_module_dirs())
    return (
        "DaVinci Resolve scripting is not available on this machine.\n"
        "\n"
        "Looked for DaVinciResolveScript.py in:\n"
        f"{searched}\n"
        "\n"
        "To enable the automated path:\n"
        "  1. Install and launch DaVinci Resolve (it must be RUNNING - the API\n"
        "     talks to a live instance, it does not start one).\n"
        "  2. Resolve > Preferences > System > General, tick\n"
        "     'External scripting using' and set it to Local, then restart Resolve.\n"
        "  3. If the module still is not found, export the documented paths, e.g.\n"
        "     macOS/Linux:\n"
        "       export RESOLVE_SCRIPT_API=\"/opt/resolve/Developer/Scripting\"\n"
        "       export PYTHONPATH=\"$PYTHONPATH:$RESOLVE_SCRIPT_API/Modules\"\n"
        "\n"
        "The FCPXML written above is a complete handoff and does not need any of\n"
        "this: in Resolve use File > Import > Timeline > AAF/EDL/XML..., pick it,\n"
        "and relink media if prompted."
    )


def resolve_lut_dirs() -> list[Path]:
    """Per-platform Resolve LUT directories, most-preferred first.

    Resolve resolves LUT paths **relative to its own LUT folder**, so a
    ``.cube`` sitting in a project directory is invisible to ``SetLUT`` no
    matter how absolute the path you hand it. The LUT has to be copied in, and
    then referenced by its path relative to that root (``taste-forge/look.cube``,
    not ``/home/you/stylepacks/x/look.cube``).
    """
    system = platform.system()
    if system == "Darwin":
        return [
            Path("/Library/Application Support/Blackmagic Design/DaVinci Resolve/LUT"),
            Path.home() / "Library/Application Support/Blackmagic Design/DaVinci Resolve/LUT",
        ]
    if system == "Windows":
        programdata = Path(os.environ.get("PROGRAMDATA", r"C:\ProgramData"))
        return [programdata / "Blackmagic Design" / "DaVinci Resolve" / "Support" / "LUT"]
    return [
        Path("/opt/resolve/LUT"),
        Path.home() / ".local/share/DaVinciResolve/LUT",
    ]


# ---------------------------------------------------------------------------
# building the cut
# ---------------------------------------------------------------------------

def collect_media(entries: list[str] | None, sp: pack_mod.StylePack) -> list[Path]:
    """Expand ``--media`` (files and/or directories) into an ordered file list.

    With nothing supplied, falls back to the pack's own stills. That is not a
    toy case: a stills-only timeline is a perfectly good animatic, and it means
    a freshly minted pack can be taken into Resolve before a single frame of
    footage has been generated.
    """
    out: list[Path] = []
    for e in entries or []:
        p = Path(e)
        if p.is_dir():
            out.extend(
                sorted(
                    f for f in p.iterdir()
                    if f.is_file() and f.suffix.lower() in (VIDEO_EXT | IMAGE_EXT)
                )
            )
        elif p.is_file():
            out.append(p)
        else:
            print(f"  !! no such media path, skipping: {e}", file=sys.stderr)
    if not out:
        out = sp.stills()
        if out:
            print(f"  no --media given; using {len(out)} pack stills as an animatic")
    return out


def build_clips(media: list[Path], cad: cad_mod.Cadence) -> list[dict]:
    """Marry media files to the reference's shot-length distribution.

    The cadence is the payload here. Whichever list is longer sets the clip
    count: extra media gets durations sampled from the reference distribution
    (``Cadence.plan_shots``), extra shots cycle back through the media. Either
    way the *rhythm* of the result is the reference's, not 5-seconds-a-clip.
    """
    if not media:
        raise SystemExit("no media and no stills in the pack - nothing to lay down")

    durations = [
        float(s.get("duration", 0.0)) for s in cad.shots if float(s.get("duration", 0.0)) > 0.04
    ]
    if not durations:
        durations = [max(cad.mean_shot, 1.0)]

    n = max(len(media), len(durations))
    if n > len(durations):
        # Extend by sampling the reference's own distribution rather than
        # repeating the tail, so the added shots inherit its variance.
        shortfall = (n - len(durations)) * max(cad.mean_shot, 0.5)
        durations = durations + list(cad.plan_shots(shortfall))
    if len(durations) < n:  # plan_shots is stochastic; top up by cycling
        base = list(durations)
        durations += [base[i % len(base)] for i in range(n - len(base))]
    durations = durations[:n]

    clips: list[dict] = []
    for i in range(n):
        src = media[i % len(media)]
        clips.append(
            {
                "path": str(src.resolve()),
                "duration": round(float(durations[i]), 4),
                "name": f"{src.stem}_{i:03d}",
            }
        )
    return clips


def detect_resolution(media: list[Path], default: tuple[int, int] = (1920, 1080)) -> tuple[int, int]:
    """Read frame size off the first readable media file; fall back to 1080p."""
    for m in media:
        try:
            import cv2  # local import: this is the only place the script needs it

            if m.suffix.lower() in IMAGE_EXT:
                img = cv2.imread(str(m))
                if img is not None:
                    return int(img.shape[1]), int(img.shape[0])
            else:
                cap = cv2.VideoCapture(str(m))
                if cap.isOpened():
                    w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
                    h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
                    cap.release()
                    if w > 0 and h > 0:
                        return w, h
                cap.release()
        except Exception:
            continue
    return default


# ---------------------------------------------------------------------------
# Resolve automation
# ---------------------------------------------------------------------------

def stage_lut(sp: pack_mod.StylePack, dry_run: bool) -> tuple[Path | None, str | None]:
    """Copy ``look.cube`` into Resolve's LUT folder.

    Returns ``(absolute_destination, relative_name)``. The *relative* name is
    the one to hand to ``TimelineItem.SetLUT`` / ``ProjectSetting`` - see
    :func:`resolve_lut_dirs` for why an absolute path outside the LUT root does
    not work.
    """
    if not sp.lut_path.exists():
        print(f"  !! pack has no look.cube at {sp.lut_path} - skipping LUT step")
        return None, None

    rel = f"taste-forge/{sp.name}.cube"
    roots = resolve_lut_dirs()

    if dry_run:
        dest = next((r for r in roots if r.exists()), roots[0]) / rel
        marker = "exists" if dest.parent.parent.exists() else "absent - Resolve not installed?"
        print(f"  [dry-run] would copy LUT -> {dest}   (LUT root {marker})")
        return dest, rel

    for root in roots:
        # Only write into a LUT root Resolve actually created. Conjuring
        # /opt/resolve/LUT on a machine without Resolve would leave litter that
        # a later real install would not pick up anyway.
        if not root.is_dir():
            continue
        dest = root / rel
        try:
            dest.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(sp.lut_path, dest)
            print(f"  LUT staged -> {dest}   (Resolve reference: {rel})")
            return dest, rel
        except OSError as exc:
            print(f"  !! could not write {dest}: {exc}", file=sys.stderr)

    print(
        "  !! no existing Resolve LUT directory found; skipping LUT staging.\n"
        f"     Copy {sp.lut_path} into your Resolve LUT folder by hand, or apply it\n"
        "     from the Color page (right-click a node > LUTs).",
        file=sys.stderr,
    )
    return None, None


def run_resolve(
    dvr,
    project_name: str,
    fps: float,
    media: list[Path],
    fcpxml_path: Path,
    lut_rel: str | None,
) -> int:
    """Everything that touches the live Resolve instance. Returns an exit code."""
    resolve = dvr.scriptapp("Resolve")
    if resolve is None:
        print(
            "  !! found the scripting module but could not reach a running Resolve.\n"
            "     Launch Resolve and leave it open, then re-run.",
            file=sys.stderr,
        )
        return 3

    pm = resolve.GetProjectManager()
    project = pm.LoadProject(project_name) or pm.CreateProject(project_name)
    if project is None:
        print(f"  !! could not create or open project {project_name!r}", file=sys.stderr)
        return 4
    print(f"  project: {project.GetName()}")

    # Frame rate must be set before a timeline exists; Resolve locks it after.
    if not project.SetSetting("timelineFrameRate", f"{float(fps):g}"):
        print(f"  !! Resolve refused timelineFrameRate={fps:g} (timeline already present?)")
    else:
        print(f"  timeline fps: {fps:g}")

    media_pool = project.GetMediaPool()
    storage = resolve.GetMediaStorage()
    added = storage.AddItemListToMediaPool([str(p) for p in media]) or []
    print(f"  imported {len(added)} item(s) into the media pool")

    # Preferred path: import the FCPXML we already wrote, so the cadence comes
    # across as authored. CreateTimelineFromClips would drop the timings.
    timeline = None
    try:
        if media_pool.ImportTimelineFromFile(
            str(fcpxml_path),
            {"timelineName": project_name, "importSourceClips": True},
        ):
            timeline = project.GetCurrentTimeline()
            print(f"  timeline built from {fcpxml_path.name} (cadence preserved)")
    except Exception as exc:
        print(f"  !! FCPXML import failed ({exc}); falling back to clip order")

    if timeline is None:
        timeline = media_pool.CreateTimelineFromClips(project_name, added)
        if timeline is None:
            print("  !! could not create a timeline", file=sys.stderr)
            return 5
        print("  timeline built from media-pool order (cadence NOT applied)")

    if lut_rel:
        applied = 0
        for track in range(1, (timeline.GetTrackCount("video") or 1) + 1):
            for item in timeline.GetItemListInTrack("video", track) or []:
                try:
                    # Node 1 = first node of the clip's grade, which is where a
                    # look LUT belongs so downstream nodes can trim it.
                    if item.SetLUT(1, lut_rel):
                        applied += 1
                except Exception:
                    pass
        print(f"  applied {lut_rel} to node 1 of {applied} clip(s)")

    resolve.OpenPage("edit")
    project.SetSetting("timelineFrameRate", f"{float(fps):g}")
    pm.SaveProject()
    print("  project saved")
    return 0


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(
        description="Set up a DaVinci Resolve project from a taste-forge style pack. "
                    "Always writes an FCPXML handoff, with or without Resolve."
    )
    ap.add_argument("--genre", required=True, help="style pack name, e.g. flashethereal")
    ap.add_argument("--root", default="stylepacks", help="style pack root directory")
    ap.add_argument("--media", nargs="*", default=None,
                    help="media files and/or directories to import "
                         "(default: the pack's stills, as an animatic)")
    ap.add_argument("--project-name", default=None,
                    help="Resolve project name (default: <genre>-cut)")
    ap.add_argument("--fps", type=float, default=None,
                    help="timeline frame rate (default: the pack cadence's fps)")
    ap.add_argument("--dry-run", action="store_true",
                    help="do everything except talk to Resolve")
    a = ap.parse_args(argv)

    # ---- pack ------------------------------------------------------------
    try:
        sp = pack_mod.load(a.genre, root=a.root)
    except FileNotFoundError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1
    print(f"pack: {sp.dir}")

    if not sp.cadence_path.exists():
        print(f"error: pack has no cadence.json at {sp.cadence_path} - re-run mint.py",
              file=sys.stderr)
        return 1
    cad = cad_mod.load(sp.cadence_path)
    fps = float(a.fps) if a.fps else float(cad.fps or 24.0)
    project_name = a.project_name or f"{sp.name}-cut"
    print(f"  cadence: {cad.n_shots} shots, mean {cad.mean_shot:.2f}s, "
          f"variance {cad.rhythm_variance:.2f}")
    print(f"  fps    : {fps:g}  ({tl_mod.fps_fraction(fps)})")

    # ---- media -----------------------------------------------------------
    media = collect_media(a.media, sp)
    if not media:
        print("error: no media and no stills in the pack - nothing to lay down",
              file=sys.stderr)
        return 1
    clips = build_clips(media, cad)
    width, height = detect_resolution(media)
    total = sum(c["duration"] for c in clips)
    print(f"  media  : {len(media)} file(s) -> {len(clips)} clip(s), "
          f"{total:.2f}s @ {width}x{height}")

    # ---- the handoff, written unconditionally and first -------------------
    fcpxml_path = tl_mod.write_timeline(
        clips, fps, sp.dir / f"{project_name}.fcpxml", fmt="fcpxml",
        title=project_name, width=width, height=height,
    )
    edl_path = tl_mod.write_timeline(
        clips, fps, sp.dir / f"{project_name}.edl", fmt="edl", title=project_name,
    )
    print(f"  FCPXML -> {fcpxml_path}")
    print(f"  EDL    -> {edl_path}")

    # ---- LUT staging -----------------------------------------------------
    _, lut_rel = stage_lut(sp, dry_run=a.dry_run)

    # ---- Resolve ---------------------------------------------------------
    dvr = load_resolve_module()
    if a.dry_run:
        print(f"  resolve module: {'found' if dvr else 'not found (fine for a dry run)'}")
        print("\n[dry-run] would now: create/open project "
              f"{project_name!r}, set fps {fps:g}, import {len(media)} item(s), "
              f"import {fcpxml_path.name} as the timeline, and apply "
              f"{lut_rel or '<no LUT>'} to node 1 of each clip.")
        print("dry run complete - the FCPXML above is real and importable.")
        return 0

    if dvr is None:
        print("", file=sys.stderr)
        print(resolve_unavailable_message(), file=sys.stderr)
        return 2

    return run_resolve(dvr, project_name, fps, media, fcpxml_path, lut_rel)


if __name__ == "__main__":
    raise SystemExit(main())
