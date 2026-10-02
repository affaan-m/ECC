"""Generation input failures must be caught before provider uploads."""

from __future__ import annotations

import io
import sys
import tempfile
import unittest
from contextlib import redirect_stdout
from pathlib import Path
from types import SimpleNamespace
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))

import apply as generation  # noqa: E402


class GenerationPreflightTests(unittest.TestCase):
    def test_missing_overlay_prevents_base_video_upload(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            base = root / "base.mp4"
            still = root / "still.png"
            base.write_bytes(b"base fixture")
            still.write_bytes(b"still fixture")
            pack = SimpleNamespace(
                stills=lambda: [still], read_json=lambda _: {},
                spec_path=root / "spec.json", grade_path=root / "grade.json",
                cadence_path=root / "cadence.json",
            )
            plan = [{"index": 0, "gen_duration": 5, "used": 1,
                     "shots": [{"start": 0, "duration": 1}]}]
            with mock.patch.object(generation.pack_mod, "load", return_value=pack), \
                    mock.patch.object(generation.cad_mod, "plan_takes", return_value=plan), \
                    mock.patch.object(generation.falapi, "upload") as upload, \
                    redirect_stdout(io.StringIO()):
                with self.assertRaisesRegex(SystemExit, "--overlay not found"):
                    generation.apply(
                        "fixture", "", "", 1, base_video=str(base),
                        overlays=[str(still), str(root / "missing.png")],
                        out=str(root / "output.mp4"),
                    )
                upload.assert_not_called()


if __name__ == "__main__":
    unittest.main()
