"""Deterministic schemas and a dependency-free validator.

Every artifact the TasteForge workflow reads or writes has one schema here.
The validator implements the JSON-Schema subset this package needs:

* ``type``  (``object``, ``array``, ``string``, ``integer``, ``number``,
  ``boolean``, ``null``; ``integer`` accepts ``bool``-exclusive ints)
* ``required``, ``properties``, ``items``, ``additionalProperties: false``
* ``enum``, ``minimum``, ``minItems``, ``pattern``

Validation returns a list of human-readable problems; an empty list means the
instance conforms. Schemas are plain data so they can be emitted as JSON for
documentation or cross-checking against the canonical implementation.
"""

from __future__ import annotations

import re
from typing import Any

# ---------------------------------------------------------------------------
# validator
# ---------------------------------------------------------------------------

_TYPE_CHECKS = {
    "object": lambda v: isinstance(v, dict),
    "array": lambda v: isinstance(v, list),
    "string": lambda v: isinstance(v, str),
    "integer": lambda v: isinstance(v, int) and not isinstance(v, bool),
    "number": lambda v: (isinstance(v, (int, float)) and not isinstance(v, bool)),
    "boolean": lambda v: isinstance(v, bool),
    "null": lambda v: v is None,
}


def validate(instance: Any, schema: dict, path: str = "$") -> list[str]:
    """Validate ``instance`` against ``schema``; return a list of problems."""
    problems: list[str] = []
    if not isinstance(schema, dict):
        return [f"{path}: schema itself is not an object"]

    expected_type = schema.get("type")
    if expected_type is not None:
        allowed = expected_type if isinstance(expected_type, list) else [expected_type]
        checks = []
        unknown = []
        for t in allowed:
            check = _TYPE_CHECKS.get(t)
            if check is None:
                unknown.append(t)
            else:
                checks.append(check)
        if unknown:
            problems.append(f"{path}: schema has unknown type(s) {unknown!r}")
        if checks and not any(check(instance) for check in checks):
            problems.append(
                f"{path}: expected type {expected_type!r}, got {_typename(instance)}"
            )
            return problems  # deeper checks are meaningless on a type mismatch

    if "enum" in schema and instance not in schema["enum"]:
        problems.append(
            f"{path}: {instance!r} not in enum {schema['enum']!r}"
        )

    if expected_type == "object" and isinstance(instance, dict):
        for key in schema.get("required", []):
            if key not in instance:
                problems.append(f"{path}: missing required property {key!r}")
        props = schema.get("properties", {})
        additional = schema.get("additionalProperties", True)
        for key, value in instance.items():
            child = f"{path}.{key}"
            if key in props:
                problems.extend(validate(value, props[key], child))
            elif additional is False:
                problems.append(f"{child}: unexpected property (additionalProperties false)")
            elif isinstance(additional, dict):
                problems.extend(validate(value, additional, child))

    if expected_type == "array" and isinstance(instance, list):
        if "minItems" in schema and len(instance) < schema["minItems"]:
            problems.append(
                f"{path}: minItems {schema['minItems']} not met "
                f"(has {len(instance)})"
            )
        item_schema = schema.get("items")
        if isinstance(item_schema, dict):
            for i, item in enumerate(instance):
                problems.extend(validate(item, item_schema, f"{path}[{i}]"))

    if "minimum" in schema and isinstance(instance, (int, float)) \
            and not isinstance(instance, bool) and instance < schema["minimum"]:
        problems.append(f"{path}: {instance} below minimum {schema['minimum']}")

    if "pattern" in schema and isinstance(instance, str):
        if re.search(schema["pattern"], instance) is None:
            problems.append(f"{path}: {instance!r} does not match pattern {schema['pattern']!r}")

    return problems


def _typename(value: Any) -> str:
    return type(value).__name__


# ---------------------------------------------------------------------------
# schemas
# ---------------------------------------------------------------------------

nonempty_str = {"type": "string", "pattern": r"\S"}

# --- taste interview / profile ------------------------------------------

LOOK_FIELDS: dict[str, dict[str, Any]] = {
    "palette_description": {"type": "string"},
    "grain": {"type": "string"},
    "lighting": {"type": "string"},
    "focal_length": {"type": "string"},
    "camera_motion": {"type": "string"},
    "subject_framing": {"type": "string"},
    "grade_description": {"type": "string"},
    "mood_adjectives": {"type": "array", "items": {"type": "string"}},
    "avoid": {"type": "array", "items": {"type": "string"}},
}

TASTE_PROFILE_SCHEMA = {
    "type": "object",
    "required": ["schema_version", "genre", "answers", "constraints"],
    "properties": {
        "schema_version": {"type": "integer", "enum": [1]},
        "genre": {"type": "string", "pattern": r"^[a-z0-9][a-z0-9_-]*$"},
        "created": {"type": "string"},
        "answers": {"type": "object"},
        "unanswered": {"type": "array", "items": {"type": "string"}},
        "constraints": {
            "type": "object",
            "required": ["look", "content"],
            "properties": {
                "look": {
                    "type": "object",
                    "required": ["mood_adjectives", "avoid"],
                    "properties": dict(LOOK_FIELDS),
                },
                "content": {
                    "type": "object",
                    "required": ["brief"],
                    "properties": {"brief": {"type": "string"}},
                },
            },
        },
    },
}

# --- style pack manifest (pack.json) ------------------------------------

PACK_MANIFEST_SCHEMA = {
    "type": "object",
    "required": ["name", "version", "created", "updated", "refs", "artifacts"],
    "properties": {
        "name": {"type": "string", "pattern": r"^[a-z0-9][a-z0-9_-]*$"},
        "version": {"type": "integer", "enum": [1]},
        "created": {"type": "string"},
        "updated": {"type": "string"},
        "refs": {
            "type": "array",
            "items": {
                "type": "object",
                "required": ["id", "src", "duration", "n_shots"],
                "properties": {
                    "id": {"type": "string"},
                    "src": {"type": "string"},
                    "duration": {"type": "number", "minimum": 0},
                    "n_shots": {"type": "integer", "minimum": 0},
                },
            },
        },
        "artifacts": {
            "type": "object",
            "required": ["grade", "cadence", "spec", "stills", "props", "plates"],
            "properties": {
                "lut": {"type": ["string", "null"]},
                "grade": {"type": "boolean"},
                "cadence": {"type": "boolean"},
                "spec": {"type": "boolean"},
                "stills": {"type": "integer", "minimum": 0},
                "props": {"type": "integer", "minimum": 0},
                "plates": {"type": "integer", "minimum": 0},
            },
        },
        "mint": {
            "type": "object",
            "properties": {
                "lut_size": {"type": "integer", "minimum": 2},
                "strength": {"type": "number"},
                "pixels_analyzed": {"type": "integer", "minimum": 0},
                "ui_masked": {"type": "boolean"},
            },
        },
        "distill": {
            "type": "object",
            "properties": {
                "generated": {"type": "string"},
                "stills_used": {"type": "array", "items": {"type": "string"}},
                "vlm_endpoint": {"type": "string"},
                "vlm_model": {"type": "string"},
                "dry_run": {"type": "boolean"},
                "prop": {"type": "object"},
            },
        },
    },
}

# --- measured color statistics (grade.json) ----------------------------

GRADE_SCHEMA = {
    "type": "object",
    "required": [
        "l_cdf", "black_point", "white_point", "contrast", "palette",
        "zones", "noise_sigma",
    ],
    "properties": {
        "lab_mean": {"type": "array", "items": {"type": "number"}},
        "lab_std": {"type": "array", "items": {"type": "number"}},
        "l_cdf": {"type": "array", "items": {"type": "number"}, "minItems": 2},
        "black_point": {"type": "number", "minimum": 0},
        "white_point": {"type": "number", "minimum": 0},
        "contrast": {"type": "number"},
        "saturation": {"type": "number"},
        "warmth": {"type": "number"},
        "tint": {"type": "number"},
        "noise_sigma": {"type": "number", "minimum": 0},
        "palette": {
            "type": "array",
            "items": {
                "type": "array",
                "items": {"type": ["string", "number"]},
                "minItems": 2,
            },
        },
        "zones": {
            "type": "array",
            "items": {"type": "array", "items": {"type": "number"}},
        },
        "n_frames": {"type": "integer", "minimum": 0},
    },
}

# --- cut rhythm (cadence.json) -------------------------------------------

SHOT_SCHEMA = {
    "type": "object",
    "required": ["index", "start", "end", "duration"],
    "properties": {
        "index": {"type": "integer", "minimum": 0},
        "start": {"type": "number", "minimum": 0},
        "end": {"type": "number", "minimum": 0},
        "duration": {"type": "number", "minimum": 0},
    },
}

CADENCE_SCHEMA = {
    "type": "object",
    "required": [
        "shots", "mean_shot", "median_shot", "p25_shot", "p75_shot",
        "min_shot", "max_shot", "cuts_per_min", "rhythm_variance",
        "total_duration", "fps", "n_shots",
    ],
    "properties": {
        "shots": {"type": "array", "items": SHOT_SCHEMA},
        "mean_shot": {"type": "number", "minimum": 0},
        "median_shot": {"type": "number", "minimum": 0},
        "p25_shot": {"type": "number", "minimum": 0},
        "p75_shot": {"type": "number", "minimum": 0},
        "min_shot": {"type": "number", "minimum": 0},
        "max_shot": {"type": "number", "minimum": 0},
        "cuts_per_min": {"type": "number", "minimum": 0},
        "rhythm_variance": {"type": "number", "minimum": 0},
        "total_duration": {"type": "number", "minimum": 0},
        "fps": {"type": "number", "minimum": 0},
        "n_shots": {"type": "integer", "minimum": 0},
    },
}

# --- distilled style specification (spec.json) ---------------------------

SPEC_SCHEMA = {
    "type": "object",
    "required": [
        "palette_description", "grain", "lighting", "focal_length",
        "camera_motion", "subject_framing", "grade_description",
        "mood_adjectives", "avoid",
    ],
    "properties": {
        **{k: dict(v) for k, v in LOOK_FIELDS.items()},
        "source": {
            "type": "object",
            "required": ["dry_run"],
            "properties": {
                "pack": {"type": "string"},
                "generated": {"type": "string"},
                "stills": {"type": "array", "items": {"type": "string"}},
                "dry_run": {"type": "boolean"},
                "provider": {"type": "string"},
                "endpoint": {"type": "string"},
                "attempts": {"type": "array"},
            },
        },
        "extra": {"type": "object"},
    },
}

# --- timeline events (input to EDL / FCPXML export) ----------------------

TIMELINE_EVENT_SCHEMA = {
    "type": "object",
    "required": ["path", "duration", "frames"],
    "properties": {
        "path": {"type": "string", "pattern": r"\S"},
        "name": {"type": "string"},
        "duration": {"type": "number", "minimum": 0},
        "frames": {"type": "integer", "minimum": 1},
        "offset_frames": {"type": "integer", "minimum": 0},
        "fps": {"type": "number", "minimum": 0},
    },
}

# --- application report (apply run manifest) ------------------------------

APPLICATION_REPORT_SCHEMA = {
    "type": "object",
    "required": [
        "schema_version", "pack", "generated", "mode", "dry_run", "provider",
        "planned_shots", "timeline_events", "cadence",
    ],
    "properties": {
        "schema_version": {"type": "integer", "enum": [1]},
        "pack": {"type": "string"},
        "generated": {"type": "string"},
        "mode": {"type": "string", "enum": ["local-deterministic"]},
        # This lane can only ever produce offline reports; the enums make a
        # false provider claim structurally invalid.
        "dry_run": {"type": "boolean", "enum": [True]},
        "provider": {"type": "string", "enum": ["none"]},
        "target_duration": {"type": "number", "minimum": 0},
        "media": {"type": "array", "items": {"type": "object"}},
        "planned_shots": {"type": "array", "items": SHOT_SCHEMA},
        "timeline_events": {"type": "array", "items": TIMELINE_EVENT_SCHEMA},
        "cadence": {
            "type": "object",
            "required": ["mean_shot", "rhythm_variance", "cuts_per_min"],
            "properties": {
                "mean_shot": {"type": "number"},
                "rhythm_variance": {"type": "number"},
                "cuts_per_min": {"type": "number"},
            },
        },
        "notes": {"type": "array", "items": {"type": "string"}},
    },
}

# --- provenance records ----------------------------------------------------

PROVENANCE_SCHEMA = {
    "type": "object",
    "required": ["canonical_source", "generations", "claude_session"],
    "properties": {
        "canonical_source": {
            "type": "object",
            "required": ["path", "read_only"],
            "properties": {
                "path": {"type": "string"},
                "read_only": {"type": "boolean"},
                "copy_verification_sha256": {"type": "string"},
                "note": {"type": "string"},
            },
        },
        "generations": {
            "type": "array",
            "minItems": 1,
            "items": {
                "type": "object",
                "required": ["archive", "sha256", "status", "delta"],
                "properties": {
                    "archive": {"type": "string"},
                    "sha256": {"type": "string", "pattern": r"^[0-9a-f]{64}$"},
                    "status": {"type": "string", "enum": ["prior", "latest"]},
                    "delta": {"type": "string"},
                },
            },
        },
        "claude_session": {
            "type": "object",
            "required": ["id", "transcript_available", "selection_evidence_local"],
            "properties": {
                "id": {"type": "string"},
                "transcript_available": {"type": "boolean"},
                "selection_evidence_local": {"type": "boolean"},
                "note": {"type": "string"},
            },
        },
        "fixture": {"type": "object"},
    },
}
