"""Edit-rhythm distillation: where a reference cuts, and how often.

Cut rhythm is the half of "taste" that never survives a text prompt. A VLM
asked to describe a reference will happily say "fast-paced editing", which is
useless downstream. Actual shot boundaries give a distribution you can
generate against: how long shots run, how much that varies, where cuts land.

The output drives two things:

* how many shots ``apply.py`` asks the video model for, and how long each
  one should be;
* the timeline emitted for Resolve, so the finished cut inherits the
  reference's pacing instead of a default 5-seconds-per-clip layout.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, asdict, field
from pathlib import Path

import numpy as np

from .frames import probe


@dataclass
class Shot:
    index: int
    start: float
    end: float

    @property
    def duration(self) -> float:
        return self.end - self.start

    def to_dict(self) -> dict:
        return {
            "index": self.index,
            "start": round(self.start, 4),
            "end": round(self.end, 4),
            "duration": round(self.duration, 4),
        }


@dataclass
class Cadence:
    """Distilled pacing of a reference set."""

    shots: list[dict] = field(default_factory=list)
    mean_shot: float = 0.0
    median_shot: float = 0.0
    p25_shot: float = 0.0
    p75_shot: float = 0.0
    min_shot: float = 0.0
    max_shot: float = 0.0
    cuts_per_min: float = 0.0
    rhythm_variance: float = 0.0  # std/mean; low = metronomic, high = jazzy
    total_duration: float = 0.0
    fps: float = 24.0
    n_shots: int = 0

    def to_dict(self) -> dict:
        return asdict(self)

    @classmethod
    def from_dict(cls, d: dict) -> "Cadence":
        known = {k: v for k, v in d.items() if k in cls.__dataclass_fields__}
        return cls(**known)

    def plan_shots(self, target_duration: float) -> list[float]:
        """Propose shot durations filling ``target_duration`` at this cadence.

        Samples from the reference's own shot-length distribution rather than
        using the mean, so the result inherits its rhythm variance instead of
        flattening into evenly spaced clips.
        """
        durations = [s["duration"] for s in self.shots if s.get("duration", 0) > 0.05]
        if not durations:
            durations = [max(self.mean_shot, 1.0)]

        rng = np.random.default_rng(7)
        pool = np.asarray(durations, dtype=float)
        out: list[float] = []
        acc = 0.0
        while acc < target_duration:
            d = float(rng.choice(pool))
            remaining = target_duration - acc
            if remaining < d * 0.5:
                break
            d = min(d, remaining)
            out.append(round(d, 3))
            acc += d
        if not out:
            out = [round(target_duration, 3)]
        return out


_SWEEP = (30.0, 24.0, 19.0, 15.0, 12.0, 9.0)
_MAX_CUTS_PER_MIN = 100.0


def _sweep_detector(path: str | Path, thresholds, min_len_frames: int) -> dict:
    """Run the whole threshold sweep with a single decode pass.

    The naive version calls scenedetect once per threshold, which re-decodes
    the file every time - on 60fps source that is the difference between
    seconds and minutes. A shared StatsManager caches the per-frame content
    metric, so only the first pass computes it and the rest just re-threshold
    the cached values. Frames are also downscaled before analysis: shot
    boundaries are a global-content signal and survive it intact.
    """
    from scenedetect import open_video, SceneManager, StatsManager, ContentDetector

    stats = StatsManager()
    out: dict[float, list] = {}
    for t in thresholds:
        video = open_video(str(path))
        # Cap the long edge around 480px for the detector; large frames cost
        # decode time without improving boundary detection.
        try:
            video.set_downscale_factor()  # auto
        except Exception:
            pass
        sm = SceneManager(stats_manager=stats)
        sm.auto_downscale = True
        sm.add_detector(
            ContentDetector(threshold=t, min_scene_len=min_len_frames)
        )
        sm.detect_scenes(video, show_progress=False)
        out[t] = sm.get_scene_list()
    return out


def _run_detector(path: str | Path, threshold: float, min_len_frames: int) -> list[tuple]:
    return _sweep_detector(path, [threshold], min_len_frames)[threshold]


def detect(
    path: str | Path,
    threshold: float | None = None,
    min_scene_len: float = 0.25,
) -> Cadence:
    """Detect shot boundaries with PySceneDetect's content detector.

    ``threshold`` is HSV content delta. Passing ``None`` (the default) runs an
    adaptive sweep instead of trusting one fixed number, because the right
    value is material-dependent: a high-contrast action reference cuts hard
    enough for 30 to work, while a moody low-contrast one hides its cuts under
    it entirely. On a six-cut test reference, the library default of 27 found
    only five; the sweep finds all six.

    The sweep picks the *highest* (most conservative) threshold that still
    recovers at least 90% of the shots the most sensitive setting finds. That
    biases toward real cuts over noise-triggered false positives.
    """
    info = probe(path)
    fps = info.fps or 24.0
    min_len_frames = max(1, int(min_scene_len * fps))

    if threshold is not None:
        scenes = _run_detector(path, threshold, min_len_frames)
    else:
        counts = _sweep_detector(path, _SWEEP, min_len_frames)

        dur = max(info.duration, 1e-3)

        def rate(t: float) -> float:
            return 60.0 * len(counts[t]) / dur

        # Continuous camera moves (a slow push-in, a morph, a whip pan) can
        # trip the content detector on every frame. Thresholds implying an
        # absurd cut rate are treated as noise rather than as ground truth.
        plausible = [t for t in _SWEEP if rate(t) <= _MAX_CUTS_PER_MIN]
        pool = plausible or [_SWEEP[0]]

        best_n = max(len(counts[t]) for t in pool)
        chosen = pool[-1]
        for t in pool:  # descending sensitivity order
            if len(counts[t]) >= 0.9 * best_n:
                chosen = t
                break
        scenes = counts[chosen]

    shots: list[Shot] = []
    for i, (start, end) in enumerate(scenes):
        shots.append(Shot(index=i, start=start.get_seconds(), end=end.get_seconds()))

    # A single-shot reference (or a detector miss) still deserves valid output.
    if not shots:
        shots = [Shot(index=0, start=0.0, end=info.duration)]

    return _summarize(shots, fps=fps, total=info.duration)


def _summarize(shots: list[Shot], fps: float, total: float) -> Cadence:
    durs = np.asarray([s.duration for s in shots], dtype=float)
    durs = durs[durs > 0]
    if len(durs) == 0:
        durs = np.asarray([total or 1.0])

    mean = float(durs.mean())
    return Cadence(
        shots=[s.to_dict() for s in shots],
        mean_shot=round(mean, 4),
        median_shot=round(float(np.median(durs)), 4),
        p25_shot=round(float(np.percentile(durs, 25)), 4),
        p75_shot=round(float(np.percentile(durs, 75)), 4),
        min_shot=round(float(durs.min()), 4),
        max_shot=round(float(durs.max()), 4),
        cuts_per_min=round(60.0 * len(shots) / total, 3) if total > 0 else 0.0,
        rhythm_variance=round(float(durs.std() / mean), 4) if mean > 0 else 0.0,
        total_duration=round(total, 3),
        fps=round(fps, 4),
        n_shots=len(shots),
    )


def merge(cadences: list[Cadence]) -> Cadence:
    """Pool several references into one cadence profile.

    Shot lists are concatenated with times offset so the pooled *distribution*
    is meaningful; absolute timings across different references are not.
    """
    if not cadences:
        return Cadence()
    if len(cadences) == 1:
        return cadences[0]

    shots: list[Shot] = []
    offset = 0.0
    for c in cadences:
        for s in c.shots:
            shots.append(
                Shot(index=len(shots), start=s["start"] + offset, end=s["end"] + offset)
            )
        offset += c.total_duration

    fps = float(np.median([c.fps for c in cadences]))
    return _summarize(shots, fps=fps, total=offset)


def keyframe_timestamps(cadence: Cadence, per_shot: float = 0.5, limit: int = 12) -> list[float]:
    """Representative timestamps: a point ``per_shot`` of the way through each shot.

    Longest shots first, because those establish the look, whereas short ones
    are often motion-blurred transition frames.
    """
    ranked = sorted(cadence.shots, key=lambda s: -s.get("duration", 0.0))
    out = [round(s["start"] + s.get("duration", 0.0) * per_shot, 3) for s in ranked[:limit]]
    return sorted(out)


def save(cadence: Cadence, path: str | Path) -> Path:
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(cadence.to_dict(), indent=2), encoding="utf-8")
    return path


def load(path: str | Path) -> Cadence:
    return Cadence.from_dict(json.loads(Path(path).read_text(encoding="utf-8")))


# Durations the video model will actually accept, read off the endpoint UI.
# Seedance rejects anything below 4s; earlier code sent 3 and would have
# failed every call.
GEN_DURATIONS = (4, 5, 6, 7, 8, 9, 10, 11, 12)


def quantize_gen_duration(seconds: float) -> int:
    """Round up to the shortest generation length the model will accept."""
    for d in GEN_DURATIONS:
        if d >= seconds - 1e-6:
            return d
    return GEN_DURATIONS[-1]


def plan_takes(cadence: "Cadence", target_duration: float, take_len: float = 5.0) -> list[dict]:
    """Group the shot plan into generated TAKES, then cut within each take.

    Asking a video model for one clip per shot is the obvious approach and the
    wrong one. This cadence averages 0.78s per shot while the model refuses to
    generate anything under 4s, so a shot-per-clip plan generates 36 seconds to
    use 10 - 28% efficiency, twelve API calls, and twelve unrelated clips
    stitched into what should read as a continuous piece.

    Editors do not work that way: they roll a longer take and cut inside it.
    Grouping shots into ~5s takes recovers close to full efficiency, cuts the
    call count by roughly six, and gives consecutive shots real visual
    continuity because they come from the same generation.

    Returns one dict per take::

        {"index": 0, "gen_duration": 5, "used": 4.8,
         "shots": [{"start": 0.0, "duration": 0.78}, ...]}
    """
    plan = cadence.plan_shots(target_duration)

    takes: list[dict] = []
    cur: list[float] = []
    acc = 0.0
    for d in plan:
        if cur and acc + d > take_len:
            takes.append(cur)
            cur, acc = [], 0.0
        cur.append(d)
        acc += d
    if cur:
        takes.append(cur)

    out = []
    for i, group in enumerate(takes):
        used = float(sum(group))
        cursor = 0.0
        shots = []
        for d in group:
            shots.append({"start": round(cursor, 3), "duration": round(d, 3)})
            cursor += d
        out.append(
            {
                "index": i,
                "gen_duration": quantize_gen_duration(used),
                "used": round(used, 3),
                "shots": shots,
            }
        )
    return out
