"""Fail-closed validation for multimodal TasteForge artifacts."""

from __future__ import annotations

import hashlib
import json
import math
import os
import re
import stat
from pathlib import Path
from typing import Any, cast

_REQUIRED_MODALITIES = {"image", "video", "3d_asset"}
_SIGNATURE_AXES = {"materials", "motion", "composition", "avoid"}


class ContractError(ValueError):
    """The dry-run bundle is incomplete or has lost taste specificity."""


def _is_finite_real(value: Any) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def _validate_media_time(value: Any, source_duration: Any, *, label: str) -> None:
    if not _is_finite_real(source_duration):
        raise ContractError(f"{label} has an invalid finite source duration")
    source_duration = cast(float, source_duration)
    if float(source_duration) <= 0:
        raise ContractError(f"{label} has an invalid finite source duration")
    if (not _is_finite_real(value) or float(value) < 0
            or float(value) > float(source_duration)):
        raise ContractError(f"{label} is outside its source duration")


def _validate_numeric_evidence(value: Any, *, label: str) -> None:
    if isinstance(value, bool):
        raise ContractError(f"{label} contains a boolean numeric value")
    if isinstance(value, (int, float)):
        if not math.isfinite(value):
            raise ContractError(f"{label} contains a non-finite numeric value")
    elif isinstance(value, dict):
        for nested in value.values():
            _validate_numeric_evidence(nested, label=label)
    elif isinstance(value, list):
        for nested in value:
            _validate_numeric_evidence(nested, label=label)


def _validate_probe_evidence(probe: Any, source_duration: float, *, label: str) -> None:
    if not isinstance(probe, dict):
        raise ContractError(f"{label} lacks probe evidence")
    _validate_numeric_evidence(probe, label=label)
    if probe.get("duration") != source_duration:
        raise ContractError(f"{label} probe duration is not bound to source duration")
    for field in ("sample_times", "scene_changes"):
        values = probe.get(field, [])
        if not isinstance(values, list):
            raise ContractError(f"{label} has invalid {field}")
        for value in values:
            _validate_media_time(value, source_duration, label=f"{label} {field}")
    samples = probe.get("style_samples", [])
    if not isinstance(samples, list) or any(not isinstance(sample, dict) for sample in samples):
        raise ContractError(f"{label} has invalid style evidence")
    for sample in samples:
        _validate_media_time(sample.get("time"), source_duration, label=f"{label} style evidence")


def _sha256(path: Path) -> str:
    if not hasattr(os, "O_NOFOLLOW"):
        raise ContractError("secure receipt validation requires O_NOFOLLOW")
    descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    digest = hashlib.sha256()
    try:
        metadata = os.fstat(descriptor)
        if not stat.S_ISREG(metadata.st_mode):
            raise ContractError(f"receipt source is not a regular file: {path}")
        while True:
            chunk = os.read(descriptor, 1024 * 1024)
            if not chunk:
                break
            digest.update(chunk)
    finally:
        os.close(descriptor)
    return digest.hexdigest()


def _semantic_signature(spec: dict[str, Any]) -> str:
    signature = spec.get("signature", {})
    return json.dumps(signature, sort_keys=True, separators=(",", ":"))


def _validate_output_tree(root: Path) -> None:
    """Reject symlinks and special files before parsing bundle content."""
    try:
        metadata = root.lstat()
    except FileNotFoundError:
        raise ContractError("output bundle is missing") from None
    if stat.S_ISLNK(metadata.st_mode):
        raise ContractError("output bundle root must not be a symlink")
    if not stat.S_ISDIR(metadata.st_mode):
        raise ContractError("output bundle root must be a directory")
    pending = [root]
    while pending:
        directory = pending.pop()
        with os.scandir(directory) as entries:
            for entry in entries:
                if entry.is_symlink():
                    raise ContractError(f"output bundle contains a symlink: {entry.path}")
                if entry.is_dir(follow_symlinks=False):
                    pending.append(Path(entry.path))
                elif not entry.is_file(follow_symlinks=False):
                    raise ContractError(f"output bundle contains a special file: {entry.path}")


def validate_genre_specs(specs: list[dict[str, Any]]) -> None:
    """Require complete, semantically distinct numbered genre specs."""
    if not specs:
        raise ContractError("at least one genre spec is required")
    numbers = [spec.get("number") for spec in specs]
    if len(numbers) != len(set(numbers)):
        raise ContractError("genre numbers must be distinct")

    fingerprints = [spec.get("style_fingerprint") for spec in specs]
    signatures = [_semantic_signature(spec) for spec in specs]
    if len(fingerprints) != len(set(fingerprints)) or len(signatures) != len(set(signatures)):
        raise ContractError("genre references collapsed into a generic style; distinct specs required")

    for spec in specs:
        if spec.get("dry_run") is not True:
            raise ContractError(f"genre {spec.get('number')} crosses the dry-run boundary")
        measured = spec.get("measured_features")
        if measured is not None:
            if not isinstance(measured, dict):
                raise ContractError(f"genre {spec.get('number')} has invalid measured evidence")
            _validate_numeric_evidence(measured, label=f"genre {spec.get('number')} evidence")
            total_duration = measured.get("total_duration")
            if not _is_finite_real(total_duration):
                raise ContractError(f"genre {spec.get('number')} has invalid total duration")
            total_duration = cast(float, total_duration)
            if float(total_duration) <= 0:
                raise ContractError(f"genre {spec.get('number')} has invalid total duration")
            for group_name in ("sample_times",):
                groups = measured.get(group_name, [])
                if not isinstance(groups, list):
                    raise ContractError(f"genre {spec.get('number')} has invalid time evidence")
                for group in groups:
                    if not isinstance(group, dict):
                        raise ContractError(f"genre {spec.get('number')} has invalid time evidence")
                    for time in group.get("times", []):
                        _validate_media_time(
                            time, group.get("source_duration"),
                            label=f"genre {spec.get('number')} time evidence",
                        )
            temporal = measured.get("temporal", {})
            if isinstance(temporal, dict):
                for group in temporal.get("scene_change_evidence", []):
                    for time in group.get("times", []):
                        _validate_media_time(
                            time, group.get("source_duration"),
                            label=f"genre {spec.get('number')} scene evidence",
                        )
        signature = spec.get("signature")
        if not isinstance(signature, dict) or not _SIGNATURE_AXES.issubset(signature):
            raise ContractError(f"genre {spec.get('number')} has an incomplete signature")
        if not all(isinstance(signature[axis], list) for axis in _SIGNATURE_AXES):
            raise ContractError(f"genre {spec.get('number')} signature axes must be lists")
        if not all(signature[axis] for axis in _SIGNATURE_AXES):
            raise ContractError(f"genre {spec.get('number')} has an empty signature axis, including avoid")


def validate_effect_recipe(
    recipe: dict[str, Any], *, reference_durations: dict[str, float] | None = None
) -> None:
    """Require a seeded aperiodic schedule and anchors on subject-aware effects."""
    if (recipe.get("dry_run") is not True
            or type(recipe.get("provider_calls")) is not int
            or recipe.get("provider_calls") != 0
            or recipe.get("provider_execution") is not False):
        raise ContractError("effect recipe crosses the dry-run provider boundary")
    if not isinstance(recipe.get("seed"), int) or isinstance(recipe.get("seed"), bool):
        raise ContractError("effect recipe must have an integer seed")
    if recipe.get("rng_algorithm") != "python.random.Random/v1":
        raise ContractError("effect recipe must declare its seeded RNG algorithm")
    events = recipe.get("events")
    if not isinstance(events, list) or len(events) < 3:
        raise ContractError("effect recipe needs at least three scheduled events")
    timeline = recipe.get("timeline_duration")
    if not _is_finite_real(timeline):
        raise ContractError("effect recipe must declare a finite positive timeline duration")
    timeline = cast(float, timeline)
    if float(timeline) <= 0:
        raise ContractError("effect recipe must declare a finite positive timeline duration")
    for event in events:
        start = event.get("time")
        duration = event.get("duration")
        if (not _is_finite_real(start) or not _is_finite_real(duration)
                or float(start) < 0 or float(duration) <= 0):
            raise ContractError("effect event start and duration must be finite positive timeline values")
        start = cast(float, start)
        duration = cast(float, duration)
        if float(start) + float(duration) > float(timeline) + 1e-9:
            raise ContractError("effect event end exceeds the declared timeline")
        evidence = event.get("evidence")
        if not isinstance(evidence, dict):
            raise ContractError(f"effect {event.get('effect')} lacks reference evidence")
        _validate_media_time(
            evidence.get("time"), evidence.get("source_duration"), label="effect evidence time"
        )
        if reference_durations is not None:
            digest = evidence.get("reference_sha256")
            expected_duration = reference_durations.get(digest) if isinstance(digest, str) else None
            if expected_duration is None or evidence.get("source_duration") != expected_duration:
                raise ContractError("effect evidence source duration is not bound to its receipt reference")
    times = [float(event["time"]) for event in events]
    if times != sorted(times) or len(times) != len(set(times)):
        raise ContractError("effect event times must be unique and increasing")
    intervals = [round(b - a, 6) for a, b in zip(times, times[1:])]  # noqa: RUF007
    if len(set(intervals)) <= 1:
        raise ContractError("stochastic schedule is periodic; intervals must vary")
    for period in range(1, len(intervals) // 2 + 1):
        if all(intervals[index] == intervals[index % period] for index in range(len(intervals))):
            raise ContractError("stochastic schedule is periodic; repeating interval cycle")
    if recipe.get("periodic") is not False:
        raise ContractError("effect recipe must explicitly declare periodic=false")
    for event in events:
        cv_effect = str(event.get("effect", "")).startswith("cv_")
        if cv_effect and event.get("requires_subject_anchor") is not True:
            raise ContractError(f"CV effect {event.get('effect')} must require a subject anchor")
        if event.get("requires_subject_anchor"):
            anchor = event.get("subject_anchor")
            required = {
                "mode", "target", "source_ref_sha256", "evidence_time",
                "source_duration", "lost_policy",
            }
            if not isinstance(anchor, dict) or not required.issubset(anchor):
                raise ContractError(f"CV effect {event.get('effect')} lacks a valid subject anchor")
            if anchor.get("mode") not in {"object_track", "point_track", "segmentation_track"}:
                raise ContractError(f"CV effect {event.get('effect')} has an invalid subject anchor")
            if anchor.get("lost_policy") != "disable_effect_until_track_recovers":
                raise ContractError(f"CV effect {event.get('effect')} must fail closed on anchor loss")
            _validate_media_time(
                anchor.get("evidence_time"), anchor.get("source_duration"),
                label="anchor evidence time",
            )
            if reference_durations is not None:
                digest = anchor.get("source_ref_sha256")
                expected_duration = reference_durations.get(digest) if isinstance(digest, str) else None
                if expected_duration is None or anchor.get("source_duration") != expected_duration:
                    raise ContractError("anchor evidence source duration is not bound to its receipt reference")
    for event in events:
        placement = event.get("placement")
        if not isinstance(placement, dict) or not {"safe_area", "max_coverage", "occlusion_policy"}.issubset(placement):
            raise ContractError(f"effect {event.get('effect')} lacks placement constraints")


def validate_provenance(payload: dict[str, Any]) -> None:
    """Require every declared rule to cite immutable, timestamped evidence."""
    rules = payload.get("rules")
    if not isinstance(rules, list) or not rules:
        raise ContractError("provenance must contain derived rules")
    for rule in rules:
        evidence = rule.get("evidence")
        if not isinstance(evidence, list) or not evidence:
            raise ContractError(f"rule {rule.get('rule_id')} lacks reference evidence")
        for item in evidence:
            digest = item.get("reference_sha256")
            if not isinstance(digest, str) or len(digest) != 64:
                raise ContractError(f"rule {rule.get('rule_id')} lacks immutable reference evidence")
            times = item.get("times")
            if not isinstance(times, list) or not times:
                raise ContractError(f"rule {rule.get('rule_id')} lacks time evidence")
            source_duration = item.get("source_duration")
            for time in times:
                _validate_media_time(
                    time, source_duration, label=f"rule {rule.get('rule_id')} time evidence"
                )


def validate_manifests(manifests_dir: str | Path) -> None:
    """Require image, video, and 3D-asset dry-run request manifests."""
    manifests_dir = Path(manifests_dir)
    found = {path.stem for path in manifests_dir.glob("*.json")} if manifests_dir.is_dir() else set()
    missing = _REQUIRED_MODALITIES - found
    if missing:
        raise ContractError(f"missing modality manifests: {sorted(missing)}")
    for modality in _REQUIRED_MODALITIES:
        payload = json.loads((manifests_dir / f"{modality}.json").read_text(encoding="utf-8"))
        if payload.get("modality") != modality or not payload.get("requests"):
            raise ContractError(f"invalid or empty {modality} manifest")
        if (payload.get("dry_run") is not True or payload.get("submit") is not False
                or type(payload.get("provider_calls")) is not int
                or payload.get("provider_calls") != 0
                or payload.get("provider_execution") is not False):
            raise ContractError(f"{modality} manifest crosses the dry-run boundary")
        for request in payload["requests"]:
            if (request.get("dry_run") is not True
                    or request.get("submit") is not False
                    or type(request.get("provider_calls")) is not int
                    or request.get("provider_calls") != 0
                    or request.get("provider_execution") is not False
                    or request.get("provider_call_mode") != "disabled"):
                raise ContractError(f"{modality} request crosses the dry-run boundary")


def validate_artifact_receipt(out_dir: str | Path, receipt: dict[str, Any]) -> None:
    """Verify that the receipt binds every emitted artifact and its provenance."""
    out_dir = Path(out_dir).resolve()
    entries = receipt.get("evidence_artifacts")
    if not isinstance(entries, list):
        raise ContractError("receipt evidence_artifacts must be a list")
    if not all(isinstance(entry, dict) for entry in entries):
        raise ContractError("receipt evidence_artifacts entries must be objects")
    known_sources: set[tuple[str, str]] = set()
    source_durations: dict[tuple[str, str], float] = {}
    for key in ("references", "evidence_files"):
        sources = receipt.get(key, [])
        if not isinstance(sources, list):
            raise ContractError(f"receipt {key} must be a list")
        for source in sources:
            if not isinstance(source, dict):
                raise ContractError(f"receipt {key} contains an invalid source")
            source_path = source.get("path")
            expected_digest = source.get("sha256")
            if (not isinstance(source_path, str) or not source_path
                    or not isinstance(expected_digest, str)
                    or not re.fullmatch(r"[0-9a-f]{64}", expected_digest)):
                raise ContractError("receipt has an invalid source identity")
            known_sources.add((source_path, expected_digest))
            if key == "references":
                source_duration = source.get("source_duration")
                if not _is_finite_real(source_duration):
                    raise ContractError("receipt reference has an invalid finite source duration")
                source_duration = cast(float, source_duration)
                if float(source_duration) <= 0:
                    raise ContractError("receipt reference has an invalid finite source duration")
                source_durations[(source_path, expected_digest)] = float(source_duration)
                _validate_probe_evidence(
                    source.get("probe"), float(source_duration), label="receipt reference"
                )
    source_policy = receipt.get("source_availability_policy")
    if known_sources and source_policy not in {"allow_unavailable", "require_available"}:
        raise ContractError("receipt must declare an explicit source availability policy")
    for source_path, expected_digest in sorted(known_sources):
        path = Path(source_path)
        try:
            metadata = path.lstat()
        except FileNotFoundError:
            if source_policy == "require_available":
                raise ContractError(f"receipt source is unavailable: {source_path}") from None
            continue
        if stat.S_ISLNK(metadata.st_mode) or not stat.S_ISREG(metadata.st_mode):
            raise ContractError(f"receipt source is not a safe regular file: {source_path}")
        try:
            actual_digest = _sha256(path)
        except FileNotFoundError:
            if source_policy == "require_available":
                raise ContractError(f"receipt source is unavailable: {source_path}") from None
            continue
        except OSError:
            raise ContractError(f"receipt source cannot be securely read: {source_path}") from None
        if actual_digest != expected_digest:
            raise ContractError(f"receipt source SHA-256 changed after generation: {source_path}")

    emitted = {
        path.relative_to(out_dir).as_posix()
        for path in out_dir.rglob("*")
        if path.is_file() and path.name != "receipt.json"
    }
    bound_paths: list[str] = []
    for entry in entries:
        relative = entry.get("path")
        if not isinstance(relative, str) or not relative:
            raise ContractError("artifact path must be a non-empty relative path")
        bound_paths.append(relative)
    if len(bound_paths) != len(set(bound_paths)):
        raise ContractError("receipt contains duplicate artifact paths")
    missing = emitted - set(bound_paths)
    extra = set(bound_paths) - emitted
    if missing:
        raise ContractError(f"unbound emitted artifact: {sorted(missing)}")
    if extra:
        raise ContractError(f"receipt binds missing artifact: {sorted(extra)}")

    for entry in entries:
        relative = entry.get("path")
        assert isinstance(relative, str)
        path = (out_dir / relative).resolve()
        try:
            path.relative_to(out_dir)
        except ValueError as error:
            raise ContractError(f"artifact path escapes output directory: {relative}") from error
        if entry.get("provider_execution") is not False:
            raise ContractError(f"artifact {relative} permits provider execution")
        if not isinstance(entry.get("genre_numbers"), list):
            raise ContractError(f"artifact {relative} lacks genre binding")
        modalities = entry.get("modalities")
        if (not isinstance(modalities, list)
                or any(modality not in _REQUIRED_MODALITIES for modality in modalities)):
            raise ContractError(f"artifact {relative} has invalid modality binding")
        if entry.get("bytes") != path.stat().st_size:
            raise ContractError(f"artifact {relative} byte size does not match receipt")
        if entry.get("sha256") != _sha256(path):
            raise ContractError(f"artifact {relative} SHA-256 does not match receipt")
        provenance = entry.get("provenance")
        if not isinstance(provenance, list) or not provenance:
            raise ContractError(f"artifact {relative} lacks exact reference/time provenance")
        for source in provenance:
            if not isinstance(source.get("reference_path"), str) or not source["reference_path"]:
                raise ContractError(f"artifact {relative} has invalid reference path")
            digest = source.get("reference_sha256")
            if not isinstance(digest, str) or len(digest) != 64:
                raise ContractError(f"artifact {relative} has invalid reference SHA-256")
            if (source["reference_path"], digest) not in known_sources:
                raise ContractError(f"artifact {relative} cites an unknown provenance source")
            times = source.get("reference_times")
            basis = source.get("time_basis")
            if not isinstance(times, list) or basis not in {"media_seconds", "whole_file"}:
                raise ContractError(f"artifact {relative} has invalid reference/time provenance")
            if basis == "media_seconds" and not times:
                raise ContractError(f"artifact {relative} lacks media reference times")
            if basis == "whole_file" and times:
                raise ContractError(f"artifact {relative} whole-file provenance must not invent times")
            if basis == "media_seconds":
                expected_duration = source_durations.get((source["reference_path"], digest))
                if expected_duration is None or source.get("source_duration") != expected_duration:
                    raise ContractError(f"artifact {relative} has an unbound source duration")
                for time in times:
                    _validate_media_time(
                        time, expected_duration,
                        label=f"artifact {relative} media reference time",
                    )

    digest_payload = dict(receipt)
    claimed_digest = digest_payload.pop("receipt_sha256", None)
    actual_digest = hashlib.sha256(
        json.dumps(digest_payload, sort_keys=True, separators=(",", ":")).encode("utf-8")
    ).hexdigest()
    if claimed_digest != actual_digest:
        raise ContractError("receipt SHA-256 does not match its canonical content")


def validate_bundle(out_dir: str | Path) -> None:
    """Validate required multimodal files and cross-artifact invariants."""
    out_dir = Path(out_dir)
    _validate_output_tree(out_dir)
    specs = [json.loads(path.read_text(encoding="utf-8"))
             for path in sorted((out_dir / "genres").glob("*.json"))]
    validate_genre_specs(specs)

    validate_manifests(out_dir / "manifests")
    provenance_path = out_dir / "provenance.json"
    if not provenance_path.is_file():
        raise ContractError("missing provenance")
    validate_provenance(json.loads(provenance_path.read_text(encoding="utf-8")))

    receipt_path = out_dir / "receipt.json"
    if not receipt_path.is_file():
        raise ContractError("missing receipt")
    receipt = json.loads(receipt_path.read_text(encoding="utf-8"))
    if (receipt.get("dry_run") is not True
            or receipt.get("provider_execution") is not False
            or type(receipt.get("provider_calls")) is not int
            or receipt.get("provider_calls") != 0):
        raise ContractError("receipt crosses the dry-run boundary")
    validate_artifact_receipt(out_dir, receipt)

    reference_durations: dict[str, float] = {}
    for reference in receipt.get("references", []):
        digest = reference.get("sha256")
        duration = reference.get("source_duration")
        if not isinstance(digest, str) or not _is_finite_real(duration):
            raise ContractError("receipt reference cannot bind recipe evidence")
        duration = float(duration)
        previous = reference_durations.get(digest)
        if previous is not None and previous != duration:
            raise ContractError("receipt reference digest has conflicting source durations")
        reference_durations[digest] = duration

    recipe_path = out_dir / "resolve" / "effect_recipe.json"
    if not recipe_path.is_file():
        raise ContractError("missing Resolve effect recipe")
    validate_effect_recipe(
        json.loads(recipe_path.read_text(encoding="utf-8")),
        reference_durations=reference_durations,
    )
