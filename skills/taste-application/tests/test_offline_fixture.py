"""Failing-first tests: offline fixture path + documented provenance."""

from __future__ import annotations

import json
import sys
import unittest
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1] / "scripts"
sys.path.insert(0, str(REPO_ROOT))

FIXTURE = Path(__import__("tasteforge").__file__).resolve().parent / "fixtures" / "flashethereal"
PROVENANCE_MD = REPO_ROOT.parent / "SOURCE.md"


class OfflineFixtureTests(unittest.TestCase):
    def test_fixture_contains_recovered_metadata_only(self):
        names = {p.name for p in FIXTURE.iterdir()}
        self.assertIn("pack.json", names)
        self.assertIn("grade.json", names)
        self.assertIn("cadence.json", names)
        self.assertIn("spec.json", names)
        self.assertIn("grounding.txt", names)
        # Deliberately excluded heavy/binary recovered artifacts.
        self.assertNotIn("look.cube", names)
        self.assertFalse(any(n.endswith(".glb") for n in names))
        self.assertFalse(any(n.endswith(".png") for n in names))
        self.assertNotIn(".DS_Store", names)

    def test_cadence_statistics_are_self_consistent(self):
        cad = json.loads((FIXTURE / "cadence.json").read_text())
        durs = [s["duration"] for s in cad["shots"]]
        self.assertEqual(cad["n_shots"], len(durs))
        self.assertAlmostEqual(cad["mean_shot"], sum(durs) / len(durs), places=2)
        self.assertGreater(cad["cuts_per_min"], 50)

    def test_grade_has_zone_structure(self):
        grade = json.loads((FIXTURE / "grade.json").read_text())
        self.assertEqual(len(grade["zones"]), 5)
        self.assertEqual(len(grade["palette"][0]), 2)
        self.assertEqual(len(grade["l_cdf"]), 256)

    def test_pack_manifest_matches_recovered_values(self):
        manifest = json.loads((FIXTURE / "pack.json").read_text())
        self.assertEqual(manifest["name"], "flashethereal")
        self.assertEqual(len(manifest["refs"]), 3)
        self.assertEqual(manifest["mint"]["lut_size"], 33)
        self.assertTrue(manifest["distill"]["dry_run"])


class ProvenanceDocTests(unittest.TestCase):
    def test_provenance_md_documents_lineage_and_exclusions(self):
        text = PROVENANCE_MD.read_text()
        self.assertIn("5e0dc440df4dcf6b2082a7dd59e1d6e9cc11d10166d4e1a19dc6c96478f4d2c8", text)
        self.assertIn("Raw media", text)

    def test_readme_documents_operator_workflow(self):
        readme = (Path(__import__("tasteforge").__file__).resolve().parent / "README.md").read_text()
        for cmd in ("inspect", "validate", "interview", "distill", "apply", "export"):
            self.assertIn(cmd, readme)


if __name__ == "__main__":
    unittest.main()
