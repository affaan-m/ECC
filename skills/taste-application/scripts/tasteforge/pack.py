"""Offline style-pack model: load, inspect, validate.

A pack is a directory (canonical layout from the recovered implementation)::

    <name>/pack.json     manifest: refs, artifact inventory, version
    <name>/grade.json    color statistics incl. per-zone chroma
    <name>/cadence.json  shot-length distribution
    <name>/spec.json     distilled style specification
    <name>/grounding.txt measured-ground-truth preamble for a VLM
    <name>/look.cube     33^3 LUT baked against canonical neutral
    <name>/stills/       full-res keyframes - the primary style carrier
    <name>/props/        GLB meshes minted from hero frames
    <name>/plates/       grain / overlay plates

This module never opens media decoders and never touches a provider: pack
metadata is plain JSON, and validation is schema-driven and offline.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from . import schema

__all__ = ["StylePack", "load"]


class StylePack:
    """A loaded, validatable style pack directory."""

    def __init__(self, dir: Path):
        self.dir = Path(dir)
        self.manifest: dict[str, Any] = {}
        self.problems: list[str] = []

    # ---- paths -----------------------------------------------------------
    @property
    def name(self) -> str:
        return str(self.manifest.get("name") or self.dir.name)

    @property
    def manifest_path(self) -> Path:
        return self.dir / "pack.json"

    @property
    def grade_path(self) -> Path:
        return self.dir / "grade.json"

    @property
    def cadence_path(self) -> Path:
        return self.dir / "cadence.json"

    @property
    def spec_path(self) -> Path:
        return self.dir / "spec.json"

    @property
    def grounding_path(self) -> Path:
        return self.dir / "grounding.txt"

    @property
    def lut_path(self) -> Path:
        return self.dir / "look.cube"

    @property
    def stills_dir(self) -> Path:
        return self.dir / "stills"

    @property
    def props_dir(self) -> Path:
        return self.dir / "props"

    @property
    def plates_dir(self) -> Path:
        return self.dir / "plates"

    # ---- io --------------------------------------------------------------
    def read_json(self, path: Path) -> dict:
        if not path.exists():
            return {}
        return json.loads(path.read_text(encoding="utf-8"))

    def stills(self) -> list[Path]:
        return sorted(self.stills_dir.glob("*.png")) if self.stills_dir.exists() else []

    def props(self) -> list[Path]:
        return sorted(self.props_dir.glob("*.glb")) if self.props_dir.exists() else []

    def plates(self) -> list[Path]:
        return sorted(p for p in self.plates_dir.glob("*") if p.is_file()) \
            if self.plates_dir.exists() else []

    # ---- inspect / validate ----------------------------------------------
    def inspect(self) -> dict[str, Any]:
        """Validate every artifact against its schema; return a full report."""
        errors: list[str] = list(self.problems)
        warnings: list[str] = []

        self._check("pack.json (manifest)", self.manifest,
                    schema.PACK_MANIFEST_SCHEMA, errors)

        grade = self._inspect_json(self.grade_path, schema.GRADE_SCHEMA, errors)
        if not self.grade_path.exists():
            warnings.append("grade.json: missing (pack has no measured grade)")

        cadence = self._inspect_json(self.cadence_path, schema.CADENCE_SCHEMA, errors)
        if not self.cadence_path.exists():
            warnings.append("cadence.json: missing (pack has no measured cadence)")

        spec = self._inspect_json(self.spec_path, schema.SPEC_SCHEMA, errors)
        if not self.spec_path.exists():
            warnings.append("spec.json: missing (pack has no distilled spec)")

        if not self.grounding_path.exists():
            warnings.append("grounding.txt: missing (no measured ground truth)")

        stills, props, plates = self.stills(), self.props(), self.plates()
        if not stills:
            warnings.append(
                "stills: none present - a full pack carries keyframe stills; "
                "the shipped fixture is metadata-only by design"
            )
        if not props:
            warnings.append("props: none present")
        lut_present = self.lut_path.exists()
        inventory = self.manifest.get("artifacts", {})
        inventory = inventory if isinstance(inventory, dict) else {}

        status = "valid" if not errors else "invalid"
        return {
            "name": self.name,
            "dir": str(self.dir),
            "manifest_version": self.manifest.get("version"),
            "refs": self.manifest.get("refs", []),
            "artifacts": {
                "lut": inventory.get("lut") if lut_present else None,
                "lut_present": lut_present,
                "grade": bool(grade),
                "cadence": bool(cadence),
                "spec": bool(spec),
                "grounding": self.grounding_path.exists(),
                "stills": len(stills),
                "props": len(props),
                "plates": len(plates),
            },
            "grade": {
                k: grade.get(k)
                for k in ("black_point", "white_point", "contrast",
                          "saturation", "warmth", "tint", "noise_sigma")
            } if grade else {},
            "cadence": {
                k: cadence.get(k)
                for k in ("mean_shot", "median_shot", "cuts_per_min",
                          "rhythm_variance", "n_shots", "fps",
                          "total_duration")
            } if cadence else {},
            "validation": {"status": status, "errors": errors, "warnings": warnings},
        }

    @staticmethod
    def _inspect_json(path: Path, schem: dict, errors: list[str]) -> dict:
        if not path.exists():
            return {}
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
        except json.JSONDecodeError as exc:
            errors.append(f"{path.name}: {exc}")
            return {}
        StylePack._check(path.name, payload, schem, errors)
        return payload if isinstance(payload, dict) else {}

    @staticmethod
    def _check(label: str, payload: dict, schem: dict, errors: list[str]) -> None:
        problems = schema.validate(payload, schem)
        for p in problems:
            errors.append(f"{label}: {p}")


def load(path: str | Path) -> StylePack:
    """Load a pack directory; raises if no manifest exists."""
    sp = StylePack(Path(path))
    if not sp.manifest_path.exists():
        raise FileNotFoundError(
            f"no style pack at {sp.dir} - expected a pack.json manifest"
        )
    try:
        payload = json.loads(sp.manifest_path.read_text(encoding="utf-8"))
        if isinstance(payload, dict):
            sp.manifest = payload
        else:
            sp.problems.extend(
                f"pack.json: {problem}"
                for problem in schema.validate(payload, schema.PACK_MANIFEST_SCHEMA)
            )
    except json.JSONDecodeError as exc:
        sp.manifest = {}
        sp.problems.append(f"pack.json: {exc}")
    return sp
