from __future__ import annotations

import copy
import importlib.util
import json
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
S = importlib.util.spec_from_file_location(
    "ecc_proof", ROOT / "scripts/compile_contribution_review.py"
)
M = importlib.util.module_from_spec(S)
assert S.loader is not None
S.loader.exec_module(M)


def worked():
    return json.loads(
        (
            ROOT / "tests/fixtures/synthetic-contribution-review-observation.json"
        ).read_text()
    )


def unsafe():
    return json.loads(
        (
            ROOT / "tests/fixtures/unsafe-contribution-review-observation.json"
        ).read_text()
    )


def compile_data(d):
    with tempfile.TemporaryDirectory() as t:
        return M.compile_contract(d, Path(t) / "observation.json")


class ContributionReviewTests(unittest.TestCase):
    def test_synthetic_example_requires_independent_review(self):
        a = compile_data(worked())
        self.assertEqual("require_review", a["controllerDecision"]["decision"])
        self.assertEqual(
            "review_packet_compiled", a["domainPayload"]["contributionOutcome"]
        )

    def test_checksum_and_receipt_match(self):
        a = compile_data(worked())
        self.assertEqual(a["semanticChecksum"], M.checksum(a))
        self.assertEqual(a["semanticChecksum"], a["returnReceipt"]["semanticChecksum"])

    def test_packet_reports_no_unperformed_effects(self):
        a = compile_data(worked())
        self.assertTrue(
            all(
                v is False
                for k, v in a["returnReceipt"].items()
                if k != "semanticChecksum"
            )
        )
        self.assertTrue(all(v is False for v in a["authorityEnvelope"].values()))

    def test_runners_are_unexecuted(self):
        a = compile_data(worked())
        self.assertEqual(
            M.RUNNERS, {x["role"] for x in a["domainPayload"]["runnerProposals"]}
        )
        self.assertTrue(
            all(
                x["executed"] is False and x["requiresExternalAuthorization"] is True
                for x in a["domainPayload"]["runnerProposals"]
            )
        )

    def test_wrong_repo_fails(self):
        d = worked()
        d["repoIdentity"]["rootName"] = "mirror"
        a = compile_data(d)
        self.assertEqual("require_review", a["controllerDecision"]["decision"])
        self.assertIn("repo_identity_failed", a["controllerDecision"]["reasonCodes"])

    def test_generated_root_requires_review(self):
        d = worked()
        d["surfaceContract"]["generatedRootsExcluded"] = False
        a = compile_data(d)
        self.assertEqual("require_review", a["controllerDecision"]["decision"])
        self.assertIn(
            "canonical_surface_failed", a["controllerDecision"]["reasonCodes"]
        )

    def test_mirror_drift_requires_review(self):
        d = worked()
        d["harnessParity"]["targets"][1]["contentIdentitySha256"] = "0" * 64
        a = compile_data(d)
        self.assertEqual("require_review", a["controllerDecision"]["decision"])
        self.assertIn("harness_parity_failed", a["controllerDecision"]["reasonCodes"])

    def test_catalog_count_drift_requires_review(self):
        d = worked()
        d["catalogContract"]["documentedSkills"] = 280
        a = compile_data(d)
        self.assertEqual("require_review", a["controllerDecision"]["decision"])
        self.assertIn(
            "catalog_reconciliation_failed", a["controllerDecision"]["reasonCodes"]
        )

    def test_validation_failure_requires_review(self):
        d = worked()
        d["validationMatrix"][0]["observedExit"] = 1
        a = compile_data(d)
        self.assertEqual("require_review", a["controllerDecision"]["decision"])
        self.assertIn(
            "validation_matrix_failed", a["controllerDecision"]["reasonCodes"]
        )

    def test_missing_red_phase_requires_review(self):
        d = worked()
        d["tddContract"]["redObserved"] = False
        a = compile_data(d)
        self.assertEqual("require_review", a["controllerDecision"]["decision"])
        self.assertIn("tdd_contract_failed", a["controllerDecision"]["reasonCodes"])

    def test_secret_in_diff_requires_review(self):
        d = worked()
        d["securityContract"]["secretsDetected"] = True
        a = compile_data(d)
        self.assertEqual("require_review", a["controllerDecision"]["decision"])
        self.assertIn(
            "security_contract_failed", a["controllerDecision"]["reasonCodes"]
        )

    def test_budget_overrun_requires_review(self):
        d = worked()
        d["budgetContract"]["observedChangedFiles"] = 11
        a = compile_data(d)
        self.assertEqual("require_review", a["controllerDecision"]["decision"])
        self.assertIn("change_budget_failed", a["controllerDecision"]["reasonCodes"])

    def test_bad_commit_subject_requires_review(self):
        d = worked()
        d["commitContract"]["subject"] = "x" * 80
        d["commitContract"]["subjectLength"] = 80
        a = compile_data(d)
        self.assertEqual("require_review", a["controllerDecision"]["decision"])
        self.assertIn("commit_contract_failed", a["controllerDecision"]["reasonCodes"])

    def test_effect_claim_rejects(self):
        d = worked()
        d["claimsCommitCreated"] = True
        a = compile_data(d)
        self.assertEqual("reject", a["controllerDecision"]["decision"])
        self.assertIn("commit_claim_forbidden", a["controllerDecision"]["reasonCodes"])

    def test_unsafe_fixture_rejects_effect_free(self):
        a = compile_data(unsafe())
        self.assertEqual("reject", a["controllerDecision"]["decision"])
        self.assertIn(
            "unsafe_generated_authority", a["controllerDecision"]["reasonCodes"]
        )
        self.assertTrue(
            all(
                v is False
                for k, v in a["returnReceipt"].items()
                if k != "semanticChecksum"
            )
        )

    def test_semantic_mutation_changes_checksum(self):
        a = compile_data(worked())
        b = copy.deepcopy(a)
        b["domainPayload"]["contributionReceiptProposal"]["commitCreated"] = True
        self.assertNotEqual(a["semanticChecksum"], M.checksum(b))

    def test_malformed_optional_lists_fail_closed_without_crashing(self):
        for section, field in (
            ("changeIntent", "counterevidenceRefs"),
            ("checkpointContract", "remainingUnknowns"),
        ):
            with self.subTest(section=section, field=field):
                d = worked()
                d[section][field] = None
                a = compile_data(d)
                self.assertEqual("require_review", a["controllerDecision"]["decision"])
                self.assertTrue(a["semanticPageFaults"])

    def test_cli_refuses_to_overwrite_observation(self):
        with tempfile.TemporaryDirectory() as t:
            path = Path(t) / "observation.json"
            original = json.dumps(worked())
            path.write_text(original)
            from unittest.mock import patch

            with patch.object(
                M.sys, "argv", ["compiler", str(path), "--output", str(path)]
            ):
                self.assertEqual(2, M.main())
            self.assertEqual(original, path.read_text())


if __name__ == "__main__":
    unittest.main()
