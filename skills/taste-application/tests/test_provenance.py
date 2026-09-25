"""Failing-first tests for tasteforge provenance and provider-reference policy.

Contract:
- exact lineage of the recovered TasteForge sources is recorded as data;
- a provider workflow may only ever be referenced, never claimed as saved;
- the Claude cloud session is recorded honestly (selected, transcript absent).
"""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1] / "scripts"
sys.path.insert(0, str(REPO_ROOT))

from tasteforge import provenance  # noqa: E402

CANONICAL = "recovered/tasteforge-flow-20260818"
LATEST_SHA = "ef06a606d3b528fbd939b05fadc25bf6674073a1e05a01e3aa6b9c9416fd6284"
SESSION = "redacted-local-session"


class LineageTests(unittest.TestCase):
    def test_lineage_report_names_canonical_source(self):
        report = provenance.lineage_report()
        self.assertEqual(report["canonical_source"]["path"], CANONICAL)
        self.assertTrue(report["canonical_source"]["read_only"])

    def test_all_five_generations_recorded_with_digests(self):
        gens = provenance.lineage_report()["generations"]
        self.assertEqual(len(gens), 5)
        latest = [g for g in gens if g["archive"] == "tasteforge (4).zip"][0]
        self.assertEqual(latest["sha256"], LATEST_SHA)
        self.assertEqual(latest["status"], "latest")
        for g in gens[:-1]:
            self.assertEqual(g["status"], "prior")

    def test_generation_deltas_explain_lineage(self):
        gens = provenance.lineage_report()["generations"]
        self.assertTrue(all(g.get("delta") for g in gens))
        latest = gens[-1]
        self.assertIn("grade", latest["delta"])

    def test_claude_session_recorded_honestly(self):
        sess = provenance.lineage_report()["claude_session"]
        self.assertEqual(sess["id"], SESSION)
        self.assertFalse(sess["transcript_available"])
        self.assertTrue(sess["selection_evidence_local"])

    def test_lineage_report_passes_schema(self):
        from tasteforge import schema

        problems = schema.validate(
            provenance.lineage_report(), schema.PROVENANCE_SCHEMA
        )
        self.assertEqual(problems, [])


class ProviderReferenceTests(unittest.TestCase):
    def test_provider_reference_is_pointer_only(self):
        ref = provenance.provider_reference("fal")
        self.assertEqual(ref["kind"], "provider-workflow-reference")
        self.assertEqual(ref["provider"], "fal")
        self.assertTrue(ref["reference_only"])
        self.assertFalse(ref["persisted_workflow_state"])
        self.assertFalse(ref["authorizes_execution"])

    def test_saved_workflow_state_is_rejected(self):
        record = {"kind": "provider-workflow-reference", "provider": "fal",
                  "reference_only": True, "persisted_workflow_state": True,
                  "authorizes_execution": False}
        with self.assertRaises(provenance.SavedWorkflowClaimError):
            provenance.assert_no_saved_provider_workflow([record])

    def test_clean_records_pass(self):
        provenance.assert_no_saved_provider_workflow([provenance.provider_reference("fal")])


if __name__ == "__main__":
    unittest.main()
