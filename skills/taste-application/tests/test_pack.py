"""Failing-first tests for offline style-pack inspect/validate."""

from __future__ import annotations

import json
import sys
import tempfile
import unittest
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1] / "scripts"
sys.path.insert(0, str(REPO_ROOT))

from tasteforge import pack as pack_mod  # noqa: E402

FIXTURE = Path(__import__("tasteforge").__file__).resolve().parent / "fixtures" / "flashethereal"


class FixturePackTests(unittest.TestCase):
    def test_fixture_pack_loads_and_inspecks(self):
        sp = pack_mod.load(FIXTURE)
        self.assertEqual(sp.name, "flashethereal")
        report = sp.inspect()
        self.assertEqual(report["name"], "flashethereal")
        self.assertEqual(report["manifest_version"], 1)
        self.assertEqual(len(report["refs"]), 3)
        self.assertTrue(report["artifacts"]["grade"])
        self.assertTrue(report["artifacts"]["cadence"])
        self.assertTrue(report["artifacts"]["spec"])

    def test_inspect_reports_validation_status(self):
        report = pack_mod.load(FIXTURE).inspect()
        self.assertEqual(report["validation"]["status"], "valid")
        self.assertEqual(report["validation"]["errors"], [])
        # The fixture deliberately ships metadata only; missing stills must be
        # a warning, never silently ignored.
        self.assertTrue(
            any("stills" in w for w in report["validation"]["warnings"])
        )

    def test_inspect_includes_cadence_and_grade_summary(self):
        report = pack_mod.load(FIXTURE).inspect()
        self.assertAlmostEqual(report["cadence"]["mean_shot"], 0.78, places=1)
        self.assertGreater(report["cadence"]["n_shots"], 50)
        self.assertIn("contrast", report["grade"])

    def test_fixture_spec_is_dry_run(self):
        sp = pack_mod.load(FIXTURE)
        spec = sp.read_json(sp.spec_path)
        self.assertTrue(spec["source"]["dry_run"])


class BrokenPackTests(unittest.TestCase):
    def _write(self, tmp, manifest) -> Path:
        d = Path(tmp) / "brokenpack"
        d.mkdir(parents=True)
        (d / "pack.json").write_text(json.dumps(manifest))
        return d

    def test_missing_manifest_raises(self):
        with tempfile.TemporaryDirectory() as td:
            with self.assertRaises(FileNotFoundError):
                pack_mod.load(Path(td) / "nowhere")

    def test_invalid_manifest_reports_errors(self):
        with tempfile.TemporaryDirectory() as td:
            d = self._write(td, {"name": "broken", "version": 99})
            report = pack_mod.load(d).inspect()
            self.assertEqual(report["validation"]["status"], "invalid")
            self.assertTrue(report["validation"]["errors"])

    def test_corrupt_cadence_reported(self):
        with tempfile.TemporaryDirectory() as td:
            d = self._write(
                td,
                {
                    "name": "broken",
                    "version": 1,
                    "created": "2026-08-16T05:53:05Z",
                    "updated": "2026-08-16T07:10:42Z",
                    "refs": [],
                    "artifacts": {},
                },
            )
            (d / "cadence.json").write_text(json.dumps({"shots": "nope"}))
            report = pack_mod.load(d).inspect()
            self.assertEqual(report["validation"]["status"], "invalid")
            self.assertTrue(any("cadence" in e for e in report["validation"]["errors"]))


if __name__ == "__main__":
    unittest.main()
