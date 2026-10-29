"""Distillation: profile (+ pack measurements) -> structured style spec.

Two paths, one boundary:

* :func:`distill_local` - deterministic, offline, dry-run semantics. It maps a
  local interview profile onto the spec contract, merges measured grounding
  when a pack supplies it, and stamps ``dry_run: true`` / ``provider: none``.
  It never pretends a vision model ran.
* :func:`distill_live` - FAILS CLOSED. Live (provider) distillation requires
  explicit separately authorized execution, which this package never grants.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from . import pack as pack_mod
from . import schema

__all__ = [
    "ProviderDisabledError",
    "distill_local",
    "distill_live",
    "grounding_from_grade",
    "build_spec",
]

_SPEC_STRING_KEYS = (
    "palette_description", "grain", "lighting", "focal_length",
    "camera_motion", "subject_framing", "grade_description",
)
_SPEC_LIST_KEYS = ("mood_adjectives", "avoid")

# Interview answer id -> spec key (palette -> palette_description).
_KEY_MAP = {
    "palette": "palette_description",
    **{k: k for k in _SPEC_STRING_KEYS + _SPEC_LIST_KEYS if k != "palette_description"},
}


class ProviderDisabledError(RuntimeError):
    """Live provider distillation was requested but is not authorized."""


_FAIL_CLOSED = (
    "live distillation requires explicit separately authorized execution; "
    "this package ships no provider adapters and performs no network calls. "
    "Use distill_local() (offline, deterministic, dry-run) instead."
)


def _utc_now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def build_spec(look: dict[str, Any], *, pack_name: str | None = None,
               grounding_used: bool = False) -> dict[str, Any]:
    """Assemble a schema-valid spec from look constraints (offline)."""
    spec: dict[str, Any] = {}
    for key in _SPEC_STRING_KEYS:
        value = look.get(key)
        spec[key] = value.strip() if isinstance(value, str) else ""
    for key in _SPEC_LIST_KEYS:
        value = look.get(key)
        spec[key] = [str(v) for v in value] if isinstance(value, list) else []

    spec["source"] = {
        "pack": pack_name or "",
        "generated": _utc_now(),
        "dry_run": True,
        "provider": "none",
        "grounding_used": grounding_used,
    }
    problems = schema.validate(spec, schema.SPEC_SCHEMA)
    if problems:
        raise ValueError(f"built an invalid spec: {problems}")
    return spec


def distill_local(profile: dict[str, Any],
                  sp: pack_mod.StylePack | None = None) -> dict[str, Any]:
    """Deterministic offline distillation of a taste profile.

    The output carries dry-run semantics from the recovered implementation:
    ``dry_run: true`` and ``provider: none`` mean no vision model ran and no
    claim of live distillation is made. When a pack with grade/cadence
    metadata is supplied, its measured ground truth is embedded for the
    operator (and any future authorized VLM call) to consume.
    """
    look = dict(profile.get("constraints", {}).get("look", {}))

    grounding_used = False
    grounding_text = ""
    if sp is not None:
        grade = sp.read_json(sp.grade_path)
        cadence = sp.read_json(sp.cadence_path)
        grounding_text = grounding_from_grade(grade, cadence)
        grounding_used = bool(grounding_text)

    spec = build_spec(
        look,
        pack_name=sp.name if sp is not None else profile.get("genre"),
        grounding_used=grounding_used,
    )
    if grounding_text:
        spec["grounding"] = grounding_text
    return spec


def distill_live(profile: dict[str, Any]) -> dict[str, Any]:
    """Refuse live provider distillation. Fails closed, always."""
    raise ProviderDisabledError(_FAIL_CLOSED)


def grounding_from_grade(grade: dict[str, Any], cadence: dict[str, Any]) -> str:
    """Measured ground truth as a factual preamble (canonicalized port).

    Numeric facts belong here, not in the model's judgment: the first
    ungrounded run of the recovered pipeline produced a spec asserting "no
    apparent color grading" for a reference measuring a*+24.9 in the
    midtones. Stating measurements as facts inverts the dependency.
    """
    if not grade:
        return ""

    lines = [
        "MEASURED GROUND TRUTH for this reference set, from numeric analysis "
        "of the sampled frames. These are FACTS. Do not contradict them. Do "
        "not describe this footage as neutral, ungraded, or clinical:",
    ]

    bp, wp = grade.get("black_point"), grade.get("white_point")
    if bp is not None and wp is not None:
        lines.append(
            f"- black point L*{bp:.1f}, white point L*{wp:.1f}, "
            f"contrast (std L*) {grade.get('contrast', 0):.1f}"
        )

    zones = grade.get("zones") or []
    if zones:
        centers = [7.5, 25, 45, 65, 87.5]
        z = " | ".join(
            f"L*{c:.0f} a*{v[0]:+.1f} b*{v[2]:+.1f}"
            for c, v in zip(centers, zones)
        )
        lines.append(f"- chroma by luminance zone: {z}")

    pal = grade.get("palette") or []
    if pal:
        lines.append(
            "- dominant palette: " + ", ".join(h for h, _ in pal[:5])
        )

    if grade.get("noise_sigma") is not None:
        lines.append(
            f"- measured grain sigma {grade['noise_sigma']:.4f} (encode noise, "
            "not necessarily aesthetic grain)"
        )

    if cadence:
        lines.append(
            f"- cut rhythm: {cadence.get('n_shots', 0)} shots, mean "
            f"{cadence.get('mean_shot', 0):.2f}s, "
            f"{cadence.get('cuts_per_min', 0):.0f} cuts/min, rhythm variance "
            f"{cadence.get('rhythm_variance', 0):.2f}"
        )

    return "\n".join(lines)
