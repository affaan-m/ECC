"""Original Blender workflow boundary tests without importing bpy."""

import importlib.util
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace

SCRIPT = (
    Path(__file__).resolve().parents[1]
    / "skills/taste-application/scripts/blender_prop.py"
)
spec = importlib.util.spec_from_file_location("blender_prop", SCRIPT)
prop = importlib.util.module_from_spec(spec)
spec.loader.exec_module(prop)


class BlenderPropTests(unittest.TestCase):
    def test_frame_geometry_validation(self):
        for frames, width, height, fps in [
            (0, 640, 480, 30),
            (48, 0, 480, 30),
            (48, 640, 480, float("nan")),
            (True, 640, 480, 30),
            (48, 640, 480, 0),
        ]:
            with self.subTest(frames=frames, fps=fps), self.assertRaises(ValueError):
                prop.validate_settings(frames, width, height, fps)
        prop.validate_settings(48, 1920, 1080, 29.97)

    def test_legacy_and_layered_fcurves(self):
        curve = SimpleNamespace(
            keyframe_points=[SimpleNamespace(interpolation="BEZIER")]
        )
        old = SimpleNamespace(fcurves=[curve])
        prop.linearize_action(old)
        self.assertEqual(curve.keyframe_points[0].interpolation, "LINEAR")
        curve.keyframe_points[0].interpolation = "BEZIER"
        bag = SimpleNamespace(fcurves=[curve])
        strip = SimpleNamespace(channelbags=[bag])
        new = SimpleNamespace(layers=[SimpleNamespace(strips=[strip])])
        prop.linearize_action(new)
        self.assertEqual(curve.keyframe_points[0].interpolation, "LINEAR")

    def test_output_cannot_overwrite_or_follow_symlinks(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary).resolve()
            target = root / "scene.blend"
            prop.validate_output(target)
            target.touch()
            with self.assertRaises(ValueError):
                prop.validate_output(target)
            link = root / "link.blend"
            link.symlink_to(target)
            with self.assertRaises(ValueError):
                prop.validate_output(link)

    def test_geometry_rejects_nonfinite_and_empty(self):
        for lower, upper in [((0, 0, 0), (0, 0, 0)), ((0, 0, 0), (float("inf"), 1, 1))]:
            with self.assertRaises(ValueError):
                prop.validate_bounds(lower, upper)
        prop.validate_bounds((-1, -1, -1), (1, 1, 1))

    def test_landscape_camera_preserves_sphere_fit(self):
        self.assertAlmostEqual(
            prop.camera_distance(1, 1024, 1024), (3.2**2 + 0.8**2) ** 0.5
        )
        self.assertGreater(
            prop.camera_distance(1, 1920, 1080), prop.camera_distance(1, 1024, 1024)
        )

    def test_render_receipt_requires_every_frame_and_finished_status(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            with self.assertRaises(RuntimeError):
                prop.verify_render({"FINISHED"}, root, 2)
            for frame in (1, 2):
                (root / f"turn_{frame:04d}.png").write_bytes(b"png")
            with self.assertRaises(RuntimeError):
                prop.verify_render({"CANCELLED"}, root, 2)
            prop.verify_render({"FINISHED"}, root, 2)
            (root / "turn_0002.png").write_bytes(b"")
            with self.assertRaises(RuntimeError):
                prop.verify_render({"FINISHED"}, root, 2)

    def test_lab_neutral_white(self):
        self.assertTrue(
            all(0.99 <= value <= 1 for value in prop._lab_to_linear_srgb(100, 0, 0))
        )
