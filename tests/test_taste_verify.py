"""Verification must distinguish an absent target from a measured zero."""

import importlib.util
import json
import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

if any(
    importlib.util.find_spec(name) is None for name in ("numpy", "cv2", "scenedetect")
):
    raise unittest.SkipTest(
        "Install taste-application/scripts/requirements.txt for the creative verification tests"
    )

import numpy as np

SCRIPTS = Path(__file__).resolve().parents[1] / "skills/taste-application/scripts"
sys.path.insert(0, str(SCRIPTS))
spec = importlib.util.spec_from_file_location("taste_verify", SCRIPTS / "verify.py")
verify = importlib.util.module_from_spec(spec)
spec.loader.exec_module(verify)


class BackgroundTargetTests(unittest.TestCase):
    def check_background(self, grade, luminance):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "grade.json"
            path.write_text(json.dumps(grade))
            stats = SimpleNamespace(
                contrast=0,
                black_point=0,
                white_point=100,
                zones=[],
                bg_share=grade.get("bg_share", 0),
            )
            pack = SimpleNamespace(grade_path=path, cadence_path="cadence.json")
            lab = np.array([[luminance, 0, 0]] * 100, dtype=np.float32)
            with (
                patch.object(verify.pack_mod, "load", return_value=pack),
                patch.object(verify.grade_mod, "load_stats", return_value=stats),
                patch.object(verify.cad_mod, "load"),
                patch.object(verify, "_lab", return_value=lab),
            ):
                result = verify.verify("output.mp4", "look", check_cadence=False)
            return next(c for c in result["checks"] if c["check"] == "background")

    def test_measured_zero_is_checked_and_passes_light_output(self):
        result = self.check_background({"bg_share": 0.0}, 50)
        self.assertIs(result["pass"], True)
        self.assertEqual(result["want"], "0.0% +/- 20")

    def test_measured_zero_fails_black_output(self):
        self.assertIs(self.check_background({"bg_share": 0.0}, 0)["pass"], False)

    def test_absent_target_is_skipped_despite_dataclass_default_zero(self):
        self.assertIsNone(self.check_background({}, 0)["pass"])

    def test_null_target_is_skipped(self):
        self.assertIsNone(self.check_background({"bg_share": None}, 0)["pass"])

    def test_positive_target_retains_existing_metric(self):
        result = self.check_background({"bg_share": 0.9}, 0)
        self.assertIs(result["pass"], True)
        self.assertEqual(result["want"], "90.0% +/- 20")

    def test_invalid_target_fails_instead_of_skipping(self):
        for value in [float("nan"), float("inf"), -0.1, 1.1, "invalid", True]:
            with self.subTest(value=value):
                self.assertIs(
                    self.check_background({"bg_share": value}, 0)["pass"], False
                )


if __name__ == "__main__":
    unittest.main()
