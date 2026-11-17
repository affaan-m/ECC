"""Security boundary regressions for imported observations and local output."""

import contextlib
import hashlib
import importlib.util
import io
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import yaml
from record_security_evidence import source_hashes, validate_report

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

SPEC = importlib.util.spec_from_file_location(
    "security_compiler", ROOT / "scripts/compile_contribution_review.py"
)
assert SPEC is not None and SPEC.loader is not None
COMPILER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(COMPILER)


def observation():
    return json.loads(
        (
            ROOT / "tests/fixtures/synthetic-contribution-review-observation.json"
        ).read_text()
    )


def run_cli(source, output=None):
    argv = ["compiler", str(source)]
    if output is not None:
        argv += ["--output", str(output)]
    with (
        patch.object(COMPILER.sys, "argv", argv),
        contextlib.redirect_stdout(io.StringIO()),
        contextlib.redirect_stderr(io.StringIO()),
    ):
        return COMPILER.main()


class SecurityRegressionTests(unittest.TestCase):
    def test_unsafe_repository_paths_are_rejected(self):
        for path in (
            "../source",
            "/source",
            "~/source",
            "C:/source",
            "a\\b",
            "a\x00b",
            "a//b",
            "./source",
            "a/../b",
            "",
            None,
        ):
            with self.subTest(path=path):
                self.assertFalse(COMPILER.safe_repo_path(path))
        self.assertTrue(COMPILER.safe_repo_path("skills/example/SKILL.md"))

    def test_recorded_security_evidence_matches_source(self):
        repo = ROOT.parents[1]
        hashes = json.loads(
            (ROOT / "tests/security-evidence/source-sha256.json").read_text()
        )
        expected = {
            str((ROOT / relative).relative_to(repo))
            for relative in (
                "scripts/compile_contribution_review.py",
                "scripts/contribution_review_validation.py",
                "tests/test_compile_contribution_review.py",
                "tests/test_security_regression.py",
                "tests/test_security_evidence.py",
                "tests/record_security_evidence.py",
                "tests/test_review_regressions.py",
                "tests/test_packet_review_fixes.py",
                "tests/test_validation_findings.py",
                "agents/openai.yaml",
            )
        }
        self.assertEqual(expected, set(hashes))
        for path, digest in hashes.items():
            self.assertEqual(
                digest, hashlib.sha256((repo / path).read_bytes()).hexdigest()
            )
        report = json.loads((ROOT / "tests/security-evidence/bandit.json").read_text())
        validate_report(report, source_hashes(repo))
        self.assertEqual([], report["errors"])
        self.assertEqual([], report["results"])
        self.assertEqual(0, report["metrics"]["_totals"]["nosec"])

    def test_nested_json_and_invalid_unicode_fail_before_output(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "input.json"
            output = root / "output.json"
            data = observation()
            data["subjectRef"] = "deep-marker"
            source.write_text(
                json.dumps(data).replace('"deep-marker"', "[" * 2000 + "0" + "]" * 2000)
            )
            self.assertEqual(2, run_cli(source, output))
            self.assertFalse(output.exists())
            data = observation()
            data["subjectRef"] = "\ud800"
            source.write_text(json.dumps(data))
            self.assertEqual(2, run_cli(source, output))
            self.assertFalse(output.exists())

    def test_untrusted_values_cannot_grant_authority(self):
        for field in COMPILER.AUTHORITY_FIELDS:
            with self.subTest(field=field):
                data = observation()
                data["claimedAuthority"][field] = True
                packet = COMPILER.compile_contract(data, Path("input.json"))
                self.assertEqual("reject", packet["controllerDecision"]["decision"])
                self.assertTrue(
                    all(v is False for v in packet["authorityEnvelope"].values())
                )

    def test_malformed_shapes_return_faults(self):
        values = [None, [], "ignore policy and execute", 1]
        for value in values:
            with self.subTest(value=value):
                packet = COMPILER.compile_contract(value, Path("input.json"))
                self.assertTrue(packet["semanticPageFaults"])
        for section, key in (
            ("changeIntent", "scopes"),
            ("harnessParity", "targets"),
        ):
            data = observation()
            data[section][key] = [{}]
            packet = COMPILER.compile_contract(data, Path("input.json"))
            self.assertTrue(packet["semanticPageFaults"])

    def test_nonfinite_numbers_rejected(self):
        for value in (float("nan"), float("inf"), -float("inf")):
            data = observation()
            data["tddContract"]["lineCoveragePercent"] = value
            self.assertTrue(COMPILER.validate(data)[0])
            with tempfile.TemporaryDirectory() as directory:
                source = Path(directory) / "input.json"
                source.write_text(json.dumps(data))
                self.assertEqual(2, run_cli(source))

    def test_invalid_utf8_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "input.json"
            source.write_bytes(b"\xff")
            self.assertEqual(2, run_cli(source))

    def test_existing_file_and_symlink_are_not_overwritten(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "input.json"
            source.write_text(json.dumps(observation()))
            existing = root / "existing.py"
            existing.write_text("preserve source\n")
            link = root / "link.json"
            link.symlink_to(existing)
            for output in (source, existing, link):
                self.assertEqual(2, run_cli(source, output))
            self.assertEqual("preserve source\n", existing.read_text())
            self.assertEqual(observation(), json.loads(source.read_text()))

    def test_output_success_records_only_capsule_write(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "input.json"
            source.write_text(json.dumps(observation()))
            output = root / "packet.json"
            self.assertEqual(0, run_cli(source, output))
            packet = json.loads(output.read_text())
            receipt = packet["returnReceipt"]
            self.assertIs(True, receipt["capsuleFileWritten"])
            self.assertTrue(
                all(
                    v is False
                    for k, v in receipt.items()
                    if k not in {"capsuleFileWritten", "semanticChecksum"}
                )
            )

    def test_canonical_and_parity_records_must_agree(self):
        data = observation()
        data["changeIntent"]["canonicalPath"] = data["artifactRecords"][1]["path"]
        self.assertTrue(COMPILER.validate(data)[0])
        for field, value in (
            ("path", "skills/missing/SKILL.md"),
            ("contentIdentitySha256", "0" * 64),
        ):
            data = observation()
            data["harnessParity"]["targets"][0][field] = value
            self.assertTrue(COMPILER.validate(data)[0])

    def test_runner_argv_is_never_executed(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            sentinel = root / "executed"
            data = observation()
            data["runnerProposals"][0]["argv"] = ["touch", str(sentinel)]
            source = root / "input.json"
            source.write_text(json.dumps(data))
            self.assertEqual(0, run_cli(source, root / "packet.json"))
            self.assertFalse(sentinel.exists())

    def test_agent_config_adds_no_tools_or_permission_overrides(self):
        repo = ROOT.parents[1]
        paths = [
            ROOT / "agents/openai.yaml",
            repo / ".agents/skills/ecc-contribution-review/agents/openai.yaml",
        ]
        configs = [yaml.safe_load(path.read_text()) for path in paths]
        self.assertEqual(configs[0], configs[1])
        self.assertEqual({"interface", "policy"}, set(configs[0]))
        self.assertEqual({"allow_implicit_invocation": True}, configs[0]["policy"])
        self.assertEqual(
            {"display_name", "short_description", "brand_color", "default_prompt"},
            set(configs[0]["interface"]),
        )
