"""Offline, hash-bound insert proposals that preserve a native timeline.

This validates local bytes and supplied metadata; it neither probes media nor
authenticates historical provider claims or human approval. Revalidate before
use. It never executes an insert, exports a timeline, or contacts a provider.
"""

from __future__ import annotations

import copy
import hashlib
import json
import math
import os
import re
import stat
from fractions import Fraction
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit


_REQUIRED = {"baseline", "source", "audio", "protected_intervals"}
_OPTIONAL = {"candidates", "inserts", "historical_receipts"}
_MAX_JSON = 8 * 1024 * 1024


def _canonical(value: Any) -> bytes:
    try:
        return json.dumps(value, sort_keys=True, separators=(",", ":"), allow_nan=False).encode()
    except (TypeError, ValueError, RecursionError) as exc:
        raise ValueError("bundle values must be finite JSON data") from exc


def _digest(value: Any) -> str:
    return hashlib.sha256(_canonical(value)).hexdigest()


def _object(value: Any, required: set[str], optional: set[str] | None = None) -> dict:
    if not isinstance(value, dict) or not required <= value.keys():
        raise ValueError("missing required bundle fields")
    if value.keys() - required - (optional or set()):
        raise ValueError("unknown bundle fields")
    return value


def _text(value: Any) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ValueError("nonempty text required")
    return value


def _integer(value: Any, minimum: int = 0) -> int:
    if type(value) is not int or value < minimum:
        raise ValueError("frame/count must be an exact integer in range")
    return value


def _rate(value: Any) -> tuple[int, int]:
    _object(value, {"numerator", "denominator"})
    n, d = (_integer(value[k], 1) for k in ("numerator", "denominator"))
    if math.gcd(n, d) != 1:
        raise ValueError("fps must be a reduced positive rational")
    return n, d


def _range(value: Any, bounds: list[int] | None = None) -> list[int]:
    if not isinstance(value, list) or len(value) != 2:
        raise ValueError("range must contain two frame integers")
    start, end = (_integer(v) for v in value)
    if start >= end or (bounds is not None and (start < bounds[0] or end > bounds[1])):
        raise ValueError("frame range is empty or outside its bounds")
    return value


def _overlap(a: list[int], b: list[int]) -> bool:
    return a[0] < b[1] and b[0] < a[1]


def _sha(value: Any) -> str:
    if not isinstance(value, str) or not re.fullmatch(r"[a-f0-9]{64}", value):
        raise ValueError("resolved SHA-256 required")
    return value


def _identity(info: os.stat_result) -> tuple:
    return (info.st_dev, info.st_ino, info.st_size, info.st_mtime_ns, info.st_ctime_ns)


def _artifact(record: Any, *, parse_json: bool = False) -> Any:
    """Read stable regular bytes without following links or hydrating cloud files."""
    _object(record, {"path", "bytes", "sha256"})
    return _read_local(_text(record["path"]), parse_json=parse_json,
                       expected_size=_integer(record["bytes"], 1),
                       expected_hash=_sha(record["sha256"]))


def _parent_fd(path: Path) -> int:
    flags = os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK | os.O_DIRECTORY
    parent = os.open(path.anchor, flags)
    try:
        for part in path.parts[1:-1]:
            child = os.open(part, flags, dir_fd=parent)
            os.close(parent)
            parent = child
        return parent
    except BaseException:
        os.close(parent)
        raise


def _read_local(raw: str, *, parse_json: bool, expected_size: int | None = None,
                expected_hash: str | None = None) -> Any:
    path = Path(raw)
    if not path.is_absolute() or str(path) != raw or ".." in path.parts:
        raise ValueError("artifact path must be canonical and absolute")
    parent = descriptor = None
    try:
        flags = os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK
        parent = _parent_fd(path)
        before = os.stat(path.name, dir_fd=parent, follow_symlinks=False)
        if not stat.S_ISREG(before.st_mode) or getattr(before, "st_flags", 0) & 0x40000000:
            raise ValueError("artifact must be a resident regular file")
        if expected_size is None:
            expected_size = before.st_size
        if parse_json and expected_size > _MAX_JSON:
            raise ValueError("JSON artifact exceeds local size limit")
        if before.st_size != expected_size:
            raise ValueError("artifact byte count mismatch")
        descriptor = os.open(path.name, flags, dir_fd=parent)
        if _identity(before) != _identity(os.fstat(descriptor)):
            raise ValueError("artifact changed before reading")
        digest, chunks, count = hashlib.sha256(), [], 0
        while data := os.read(descriptor, 65536):
            count += len(data)
            if count > expected_size:
                raise ValueError("artifact byte count exceeded during reading")
            digest.update(data)
            if parse_json:
                chunks.append(data)
        # Rewalk the named path: a pinned old directory fd can outlive a rename.
        fresh_parent = _parent_fd(path)
        try:
            after = os.stat(path.name, dir_fd=fresh_parent, follow_symlinks=False)
        finally:
            os.close(fresh_parent)
        if (_identity(before) != _identity(os.fstat(descriptor))
                or _identity(before) != _identity(after)):
            raise ValueError("artifact changed during reading")
        if expected_hash is not None and digest.hexdigest() != expected_hash:
            raise ValueError("artifact SHA-256 mismatch")
        return _load_json(b"".join(chunks)) if parse_json else None
    except (OSError, AttributeError) as exc:
        raise ValueError("local artifact unavailable or unsafe") from exc
    finally:
        if descriptor is not None:
            os.close(descriptor)
        if parent is not None:
            os.close(parent)


def load_application_request(path: str | Path) -> dict:
    """Load only a bounded resident request; never follow a config symlink."""
    value = _read_local(str(Path(path).absolute()), parse_json=True)
    if not isinstance(value, dict):
        raise ValueError("application request must be a JSON object")
    return value


def _load_json(data: bytes) -> Any:
    def unique(pairs):
        result = {}
        for key, value in pairs:
            if key in result:
                raise ValueError("duplicate JSON field")
            result[key] = value
        return result

    try:
        value = json.loads(data, object_pairs_hook=unique)
        _canonical(value)
        return value
    except (UnicodeError, RecursionError) as exc:
        raise ValueError("invalid JSON artifact") from exc


def _snapshot(baseline: dict) -> dict:
    _object(baseline, {"project_file", "snapshot_file", "project_name", "timeline_name",
                       "fps", "timeline_range"})
    _rate(baseline["fps"])
    bounds = _range(baseline["timeline_range"])
    _artifact(baseline["project_file"])
    snapshot = _artifact(baseline["snapshot_file"], parse_json=True)
    if not isinstance(snapshot, dict):
        raise ValueError("native snapshot must be an object")
    settings = snapshot.get("settings")
    native_fps = settings.get("timelineFrameRate") if isinstance(settings, dict) else None
    # Resolve's conventional decimal NTSC labels represent these exact rates.
    ntsc = {"23.976": "24000/1001", "29.97": "30000/1001", "59.94": "60000/1001"}
    try:
        if type(native_fps) not in (str, int, float):
            raise ValueError("native fps missing")
        label = str(native_fps)
        if not re.fullmatch(r"[0-9]{1,9}(?:\.[0-9]{1,12}|/[1-9][0-9]{0,8})?", label):
            raise ValueError("native fps must use a bounded decimal or rational label")
        native_rate = Fraction(ntsc.get(label, label))
        if native_rate != Fraction(*_rate(baseline["fps"])):
            raise ValueError("native fps differs")
    except (ValueError, ZeroDivisionError) as exc:
        raise ValueError("native snapshot fps is missing, invalid or contradictory") from exc
    for cfg, key in [("project_name", "project"), ("timeline_name", "timeline")]:
        if _text(baseline[cfg]) != snapshot.get(key):
            raise ValueError("native snapshot identity mismatch")
    tracks = snapshot.get("timeline_readback")
    if not isinstance(tracks, dict) or not tracks:
        raise ValueError("native clip snapshot required")
    for track, clips in tracks.items():
        if not re.fullmatch(r"(?:video|audio)[1-9][0-9]*", track) or not isinstance(clips, list):
            raise ValueError("invalid native snapshot track")
        for clip in clips:
            _check_clip(clip, bounds)
    return tracks


def _check_clip(clip: Any, bounds: list[int]) -> None:
    required = {"path", "name", "start", "end", "left_offset", "right_offset", "enabled", "properties"}
    if not isinstance(clip, dict) or not required <= clip.keys():
        raise ValueError("native snapshot clip is incomplete")
    _range([clip["start"], clip["end"]], bounds)
    _integer(clip["left_offset"])
    _integer(clip["right_offset"])
    if clip["path"] is not None:
        _text(clip["path"])
    _text(clip["name"])
    if type(clip["enabled"]) is not bool or not isinstance(clip["properties"], dict):
        raise ValueError("native clip state is incomplete")


def _binding(item: Any, tracks: dict, baseline: dict, *, audio: bool = False) -> tuple:
    _object(item, {"media", "track", "clip_index", "media_frames", "fps",
                   "source_range", "timeline_range"})
    track, index = _text(item["track"]), _integer(item["clip_index"])
    if not track.startswith("audio" if audio else "video"):
        raise ValueError("wrong source/audio track kind")
    if track not in tracks or index >= len(tracks[track]):
        raise ValueError("source binding has no native clip")
    clip = tracks[track][index]
    _artifact(item["media"])
    if item["media"]["path"] != clip["path"]:
        raise ValueError("source path does not match native clip")
    if _rate(item["fps"]) != _rate(baseline["fps"]):
        raise ValueError("source fps/retime ambiguity")
    duration = clip["end"] - clip["start"]
    capacity = _integer(item["media_frames"], 1)
    if capacity != clip["left_offset"] + duration + clip["right_offset"]:
        raise ValueError("source capacity does not match native offsets")
    source = _range(item["source_range"], [clip["left_offset"], clip["left_offset"] + duration])
    target = _range(item["timeline_range"], [clip["start"], clip["end"]])
    mapped = [clip["start"] + f - clip["left_offset"] for f in source]
    if mapped != target or (audio and target != [clip["start"], clip["end"]]):
        raise ValueError("source/audio placement must preserve native timing")
    return track, index


def _preserved_stack(protected: Any, tracks: dict, bounds: list[int]) -> list[dict]:
    if not isinstance(protected, list) or not protected:
        raise ValueError("protected intervals must be explicit and nonempty")
    for item in protected:
        _object(item, {"range", "reason"})
        _range(item["range"], bounds)
        _text(item["reason"])
        if not any(_overlap(item["range"], [c["start"], c["end"]])
                   for key, clips in tracks.items() if key.startswith("video") for c in clips):
            raise ValueError("protected interval has no original video stack")
    return [{"track": track, "clip_index": index, "clip": copy.deepcopy(clip),
             "clip_sha256": _digest(clip)}
            for track, clips in sorted(tracks.items()) for index, clip in enumerate(clips)
            if any(_overlap(p["range"], [clip["start"], clip["end"]]) for p in protected)]


def _candidates(items: list, source_hash: str, input_hash: str, source_url: str) -> dict:
    result = {}
    for item in items:
        _object(item, {"id", "media", "media_frames", "fps", "origin", "relationship",
                       "source_sha256", "compiled_input_sha256", "review_status", "generation_receipt"})
        name = _text(item["id"])
        if name in result:
            raise ValueError("candidate ids must be unique")
        _artifact(item["media"])
        _integer(item["media_frames"], 1)
        _rate(item["fps"])
        if item["origin"] != "provider_generated" or item["relationship"] != "generated_variation":
            raise ValueError("a generated candidate cannot claim original-source identity")
        if item["source_sha256"] != source_hash or item["compiled_input_sha256"] != input_hash:
            raise ValueError("candidate is bound to a different source or input")
        if item["review_status"] not in ("pending", "rejected", "approved"):
            raise ValueError("explicit candidate review state required")
        evidence = _artifact(item["generation_receipt"], parse_json=True)
        if not isinstance(evidence, dict) or not isinstance(evidence.get("request_id"), str):
            raise ValueError("historical request evidence required")
        _text(evidence["request_id"])
        expected = {"source_sha256": source_hash, "compiled_input_sha256": input_hash,
                    "candidate_sha256": item["media"]["sha256"], "source_url": source_url}
        if any(evidence.get(key) != value for key, value in expected.items()):
            raise ValueError("historical evidence does not bind the candidate source/input/bytes")
        result[name] = item
    return result


def _inserts(items: list, candidates: dict, config: dict, input_hash: str, edit_hash: str) -> None:
    occupied = []
    for item in items:
        _object(item, {"candidate_id", "candidate_range", "timeline_range", "retime", "approval_file"})
        candidate = candidates.get(_text(item["candidate_id"]))
        if candidate is None or candidate["review_status"] != "approved":
            raise ValueError("insert requires an approved, resolved candidate")
        target = _range(item["timeline_range"], config["baseline"]["timeline_range"])
        source = _range(item["candidate_range"], [0, candidate["media_frames"]])
        if any(_overlap(target, p["range"]) for p in config["protected_intervals"]):
            raise ValueError("insert overlaps protected original stack")
        if any(_overlap(target, span) for span in occupied):
            raise ValueError("insert proposals overlap")
        if (item["retime"] != "none" or target[1] - target[0] != source[1] - source[0]
                or _rate(candidate["fps"]) != _rate(config["baseline"]["fps"])):
            raise ValueError("candidate fps/duration/retime ambiguity")
        evidence = _artifact(item["approval_file"], parse_json=True)
        expected = {"status": "approved", "candidate_sha256": candidate["media"]["sha256"],
                    "source_sha256": config["source"]["media"]["sha256"],
                    "compiled_input_sha256": input_hash,
                    "edit_context_sha256": edit_hash,
                    "candidate_range": source, "timeline_range": target}
        if not isinstance(evidence, dict) or any(
                _canonical(evidence.get(key)) != _canonical(value) for key, value in expected.items()):
            raise ValueError("approval evidence must bind exact source, candidate and placement")
        occupied.append(target)


def build_application_bundle(config: dict, compiled_input: dict | None, *, local_only: bool = False) -> dict:
    """Validate resident evidence and return a new deterministic, offline bundle."""
    if type(local_only) is not bool:
        raise ValueError("local_only must be an exact boolean")
    _object(config, _REQUIRED, _OPTIONAL)
    if len(_canonical(config)) > _MAX_JSON:
        raise ValueError("application config exceeds local size limit")
    if local_only:
        if compiled_input is not None:
            raise ValueError("local-only preservation cannot accept provider input")
    else:
        _object(compiled_input, {"source_video", "compiled_prompt"})
        url = urlsplit(_text(compiled_input["source_video"]))
        if url.scheme != "https" or not url.hostname or url.username or url.password:
            raise ValueError("source reference must be HTTPS without embedded credentials")
        _text(compiled_input["compiled_prompt"])
    cfg = copy.deepcopy(config)
    for key in ("audio", "candidates", "inserts", "historical_receipts"):
        cfg.setdefault(key, [])
        if not isinstance(cfg[key], list):
            raise ValueError("bundle collections must be lists")
    if local_only and (cfg["candidates"] or cfg["inserts"]):
        raise ValueError("local-only preservation cannot contain candidates or inserts")
    tracks = _snapshot(cfg["baseline"])
    _binding(cfg["source"], tracks, cfg["baseline"])
    audio_keys = [_binding(item, tracks, cfg["baseline"], audio=True) for item in cfg["audio"]]
    expected_audio = {(t, i) for t, clips in tracks.items() if t.startswith("audio")
                      for i in range(len(clips))}
    if len(set(audio_keys)) != len(audio_keys) or set(audio_keys) != expected_audio:
        raise ValueError("every original audio clip must be preserved exactly once")
    stack = _preserved_stack(cfg["protected_intervals"], tracks, cfg["baseline"]["timeline_range"])
    input_hash = None if local_only else _digest(compiled_input)
    edit_hash = _digest({key: cfg[key] for key in _REQUIRED})
    if not local_only:
        candidates = _candidates(cfg["candidates"], cfg["source"]["media"]["sha256"],
                                 input_hash, compiled_input["source_video"])
        _inserts(cfg["inserts"], candidates, cfg, input_hash, edit_hash)
    for receipt in cfg["historical_receipts"]:
        _artifact(receipt)
    result = {**cfg, "schema_version": 1, "mode": "preserve_native_timeline",
              "provider_calls": 0, "provider_execution": False, "dry_run": True, "submit": False,
              "provider_input": copy.deepcopy(compiled_input), "compiled_input_sha256": input_hash,
              "edit_context_sha256": edit_hash,
              "protected_stack": stack, "insert_policy": "new_video_track_preserve_baseline_audio",
              "evidence_scope": "verified_local_bytes_and_supplied_metadata_only"}
    if local_only:
        result = {**result, "local_only": True, "provider_input_status": "not_prepared_local_only",
                  "insert_policy": "none_preserve_baseline"}
    return {**result, "bundle_sha256": _digest(result)}


def validate_application_bundle(bundle: dict) -> None:
    """Recheck all files, derived state and exact flags; no mutation or execution."""
    if not isinstance(bundle, dict) or not (_REQUIRED | _OPTIONAL | {"provider_input"}) <= bundle.keys():
        raise ValueError("incomplete application bundle")
    cfg = {key: bundle[key] for key in _REQUIRED | _OPTIONAL}
    expected = build_application_bundle(cfg, bundle["provider_input"],
                                        local_only=bundle.get("local_only", False))
    if _canonical(bundle) != _canonical(expected):
        raise ValueError("application bundle differs from its bound evidence")
