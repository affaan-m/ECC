"""Validated overlay placement using injected Resolve objects, without connecting.

The caller selects a versioned target timeline, saves a pre-edit project backup,
then supplies its timeline and media pool. Failures raise without a completion
receipt; partial edits may remain and must be discarded/restored by the caller.
Composite values are explicit API integers, never guessed blend-mode names.
"""

from __future__ import annotations

import copy
import json
import math
import subprocess
from fractions import Fraction
from pathlib import Path

from .timeline import fps_fraction


def _integer(value, label, minimum=0):
    if isinstance(value, bool) or not isinstance(value, int) or value < minimum:
        raise ValueError(f"{label} must be an integer >= {minimum}")
    return value


def _fps(value):
    if isinstance(value, bool):
        raise ValueError("fps must be finite and positive")
    try:
        number = float(Fraction(str(value)))
        if not math.isfinite(number) or number <= 0:
            raise ValueError("fps must be finite and positive")
        return fps_fraction(number)
    except (TypeError, ZeroDivisionError, OverflowError) as exc:
        raise ValueError("invalid fps") from exc


def probe_asset(path):
    """Count decoded video frames; never infer source length from duration."""
    result = subprocess.run(
        [
            "ffprobe",
            "-v",
            "error",
            "-select_streams",
            "v:0",
            "-count_frames",
            "-show_entries",
            "stream=avg_frame_rate,r_frame_rate,nb_read_frames,pix_fmt",
            "-of",
            "json",
            str(path),
        ],
        capture_output=True,
        text=True,
        check=True,
        timeout=120,
    )
    streams = json.loads(result.stdout).get("streams", [])
    if len(streams) != 1:
        raise ValueError(f"asset must contain a video stream: {path}")
    stream = streams[0]
    average = _fps(stream["avg_frame_rate"])
    if average != _fps(stream["r_frame_rate"]):
        raise ValueError(f"variable or ambiguous frame rate: {path}")
    pixel_format = stream.get("pix_fmt", "")
    alpha = pixel_format.startswith(("yuva", "gbrap")) or pixel_format in {
        "rgba",
        "bgra",
        "argb",
        "abgr",
        "rgba64be",
        "rgba64le",
        "bgra64be",
        "bgra64le",
        "ya8",
        "ya16be",
        "ya16le",
    }
    return {
        "fps": str(average),
        "frames": int(stream["nb_read_frames"]),
        "has_alpha": alpha,
    }


def allocate_placements(placements, *, fps, base_track_count, probe=probe_asset):
    """Validate assets and interval-color overlays above preserved video tracks.

    record_frame is an absolute timeline frame; intervals are [start, end).
    Optional requires_alpha=True enforces a decoded alpha-capable pixel format.
    """
    rate = _fps(fps)
    _integer(base_track_count, "base_track_count")
    checked, seen, metadata = [], set(), {}
    for event in placements:
        identifier = event.get("id")
        if not isinstance(identifier, str) or not identifier or identifier in seen:
            raise ValueError("placement id must be unique and nonempty")
        seen.add(identifier)
        start = _integer(event.get("record_frame"), "record_frame")
        frames = _integer(event.get("frames"), "frames", 1)
        opacity = event.get("opacity")
        if (
            isinstance(opacity, bool)
            or not isinstance(opacity, (int, float))
            or not math.isfinite(opacity)
            or not 0 <= opacity <= 100
        ):
            raise ValueError("explicit opacity must be finite within 0..100")
        composite = _integer(event.get("composite"), "composite")
        raw_asset = event.get("asset")
        if not isinstance(raw_asset, (str, Path)) or not str(raw_asset):
            raise ValueError("asset must be a local regular file")
        asset = Path(raw_asset).expanduser().resolve()
        if not asset.is_file():
            raise ValueError(f"asset must be a local regular file: {asset}")
        alpha = event.get("requires_alpha", False)
        if not isinstance(alpha, bool):
            raise ValueError("requires_alpha must be boolean")
        key = str(asset)
        if key not in metadata:
            metadata[key] = probe(asset)
        info = metadata[key]
        if _fps(info.get("fps")) != rate:
            raise ValueError(f"asset fps differs from timeline: {asset}")
        if _integer(info.get("frames"), "asset frames", 1) < frames:
            raise ValueError(f"asset contains too few frames: {asset}")
        if alpha and info.get("has_alpha") is not True:
            raise ValueError(f"asset requires verified alpha: {asset}")
        checked.append(
            {
                "id": identifier,
                "asset": key,
                "record_frame": start,
                "frames": frames,
                "opacity": opacity,
                "composite": composite,
            }
        )
    if not checked:
        raise ValueError("at least one placement is required")
    ends, allocated = [], {}
    for event in sorted(checked, key=lambda entry: entry["record_frame"]):
        index = next(
            (i for i, end in enumerate(ends) if end <= event["record_frame"]), len(ends)
        )
        if index == len(ends):
            ends.append(0)
        ends[index] = event["record_frame"] + event["frames"]
        allocated[event["id"]] = {**event, "track": base_track_count + index + 1}
    return [allocated[event["id"]] for event in checked]


def _path(item):
    media = item.GetMediaPoolItem()
    raw = media.GetClipProperty("File Path") if media else None
    return str(Path(raw).expanduser().resolve()) if raw else None


def _items(timeline, kind, track):
    items = timeline.GetItemListInTrack(kind, track)
    if items is None:
        raise RuntimeError(f"could not read {kind} track {track}")
    return items


def _base_snapshot(timeline, base_track_count):
    snapshot = {}
    for kind, count in [
        ("video", base_track_count),
        ("audio", timeline.GetTrackCount("audio")),
    ]:
        for track in range(1, count + 1):
            snapshot[f"{kind}:{track}"] = [
                {
                    "start": item.GetStart(),
                    "end": item.GetEnd(),
                    "duration": item.GetDuration(),
                    "enabled": item.GetClipEnabled(),
                    "path": _path(item),
                    "properties": copy.deepcopy(item.GetProperty()),
                }
                for item in _items(timeline, kind, track)
            ]
    return snapshot


def _readback(timeline, item, event):
    track = event["track"]
    members = _items(timeline, "video", track)

    # API wrappers can be recreated on each call, so verify track membership by
    # stable unique id when available; test doubles may use object identity.
    def identity(candidate):
        method = getattr(candidate, "GetUniqueId", None)
        return method() if callable(method) else id(candidate)

    item_id = identity(item)
    if item_id is None:
        raise RuntimeError("Resolve returned an item without an identity")
    matches = [member for member in members if identity(member) == item_id]
    if len(matches) != 1:
        raise RuntimeError(f"placement {event['id']} missing from requested track")
    item = matches[0]
    actual = {
        "start": item.GetStart(),
        "end": item.GetEnd(),
        "duration": item.GetDuration(),
        "enabled": item.GetClipEnabled(),
        "track": track,
        "opacity": item.GetProperty("Opacity"),
        "composite": item.GetProperty("CompositeMode"),
        "path": _path(item),
    }
    expected = {
        "start": event["record_frame"],
        "end": event["record_frame"] + event["frames"],
        "duration": event["frames"],
        "enabled": True,
        "track": track,
        "opacity": event["opacity"],
        "composite": event["composite"],
        "path": event["asset"],
    }
    if actual != expected:
        raise RuntimeError(f"placement {event['id']} readback mismatch: {actual!r}")
    return actual


def apply_placements(
    timeline,
    media_pool,
    placements,
    *,
    source_timeline,
    source_end_mode,
    fps,
    base_track_count,
    probe=probe_asset,
):
    """Append and verify overlays; returns an in-memory placement receipt only.

    This does not save/export/render a project. Supply the selected target's
    media pool. Existing overlay tracks must be empty; base tracks are preserved.
    source_end_mode is required: use the endpoint convention verified on this
    Resolve host. No automatic retry occurs if that convention is incorrect.
    """
    if source_end_mode not in ("inclusive", "exclusive"):
        raise ValueError("source_end_mode must be inclusive or exclusive")
    if not isinstance(source_timeline, str) or not source_timeline:
        raise ValueError("source_timeline must be explicit")
    name = timeline.GetName()
    if not name or name == source_timeline:
        raise ValueError("target must be a distinct versioned timeline")
    plan = allocate_placements(
        placements, fps=fps, base_track_count=base_track_count, probe=probe
    )
    if _fps(timeline.GetSetting("timelineFrameRate")) != _fps(fps):
        raise ValueError("target timeline fps mismatch")
    count = timeline.GetTrackCount("video")
    if count < base_track_count:
        raise ValueError("base_track_count exceeds target video tracks")
    for track in range(base_track_count + 1, count + 1):
        if _items(timeline, "video", track):
            raise ValueError("target overlay tracks must be empty")
    before = _base_snapshot(timeline, base_track_count)
    for _ in range(count, max(event["track"] for event in plan)):
        old_count = timeline.GetTrackCount("video")
        if (
            not timeline.AddTrack("video")
            or timeline.GetTrackCount("video") != old_count + 1
        ):
            raise RuntimeError("could not create overlay track")
    appended = []
    for event in plan:
        imported = media_pool.ImportMedia([event["asset"]])
        if not imported or len(imported) != 1:
            raise RuntimeError(f"could not import {event['asset']}")
        items = media_pool.AppendToTimeline(
            [
                {
                    "mediaPoolItem": imported[0],
                    "startFrame": 0,
                    "endFrame": event["frames"] - (source_end_mode == "inclusive"),
                    "mediaType": 1,
                    "trackIndex": event["track"],
                    "recordFrame": event["record_frame"],
                }
            ]
        )
        if not items or len(items) != 1:
            raise RuntimeError(f"could not append {event['id']}")
        item = items[0]
        for key, value in [
            ("Opacity", event["opacity"]),
            ("CompositeMode", event["composite"]),
        ]:
            if not item.SetProperty(key, value):
                raise RuntimeError(f"could not set {key} for {event['id']}")
        _readback(timeline, item, event)
        appended.append((event, item))
    receipts = []
    for event, item in appended:
        actual = _readback(timeline, item, event)
        receipts.append(
            {
                "id": event["id"],
                "asset": event["asset"],
                "requested": {
                    key: event[key]
                    for key in (
                        "record_frame",
                        "frames",
                        "track",
                        "opacity",
                        "composite",
                    )
                },
                "actual": actual,
            }
        )
    for track in range(base_track_count + 1, timeline.GetTrackCount("video") + 1):
        if len(_items(timeline, "video", track)) != sum(
            e["track"] == track for e in plan
        ):
            raise RuntimeError("unexpected overlay items after append")
    if before != _base_snapshot(timeline, base_track_count):
        raise RuntimeError("base tracks changed during overlay placement")
    return {
        "timeline": name,
        "source_timeline": source_timeline,
        "source_end_mode": source_end_mode,
        "base_track_count": base_track_count,
        "fps": float(_fps(fps)),
        "placements": receipts,
        "preservation": {"base_tracks_match": True},
    }
