"""Editable timeline emission: the distilled cut rhythm, handed to a real NLE.

A style pack knows *where a reference cuts* (``cadence.py``) and *what it looks
like* (``grade.py`` / ``look.cube``). Neither survives as a rendered mp4 - the
moment you hand someone a flat file, the pacing becomes unnegotiable and the
grade becomes baked. This module closes that gap by writing the cut list out as
a project file, so the rhythm arrives in DaVinci Resolve / Premiere / Final Cut
as *editable events* that a human can still push around.

Two formats, deliberately:

* **FCPXML** - the rich one. Carries per-clip source references, frame-exact
  offsets, and format metadata. DaVinci Resolve imports it directly
  (File > Import > Timeline).
* **EDL (CMX3600)** - the dumb, universal one. No media references, just
  timecode. It is the fallback that works when FCPXML round-tripping does not.

The single most important detail in here is time representation. **FCPXML
times are rational strings, not decimal seconds.** ``"1001/30000s"`` is one
frame at 29.97; ``"1.001s"`` is a rounding error waiting to desync a timeline.
Every time value written by this module goes through :func:`seconds_to_rational`
or :func:`frames_to_rational`, which quantise to whole frames at the sequence
timebase and emit an exact reduced fraction. Durations are accumulated in
*integer frames*, never in floats, so the sequence duration is exactly the sum
of its clips no matter how long the timeline runs.

Self-check::

    python3 taste/timeline.py

Deliberately stdlib-only, so it can be run as a script without dragging in the
numpy/opencv half of the package.
"""

from __future__ import annotations

import xml.etree.ElementTree as ET
from fractions import Fraction
from pathlib import Path
from typing import Iterable, Sequence
from xml.dom import minidom

__all__ = [
    "fps_fraction",
    "frame_duration",
    "seconds_to_frames",
    "frames_to_rational",
    "seconds_to_rational",
    "frames_to_timecode",
    "build_fcpxml",
    "build_edl",
    "write_timeline",
]

# ---------------------------------------------------------------------------
# timebase
# ---------------------------------------------------------------------------

# NTSC-family rates are *not* the decimals people write them as. 29.97 is
# exactly 30000/1001, and a timeline built on the decimal drifts by ~3.6s per
# hour. Anything within this tolerance of a known NTSC rate snaps to the exact
# fraction; everything else is taken at face value.
_NTSC: dict[float, Fraction] = {
    23.976: Fraction(24000, 1001),
    29.97: Fraction(30000, 1001),
    47.952: Fraction(48000, 1001),
    59.94: Fraction(60000, 1001),
    119.88: Fraction(120000, 1001),
}
_NTSC_TOL = 0.02

# CMX3600 signals drop-frame with the `FCM:` header line rather than with the
# timecode separator; some houses also swap ':' for ';'. We emit the spec form
# (FCM header, ':' separators) because that is what Resolve's EDL parser keys on.
EDL_DROP_SEPARATOR = ":"


def fps_fraction(fps: float | Fraction) -> Fraction:
    """Exact frame rate as a :class:`Fraction`, snapping NTSC decimals.

    >>> fps_fraction(29.97)
    Fraction(30000, 1001)
    >>> fps_fraction(24)
    Fraction(24, 1)
    """
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
    """Quantise ``seconds`` to the nearest whole frame at ``fps``.

    Rounds half away from zero rather than using banker's rounding, so a clip
    asked for at exactly half a frame does not silently vanish.
    """
    f = fps_fraction(fps)
    exact = Fraction(float(seconds)).limit_denominator(1_000_000) * f
    floor = exact.numerator // exact.denominator
    rem = exact - floor
    return int(floor + (1 if rem >= Fraction(1, 2) else 0))


def frames_to_rational(frames: int, fps: float | Fraction) -> str:
    """Whole frames -> an FCPXML time string, e.g. ``"1001/30000s"``.

    The value is ``frames * frame_duration`` reduced to lowest terms. FCPXML
    accepts a bare integer form for whole seconds (``"5s"``), which is what
    Fraction reduction naturally produces when the denominator collapses to 1.

    >>> frames_to_rational(1, 29.97)
    '1001/30000s'
    >>> frames_to_rational(30, 29.97)
    '1001/1000s'
    >>> frames_to_rational(120, 24)
    '5s'
    """
    value = Fraction(int(frames), 1) * frame_duration(fps)
    if value.denominator == 1:
        return f"{value.numerator}s"
    return f"{value.numerator}/{value.denominator}s"


def seconds_to_rational(seconds: float, fps: float | Fraction) -> str:
    """Seconds -> a frame-quantised FCPXML rational time string.

    This is the function that keeps Resolve happy. Writing ``"2.5s"`` where a
    rational is expected either fails validation outright or silently re-times
    the import; writing ``"60/24s"`` does not.

    >>> seconds_to_rational(2.5, 24)
    '5/2s'
    >>> seconds_to_rational(1.0, 29.97)
    '30030/30000s'  # doctest: +SKIP
    """
    return frames_to_rational(seconds_to_frames(seconds, fps), fps)


def _is_drop_frame(fps: float | Fraction) -> bool:
    """Drop-frame applies to the 30/60-family NTSC rates, not to 23.976."""
    f = fps_fraction(fps)
    return f in (Fraction(30000, 1001), Fraction(60000, 1001))


def frames_to_timecode(
    frames: int, fps: float | Fraction, drop: bool | None = None
) -> str:
    """Whole frames -> ``HH:MM:SS:FF`` timecode.

    ``drop`` defaults to auto: on for 29.97 and 59.94, off everywhere else.
    Drop-frame skips frame *numbers* (never actual frames) at the top of every
    minute except every tenth, which is what keeps 29.97 timecode agreeing with
    a wall clock.

    >>> frames_to_timecode(1800, 29.97)
    '00:01:00:02'
    >>> frames_to_timecode(17982, 29.97)
    '00:10:00:00'
    >>> frames_to_timecode(24, 24)
    '00:00:01:00'
    """
    frames = int(frames)
    if drop is None:
        drop = _is_drop_frame(fps)
    rate = int(round(float(fps_fraction(fps))))

    if drop:
        dropped = int(round(float(fps_fraction(fps)) * 0.066666))  # 2 @ 29.97, 4 @ 59.94
        per_10min = int(round(float(fps_fraction(fps)) * 600))     # 17982 @ 29.97
        per_min = rate * 60 - dropped                              # 1798  @ 29.97
        tens, rem = divmod(frames, per_10min)
        if rem > dropped:
            frames += dropped * 9 * tens + dropped * ((rem - dropped) // per_min)
        else:
            frames += dropped * 9 * tens
        sep = EDL_DROP_SEPARATOR
    else:
        sep = ":"

    ff = frames % rate
    total_s = frames // rate
    ss = total_s % 60
    mm = (total_s // 60) % 60
    hh = (total_s // 3600) % 24
    return f"{hh:02d}:{mm:02d}:{ss:02d}{sep}{ff:02d}"


# ---------------------------------------------------------------------------
# clip normalisation
# ---------------------------------------------------------------------------


def _normalise(clips: Iterable[dict], fps: float | Fraction) -> list[dict]:
    """Validate clips and pre-compute integer frame counts and offsets.

    Returns dicts with ``path``, ``name``, ``frames`` (int, >= 1) and
    ``offset_frames`` (int). Working in frames from here down is what makes the
    sequence duration exactly the sum of the clip durations.
    """
    out: list[dict] = []
    offset = 0
    for i, c in enumerate(clips):
        path = str(c.get("path") or "")
        if not path:
            raise ValueError(f"clip {i} has no 'path'")
        dur = float(c.get("duration") or 0.0)
        if dur <= 0:
            raise ValueError(f"clip {i} ({path}) has non-positive duration {dur!r}")
        frames = max(1, seconds_to_frames(dur, fps))  # never emit a zero-length event
        name = str(c.get("name") or Path(path).stem)
        out.append(
            {
                "path": path,
                "name": name,
                "frames": frames,
                "offset_frames": offset,
                "seconds": dur,
            }
        )
        offset += frames
    if not out:
        raise ValueError("no clips to write - a timeline needs at least one event")
    return out


def _file_uri(path: str) -> str:
    """Absolute ``file://`` URI. Works for paths that do not exist yet."""
    p = Path(path)
    if not p.is_absolute():
        p = Path.cwd() / p
    # as_uri() percent-escapes correctly; normalise away '..' without resolving
    # symlinks or requiring the file to exist.
    return Path(str(p)).absolute().as_uri()


def _format_name(width: int, height: int, fps: float | Fraction) -> str:
    f = fps_fraction(fps)
    rate = float(f)
    label = f"{rate:.2f}".rstrip("0").rstrip(".").replace(".", "")
    return f"FFVideoFormat{height}p{label}"


# ---------------------------------------------------------------------------
# FCPXML
# ---------------------------------------------------------------------------


def build_fcpxml(
    clips: Sequence[dict],
    fps: float = 24.0,
    title: str = "taste-forge",
    width: int = 1920,
    height: int = 1080,
    version: str = "1.9",
) -> str:
    """Build an FCPXML 1.9 document for ``clips``.

    Each clip is ``{"path": str, "duration": float, "name": str}``.

    Document shape (this is what Resolve's importer walks)::

        <fcpxml version="1.9">
          <resources>
            <format id="r0" frameDuration="1/24s" width= height=/>
            <asset id="r1" hasVideo="1" format="r0" duration="...">
              <media-rep kind="original-media" src="file:///..."/>
            </asset>
          </resources>
          <library>
            <event><project><sequence format="r0"><spine>
              <asset-clip ref="r1" offset= duration= start=/>
            </spine></sequence></project></event>
          </library>
        </fcpxml>

    ``offset`` is the clip's position on the timeline, ``start`` is its in-point
    inside the source media (0 here - we always take from the head of each
    generated clip), and ``duration`` is the same on both the asset and the
    asset-clip because each generated clip is used whole.
    """
    items = _normalise(clips, fps)
    total_frames = sum(c["frames"] for c in items)
    fd = frame_duration(fps)

    fcpxml = ET.Element("fcpxml", {"version": version})
    resources = ET.SubElement(fcpxml, "resources")

    fmt_id = "r0"
    ET.SubElement(
        resources,
        "format",
        {
            "id": fmt_id,
            "name": _format_name(width, height, fps),
            "frameDuration": f"{fd.numerator}/{fd.denominator}s"
            if fd.denominator != 1
            else f"{fd.numerator}s",
            "width": str(int(width)),
            "height": str(int(height)),
            "colorSpace": "1-1-1 (Rec. 709)",
        },
    )

    for i, c in enumerate(items):
        asset_id = f"r{i + 1}"
        c["asset_id"] = asset_id
        asset = ET.SubElement(
            resources,
            "asset",
            {
                "id": asset_id,
                "name": c["name"],
                # uid must be stable per source so re-imports relink instead of
                # duplicating media in the pool.
                "uid": f"{title}-{i:04d}",
                "start": "0s",
                "duration": frames_to_rational(c["frames"], fps),
                "hasVideo": "1",
                "videoSources": "1",
                "format": fmt_id,
            },
        )
        ET.SubElement(
            asset,
            "media-rep",
            {"kind": "original-media", "src": _file_uri(c["path"])},
        )

    library = ET.SubElement(fcpxml, "library")
    event = ET.SubElement(library, "event", {"name": title})
    project = ET.SubElement(event, "project", {"name": title})
    sequence = ET.SubElement(
        project,
        "sequence",
        {
            "format": fmt_id,
            "duration": frames_to_rational(total_frames, fps),
            "tcStart": "0s",
            "tcFormat": "DF" if _is_drop_frame(fps) else "NDF",
            "audioLayout": "stereo",
            "audioRate": "48k",
        },
    )
    spine = ET.SubElement(sequence, "spine")

    for c in items:
        ET.SubElement(
            spine,
            "asset-clip",
            {
                "ref": c["asset_id"],
                "offset": frames_to_rational(c["offset_frames"], fps),
                "name": c["name"],
                "start": "0s",
                "duration": frames_to_rational(c["frames"], fps),
                "format": fmt_id,
                "tcFormat": "DF" if _is_drop_frame(fps) else "NDF",
            },
        )

    raw = ET.tostring(fcpxml, encoding="unicode")
    pretty = minidom.parseString(raw).documentElement.toprettyxml(indent="    ")
    return (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        "<!DOCTYPE fcpxml>\n" + pretty.rstrip() + "\n"
    )


# ---------------------------------------------------------------------------
# EDL (CMX3600)
# ---------------------------------------------------------------------------


def build_edl(
    clips: Sequence[dict],
    fps: float = 24.0,
    title: str = "taste-forge",
    reel: str = "AX",
) -> str:
    """Build a CMX3600 EDL - the fallback when FCPXML round-tripping fails.

    An EDL carries no media references, only cut points, so the importing NLE
    has to relink by clip name. That is a real downgrade, which is exactly why
    FCPXML is the default; but every NLE ever made reads a CMX3600.

    Column layout is the fixed-width classic: event number, reel, channel,
    transition, then source-in / source-out / record-in / record-out.
    """
    items = _normalise(clips, fps)
    drop = _is_drop_frame(fps)

    lines = [
        f"TITLE: {title.upper()}",
        f"FCM: {'DROP FRAME' if drop else 'NON-DROP FRAME'}",
        "",
    ]
    for i, c in enumerate(items):
        src_in = frames_to_timecode(0, fps, drop)
        src_out = frames_to_timecode(c["frames"], fps, drop)
        rec_in = frames_to_timecode(c["offset_frames"], fps, drop)
        rec_out = frames_to_timecode(c["offset_frames"] + c["frames"], fps, drop)
        lines.append(
            f"{i + 1:03d}  {reel:<9}{'V':<6}{'C':<9}"
            f"{src_in} {src_out} {rec_in} {rec_out}"
        )
        lines.append(f"* FROM CLIP NAME: {Path(c['path']).name}")
        lines.append("")
    return "\n".join(lines).rstrip() + "\n"


# ---------------------------------------------------------------------------
# entry point
# ---------------------------------------------------------------------------


def write_timeline(
    clips: Sequence[dict],
    fps: float,
    out_path: str | Path,
    fmt: str = "fcpxml",
    title: str | None = None,
    width: int = 1920,
    height: int = 1080,
) -> Path:
    """Write ``clips`` to ``out_path`` as ``fcpxml`` or ``edl``. Returns the path."""
    out_path = Path(out_path)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    name = title or out_path.stem

    fmt = fmt.lower().lstrip(".")
    if fmt == "fcpxml":
        text = build_fcpxml(clips, fps=fps, title=name, width=width, height=height)
    elif fmt == "edl":
        text = build_edl(clips, fps=fps, title=name)
    else:
        raise ValueError(f"unknown timeline format {fmt!r} - use 'fcpxml' or 'edl'")

    out_path.write_text(text, encoding="utf-8")
    return out_path


# ---------------------------------------------------------------------------
# self-check
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    import tempfile

    # --- rational arithmetic, the part that breaks imports when wrong --------
    assert fps_fraction(29.97) == Fraction(30000, 1001)
    assert fps_fraction(23.976) == Fraction(24000, 1001)
    assert fps_fraction(24) == Fraction(24, 1)
    assert frames_to_rational(1, 29.97) == "1001/30000s", frames_to_rational(1, 29.97)
    assert frames_to_rational(0, 24) == "0s"
    assert frames_to_rational(120, 24) == "5s"
    assert frames_to_rational(60, 24) == "5/2s"
    assert seconds_to_rational(2.5, 24) == "5/2s"
    # one second at 29.97 is 30 frames = 30 * 1001/30000 = 30030/30000 = 1001/1000
    assert seconds_to_rational(1.0, 29.97) == "1001/1000s", seconds_to_rational(1.0, 29.97)
    # a rational time is always an exact multiple of the frame duration
    for f in (23.976, 24, 25, 29.97, 30, 59.94, 60):
        for n in (0, 1, 7, 1000):
            s = frames_to_rational(n, f)
            num, den = s.rstrip("s").split("/") if "/" in s else (s.rstrip("s"), "1")
            assert Fraction(int(num), int(den)) == n * frame_duration(f)

    # --- timecode -----------------------------------------------------------
    assert frames_to_timecode(24, 24) == "00:00:01:00"
    assert frames_to_timecode(0, 24) == "00:00:00:00"
    # frame 1799 is the last of the first minute; 1800 skips labels ;00 and ;01
    assert frames_to_timecode(1799, 29.97) == "00:00:59:29"
    assert frames_to_timecode(1800, 29.97) == "00:01:00:02"   # drop-frame skip
    assert frames_to_timecode(17982, 29.97) == "00:10:00:00"  # tenth minute, no skip
    assert frames_to_timecode(1800, 30, drop=False) == "00:01:00:00"

    # --- a real five-clip timeline ------------------------------------------
    FPS = 23.976
    durations = [1.4167, 0.8333, 2.125, 1.2917, 3.125]  # flashethereal-ish cadence
    clips = [
        {"path": f"/tmp/taste_forge_shot_{i:02d}.mp4", "duration": d, "name": f"shot_{i:02d}"}
        for i, d in enumerate(durations)
    ]

    xml_text = build_fcpxml(clips, fps=FPS, title="selfcheck", width=1920, height=1080)

    root = ET.fromstring(xml_text)  # parses => well-formed
    assert root.tag == "fcpxml" and root.get("version") == "1.9"
    assets = root.findall("./resources/asset")
    assert len(assets) == 5, len(assets)
    assert all(a.get("hasVideo") == "1" and a.get("format") == "r0" for a in assets)
    assert len(root.findall("./resources/asset/media-rep")) == 5

    seq = root.find("./library/event/project/sequence")
    assert seq is not None
    spine_clips = seq.findall("./spine/asset-clip")
    assert len(spine_clips) == 5

    def _sec(t: str) -> Fraction:
        t = t.rstrip("s")
        return Fraction(*(int(x) for x in t.split("/"))) if "/" in t else Fraction(int(t))

    # total duration == sum of clip durations, exactly (integer-frame accumulation)
    summed = sum(_sec(c.get("duration")) for c in spine_clips)
    assert _sec(seq.get("duration")) == summed, (seq.get("duration"), summed)

    # offsets are contiguous: each clip starts where the previous one ended
    running = Fraction(0)
    for c in spine_clips:
        assert _sec(c.get("offset")) == running, (c.get("offset"), running)
        assert c.get("start") == "0s"
        running += _sec(c.get("duration"))
    assert running == summed

    # and it still tracks the float durations we asked for, to within half a frame
    fd = frame_duration(FPS)
    assert abs(float(summed) - sum(durations)) <= float(fd) * len(durations) / 2

    # --- EDL ----------------------------------------------------------------
    edl = build_edl(clips, fps=FPS, title="selfcheck")
    assert edl.startswith("TITLE: SELFCHECK")
    assert "FCM: NON-DROP FRAME" in edl
    edl_events = [ln for ln in edl.splitlines() if ln[:3].isdigit()]
    assert len(edl_events) == 5, edl_events
    last_rec_out = edl_events[-1].split()[-1]
    assert last_rec_out == frames_to_timecode(
        sum(seconds_to_frames(d, FPS) for d in durations), FPS
    ), last_rec_out

    # --- round-trip through write_timeline ----------------------------------
    with tempfile.TemporaryDirectory() as td:
        p1 = write_timeline(clips, FPS, Path(td) / "sc.fcpxml", "fcpxml")
        p2 = write_timeline(clips, FPS, Path(td) / "sc.edl", "edl")
        ET.parse(p1)
        assert p2.read_text(encoding="utf-8").startswith("TITLE:")

    print("timeline self-check OK")
    print(f"  5 clips @ {FPS} fps ({fps_fraction(FPS)})")
    print(f"  frame duration      : {frame_duration(FPS).numerator}/"
          f"{frame_duration(FPS).denominator}s")
    print(f"  sequence duration   : {seq.get('duration')}  "
          f"({float(summed):.4f}s, requested {sum(durations):.4f}s)")
    print(f"  1 frame @ 29.97     : {frames_to_rational(1, 29.97)}")
    print(f"  last EDL record out : {last_rec_out}")
