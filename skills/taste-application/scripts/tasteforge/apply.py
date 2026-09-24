"""Apply a style pack to local media - deterministically, offline.

The recovered pipeline's provider stage generated each shot against a hosted
model. In this lane, application is *local and deterministic*: the pack's
measured cadence plans the shot rhythm, local media clips fill the slots, and
the result is a schema-valid application report plus a timeline ready for
EDL/FCPXML export. Provider generation fails closed (see :func:`apply_generate).
"""

from __future__ import annotations

import random
import math
from fractions import Fraction
from pathlib import Path
from datetime import datetime, timezone
from typing import Any

from . import pack as pack_mod
from . import schema, timeline

__all__ = ["ProviderDisabledError", "apply_local", "apply_generate", "plan_shots"]

_DEFAULT_FPS = 24.0
_MIN_SHOT = 0.05  # matches the recovered cadence floor


class ProviderDisabledError(RuntimeError):
    """Provider generation was requested but is not authorized."""


_FAIL_CLOSED = (
    "provider generation requires explicit separately authorized execution; "
    "this package ships no provider adapters and performs no network calls. "
    "Use apply_local() (deterministic, offline) instead."
)


def _utc_now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _positive(value: Any, label: str) -> float:
    if isinstance(value, bool):
        raise ValueError(f"{label} must be finite and positive")
    try:
        number = float(value)
    except (TypeError, ValueError, OverflowError) as exc:
        raise ValueError(f"{label} must be finite and positive") from exc
    if not math.isfinite(number) or number <= 0:
        raise ValueError(f"{label} must be finite and positive")
    return number


def _strict_assign(
    planned: list[float], media: list[dict[str, Any]], target: float, fps: float
) -> list[tuple[dict[str, Any], int]]:
    """Fill the target frame count, then match whole shots to unique sources."""
    target_frames = timeline.seconds_to_frames(target, fps)
    if target_frames < 1:
        raise ValueError("target duration must contain at least one frame")
    frame_counts = []
    elapsed = 0.0
    assigned = 0
    for duration in planned:
        if assigned == target_frames:
            break
        elapsed += duration
        boundary = min(target_frames, timeline.seconds_to_frames(elapsed, fps))
        if boundary <= assigned:
            raise ValueError("cadence shot cannot occupy a whole frame")
        frame_counts.append(boundary - assigned)
        assigned = boundary
    if assigned < target_frames:
        frame_counts.append(target_frames - assigned)

    rate = timeline.fps_fraction(fps)
    sources: dict[str, tuple[dict[str, Any], int]] = {}
    for clip in media:
        path = str(Path(clip["path"]).expanduser().resolve())
        # Floor rational capacity: rounding up could read past the source end.
        capacity = math.floor(Fraction(str(clip["duration"])) * rate)
        # Accept a boundary serialized as a float only when the frame duration
        # itself compares within the supplied duration; no broad epsilon.
        if float((capacity + 1) / rate) <= clip["duration"]:
            capacity += 1
        if path in sources:
            raise ValueError("no-repeat media must contain unique normalized source paths")
        sources[path] = ({**clip, "path": path}, capacity)
    if len(sources) < len(frame_counts):
        raise ValueError("no-repeat plan requires more unique source clips")
    assignments = []
    for (clip, capacity), count in zip(sources.values(), frame_counts):
        if capacity < count:
            raise ValueError("source clip is too short for its no-repeat cadence slot")
        assignments.append((clip, count))
    return assignments



def plan_shots(cadence: dict[str, Any], target_duration: float) -> list[float]:
    """Propose shot durations filling ``target_duration`` at this cadence.

    Samples from the reference's own shot-length distribution (seeded, like
    the recovered ``Cadence.plan_shots``) so the plan inherits rhythm
    variance instead of flattening into evenly spaced clips.
    """
    target_duration = _positive(target_duration, "target duration")
    durations = [
        _positive(s["duration"], "cadence shot duration")
        for s in cadence.get("shots", [])
        if isinstance(s, dict) and _positive(s.get("duration"), "cadence shot duration") > _MIN_SHOT
    ]
    if not durations:
        if "mean_shot" not in cadence:
            raise ValueError("cadence has no measured shot durations to plan from")
        durations = [max(_positive(cadence.get("mean_shot"), "mean shot duration"), 1.0)]

    rng = random.Random(7)  # deterministic, mirrors numpy default_rng(7)
    out: list[float] = []
    acc = 0.0
    while acc < target_duration:
        d = rng.choice(durations)
        remaining = target_duration - acc
        if remaining < d * 0.5:
            break
        d = min(d, remaining)
        out.append(round(d, 3))
        acc += d
    if not out:
        out = [round(target_duration, 3)]
    return out


def apply_local(
    sp: pack_mod.StylePack,
    media: list[dict[str, Any]],
    duration: float | None = None,
    fps: float | None = None,
    no_repeat: bool = False,
) -> dict[str, Any]:
    """Plan a cut from the pack's cadence over local media clips.

    With ``no_repeat=True``, normalized source paths are used at most once;
    insufficient sources or source durations fail instead of repeating clips.
    Strict plans fill the nearest whole-frame target and never exceed source
    capacity. Media duration metadata must describe the available source.

    Returns an application report validated against
    ``schema.APPLICATION_REPORT_SCHEMA``. The report structurally cannot
    claim a provider run: ``provider`` is enum-locked to ``"none"`` and
    ``dry_run`` to ``true``.
    """
    if not media:
        raise ValueError("apply_local needs at least one media clip")

    if not sp.cadence_path.exists():
        raise ValueError("pack has no measured cadence (cadence.json is missing)")
    cadence = sp.read_json(sp.cadence_path)
    if not isinstance(cadence, dict) or not (cadence.get("shots") or "mean_shot" in cadence):
        raise ValueError("cadence.json has no measured shots to plan from")
    seq_fps = _positive(fps if fps is not None else cadence.get("fps", _DEFAULT_FPS), "fps")
    validated_media = []
    for clip in media:
        if not isinstance(clip, dict) or not isinstance(clip.get("path"), (str, Path)):
            raise ValueError("media clips require a local source path")
        if not str(clip["path"]).strip():
            raise ValueError("media clips require a local source path")
        validated_media.append({**clip, "duration": _positive(clip.get("duration"), "media duration")})
    target = _positive(duration if duration is not None else sum(
        c["duration"] for c in validated_media
    ), "target duration")
    planned = plan_shots(cadence, target)
    assignments = _strict_assign(planned, validated_media, target, seq_fps) if no_repeat else [
        (validated_media[i % len(validated_media)], max(1, timeline.seconds_to_frames(d, seq_fps)))
        for i, d in enumerate(planned)
    ]

    shots: list[dict[str, Any]] = []
    events: list[dict[str, Any]] = []
    clock = 0.0
    offset_frames = 0
    for i, (clip, frames) in enumerate(assignments):
        d = float(frames / timeline.fps_fraction(seq_fps)) if no_repeat else planned[i]
        clock = float(offset_frames / timeline.fps_fraction(seq_fps)) if no_repeat else clock
        events.append(
            {
                "path": str(clip["path"]),
                "name": str(clip.get("name") or clip["path"]),
                "duration": d if no_repeat else round(d, 3),
                "frames": frames,
                "offset_frames": offset_frames,
                "fps": seq_fps,
            }
        )
        shots.append(
            {
                "index": i,
                "start": clock if no_repeat else round(clock, 3),
                "end": (float((offset_frames + frames) / timeline.fps_fraction(seq_fps))
                        if no_repeat else round(clock + d, 3)),
                "duration": d if no_repeat else round(d, 3),
            }
        )
        clock += d
        offset_frames += frames

    report = {
        "schema_version": 1,
        "pack": sp.name,
        "generated": _utc_now(),
        "mode": "local-deterministic",
        "dry_run": True,
        "provider": "none",
        "target_duration": target if no_repeat else round(target, 3),
        "media": [
            {"path": str(c.get("path")), "duration": float(c.get("duration") or 0)}
            for c in validated_media
        ],
        "planned_shots": shots,
        "timeline_events": events,
        "cadence": {
            "mean_shot": cadence.get("mean_shot", 0.0),
            "rhythm_variance": cadence.get("rhythm_variance", 0.0),
            "cuts_per_min": cadence.get("cuts_per_min", 0.0),
        },
        "notes": [
            "shot durations drawn from the pack's measured cadence (seeded, "
            "deterministic); no provider generation was requested or run",
        ],
    }
    problems = schema.validate(report, schema.APPLICATION_REPORT_SCHEMA)
    if problems:
        raise ValueError(f"apply_local produced an invalid report: {problems}")
    return report


def apply_generate(
    sp: pack_mod.StylePack, brief: str, **_: Any
) -> dict[str, Any]:
    """Refuse provider generation. Fails closed, always."""
    raise ProviderDisabledError(_FAIL_CLOSED)
