#!/usr/bin/env python3
"""Generate new video from a style pack. Stage 3 of taste-forge.

The pack supplies the *look*; this stage supplies the *content*. Two separate
flags carry those two axes, and keeping them separate is the whole point:

* ``--style-steer`` - how it should LOOK. A per-run nudge on top of the pack's
  distilled spec: "push the teal harder", "longer lens", "less grain". It is
  appended to the look half of the prompt, alongside spec.json and the palette
  measured by mint.py.
* ``--brief`` - what should HAPPEN. Subject, action, place: "a courier weaves
  through night traffic". It is the only text describing content.

Collapsing them into one prompt string is the standard mistake, and it fails
in both directions: style words leak into the scene ("teal" becomes a teal
object in frame), and subject words get read as style. Splitting them also
makes the pack reusable - the same pack drives a hundred different briefs, and
the same brief can be rendered through a hundred different packs.

Shot lengths come from the reference's own cut rhythm (``Cadence.plan_shots``)
rather than a fixed clip length, so the rough cut inherits the pacing that
mint.py measured.

    python apply.py --genre flashethereal \\
        --style-steer "push the teal, longer lens" \\
        --brief "a courier weaves through night traffic" \\
        --duration 20

Every network call is stubbed under ``--dry-run`` / ``TASTE_FORGE_DRY_RUN=1``,
so the full plan, prompts and manifest can be inspected without spending.
"""

from __future__ import annotations

import argparse
import math
import json
import logging
import sys
import threading
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path

from taste import cadence as cad_mod
from taste import falapi
from taste import grade as grade_mod
from taste import pack as pack_mod

log = logging.getLogger("taste.apply")

# ffmpeg-api/compose track types are exactly 'video', 'audio' or 'image', and
# it accepts only ONE video track - a second one is rejected outright with
# "Multiple video tracks are not supported". So an image overlay has to ride
# an 'image' track; declaring it 'video' fails the whole compose.
OVERLAY_TRACK_TYPE = "image"

# Keyframe timestamps and durations are MILLISECONDS in this API, not seconds.
# Nothing in the response says so - a run submitted in seconds is accepted and
# returns a video, it is simply 1000x too short.
_MS = 1000.0


# ---------------------------------------------------------------------------
# prompt construction
# ---------------------------------------------------------------------------


def _spec_line(spec: dict, key: str, label: str) -> str | None:
    val = spec.get(key)
    if isinstance(val, list):
        val = ", ".join(str(v) for v in val)
    val = (val or "").strip() if isinstance(val, str) else ""
    return f"{label}: {val}" if val else None


def build_prompt(
    spec: dict,
    grade: grade_mod.GradeStats | None,
    style_steer: str,
    brief: str,
    index: int,
    n_shots: int,
    duration: float,
    n_cuts: int = 1,
) -> str:
    """Assemble one shot prompt: structure and motion only, then brief, then avoid.

    Deliberately says NOTHING about colour or contrast. That is not an
    oversight, it is the measured conclusion.

    Three paid generations were run against this pack with progressively more
    explicit colour direction, and the grade never arrived. The reference has
    a*+24.9 in the lower midtones; asking for it produced +1.9, then +2.8, and
    with colour language removed entirely, +0.3. Contrast was asked for in
    escalating terms across all three and sat at 23.4, 19.3, 19.2 against a
    target of 34.7. The model simply does not take numeric colour or tone
    direction.

    The pack does, deterministically and for free. Applying the same pack's
    zone transfer to the generated footage lands chroma at a mean absolute
    error of 1.4, and its L* CDF match moves contrast 18.7 -> 34.9 against a
    target of 34.7.

    So the division of labour is: the model supplies content, motion, lighting
    structure and framing, which it is good at; ``grade_clip`` supplies the
    look. Colour words in this prompt are worse than useless - they cost money
    and push the generation away from the neutral base the LUT wants.
    """
    look: list[str] = []
    for key, label in (
        ("lighting", "Lighting"),
        ("focal_length", "Lens"),
        ("camera_motion", "Camera"),
        ("subject_framing", "Framing"),
        ("grain", "Texture"),
        ("mood_adjectives", "Mood"),
    ):
        line = _spec_line(spec, key, label)
        if line:
            look.append(line)

    # Exposure structure, stated without hue, and QUANTIFIED from the pack.
    #
    # The model responds to local, checkable rules about regions far better
    # than to global ones ("extreme contrast"). But an unbounded rule
    # over-steers: "backgrounds pure black and unlit" produced generations
    # that were 79% pure black against a reference that is 26% black, and the
    # grade cannot pull that back - anchored tone preserves source blacks by
    # design, so the finished cut landed at 52% and failed its background
    # check. Naming the measured share turns an absolute into a target.
    bg = float(getattr(grade, "bg_share", 0.0) or 0.0) if grade else 0.0
    if bg > 0:
        look.append(
            f"Exposure: roughly {round(100 * bg / 5) * 5:.0f}% of each frame is "
            "unlit background falling to pure black, and the rest is brilliantly "
            "lit subject blowing toward white; no flat mid-grey anywhere. Do not "
            "let the frame go mostly black - the lit subject should fill most of it"
        )
    else:
        look.append(
            "Exposure: unlit background falling to pure black behind a brilliantly "
            "lit subject that fills most of the frame and blows toward white; "
            "no flat mid-grey anywhere"
        )
    look.append(
        "Colour: none. Render neutral. Grading is applied afterwards - do not "
        "attempt any colour styling, tint, or cast"
    )

    if style_steer.strip():
        look.append(f"Style direction (overrides the above on conflict): {style_steer.strip()}")

    parts = [
        "LOOK - match the reference image's structure, lighting and motion:",
        "\n".join(f"- {ln}" for ln in look) if look else "- match the reference image",
        "",
        "CONTENT - what happens in this shot:",
        brief.strip() or "continue the scene",
        "",
        _take_line(index, n_shots, duration, n_cuts),
    ]

    avoid = spec.get("avoid")
    if isinstance(avoid, list) and avoid:
        parts += ["", "AVOID: " + "; ".join(str(a) for a in avoid)]

    return "\n".join(parts)


def _take_line(index: int, n_takes: int, duration: float, n_cuts: int) -> str:
    """The one sentence that tells the model what shape of clip to produce.

    A take that will be cut into six pieces needs different direction from a
    take that plays whole. If the model is told "a single continuous take" and
    nothing else, it happily renders a slow locked-off push, and cutting that
    into six 0.8s pieces produces six near-identical frames - the cuts land
    but read as a stutter, not as edits. Asking for continuous change across
    the take is what makes each cut point look like a different shot.
    """
    if n_cuts <= 1:
        return (f"This is shot {index + 1} of {n_takes}, {duration:.1f}s, a single "
                "continuous take with no cuts.")
    return (
        f"This is take {index + 1} of {n_takes}: {duration:.1f}s, filmed as ONE "
        f"continuous take with no hard cuts inside it. It will be cut into "
        f"{n_cuts} pieces of roughly {duration / n_cuts:.1f}s in the edit, so "
        "the framing, subject and light must keep changing throughout - any "
        f"{duration / n_cuts:.1f}s window of it has to stand alone as its own shot."
    )


# ---------------------------------------------------------------------------
# shot generation
# ---------------------------------------------------------------------------


class ShotPlan:
    """One planned shot, plus whatever the run produced for it."""

    def __init__(
        self,
        index: int,
        start: float,
        duration: float,
        still: Path,
        cuts: list[dict] | None = None,
        gen_duration: float | None = None,
    ):
        self.index = index
        self.start = start
        self.duration = duration
        self.still = still
        # In take mode this clip is generated once and cut into several shots
        # locally; ``cuts`` are those sub-shot in/out points, relative to the
        # start of the generated file. In shot mode it is a single cut.
        self.cuts = cuts or [{"start": 0.0, "duration": duration}]
        # What the model is actually asked for, which is >= duration because
        # the endpoint has a 4s floor and quantizes to whole seconds.
        self.gen_duration = float(gen_duration or duration)
        self.local_path: Path | None = None
        # ``start`` is the shot's slot in the PLANNED timeline, and doubles as
        # the timecode read out of --base-video. ``timeline_start`` is where it
        # actually lands in the delivered cut, which differs once a failed shot
        # is dropped and the survivors close ranks.
        self.timeline_start: float | None = None
        self.prompt: str = ""
        self.still_url: str | None = None
        self.image_ref_url: str | None = None
        self.video_url: str | None = None
        self.error: str | None = None

    def to_dict(self) -> dict:
        return {
            "index": self.index,
            "start": round(self.start, 3),
            "timeline_start": (
                round(self.timeline_start, 3) if self.timeline_start is not None else None
            ),
            "duration": round(self.duration, 3),
            "duration_sent": self.gen_duration,
            "cuts": self.cuts,
            "local_path": str(self.local_path) if self.local_path else None,
            "still": self.still.name,
            "still_path": str(self.still),
            "still_url": self.still_url,
            "image_ref_url": self.image_ref_url,
            "prompt": self.prompt,
            "video_url": self.video_url,
            "error": self.error,
        }


def _generate(shot: ShotPlan, base_video_url: str | None, lock: threading.Lock) -> ShotPlan:
    """Produce one shot. Runs on a worker thread; never raises."""
    try:
        shot.still_url = falapi.upload(shot.still)

        if base_video_url:
            # Supplementing existing footage: the frame already on the timeline
            # at this timecode is a stronger conditioning image than a pack
            # still, because it carries the actual subject and set continuity.
            shot.image_ref_url = falapi.extract_frame(base_video_url, shot.start)
        else:
            shot.image_ref_url = shot.still_url

        shot.video_url = falapi.reference_to_video(
            shot.image_ref_url, shot.prompt, shot.gen_duration
        )
        with lock:
            log.info("shot %d ok -> %s", shot.index, shot.video_url)
    except Exception as exc:  # noqa: BLE001 - one bad shot must not kill the run
        shot.error = f"{type(exc).__name__}: {exc}"
        with lock:
            log.error("shot %d failed: %s", shot.index, shot.error)
    return shot


# ---------------------------------------------------------------------------
# main pipeline
# ---------------------------------------------------------------------------


def apply(
    genre: str,
    style_steer: str,
    brief: str,
    duration: float,
    root: str = "stylepacks",
    base_video: str | None = None,
    overlays: list[str] | None = None,
    out: str | None = None,
    concurrency: int = 4,
    take_len: float = 5.0,
    assemble: bool = True,
    base_ratio: float = 0.35,
    strength: float = 1.0,
    fps: float | None = None,
    tier: str | None = None,
) -> dict:
    if fps is not None and (not math.isfinite(fps) or fps <= 0):
        raise ValueError("fps must be finite and positive")
    # Fail before uploads/generation, and keep every run's paid originals.
    from forge import validate_output
    out_path = Path(out) if out else Path("out") / f"{genre}_roughcut.mp4"
    validate_output(out_path)
    takes_dir = out_path.parent / f"{out_path.stem}_takes"
    manifest_path = out_path.with_suffix(".generation.json")
    for destination in (takes_dir, manifest_path):
        if destination.exists() or destination.is_symlink():
            raise FileExistsError(f"output already exists; choose a new --out: {destination}")
    if tier:
        falapi.use_tier("reference_to_video", tier)
    sp = pack_mod.load(genre, root=root)
    stills = sp.stills()
    if not stills:
        raise SystemExit(f"pack '{genre}' has no stills - run mint.py first")

    spec = sp.read_json(sp.spec_path)
    if not spec:
        print(
            f"  !! no spec.json in pack; prompts will rely on --style-steer alone.\n"
            f"     run: python distill.py --genre {genre}",
            file=sys.stderr,
        )

    grade = grade_mod.load_stats(sp.grade_path) if sp.grade_path.exists() else None
    cad = cad_mod.load(sp.cadence_path) if sp.cadence_path.exists() else cad_mod.Cadence()

    # Plan TAKES, not shots.
    #
    # One generation per shot is the obvious reading of "match the reference's
    # cadence" and it is economically absurd here: this pack averages 0.78s per
    # shot while the endpoint refuses anything under 4s, so a 10s piece becomes
    # twelve calls, 48 generated seconds for 10 used (21% efficiency), and
    # twelve mutually unrelated clips stitched into what should read as one
    # continuous piece. Rolling ~5s takes and cutting inside them locally is
    # what an editor does: 3 calls, 13 generated seconds, 77% efficiency, and
    # consecutive shots that actually belong to each other.
    mode = "DRY RUN" if falapi.is_dry_run() else "live"
    if take_len and take_len > 0:
        plan = cad_mod.plan_takes(cad, duration, take_len=take_len)
    else:
        plan = [
            {"index": i, "gen_duration": cad_mod.quantize_gen_duration(d),
             "used": d, "shots": [{"start": 0.0, "duration": d}]}
            for i, d in enumerate(cad.plan_shots(duration))
        ]
    n_cuts = sum(len(t["shots"]) for t in plan)
    gen_secs = sum(t["gen_duration"] for t in plan)
    used_secs = sum(t["used"] for t in plan)
    print(f"applying '{genre}' [{mode}]: {len(plan)} take(s) -> {n_cuts} shot(s) "
          f"over {duration:.1f}s")
    print(f"  cadence        : mean {cad.mean_shot:.2f}s, variance {cad.rhythm_variance:.2f}")
    print(f"  efficiency     : {used_secs:.1f}s used of {gen_secs:.0f}s generated "
          f"({100 * used_secs / max(1e-6, gen_secs):.0f}%), {len(plan)} call(s)")

    out_path.parent.mkdir(parents=True, exist_ok=True)

    # Rotate through the stills so consecutive shots do not all inherit the
    # same frame's composition - the look should carry, the framing should not.
    shots: list[ShotPlan] = []
    clock = 0.0
    for t in plan:
        i = t["index"]
        s = ShotPlan(
            i, clock, float(t["used"]), stills[i % len(stills)],
            cuts=t["shots"], gen_duration=float(t["gen_duration"]),
        )
        s.prompt = build_prompt(
            spec, grade, style_steer, brief, i, len(plan),
            float(t["gen_duration"]), n_cuts=len(t["shots"]),
        )
        shots.append(s)
        clock += float(t["used"])

    base_video_url = None
    if base_video:
        bp = Path(base_video)
        if not bp.exists():
            raise SystemExit(f"--base-video not found: {bp}")
        base_video_url = falapi.upload(bp)
        print(f"  base video     : {bp.name} (frames pulled per shot timecode)")

    overlay_urls: list[str] = []
    if overlays:
        # Fail before any paid upload: forge() rejects a missing overlay
        # later, which would strand every generated take without a manifest.
        missing = [Path(o) for o in overlays if not Path(o).is_file()]
        if missing:
            raise SystemExit("--overlay not found: " + ", ".join(str(m) for m in missing))
        for o in overlays:
            overlay_urls.append(falapi.upload(Path(o)))
        print(f"  overlays       : {len(overlay_urls)}")

    # Uploads are cached by (path, mtime, size), so the workers racing on the
    # same handful of stills still only pay for each upload once.
    lock = threading.Lock()
    workers = max(1, min(int(concurrency), len(shots)))
    print(f"  generating     : {len(shots)} shot(s), {workers} worker(s) ...")
    with ThreadPoolExecutor(max_workers=workers) as pool:
        list(pool.map(lambda s: _generate(s, base_video_url, lock), shots))

    ok = [s for s in shots if s.video_url]
    failed = [s for s in shots if not s.video_url]
    for s in failed:
        print(f"  !! shot {s.index} failed: {s.error}", file=sys.stderr)
    if not ok:
        raise SystemExit("every shot failed; nothing to compose")

    # Close ranks over any failed shot so the cut has no black hole in it.
    timeline_clock = 0.0
    for s in ok:
        s.timeline_start = timeline_clock
        timeline_clock += s.duration

    # Generate long, trim short. Video models quantize to whole seconds with a
    # floor of a few, but the pack's cadence is often faster than that (a 1.1s
    # shot is normal in a fast reference). So each shot is requested at the
    # model's nearest legal length and then cut back to its cadence-derived
    # duration on the timeline - which is the only way the rough cut actually
    # inherits the reference's rhythm instead of a 3s-per-clip floor.
    tracks = [
        {
            "id": "shots",
            "type": "video",
            "keyframes": [
                {
                    "url": s_.video_url,
                    "timestamp": round(s_.timeline_start * _MS, 1),
                    "duration": round(s_.duration * _MS, 1),
                }
                for s_ in ok
            ],
        }
    ]
    if overlay_urls:
        total = timeline_clock or duration
        span = total / len(overlay_urls)
        tracks.append(
            {
                "id": "overlays",
                "type": OVERLAY_TRACK_TYPE,
                "keyframes": [
                    {
                        "url": u,
                        "timestamp": round(i * span * _MS, 1),
                        "duration": round(span * _MS, 1),
                    }
                    for i, u in enumerate(overlay_urls)
                ],
            }
        )

    # Pull the takes down before anything else touches them. Everything from
    # here on - grade, cut, overlay, concat - is local ffmpeg, which is exact,
    # free, and re-runnable, whereas the hosted composer can only place whole
    # clips at whole timestamps and cannot cut inside a take at all.
    takes_dir.mkdir(parents=True, exist_ok=False)
    for s_ in ok:
        s_.local_path = takes_dir / f"take_{s_.index:03d}.mp4"
        falapi.download(s_.video_url, s_.local_path)
    print(f"  takes          : {len(ok)} downloaded -> {takes_dir}")

    compose_mode = "local"
    final_url = None
    if assemble and falapi.is_dry_run():
        # A dry-run "take" is a text placeholder, not an mp4, so there is
        # nothing for the assembler to grade or cut. Everything up to this
        # point - the plan, the prompts, the track layout, the manifest - is
        # still exercised, which is what the dry run is for.
        print("  assemble       : skipped (dry-run takes are placeholders)")
        compose_mode = "skipped"
    elif assemble:
        # forge() is the finishing stage: it grades each take with the pack,
        # cuts it at the planned in/out points, weaves in shots from the video
        # being supplemented, composites overlays, and concatenates.
        from forge import forge as _forge

        _forge(
            genre=genre,
            takes=[str(s_.local_path) for s_ in ok],
            out=str(out_path),
            root=root,
            base_video=base_video,
            base_ratio=base_ratio if base_video else 0.0,
            overlays=overlays,
            duration=duration,
            strength=strength,
            plan=[{"index": s_.index, "shots": s_.cuts} for s_ in ok],
            fps=fps,
        )
    else:
        compose_mode = "compose"
        try:
            final_url = falapi.compose(tracks)
        except falapi.FalError as exc:
            # A composed timeline is the goal, but a plain concatenation still
            # gives an editor something to cut against, so degrade rather than die.
            log.error("compose failed (%s); falling back to merge_videos", exc)
            compose_mode = "merge_videos"
            final_url = falapi.merge_videos([s_.video_url for s_ in ok])
        falapi.download(final_url, out_path)

    manifest = {
        "genre": genre,
        "generated": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "dry_run": falapi.is_dry_run(),
        "style_steer": style_steer,
        "brief": brief,
        "target_duration": duration,
        "planned_duration": round(sum(s.duration for s in shots), 3),
        "base_video": str(base_video) if base_video else None,
        "base_video_url": base_video_url,
        "overlays": [str(o) for o in (overlays or [])],
        "overlay_urls": overlay_urls,
        "concurrency": workers,
        "take_len": take_len,
        "assembled_locally": compose_mode == "local",
        "fps": fps,
        "tier": tier,
        "takes_dir": str(takes_dir),
        "generated_seconds": gen_secs,
        "used_seconds": round(used_secs, 3),
        "efficiency": round(used_secs / max(1e-6, gen_secs), 4),
        "cadence": {
            "mean_shot": cad.mean_shot,
            "rhythm_variance": cad.rhythm_variance,
            "cuts_per_min": cad.cuts_per_min,
        },
        "endpoints": dict(falapi.ENDPOINTS),
        "compose_mode": compose_mode,
        "output_url": final_url,
        "output": str(out_path),
        "n_shots": len(shots),
        "n_failed": len(failed),
        "tracks": tracks,
        "shots": [s.to_dict() for s in shots],
    }
    manifest_path.write_text(json.dumps(manifest, indent=2), encoding="utf-8")

    print(f"\n  === {genre} rough cut ===")
    print(f"  takes          : {len(ok)} ok / {len(failed)} failed")
    print(f"  take lengths   : {', '.join(f'{s_.gen_duration:.0f}s' for s_ in shots)}")
    print(f"  shots cut      : {sum(len(s_.cuts) for s_ in ok)}")
    print(f"  video          : {out_path}")
    print(f"  manifest       : {manifest_path}")
    if falapi.is_dry_run():
        print("  (dry run - the video file is a placeholder, not footage)")
    return manifest


def main() -> None:
    ap = argparse.ArgumentParser(
        description="Generate a rough cut from a style pack (stage 3).",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="--style-steer and --brief are deliberately separate: one is how it\n"
               "LOOKS, the other is what HAPPENS. Merging them leaks style words\n"
               "into the scene and subject words into the grade.",
    )
    ap.add_argument("--genre", required=True, help="existing pack name, e.g. flashethereal")
    ap.add_argument("--root", default="stylepacks")
    ap.add_argument("--style-steer", default="",
                    help="HOW IT LOOKS: per-run nudge on top of the pack's spec, "
                         "e.g. 'push the teal, longer lens'")
    ap.add_argument("--brief", default="",
                    help="WHAT HAPPENS: subject and action, e.g. 'a courier weaves "
                         "through night traffic'")
    ap.add_argument("--duration", type=float, default=20.0,
                    help="best-effort target seconds, not exact; shot lengths follow the pack's cadence and actual assembly duration is reported")
    ap.add_argument("--base-video",
                    help="optional existing footage; each shot is conditioned on the frame "
                         "at its own timecode so generated shots supplement the edit")
    ap.add_argument("--overlays", nargs="*", default=None,
                    help="optional image paths composited over the rough cut")
    ap.add_argument("--out", help="output video path (default out/<genre>_roughcut.mp4)")
    ap.add_argument("--fps", type=float, default=None, help="local assembly output frame rate")
    ap.add_argument("--tier", default=None, help="reference-to-video provider tier")
    ap.add_argument("--concurrency", type=int, default=4,
                    help="parallel take generations; these are slow network calls")
    ap.add_argument("--take-len", type=float, default=5.0,
                    help="seconds per generated take; shots are cut inside it. "
                         "0 disables take grouping and generates one clip per shot "
                         "(far more expensive)")
    ap.add_argument("--base-ratio", type=float, default=0.35,
                    help="with --base-video: share of the finished cut taken from it")
    ap.add_argument("--strength", type=float, default=1.0,
                    help="0-1 grade intensity applied to the generated takes")
    ap.add_argument("--no-assemble", action="store_true",
                    help="skip the local grade/cut/assemble stage and compose the raw "
                         "takes on the hosted API instead")
    ap.add_argument("--dry-run", action="store_true",
                    help="stub every network call; no API key needed, no spend")
    ap.add_argument("--verbose", "-v", action="store_true")
    a = ap.parse_args()

    logging.basicConfig(
        level=logging.DEBUG if a.verbose else logging.INFO,
        format="%(levelname)s %(name)s: %(message)s",
    )
    if a.dry_run:
        falapi.enable_dry_run()

    try:
        # Check credentials once, up front. Otherwise a missing key surfaces as
        # N identical failures from N worker threads after the uploads have
        # already run, which buries the one line that says what to do.
        if not falapi.is_dry_run():
            falapi.api_key()
        apply(
            genre=a.genre,
            style_steer=a.style_steer,
            brief=a.brief,
            duration=a.duration,
            root=a.root,
            base_video=a.base_video,
            overlays=a.overlays,
            out=a.out,
            concurrency=a.concurrency,
            take_len=a.take_len,
            assemble=not a.no_assemble,
            base_ratio=a.base_ratio,
            strength=a.strength,
            fps=a.fps,
            tier=a.tier,
        )
    except (FileNotFoundError, falapi.FalError) as exc:
        raise SystemExit(f"apply failed: {exc}") from exc


if __name__ == "__main__":
    main()
