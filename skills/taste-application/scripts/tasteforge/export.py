"""Editable timeline export: CMX3600 EDL and FCPXML 1.9.

Canonicalized from the recovered gen4 ``taste/timeline.py``. The pack knows
where a reference cuts and what it looks like; these formats carry that
rhythm into DaVinci Resolve / Premiere / Final Cut as *editable events*.

* FCPXML - rich: per-clip source refs, frame-exact rational offsets.
* EDL (CMX3600) - universal: timecode only, relink by clip name.

All times flow through :mod:`tasteforge.timeline`; durations accumulate in
integer frames so the sequence is exactly the sum of its clips.
"""

from __future__ import annotations

import re
import xml.etree.ElementTree as ET
from fractions import Fraction
from pathlib import Path
from typing import Iterable, Sequence
from xml.dom import minidom

from .timeline import (
    frame_duration,
    frames_to_rational,
    frames_to_timecode,
    fps_fraction,
    seconds_to_frames,
)

__all__ = [
    "normalise_clips",
    "build_edl",
    "build_fcpxml",
    "parse_edl",
    "write_timeline",
]


# ---------------------------------------------------------------------------
# clip normalisation
# ---------------------------------------------------------------------------

def normalise_clips(clips: Iterable[dict], fps: float | Fraction) -> list[dict]:
    """Validate clips and pre-compute integer frame counts and offsets.

    Each clip is ``{"path": str, "duration": float, "name": str?}``.
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
        frames = max(1, seconds_to_frames(dur, fps))  # never a zero-length event
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
    p = Path(path)
    if not p.is_absolute():
        p = Path.cwd() / p
    return Path(str(p)).absolute().as_uri()


def _format_name(width: int, height: int, fps: float | Fraction) -> str:
    f = fps_fraction(fps)
    rate = float(f)
    label = f"{rate:.2f}".rstrip("0").rstrip(".").replace(".", "")
    return f"FFVideoFormat{height}p{label}"


def _is_drop_frame(fps: float | Fraction) -> bool:
    f = fps_fraction(fps)
    return f in (Fraction(30000, 1001), Fraction(60000, 1001))


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
    """Build an FCPXML 1.9 document for ``clips``."""
    items = normalise_clips(clips, fps)
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
            "frameDuration": (
                f"{fd.numerator}s" if fd.denominator == 1
                else f"{fd.numerator}/{fd.denominator}s"
            ),
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
                # Stable uid so re-imports relink instead of duplicating media.
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
            },
        )

    raw = ET.tostring(fcpxml, encoding="unicode")
    document = minidom.parseString(raw)
    root_el = document.documentElement
    assert root_el is not None  # parsed from a fresh serialized element
    pretty = root_el.toprettyxml(indent="    ")
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
    """Build a CMX3600 EDL: event number, reel, channel, transition, 4 TCs."""
    items = normalise_clips(clips, fps)
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
# EDL parsing (round-trip validation)
# ---------------------------------------------------------------------------

_TC_RE = re.compile(r"^(\d{2}):(\d{2}):(\d{2})[:;](\d{2})$")
_EVENT_RE = re.compile(
    r"^(\d+)\s+(\S+)\s+V\s+C\s+"
    r"(\d{2}:\d{2}:\d{2}[:;]\d{2})\s+"
    r"(\d{2}:\d{2}:\d{2}[:;]\d{2})\s+"
    r"(\d{2}:\d{2}:\d{2}[:;]\d{2})\s+"
    r"(\d{2}:\d{2}:\d{2}[:;]\d{2})\s*$"
)


def _tc_to_frames(tc: str, fps: float | Fraction, drop: bool) -> int:
    m = _TC_RE.match(tc)
    if not m:
        raise ValueError(f"bad timecode {tc!r}")
    hh, mm, ss, ff = (int(g) for g in m.groups())
    rate = int(round(float(fps_fraction(fps))))
    displayed = (hh * 3600 + mm * 60 + ss) * rate + ff
    if drop:
        dropped = int(round(float(fps_fraction(fps)) * 0.066666))
        total_minutes = hh * 60 + mm
        # Skipped frame numbers before this TC: 2/min except every 10th min.
        skipped = dropped * (total_minutes - total_minutes // 10)
        return displayed - skipped
    return displayed


def parse_edl(text: str, fps: float = 24.0) -> list[dict]:
    """Parse a CMX3600 EDL back into structured events (round-trip check)."""
    drop = "FCM: DROP FRAME" in text
    events: list[dict] = []
    for line in text.splitlines():
        m = _EVENT_RE.match(line)
        if not m:
            continue
        number = int(m.group(1))
        rec_in = _tc_to_frames(m.group(5), fps, drop)
        rec_out = _tc_to_frames(m.group(6), fps, drop)
        events.append(
            {
                "number": number,
                "reel": m.group(2),
                "src_in": _tc_to_frames(m.group(3), fps, drop),
                "src_out": _tc_to_frames(m.group(4), fps, drop),
                "record_in": rec_in,
                "record_out": rec_out,
                "duration_frames": rec_out - rec_in,
            }
        )
    names = re.findall(r"^\* FROM CLIP NAME: (.+)$", text, re.MULTILINE)
    for event, name in zip(events, names):
        event["name"] = name
    return events


# ---------------------------------------------------------------------------
# entry point
# ---------------------------------------------------------------------------

def write_timeline(
    clips: Sequence[dict],
    out_dir: str | Path,
    fps: float = 24.0,
    title: str = "taste-forge",
    width: int = 1920,
    height: int = 1080,
) -> tuple[Path, Path]:
    """Write ``<title>.edl`` and ``<title>.fcpxml`` into ``out_dir``."""
    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    edl_path = out_dir / f"{title}.edl"
    fcpxml_path = out_dir / f"{title}.fcpxml"
    edl_path.write_text(build_edl(clips, fps=fps, title=title), encoding="utf-8")
    fcpxml_path.write_text(
        build_fcpxml(clips, fps=fps, title=title, width=width, height=height),
        encoding="utf-8",
    )
    return edl_path, fcpxml_path
