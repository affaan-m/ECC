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
        errors: list[str] = []
        warnings: list[str] = []

        self._check("pack.json (manifest)", self.manifest,
                    schema.PACK_MANIFEST_SCHEMA, errors)

        grade = self.read_json(self.grade_path)
        if grade:
            self._check("grade.json", grade, schema.GRADE_SCHEMA, errors)
        elif self.grade_path.exists():
            errors.append("grade.json: unreadable JSON")
        else:
            warnings.append("grade.json: missing (pack has no measured grade)")

        cadence = self.read_json(self.cadence_path)
        if cadence:
            self._check("cadence.json", cadence, schema.CADENCE_SCHEMA, errors)
        elif self.cadence_path.exists():
            errors.append("cadence.json: unreadable JSON")
        else:
            warnings.append("cadence.json: missing (pack has no measured cadence)")

        spec = self.read_json(self.spec_path)
        if spec:
            self._check("spec.json", spec, schema.SPEC_SCHEMA, errors)
        elif self.spec_path.exists():
            errors.append("spec.json: unreadable JSON")
        else:
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

        status = "valid" if not errors else "invalid"
        return {
            "name": self.name,
            "dir": str(self.dir),
            "manifest_version": self.manifest.get("version"),
            "refs": self.manifest.get("refs", []),
            "artifacts": {
                "lut": self.manifest.get("artifacts", {}).get("lut") if lut_present else None,
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
        sp.manifest = json.loads(sp.manifest_path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        sp.manifest = {}
        sp.problems.append(f"pack.json: {exc}")
    return sp
