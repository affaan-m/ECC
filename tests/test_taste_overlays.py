"""Requested image overlays must fail closed if compositing fails."""

import importlib.util
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

if any(
    importlib.util.find_spec(name) is None for name in ("numpy", "cv2", "scenedetect")
):
    raise unittest.SkipTest("Install taste-application requirements for overlay tests")

SCRIPTS = Path(__file__).resolve().parents[1] / "skills/taste-application/scripts"
sys.path.insert(0, str(SCRIPTS))
spec = importlib.util.spec_from_file_location("overlay_forge", SCRIPTS / "forge.py")
forge = importlib.util.module_from_spec(spec)
spec.loader.exec_module(forge)


class OverlayFailureTests(unittest.TestCase):
    @unittest.skipUnless(
        shutil.which("ffmpeg") and shutil.which("ffprobe"), "FFmpeg required"
    )
    def test_still_overlay_preserves_all_video_frames(self):
        import cv2

        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            take, plate, out = (
                root / name for name in ("take.mp4", "plate.png", "out.mp4")
            )
            subprocess.run(
                [
                    "ffmpeg",
                    "-nostdin",
                    "-v",
                    "error",
                    "-f",
                    "lavfi",
                    "-i",
                    "color=c=black:s=64x64:r=30:d=0.5",
                    "-c:v",
                    "libx264",
                    str(take),
                ],
                check=True,
                timeout=20,
            )
            image = forge.np.full((16, 16, 4), 255, dtype=forge.np.uint8)
            self.assertTrue(cv2.imwrite(str(plate), image))
            forge.asm.overlay(take, plate, out, width=64, height=64)
            cap = cv2.VideoCapture(str(out))
            frames = []
            while True:
                ok, frame = cap.read()
                if not ok:
                    break
                frames.append(frame)
            cap.release()
            self.assertEqual(len(frames), 15)
            self.assertTrue(all(frame.max() > 30 for frame in frames))

    @unittest.skipUnless(
        shutil.which("ffmpeg") and shutil.which("ffprobe"), "FFmpeg required"
    )
    def test_rgba_overlay_preserves_background_and_respects_alpha_opacity(self):
        import cv2

        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            take, plate, out = (
                root / name for name in ("take.mp4", "plate.png", "out.mp4")
            )
            subprocess.run(
                [
                    "ffmpeg",
                    "-nostdin",
                    "-v",
                    "error",
                    "-f",
                    "lavfi",
                    "-i",
                    "color=c=black:s=64x64:r=30:d=0.1",
                    "-c:v",
                    "libx264",
                    str(take),
                ],
                check=True,
                timeout=20,
            )
            # Nonzero RGB underneath zero alpha must remain invisible.
            image = forge.np.full((16, 16, 4), 255, dtype=forge.np.uint8)
            image[:, :, 3] = 0
            image[4:12, 4:12, 3] = 128
            self.assertTrue(cv2.imwrite(str(plate), image))
            forge.asm.overlay(
                take, plate, out, width=64, height=64, scale=0.5, opacity=0.5
            )
            cap = cv2.VideoCapture(str(out))
            ok, frame = cap.read()
            cap.release()
            self.assertTrue(ok)
            self.assertLess(int(frame[:8, :8].max()), 8)
            self.assertLess(int(frame[17:20, 17:20].max()), 8)
            # Half-alpha white at half opacity over black is about 64/255.
            self.assertGreater(float(frame[29:35, 29:35].mean()), 50)
            self.assertLess(float(frame[29:35, 29:35].mean()), 80)

    def test_failed_requested_overlay_prevents_final_video_and_manifest(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            take, plate, out = (
                root / name for name in ("take.mp4", "plate.png", "out.mp4")
            )
            take.write_bytes(b"original video")
            plate.write_bytes(b"original image")
            with (
                patch.object(
                    forge.pack_mod,
                    "load",
                    return_value=SimpleNamespace(
                        grade_path="grade", cadence_path="cadence"
                    ),
                ),
                patch.object(forge.grade_mod, "load_stats"),
                patch.object(
                    forge.cad_mod,
                    "load",
                    return_value=SimpleNamespace(
                        mean_shot=1,
                        cuts_per_min=60,
                        rhythm_variance=0,
                        plan_shots=lambda _: [1],
                    ),
                ),
                patch.object(
                    forge.frame_mod,
                    "probe",
                    return_value=SimpleNamespace(
                        width=320, height=180, fps=30, duration=1
                    ),
                ),
                patch.object(forge.asm, "normalize", return_value=take),
                patch.object(forge.grade_mod, "grade_clip_direct"),
                patch.object(forge.asm, "cut_take", return_value=[take]),
                patch.object(forge.plate_mod, "tighten", return_value=plate),
                patch.object(forge.plate_mod, "plate_coverage", return_value=0.3),
                patch.object(
                    forge.asm, "overlay", side_effect=RuntimeError("compositor failed")
                ),
                patch.object(forge.asm, "concat") as concat,
                patch.object(forge.tl_mod, "write_timeline") as timeline,
                patch.object(forge.asm, "write_manifest") as manifest,
            ):
                with self.assertRaisesRegex(RuntimeError, "compositor failed"):
                    forge.forge(
                        "look",
                        [str(take)],
                        str(out),
                        overlays=[str(plate)],
                        work=str(root / "work"),
                        fps=30,
                    )
                concat.assert_not_called()
                timeline.assert_not_called()
                manifest.assert_not_called()
                self.assertFalse(out.exists())
                self.assertEqual(take.read_bytes(), b"original video")
                self.assertEqual(plate.read_bytes(), b"original image")


if __name__ == "__main__":
    unittest.main()
