"""Regression coverage for PR #3598 review findings."""

import ast
import contextlib
import importlib.util
import io
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
SPEC = importlib.util.spec_from_file_location(
    "review_compiler", ROOT / "scripts/compile_contribution_review.py"
)
assert SPEC is not None and SPEC.loader is not None
COMPILER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(COMPILER)


def observation():
    return json.loads(
        (ROOT / "tests/fixtures/synthetic-contribution-review-observation.json").read_text()
    )


def cli_packet(data):
    with tempfile.TemporaryDirectory() as directory:
        source = Path(directory) / "input.json"
        source.write_text(json.dumps(data))
        stdout, stderr = io.StringIO(), io.StringIO()
        with (
            patch.object(COMPILER.sys, "argv", ["compiler", str(source)]),
            contextlib.redirect_stdout(stdout),
            contextlib.redirect_stderr(stderr),
        ):
            status = COMPILER.main()
        return status, json.loads(stdout.getvalue()), stderr.getvalue()


class ReviewRegressionTests(unittest.TestCase):
    def assert_diagnostic(self, data, reason):
        status, packet, stderr = cli_packet(data)
        self.assertEqual(2, status)
        self.assertEqual("", stderr)
        self.assertIn(reason, packet["controllerDecision"]["reasonCodes"])
        self.assertEqual(packet["semanticChecksum"], COMPILER.checksum(packet))

    def test_unhashable_failure_modes_emit_diagnostics(self):
        for value in ([], {}, ["secret-in-diff"], None, 123, "unknown"):
            for replacement in (False, True):
                with self.subTest(value=value, replacement=replacement):
                    data = observation()
                    if replacement:
                        data["failureProbes"] = [{"failureMode": value}]
                    else:
                        data["failureProbes"][0]["failureMode"] = value
                    self.assert_diagnostic(data, "failure_probe_coverage_failed")

    def test_standalone_cli_emits_malformed_probe_packet(self):
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "input.json"
            data = observation()
            data["failureProbes"] = [{"failureMode": []}]
            source.write_text(json.dumps(data))
            for flags in ([], ["-P"], ["-I"]):
                with self.subTest(flags=flags):
                    result = subprocess.run(
                        [sys.executable, *flags, str(ROOT / "scripts/compile_contribution_review.py"), str(source)],
                        capture_output=True, text=True, check=False, cwd=directory,
                    )
                    self.assertEqual(2, result.returncode)
                    self.assertEqual("", result.stderr)
                    packet = json.loads(result.stdout)
                    self.assertIn("failure_probe_coverage_failed", packet["controllerDecision"]["reasonCodes"])

    def test_non_skill_labels_are_rejected(self):
        for kind in ("agent", "command", "hook", "rule", "script", [], None):
            with self.subTest(kind=kind):
                data = observation()
                data["changeIntent"]["changeKind"] = kind
                self.assert_diagnostic(data, "change_intent_failed")

    def test_coverage_percentages_cannot_exceed_100(self):
        for field in (
            "lineCoveragePercent", "functionCoveragePercent",
            "branchCoveragePercent", "statementCoveragePercent",
        ):
            with self.subTest(field=field):
                data = observation()
                data["tddContract"][field] = 150
                self.assert_diagnostic(data, "tdd_contract_failed")
                data["tddContract"][field] = 100
                self.assertEqual(0, cli_packet(data)[0])

    def test_catalog_components_must_be_nonnegative(self):
        for field, other in (
            ("curatedSkillsReferenced", "intentionallyUnshippedSkills"),
            ("intentionallyUnshippedSkills", "curatedSkillsReferenced"),
        ):
            with self.subTest(field=field):
                data = observation()
                total = data["catalogContract"]["filesystemSkills"]
                data["catalogContract"].update({field: -1, other: total + 1})
                self.assert_diagnostic(data, "catalog_reconciliation_failed")
                data["catalogContract"].update({field: 0, other: total})
                self.assertEqual(0, cli_packet(data)[0])

    def test_envelope_values_are_validated(self):
        cases = {
            "schemaVersion": ("999.0.0", None, 1, ""),
            "observedAt": (None, [], 123, "", "  ", "yesterday", "2026-02-30T12:00:00Z", "2026-10-16", "2026-10-16T12:00:00", "2026-10-16T12:00:00+00:99"),
            "subjectRef": (None, {}, 123, "", "  "),
        }
        for field, values in cases.items():
            for value in values:
                with self.subTest(field=field, value=value):
                    data = observation()
                    data[field] = value
                    status, packet, stderr = cli_packet(data)
                    self.assertEqual(2, status)
                    self.assertTrue(packet["semanticPageFaults"])
                    self.assertEqual("", stderr)

    def test_valid_envelope_and_offsets_remain_supported(self):
        for timestamp in ("2026-10-16T12:34:56Z", "2026-10-16T12:34:56-04:00"):
            data = observation()
            data["observedAt"] = timestamp
            status, packet, _ = cli_packet(data)
            self.assertEqual(0, status)
            self.assertEqual(timestamp, packet["generatedAt"])

    def test_compiler_functions_and_modules_meet_size_policy(self):
        for path in (ROOT / "scripts").glob("*.py"):
            source = path.read_text()
            self.assertLessEqual(len(source.splitlines()), 800, str(path))
            for node in ast.walk(ast.parse(source)):
                if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                    with self.subTest(path=path.name, function=node.name):
                        self.assertLess(node.end_lineno - node.lineno + 1, 50)
