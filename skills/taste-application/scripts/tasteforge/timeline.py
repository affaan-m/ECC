"""Frame-exact timebase for timelines: rational time, NTSC snap, timecode.

Canonicalized from the recovered gen4 ``taste/timeline.py`` (stdlib-only
there, stdlib-only here). The invariant that matters: FCPXML times are
*rational strings*, never decimal seconds, and durations are accumulated in
integer frames so a sequence is exactly the sum of its clips.
"""

from __future__ import annotations

from fractions import Fraction

__all__ = [
    "fps_fraction",
    "frame_duration",
    "seconds_to_frames",
    "frames_to_rational",
    "seconds_to_rational",
    "frames_to_timecode",
]

# 29.97 is exactly 30000/1001; a decimal timebase drifts ~3.6s/hour.
_NTSC: dict[float, Fraction] = {
    23.976: Fraction(24000, 1001),
    29.97: Fraction(30000, 1001),
    47.952: Fraction(48000, 1001),
    59.94: Fraction(60000, 1001),
    119.88: Fraction(120000, 1001),
}
_NTSC_TOL = 0.02


def fps_fraction(fps: float | Fraction) -> Fraction:
    """Exact frame rate as a Fraction, snapping NTSC-family decimals."""
    if isinstance(fps, Fraction):
        return fps
    fps = float(fps)
    if fps <= 0:
        raise ValueError(f"fps must be positive, got {fps!r}")
    for nominal, exact in _NTSC.items():
        if abs(fps - nominal) < _NTSC_TOL:
            return exact
    if abs(fps - round(fps)) < 1e-9:
        return Fraction(int(round(fps)), 1)
    return Fraction(fps).limit_denominator(100000)


def frame_duration(fps: float | Fraction) -> Fraction:
    """Duration of one frame, in seconds, as an exact fraction."""
    return 1 / fps_fraction(fps)


def seconds_to_frames(seconds: float, fps: float | Fraction) -> int:
    """Quantise seconds to whole frames, rounding half away from zero."""
    f = fps_fraction(fps)
    exact = Fraction(float(seconds)).limit_denominator(1_000_000) * f
    floor = exact.numerator // exact.denominator
    rem = exact - floor
    return int(floor + (1 if rem >= Fraction(1, 2) else 0))


def frames_to_rational(frames: int, fps: float | Fraction) -> str:
    """Whole frames -> an FCPXML rational time string, e.g. ``1001/30000s``."""
    value = Fraction(int(frames), 1) * frame_duration(fps)
    if value.denominator == 1:
        return f"{value.numerator}s"
    return f"{value.numerator}/{value.denominator}s"


def seconds_to_rational(seconds: float, fps: float | Fraction) -> str:
    """Seconds -> a frame-quantised FCPXML rational time string."""
    return frames_to_rational(seconds_to_frames(seconds, fps), fps)


def _is_drop_frame(fps: float | Fraction) -> bool:
    f = fps_fraction(fps)
    return f in (Fraction(30000, 1001), Fraction(60000, 1001))


def frames_to_timecode(
    frames: int, fps: float | Fraction, drop: bool | None = None
) -> str:
    """Whole frames -> ``HH:MM:SS:FF`` timecode (CMX3600 ':' separator)."""
    frames = int(frames)
    if drop is None:
        drop = _is_drop_frame(fps)
    rate = int(round(float(fps_fraction(fps))))

    if drop:
        dropped = int(round(float(fps_fraction(fps)) * 0.066666))  # 2 @ 29.97
        per_10min = int(round(float(fps_fraction(fps)) * 600))    # 17982 @ 29.97
        per_min = rate * 60 - dropped                             # 1798 @ 29.97
        tens, rem = divmod(frames, per_10min)
        if rem > dropped:
            frames += dropped * 9 * tens + dropped * ((rem - dropped) // per_min)
        else:
            frames += dropped * 9 * tens

    ff = frames % rate
    total_s = frames // rate
    ss = total_s % 60
    mm = (total_s // 60) % 60
    hh = (total_s // 3600) % 24
    return f"{hh:02d}:{mm:02d}:{ss:02d}:{ff:02d}"
