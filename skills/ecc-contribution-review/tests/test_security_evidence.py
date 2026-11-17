"""Provenance regressions for recorded Bandit scans."""

import copy
import json
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from typing import Any
from unittest.mock import patch

import record_security_evidence as evidence


def report(sources: dict[str, str]) -> dict[str, Any]:
    return {
        "errors": [], "results": [],
        "metrics": {"_totals": {"nosec": 0}, **{p: {} for p in sources}},
        "source_provenance": {
            "scanner": "bandit", "version": "1.9.4", "sha256": sources,
        },
    }


class SecurityEvidenceTests(unittest.TestCase):
    def test_same_line_edit_cannot_be_hidden_by_refreshed_manifest(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / evidence.SCRIPTS / "example.py"
            source.parent.mkdir(parents=True)
            source.write_text("value = 1\n")
            recorded = report(evidence.source_hashes(root))
            source.write_text("value = 2\n")
            refreshed_manifest = evidence.source_hashes(root)
            self.assertEqual(1, len(source.read_text().splitlines()))
            with self.assertRaisesRegex(ValueError, "provenance"):
                evidence.validate_report(recorded, refreshed_manifest)

    def test_report_requires_exact_scanned_inventory_and_version(self) -> None:
        sources = {"scripts/example.py": "a" * 64}
        evidence.validate_report(report(sources), sources)
        for field, value in (("version", "0.0.0"), ("sha256", {})):
            data = report(sources)
            data["source_provenance"][field] = value
            with self.assertRaises(ValueError):
                evidence.validate_report(data, sources)
        data = report(sources)
        data["metrics"].pop("scripts/example.py")
        with self.assertRaises(ValueError):
            evidence.validate_report(data, sources)

    def test_record_binds_real_scan_output(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / evidence.SCRIPTS / "example.py"
            source.parent.mkdir(parents=True)
            source.write_text("value = 1\n")
            raw = report(evidence.source_hashes(root))
            raw.pop("source_provenance")
            def scan(argv: list[str], **kwargs: Any) -> SimpleNamespace:
                self.assertFalse(kwargs.get("shell", False))
                self.assertEqual(root, kwargs["cwd"])
                Path(argv[-1]).write_text(json.dumps(raw))
                return SimpleNamespace(returncode=0)
            with patch.object(evidence, "version", return_value="1.9.4"), patch.object(evidence.subprocess, "run", side_effect=scan):
                self.assertEqual(0, evidence.record(root, root / "report.json"))
            evidence.validate_report(json.loads((root / "report.json").read_text()), evidence.source_hashes(root))

    def test_failed_scan_does_not_replace_existing_report(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            output = root / "report.json"
            output.write_text("preserve\n")
            with patch.object(evidence, "version", return_value="1.9.4"), patch.object(evidence.subprocess, "run", return_value=SimpleNamespace(returncode=2)):
                with self.assertRaises(RuntimeError):
                    evidence.record(root, output)
            self.assertEqual("preserve\n", output.read_text())

    def test_scan_findings_are_preserved(self) -> None:
        data = report({})
        data["results"] = [{"test_id": "example"}]
        original = copy.deepcopy(data)
        evidence.validate_report(data, {})
        self.assertEqual(original, data)

    def test_source_drift_discards_scan(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / evidence.SCRIPTS / "example.py"
            source.parent.mkdir(parents=True)
            source.write_text("value = 1\n")
            def scan(argv: list[str], **kwargs: Any) -> SimpleNamespace:
                Path(argv[-1]).write_text(json.dumps(report(evidence.source_hashes(root))))
                source.write_text("value = 2\n")
                return SimpleNamespace(returncode=0)
            with patch.object(evidence, "version", return_value="1.9.4"), patch.object(evidence.subprocess, "run", side_effect=scan):
                with self.assertRaisesRegex(RuntimeError, "changed"):
                    evidence.record(root, root / "report.json")
            self.assertFalse((root / "report.json").exists())

    def test_findings_and_scanner_version_cannot_be_hidden(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            data = report({})
            data["results"] = [{"test_id": "example"}]
            def scan(argv: list[str], **kwargs: Any) -> SimpleNamespace:
                Path(argv[-1]).write_text(json.dumps(data))
                return SimpleNamespace(returncode=1)
            with patch.object(evidence, "version", return_value="1.9.4"), patch.object(evidence.subprocess, "run", side_effect=scan):
                self.assertEqual(1, evidence.record(root, root / "report.json"))
            self.assertEqual(data["results"], json.loads((root / "report.json").read_text())["results"])
            with patch.object(evidence, "version", return_value="0.0.0"):
                with self.assertRaises(RuntimeError):
                    evidence.record(root, root / "report.json")
