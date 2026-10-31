"""Style pack: the durable artifact that makes taste reusable.

A pack is a directory, not a database row, so it can be copied, versioned in
git, zipped, and handed to someone else. Genres partition the library:
``stylepacks/flashethereal/``, ``stylepacks/<next-genre>/``, and so on.

Layout::

    stylepacks/flashethereal/
        pack.json       manifest: refs, artifact inventory, version
        grade.json      GradeStats - color statistics incl. per-zone chroma
        cadence.json    Cadence    - shot-length distribution
        spec.json       VLM style spec (written by distill.py)
        look.cube       33^3 LUT baked against canonical neutral
        stills/         full-res keyframes - the primary style carrier
        props/          GLB meshes minted from hero frames
        plates/         grain / overlay plates
"""

from __future__ import annotations

import json
import shutil
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path

DEFAULT_ROOT = Path("stylepacks")
PACK_VERSION = 1


def _utc_now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


@dataclass
class StylePack:
    name: str
    root: Path = DEFAULT_ROOT
    manifest: dict = field(default_factory=dict)

    # ---- paths -----------------------------------------------------------
    @property
    def dir(self) -> Path:
        return Path(self.root) / self.name

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

    # ---- lifecycle -------------------------------------------------------
    def ensure(self) -> "StylePack":
        for d in (self.dir, self.stills_dir, self.props_dir, self.plates_dir):
            d.mkdir(parents=True, exist_ok=True)
        if not self.manifest:
            self.manifest = {
                "name": self.name,
                "version": PACK_VERSION,
                "created": _utc_now(),
                "updated": _utc_now(),
                "refs": [],
                "artifacts": {},
            }
        return self

    def add_ref(self, ref_id: str, src: str, duration: float, n_shots: int) -> None:
        self.manifest.setdefault("refs", []).append(
            {
                "id": ref_id,
                "src": str(src),
                "duration": round(float(duration), 3),
                "n_shots": int(n_shots),
            }
        )

    def stills(self) -> list[Path]:
        return sorted(self.stills_dir.glob("*.png")) if self.stills_dir.exists() else []

    def props(self) -> list[Path]:
        return sorted(self.props_dir.glob("*.glb")) if self.props_dir.exists() else []

    def refresh_inventory(self) -> None:
        self.manifest["artifacts"] = {
            "lut": self.lut_path.name if self.lut_path.exists() else None,
            "grade": self.grade_path.exists(),
            "cadence": self.cadence_path.exists(),
            "spec": self.spec_path.exists(),
            "stills": len(self.stills()),
            "props": len(self.props()),
            "plates": len(list(self.plates_dir.glob("*"))) if self.plates_dir.exists() else 0,
        }
        self.manifest["updated"] = _utc_now()

    def save(self) -> Path:
        self.ensure()
        self.refresh_inventory()
        self.manifest_path.write_text(json.dumps(self.manifest, indent=2), encoding="utf-8")
        return self.manifest_path

    def write_json(self, path: Path, payload: dict) -> Path:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(payload, indent=2), encoding="utf-8")
        return path

    def read_json(self, path: Path) -> dict:
        if not path.exists():
            return {}
        return json.loads(path.read_text(encoding="utf-8"))

    def archive(self, dest_dir: str | Path = "out") -> Path:
        """Zip the pack so a whole taste can be handed off as one file."""
        dest_dir = Path(dest_dir)
        dest_dir.mkdir(parents=True, exist_ok=True)
        base = dest_dir / f"{self.name}-stylepack"
        return Path(shutil.make_archive(str(base), "zip", root_dir=self.dir))


def load(name: str, root: str | Path = DEFAULT_ROOT) -> StylePack:
    p = StylePack(name=name, root=Path(root))
    if not p.manifest_path.exists():
        raise FileNotFoundError(
            f"no style pack '{name}' under {root} - run mint.py first"
        )
    p.manifest = json.loads(p.manifest_path.read_text(encoding="utf-8"))
    return p


def create(name: str, root: str | Path = DEFAULT_ROOT) -> StylePack:
    return StylePack(name=name, root=Path(root)).ensure()


def list_packs(root: str | Path = DEFAULT_ROOT) -> list[str]:
    root = Path(root)
    if not root.exists():
        return []
    return sorted(d.name for d in root.iterdir() if (d / "pack.json").exists())
