"""Failing-first tests for offline distillation and the fail-closed live path."""

from __future__ import annotations

import json
import sys
import unittest
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1] / "scripts"
sys.path.insert(0, str(REPO_ROOT))

from tasteforge import distill, interview, schema  # noqa: E402

FIXTURE = Path(__import__("tasteforge").__file__).resolve().parent / "fixtures" / "flashethereal"


def _profile():
    return interview.conduct(
        {
            "palette": "near-black void, bone white, violet bloom",
            "grain": "fine 35mm grain",
            "lighting": "single hard key",
            "focal_length": "35mm",
            "camera_motion": "locked off",
            "subject_framing": "centered, headroom",
            "grade_description": "crushed blacks",
            "mood_adjectives": "holy, crystalline",
            "avoid": "plastic highlights",
            "brief": "courier in night traffic",
        },
        genre="flashethereal",
    )


class LocalDistillTests(unittest.TestCase):
    def test_distill_local_produces_valid_spec(self):
        spec = distill.distill_local(_profile())
        problems = schema.validate(spec, schema.SPEC_SCHEMA)
        self.assertEqual(problems, [])

    def test_distill_local_is_deterministic(self):
        a = distill.distill_local(_profile())
        b = distill.distill_local(_profile())
        a["source"].pop("generated"), b["source"].pop("generated")
        self.assertEqual(a, b)

    def test_distill_local_labels_dry_run_and_carries_answers(self):
        spec = distill.distill_local(_profile())
        self.assertTrue(spec["source"]["dry_run"])
        self.assertEqual(spec["source"]["provider"], "none")
        self.assertEqual(spec["lighting"], "single hard key")
        self.assertEqual(spec["mood_adjectives"], ["holy", "crystalline"])

    def test_grounding_from_grade_states_measurements(self):
        grade = json.loads((FIXTURE / "grade.json").read_text())
        cadence = json.loads((FIXTURE / "cadence.json").read_text())
        text = distill.grounding_from_grade(grade, cadence)
        self.assertIn("MEASURED GROUND TRUTH", text)
        self.assertIn("black point", text)
        self.assertIn("#131215", text)  # dominant palette hex survives
        self.assertIn("cuts/min", text)
        # The banned-words contract from the recovered grounding prompt.
        self.assertIn("Do not contradict", text)

    def test_grounding_from_empty_inputs_is_empty(self):
        self.assertEqual(distill.grounding_from_grade({}, {}), "")


class FailClosedLiveTests(unittest.TestCase):
    def test_distill_live_raises_provider_disabled(self):
        with self.assertRaises(distill.ProviderDisabledError) as ctx:
            distill.distill_live(_profile())
        self.assertIn("separately authorized", str(ctx.exception))

    def test_no_network_module_imported(self):
        import sys as _sys

        _sys.modules.pop("fal_client", None)
        try:
            distill.distill_live(_profile())
        except distill.ProviderDisabledError:
            pass
        self.assertNotIn("fal_client", _sys.modules)
        self.assertNotIn("urllib.request", _sys.modules)


if __name__ == "__main__":
    unittest.main()
