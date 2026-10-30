"""Failing-first tests for the deterministic taste interview/profile."""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1] / "scripts"
sys.path.insert(0, str(REPO_ROOT))

from tasteforge import interview, schema  # noqa: E402


class QuestionSetTests(unittest.TestCase):
    def test_questions_cover_required_axes(self):
        ids = {q.id for q in interview.QUESTIONS}
        for required in (
            "palette", "grain", "lighting", "focal_length", "camera_motion",
            "subject_framing", "grade_description", "mood_adjectives", "avoid",
            "brief",
        ):
            self.assertIn(required, ids)

    def test_every_question_has_prompt_and_id(self):
        for q in interview.QUESTIONS:
            self.assertTrue(q.id)
            self.assertTrue(q.prompt)


class ConductTests(unittest.TestCase):
    def _answers(self):
        return {
            "palette": "near-black void with bone-white highlights and one violet bloom",
            "grain": "fine 35mm grain",
            "lighting": "single hard key, backgrounds unlit",
            "focal_length": "35mm, mild compression",
            "camera_motion": "locked off with slow push-ins",
            "subject_framing": "centered subjects, generous headroom",
            "grade_description": "crushed blacks, blown highlights, cool mids",
            "mood_adjectives": "holy, crystalline, distant",
            "avoid": "over-saturated skin, plastic highlights, drifting camera",
            "brief": "a courier weaves through night traffic",
        }

    def test_conduct_produces_valid_profile(self):
        profile = interview.conduct(self._answers(), genre="flashethereal")
        problems = schema.validate(profile, schema.TASTE_PROFILE_SCHEMA)
        self.assertEqual(problems, [])
        self.assertEqual(profile["genre"], "flashethereal")

    def test_missing_answers_are_flagged_not_invented(self):
        answers = self._answers()
        del answers["lighting"]
        profile = interview.conduct(answers, genre="flashethereal")
        self.assertIn("lighting", profile["unanswered"])
        self.assertNotIn("lighting", profile["constraints"]["look"])
        # but the profile is still schema-valid
        self.assertEqual(schema.validate(profile, schema.TASTE_PROFILE_SCHEMA), [])

    def test_profile_deterministic(self):
        a = interview.conduct(self._answers(), genre="g")
        b = interview.conduct(self._answers(), genre="g")
        a.pop("created"), b.pop("created")
        self.assertEqual(a, b)

    def test_constraints_split_look_and_content(self):
        profile = interview.conduct(self._answers(), genre="flashethereal")
        look = profile["constraints"]["look"]
        self.assertIn("lighting", look)
        self.assertIn("mood_adjectives", look)
        self.assertIn("avoid", look)
        self.assertEqual(
            profile["constraints"]["content"]["brief"],
            "a courier weaves through night traffic",
        )


if __name__ == "__main__":
    unittest.main()
