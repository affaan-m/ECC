"""Immutable validation and independent authority-scan regressions."""

import copy
import json
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
from compile_contribution_review import compile_contract  # noqa: E402
from contribution_review_validation import (  # noqa: E402
    _validate_authority,
    _validate_repo,
    add_issue,
    validate,
)


def observation():
    return json.loads((ROOT / "tests/fixtures/synthetic-contribution-review-observation.json").read_text())


class ValidationFindingsTests(unittest.TestCase):
    def test_add_issue_returns_new_list_without_mutating_caller(self):
        original = [{"code": "prior", "plane": 1, "detail": "prior fault"}]
        before = copy.deepcopy(original)
        result = add_issue(original, "new", 2, "new fault")
        self.assertEqual(before, original)
        self.assertEqual(["prior", "new"], [item["code"] for item in result])
        duplicate = add_issue(result, "new", 2, "duplicate")
        self.assertEqual(result, duplicate)
        self.assertIsNot(result, duplicate)

    def test_section_validators_leave_caller_owned_lists_unchanged(self):
        data = observation()
        data["repoIdentity"]["branch"] = "main"
        data["claimedAuthority"]["mayCommit"] = True
        for validator in (_validate_repo, _validate_authority):
            with self.subTest(validator=validator.__name__):
                prior = [{"code": "prior", "plane": 1, "detail": "prior fault"}]
                before = copy.deepcopy(prior)
                result = validator(data, prior)
                self.assertEqual(before, prior)
                self.assertGreater(len(result), len(prior))

    def test_malformed_gate_does_not_hide_authority_rejection(self):
        data = observation()
        data["validationMatrix"][0]["gateId"] = []
        data["claimedAuthority"]["mayCommit"] = True
        before = copy.deepcopy(data)
        packet = compile_contract(data, Path("observation.json"))
        self.assertEqual(before, data)
        self.assertEqual("reject", packet["controllerDecision"]["decision"])
        self.assertIn("unsafe_generated_authority", packet["controllerDecision"]["reasonCodes"])
        self.assertIn("observation_shape_invalid", packet["controllerDecision"]["reasonCodes"])

    def test_malformed_section_preserves_other_faults_and_authority(self):
        data = observation()
        data["repoIdentity"]["branch"] = "main"
        data["validationMatrix"][0]["gateId"] = []
        data["claimedAuthority"]["mayCommit"] = True
        faults, contradictions = validate(data)
        self.assertIn("repo_identity_failed", [item["code"] for item in faults])
        self.assertIn("observation_shape_invalid", [item["code"] for item in faults])
        self.assertIn("unsafe_generated_authority", [item["code"] for item in contradictions])

    def test_invalid_top_level_section_does_not_hide_authority(self):
        data = observation()
        data["validationMatrix"] = None
        data["claimedAuthority"]["mayCommit"] = True
        _, contradictions = validate(data)
        self.assertIn("unsafe_generated_authority", [item["code"] for item in contradictions])


if __name__ == "__main__":
    unittest.main()
