"""File-driven, multimodal TasteForge dry-run orchestration.

The workflow reads one JSON contract, hashes and probes every local reference,
keeps each numbered genre separate, and writes provider request manifests. It
never imports or calls a provider SDK.
"""

from __future__ import annotations

import hashlib
import json
import math
import os
import random
import re
import secrets
import shutil
import stat
import statistics
import subprocess
import tempfile
from collections.abc import Callable
from pathlib import Path
from typing import Any, cast

Probe = Callable[[Path], dict[str, Any]]
_MODALITIES = ("image", "video", "3d_asset")


class MediaToolUnavailable(RuntimeError):
    """A required local media executable is unavailable."""


def _canonical_bytes(value: Any) -> bytes:
    return json.dumps(value, sort_keys=True, separators=(",", ":")).encode("utf-8")


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _hash_descriptor(descriptor: int) -> tuple[int, str]:
    os.lseek(descriptor, 0, os.SEEK_SET)
    digest = hashlib.sha256()
    total = 0
    while True:
        chunk = os.read(descriptor, 1024 * 1024)
        if not chunk:
            break
        total += len(chunk)
        digest.update(chunk)
    return total, digest.hexdigest()


def _stable_probe(path: Path, probe: Probe) -> tuple[dict[str, Any], int, str]:
    """Probe a private snapshot while binding the digest to one stable source object."""
    if not hasattr(os, "O_NOFOLLOW"):
        raise ValueError("stable source probing requires O_NOFOLLOW")
    descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    try:
        before = os.fstat(descriptor)
        if not stat.S_ISREG(before.st_mode):
            raise ValueError("reference source must be a regular file")
        with tempfile.TemporaryDirectory(prefix="tasteforge-source-") as temporary:
            snapshot = Path(temporary) / f"source{path.suffix}"
            snapshot_fd = os.open(
                snapshot, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600
            )
            try:
                os.lseek(descriptor, 0, os.SEEK_SET)
                digest = hashlib.sha256()
                total = 0
                while True:
                    chunk = os.read(descriptor, 1024 * 1024)
                    if not chunk:
                        break
                    total += len(chunk)
                    digest.update(chunk)
                    view = memoryview(chunk)
                    while view:
                        written = os.write(snapshot_fd, view)
                        if written <= 0:
                            raise ValueError("stable source snapshot write made no progress")
                        view = view[written:]
                os.fsync(snapshot_fd)
            finally:
                os.close(snapshot_fd)
            source_digest = digest.hexdigest()
            copied = os.fstat(descriptor)
            if (before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns) != (
                copied.st_dev, copied.st_ino, copied.st_size, copied.st_mtime_ns
            ):
                raise ValueError("reference source mutated while creating stable snapshot")
            verified_size, verified_digest = _hash_descriptor(descriptor)
            if verified_size != total or verified_digest != source_digest:
                raise ValueError("reference source mutated while creating stable snapshot")

            measured = probe(snapshot)

            after = os.fstat(descriptor)
            final_size, final_digest = _hash_descriptor(descriptor)
            if (before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns) != (
                after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns
            ) or final_size != total or final_digest != source_digest:
                raise ValueError("reference source mutated during media probing")
            rebound = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
            try:
                rebound_stat = os.fstat(rebound)
                if (rebound_stat.st_dev, rebound_stat.st_ino) != (before.st_dev, before.st_ino):
                    raise ValueError("reference source identity changed during media probing")
            finally:
                os.close(rebound)
            return measured, total, source_digest
    finally:
        os.close(descriptor)


def _finite_real(value: Any) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def _validate_probe(measured: dict[str, Any]) -> float:
    def require_finite_evidence(value: Any) -> None:
        if isinstance(value, bool):
            raise ValueError(  # noqa: TRY004 - one bounded invalid-media error family
                "reference probe numeric evidence must be finite real values"
            )
        if isinstance(value, (int, float)):
            if not math.isfinite(value):
                raise ValueError("reference probe numeric evidence must be finite real values")
        elif isinstance(value, dict):
            for nested in value.values():
                require_finite_evidence(nested)
        elif isinstance(value, list):
            for nested in value:
                require_finite_evidence(nested)

    require_finite_evidence(measured)
    duration = measured.get("duration")
    if not _finite_real(duration):
        raise ValueError("reference probe duration must be finite and positive")
    duration = cast(float, duration)
    if float(duration) <= 0:
        raise ValueError("reference probe duration must be finite and positive")
    for field in ("sample_times", "scene_changes"):
        values = measured.get(field, [])
        if not isinstance(values, list) or any(
            not _finite_real(value) or float(value) < 0 or float(value) > float(duration)
            for value in values
        ):
            raise ValueError(f"reference probe {field} must contain finite in-duration times")
    samples = measured.get("style_samples", [])
    if not isinstance(samples, list) or any(
        not isinstance(sample, dict)
        or not _finite_real(sample.get("time"))
        or float(cast(float, sample["time"])) < 0
        or float(cast(float, sample["time"])) > float(duration)
        for sample in samples
    ):
        raise ValueError("reference style evidence times must be finite and within duration")
    return float(duration)


class _SafeOutput:
    """Descriptor-bound output tree with no-follow traversal and atomic writes."""

    def __init__(self, root: Path) -> None:
        self._root_fd = -1
        if not hasattr(os, "O_NOFOLLOW") or not hasattr(os, "O_DIRECTORY"):
            raise RuntimeError("secure output requires O_NOFOLLOW and O_DIRECTORY")
        if root.exists() or root.is_symlink():
            metadata = root.lstat()
            if stat.S_ISLNK(metadata.st_mode):
                raise ValueError("output root must not be a symlink")
            if not stat.S_ISDIR(metadata.st_mode):
                raise ValueError("output root must be a directory")
        else:
            if not root.parent.is_dir():
                raise ValueError("output parent directory must already exist")
            root.mkdir(mode=0o700)
        self.root = root
        self._root_fd = os.open(root, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        self._written: list[str] = []

    def close(self) -> None:
        if self._root_fd >= 0:
            os.close(self._root_fd)
            self._root_fd = -1

    def __del__(self) -> None:
        self.close()

    def _open_dir(self, parts: tuple[str, ...], *, create: bool) -> int:
        current = os.dup(self._root_fd)
        try:
            for part in parts:
                if not part or part in {".", ".."} or "/" in part:
                    raise ValueError("output path contains an invalid component")
                try:
                    metadata = os.stat(part, dir_fd=current, follow_symlinks=False)
                except FileNotFoundError:
                    if not create:
                        raise ValueError(f"missing output directory: {part}") from None
                    os.mkdir(part, mode=0o700, dir_fd=current)
                    metadata = os.stat(part, dir_fd=current, follow_symlinks=False)
                if stat.S_ISLNK(metadata.st_mode):
                    raise ValueError(f"output directory must not be a symlink: {part}")
                if not stat.S_ISDIR(metadata.st_mode):
                    raise ValueError(f"output intermediate must be a directory: {part}")
                child = os.open(
                    part,
                    os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW,
                    dir_fd=current,
                )
                os.close(current)
                current = child
            return current
        except Exception:
            os.close(current)
            raise

    def prepare(self, directories: tuple[str, ...]) -> None:
        """Validate every known intermediate before the first artifact write."""
        opened: list[int] = []
        try:
            for directory in directories:
                opened.append(self._open_dir((directory,), create=True))
        finally:
            for descriptor in opened:
                os.close(descriptor)

    def write_json(self, relative: str, payload: Any) -> None:
        path = Path(relative)
        if path.is_absolute() or not path.name or any(part in {".", ".."} for part in path.parts):
            raise ValueError("artifact path must stay beneath output root")
        parent_fd = self._open_dir(tuple(path.parts[:-1]), create=False)
        temporary = f".{path.name}.tmp-{secrets.token_hex(8)}"
        descriptor = -1
        try:
            try:
                existing = os.stat(path.name, dir_fd=parent_fd, follow_symlinks=False)
            except FileNotFoundError:
                existing = None
            if existing is not None and not stat.S_ISREG(existing.st_mode):
                raise ValueError(f"output artifact must be a regular file: {relative}")
            data = json.dumps(payload, indent=2, sort_keys=True).encode("utf-8") + b"\n"
            descriptor = os.open(
                temporary,
                os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW,
                0o600,
                dir_fd=parent_fd,
            )
            view = memoryview(data)
            while view:
                written = os.write(descriptor, view)
                view = view[written:]
            os.fsync(descriptor)
            os.close(descriptor)
            descriptor = -1
            os.replace(temporary, path.name, src_dir_fd=parent_fd, dst_dir_fd=parent_fd)
            os.fsync(parent_fd)
            if relative not in self._written:
                self._written.append(relative)
        finally:
            if descriptor >= 0:
                os.close(descriptor)
            try:
                os.unlink(temporary, dir_fd=parent_fd)
            except FileNotFoundError:
                pass
            os.close(parent_fd)

    def artifact_paths(self) -> list[str]:
        return sorted(self._written)

    def artifact_metadata(self, relative: str) -> tuple[int, str]:
        path = Path(relative)
        parent_fd = self._open_dir(tuple(path.parts[:-1]), create=False)
        descriptor = -1
        try:
            descriptor = os.open(path.name, os.O_RDONLY | os.O_NOFOLLOW, dir_fd=parent_fd)
            metadata = os.fstat(descriptor)
            if not stat.S_ISREG(metadata.st_mode):
                raise ValueError(f"output artifact must be a regular file: {relative}")
            digest = hashlib.sha256()
            total = 0
            while True:
                chunk = os.read(descriptor, 1024 * 1024)
                if not chunk:
                    break
                total += len(chunk)
                digest.update(chunk)
            return total, digest.hexdigest()
        finally:
            if descriptor >= 0:
                os.close(descriptor)
            os.close(parent_fd)


def parse_feature_output(output: str, *, scene_threshold: float = 0.30) -> dict[str, Any]:
    """Parse ffmpeg ``metadata=print`` output into timestamped measurements."""
    records: list[dict[str, float]] = []
    current: dict[str, float] | None = None
    for raw_line in output.splitlines():
        line = raw_line.strip()
        match = re.search(r"pts_time:([-+0-9.eE]+)", line)
        if line.startswith("frame:") and match:
            if current:
                records.append(current)
            current = {"time": float(match.group(1))}
            continue
        if current is None or "=" not in line:
            continue
        key, value = line.rsplit("=", 1)
        mapped = {
            "lavfi.signalstats.YAVG": "luma_raw",
            "lavfi.signalstats.SATAVG": "saturation_raw",
            "lavfi.signalstats.HUEAVG": "hue",
            "lavfi.scene_score": "scene_score",
        }.get(key)
        if mapped:
            try:
                current[mapped] = float(value)
            except ValueError:
                pass
    if current:
        records.append(current)

    style_samples = []
    scene_changes = []
    for record in records:
        if "luma_raw" in record:
            style_samples.append({
                "time": round(record["time"], 6),
                "luma": round(record["luma_raw"] / 255.0, 6),
                "saturation": round(record.get("saturation_raw", 0.0) / 100.0, 6),
                "hue": record.get("hue"),
            })
        if record.get("scene_score", 0.0) >= scene_threshold:
            scene_changes.append(round(record["time"], 6))
    return {"style_samples": style_samples, "scene_changes": scene_changes}


def _run_ffmpeg_features(path: Path) -> dict[str, Any]:
    ffmpeg = shutil.which("ffmpeg")
    if not ffmpeg:
        raise MediaToolUnavailable("ffmpeg is required for temporal/style feature extraction")
    filters = (
        "scale=320:-2,"
        "select='not(mod(n\\,12))+gt(scene\\,0.30)',"
        "signalstats,metadata=print:file=-"
    )
    result = subprocess.run(
        [ffmpeg, "-v", "error", "-i", str(path), "-vf", filters,
         "-an", "-vsync", "0", "-f", "null", "-"],
        check=True,
        capture_output=True,
        text=True,
    )
    return parse_feature_output(result.stderr + "\n" + result.stdout)


def probe_media(path: Path) -> dict[str, Any]:
    """Probe local media and extract timestamped style/temporal features."""
    ffprobe = shutil.which("ffprobe")
    if not ffprobe:
        raise MediaToolUnavailable("ffprobe is required for reference probing")
    command = [
        ffprobe, "-v", "error", "-show_streams", "-show_format",
        "-of", "json", str(path),
    ]
    result = subprocess.run(command, check=True, capture_output=True, text=True)
    payload = json.loads(result.stdout)
    video: dict[str, Any] = next(
        (stream for stream in payload.get("streams", []) if stream.get("codec_type") == "video"),
        {},
    )
    duration = float(video.get("duration") or payload.get("format", {}).get("duration") or 0)
    rate = str(video.get("avg_frame_rate") or video.get("r_frame_rate") or "0/1")
    num, _, den = rate.partition("/")
    fps = float(num) / float(den or 1) if float(den or 1) else 0.0
    feature_data = _run_ffmpeg_features(path)
    measured_times = sorted({
        float(sample["time"]) for sample in feature_data["style_samples"]
    } | set(feature_data["scene_changes"]))
    sample_times = measured_times or [
        round(duration * fraction, 6) for fraction in (0.125, 0.375, 0.625, 0.875)
    ]
    return {
        "duration": duration,
        "width": int(video.get("width") or 0),
        "height": int(video.get("height") or 0),
        "fps": fps,
        "codec": str(video.get("codec_name") or "unknown"),
        "pixel_format": str(video.get("pix_fmt") or "unknown"),
        "color_space": str(video.get("color_space") or "unknown"),
        "sample_times": sample_times,
        "style_samples": feature_data["style_samples"],
        "scene_changes": feature_data["scene_changes"],
    }


def _prompt(modality: str, genre: dict[str, Any], features: dict[str, Any]) -> str:
    signature = genre["signature"]
    base = (
        f"Genre {genre['number']}: {genre['label']}. "
        f"Materials: {', '.join(signature['materials'])}. "
        f"Motion: {', '.join(signature['motion'])}. "
        f"Composition: {', '.join(signature['composition'])}. "
        f"Avoid: {', '.join(signature['avoid'])}. "
        f"Reference evidence: {features['reference_count']} file(s), "
        f"{features['total_duration']:.3f}s total."
    )
    suffix = {
        "image": " Create one still image with explicit subject placement and no temporal language.",
        "video": " Create a moving shot with camera motion and non-looping temporal progression.",
        "3d_asset": " Create a watertight textured 3D asset with front, side, and material consistency.",
    }[modality]
    return base + suffix


def _build_effect_recipe(
    config: dict[str, Any], specs: list[dict[str, Any]], references: list[dict[str, Any]]
) -> dict[str, Any]:
    """Build a deterministic, seeded, non-periodic Resolve placement plan."""
    seed = int(config["seed"])
    rng = random.Random(seed)
    by_genre = {
        spec["number"]: [ref for ref in references if ref["genre_number"] == spec["number"]]
        for spec in specs
    }
    configured_duration = config.get("resolve_duration")
    if configured_duration is not None and (
        not _finite_real(configured_duration) or float(configured_duration) <= 0
    ):
        raise ValueError("resolve_duration must be finite and positive")
    duration = float(configured_duration or sum(
        spec["measured_features"]["total_duration"] for spec in specs
    ))
    duration = max(duration, 6.0)
    effect_names = {
        "flash-ethereal": "bloom_flash",
        "3d-cyber-glitch": "cv_wireframe_lock",
        "fluid-sketch": "fluid_contour_bleed",
    }
    event_times: list[float] = []
    clock = round(rng.uniform(0.35, 0.75), 6)
    while clock <= duration - 0.08 and len(event_times) < 18:
        event_times.append(clock)
        clock = round(clock + rng.uniform(0.61, 2.17), 6)

    # Short timelines use deterministic, aperiodic fallback positions rather
    # than forcing later random draws beyond the declared duration.
    if len(event_times) < 4:
        event_times.extend(round(duration * fraction, 6) for fraction in (0.10, 0.28, 0.53, 0.82))
        event_times = sorted({time for time in event_times if 0 <= time <= duration - 0.08})[:18]
    if len(event_times) < 4:
        raise ValueError("timeline is too short for a fail-closed aperiodic effect schedule")

    events: list[dict[str, Any]] = []
    for index, clock in enumerate(event_times):
        spec = specs[index % len(specs)]
        ref = by_genre[spec["number"]][index % len(by_genre[spec["number"]])]
        sample_times = ref["probe"].get("sample_times", [])
        evidence_time = float(sample_times[index % len(sample_times)]) if sample_times else 0.0
        source_duration = ref["source_duration"]
        requires_anchor = spec["slug"] == "3d-cyber-glitch"
        event_duration = round(min(rng.uniform(0.08, 0.42), duration - clock), 6)
        event: dict[str, Any] = {
            "event_id": f"fx-{index:03d}",
            "time": clock,
            "duration": event_duration,
            "genre_number": spec["number"],
            "effect": effect_names.get(spec["slug"], "reference_accent"),
            "requires_subject_anchor": requires_anchor,
            "placement": {
                "safe_area": 0.08,
                "max_coverage": 0.30 if requires_anchor else 0.35,
                "occlusion_policy": "preserve_subject_face_and_readable_type",
                "track_space": "source_normalized",
            },
            "evidence": {
                "reference_sha256": ref["sha256"],
                "time": evidence_time,
                "source_duration": source_duration,
                "style_fingerprint": spec["style_fingerprint"],
            },
        }
        if requires_anchor:
            event["subject_anchor"] = {
                "mode": "segmentation_track",
                "target": "primary_subject",
                "source_ref_sha256": ref["sha256"],
                "evidence_time": evidence_time,
                "source_duration": source_duration,
                "lost_policy": "disable_effect_until_track_recovers",
            }
        events.append(event)

    return {
        "schema_version": 1,
        "dry_run": True,
        "provider_calls": 0,
        "provider_execution": False,
        "seed": seed,
        "rng_algorithm": "python.random.Random/v1",
        "periodic": False,
        "timeline_duration": duration,
        "events": events,
        "placement_constraints": {
            "subject_anchored_cv_only": True,
            "full_frame_3d_not_corner_overlay": True,
            "preserve_titles_and_faces": True,
            "disable_on_track_loss": True,
        },
    }


def run_workflow(config_path: str | Path, out_dir: str | Path, *, probe: Probe | None = None) -> dict[str, Any]:
    """Execute the deterministic offline contract and return its receipt."""
    config_path = Path(config_path)
    out_dir = Path(out_dir)
    config = json.loads(config_path.read_text(encoding="utf-8"))
    probe = probe or probe_media

    def resolve_input(raw_path: str) -> Path:
        candidate = Path(raw_path).expanduser()
        if not candidate.is_absolute():
            candidate = config_path.parent / candidate
        return Path(os.path.abspath(candidate))

    if config.get("schema_version") != 1:
        raise ValueError("workflow schema_version must be 1")
    if config.get("dry_run", True) is not True:
        raise ValueError("workflow requires dry_run=true; provider execution is disabled")
    source_policy = config.get("source_availability_policy", "allow_unavailable")
    if source_policy not in {"allow_unavailable", "require_available"}:
        raise ValueError("source_availability_policy must be allow_unavailable or require_available")
    genres = sorted(config.get("genres", []), key=lambda item: item["number"])
    if not genres:
        raise ValueError("workflow needs at least one numbered genre")

    output = _SafeOutput(out_dir)
    output.prepare(("genres", "manifests", "resolve"))

    references: list[dict[str, Any]] = []
    specs: list[dict[str, Any]] = []
    manifests: dict[str, dict[str, Any]] = {
        modality: {
            "schema_version": 1,
            "modality": modality,
            "dry_run": True,
            "submit": False,
            "provider_calls": 0,
            "provider_execution": False,
            "requests": [],
        }
        for modality in _MODALITIES
    }
    provenance_rules: list[dict[str, Any]] = []
    evidence_files: list[dict[str, Any]] = []
    for raw_path in config.get("evidence_files", []):
        path = resolve_input(raw_path)
        if not path.is_file():
            raise FileNotFoundError(path)
        suffix = path.suffix.lower()
        evidence_files.append({
            "path": str(path),
            "bytes": path.stat().st_size,
            "sha256": _sha256(path),
            "kind": (
                "editorial" if suffix in {".edl", ".fcpxml"}
                else "archive" if suffix == ".zip"
                else "workflow_record"
            ),
        })

    for genre in genres:
        genre_refs: list[dict[str, Any]] = []
        for raw_path in genre.get("references", []):
            path = resolve_input(raw_path)
            if not path.is_file():
                raise FileNotFoundError(path)
            measured, source_bytes, source_digest = _stable_probe(path, probe)
            source_duration = _validate_probe(measured)
            ref = {
                "genre_number": genre["number"],
                "genre_slug": genre["slug"],
                "path": str(path),
                "bytes": source_bytes,
                "sha256": source_digest,
                "source_duration": source_duration,
                "probe": measured,
            }
            references.append(ref)
            genre_refs.append(ref)

        if not genre_refs:
            raise ValueError(f"genre {genre['slug']} has no references")
        total_duration = round(sum(float(ref["probe"].get("duration") or 0) for ref in genre_refs), 6)
        scene_change_evidence = [{
            "sha256": ref["sha256"],
            "source_duration": ref["source_duration"],
            "times": [float(time) for time in ref["probe"].get("scene_changes", [])],
        } for ref in genre_refs]
        scene_changes = [time for item in scene_change_evidence for time in item["times"]]
        scene_intervals = [
            later - earlier
            for earlier, later in zip(scene_changes, scene_changes[1:])  # noqa: RUF007
        ]
        style_samples = [
            sample
            for ref in genre_refs
            for sample in ref["probe"].get("style_samples", [])
        ]
        luma = [float(sample["luma"]) for sample in style_samples if "luma" in sample]
        saturation = [
            float(sample["saturation"])
            for sample in style_samples
            if "saturation" in sample
        ]
        features = {
            "reference_count": len(genre_refs),
            "total_duration": total_duration,
            "sample_times": [
                {
                    "sha256": ref["sha256"],
                    "source_duration": ref["source_duration"],
                    "times": ref["probe"].get("sample_times", []),
                }
                for ref in genre_refs
            ],
            "temporal": {
                "scene_change_count": len(scene_changes),
                "scene_change_evidence": scene_change_evidence,
                "scene_interval_mean": (
                    round(statistics.fmean(scene_intervals), 6) if scene_intervals else 0.0
                ),
                "scene_interval_variance": (
                    round(statistics.pvariance(scene_intervals), 6)
                    if len(scene_intervals) > 1 else 0.0
                ),
            },
            "style": {
                "sample_count": len(style_samples),
                "luma_mean": round(statistics.fmean(luma), 6) if luma else None,
                "saturation_mean": (
                    round(statistics.fmean(saturation), 6) if saturation else None
                ),
            },
        }
        fingerprint_payload = {"signature": genre["signature"], "features": features}
        fingerprint = hashlib.sha256(_canonical_bytes(fingerprint_payload)).hexdigest()
        spec = {
            "schema_version": 1,
            "number": genre["number"],
            "slug": genre["slug"],
            "label": genre["label"],
            "signature": genre["signature"],
            "measured_features": features,
            "style_fingerprint": fingerprint,
            "dry_run": True,
        }
        specs.append(spec)
        output.write_json(f"genres/{genre['number']:02d}-{genre['slug']}.json", spec)

        evidence = [
            {
                "reference_sha256": ref["sha256"],
                "times": ref["probe"].get("sample_times", []),
                "source_duration": ref["source_duration"],
                "feature_keys": ["duration", "fps", "style_samples", "scene_changes"],
            }
            for ref in genre_refs
        ]
        for axis, values in genre["signature"].items():
            provenance_rules.append({
                "rule_id": f"genre-{genre['number']}-{axis}",
                "genre_number": genre["number"],
                "axis": axis,
                "rule": values,
                "evidence": evidence,
            })

        for modality in _MODALITIES:
            prompt = _prompt(modality, genre, features)
            modality_index = _MODALITIES.index(modality)
            request_seed = int(config["seed"]) + genre["number"] * 100 + modality_index
            endpoint = {
                "image": "fal-ai/flux/dev",
                "video": "fal-ai/kling-video/v2.1/master/text-to-video",
                "3d_asset": "fal-ai/hunyuan3d/v2",
            }[modality]
            body: dict[str, Any] = {"prompt": prompt, "seed": request_seed}
            if modality == "image":
                body.update({"image_size": "landscape_16_9", "num_images": 1})
            elif modality == "video":
                body.update({"aspect_ratio": "16:9", "duration": "5", "generate_audio": False})
            else:
                body.update({
                    "output_format": "glb",
                    "generate_texture": True,
                    "input_image_artifact": (
                        f"manifest://image/{config['run_id']}-{genre['number']}-image"
                    ),
                })
            manifests[modality]["requests"].append({
                "request_id": f"{config['run_id']}-{genre['number']}-{modality}",
                "genre_number": genre["number"],
                "genre_slug": genre["slug"],
                "style_fingerprint": fingerprint,
                "prompt": prompt,
                "provider": "fal",
                "endpoint_candidate": endpoint,
                "endpoint_status": "historical_candidate_unverified_no_network_lookup",
                "provider_call_mode": "disabled",
                "provider_calls": 0,
                "provider_execution": False,
                "request_body": body,
                "submit": False,
                "dry_run": True,
                "reference_sha256": [ref["sha256"] for ref in genre_refs],
            })

    for modality, manifest in manifests.items():
        output.write_json(f"manifests/{modality}.json", manifest)
    output.write_json("references.json", references)
    output.write_json("evidence_files.json", evidence_files)
    output.write_json("provenance.json", {
        "schema_version": 1,
        "run_id": config["run_id"],
        "rules": provenance_rules,
    })
    effect_recipe = _build_effect_recipe(config, specs, references)
    output.write_json("resolve/effect_recipe.json", effect_recipe)

    def all_probe_times(ref: dict[str, Any]) -> list[float]:
        probe_payload = ref["probe"]
        return sorted({
            *[float(time) for time in probe_payload.get("sample_times", [])],
            *[float(time) for time in probe_payload.get("scene_changes", [])],
            *[float(sample["time"]) for sample in probe_payload.get("style_samples", [])],
        })

    def reference_provenance(selected: list[dict[str, Any]]) -> list[dict[str, Any]]:
        return [{
            "reference_path": ref["path"],
            "reference_sha256": ref["sha256"],
            "reference_times": all_probe_times(ref),
            "source_duration": ref["source_duration"],
            "time_basis": "media_seconds",
        } for ref in selected]

    whole_file_provenance = [{
        "reference_path": item["path"],
        "reference_sha256": item["sha256"],
        "reference_times": [],
        "time_basis": "whole_file",
    } for item in evidence_files]

    evidence_artifacts: list[dict[str, Any]] = []
    all_genres = [spec["number"] for spec in specs]
    all_modalities = list(_MODALITIES)
    for relative in output.artifact_paths():
        artifact_path = Path(relative)
        genre_numbers = list(all_genres)
        modalities = list(all_modalities)
        sources = reference_provenance(references)
        if relative.startswith("genres/"):
            genre_number = int(artifact_path.name.split("-", 1)[0])
            genre_numbers = [genre_number]
            sources = reference_provenance([
                ref for ref in references if ref["genre_number"] == genre_number
            ])
        elif relative.startswith("manifests/"):
            modality = artifact_path.stem
            modalities = [modality]
        elif relative == "evidence_files.json" and whole_file_provenance:
            genre_numbers = []
            modalities = []
            sources = whole_file_provenance
        elif relative == "resolve/effect_recipe.json":
            modalities = ["video"]
            source_by_digest = {ref["sha256"]: ref for ref in references}
            exact: dict[str, set[float]] = {}
            for event in effect_recipe["events"]:
                evidence = event["evidence"]
                exact.setdefault(evidence["reference_sha256"], set()).add(float(evidence["time"]))
            sources = [{
                "reference_path": source_by_digest[digest]["path"],
                "reference_sha256": digest,
                "reference_times": sorted(times),
                "source_duration": source_by_digest[digest]["source_duration"],
                "time_basis": "media_seconds",
            } for digest, times in sorted(exact.items())]
        artifact_bytes, artifact_sha256 = output.artifact_metadata(relative)
        evidence_artifacts.append({
            "path": relative,
            "bytes": artifact_bytes,
            "sha256": artifact_sha256,
            "genre_numbers": genre_numbers,
            "modalities": modalities,
            "provider_execution": False,
            "provenance": sources,
        })

    receipt = {
        "schema_version": 1,
        "run_id": config["run_id"],
        "seed": int(config["seed"]),
        "dry_run": True,
        "provider_calls": 0,
        "provider_execution": False,
        "source_availability_policy": source_policy,
        "references": references,
        "evidence_files": evidence_files,
        "evidence_artifacts": evidence_artifacts,
        "genre_fingerprints": [spec["style_fingerprint"] for spec in specs],
        "artifacts": {
            "genres": len(specs),
            "manifests": list(_MODALITIES),
            "provenance_rules": len(provenance_rules),
            "evidence_artifacts": len(evidence_artifacts),
        },
    }
    receipt["receipt_sha256"] = hashlib.sha256(_canonical_bytes(receipt)).hexdigest()
    output.write_json("receipt.json", receipt)
    output.close()
    return receipt
