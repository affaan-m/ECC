"""Regression coverage for the original standalone creative pipeline."""

import importlib.util
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
        "Install taste-application/scripts/requirements.txt for the creative pipeline tests"
    )

SCRIPTS = Path(__file__).resolve().parents[1] / "skills/taste-application/scripts"
sys.path.insert(0, str(SCRIPTS))


def load(name):
    spec = importlib.util.spec_from_file_location(name, SCRIPTS / f"{name}.py")
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


pipeline = load("pipeline")
forge = load("forge")
apply = load("apply")


class PipelineTests(unittest.TestCase):
    def run_pipeline(self, *extra):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "look").mkdir()
            (root / "look/grade.json").touch()
            with (
                patch.object(
                    sys,
                    "argv",
                    ["pipeline", "--genre", "look", "--root", directory, *extra],
                ),
                patch.object(
                    pipeline.subprocess,
                    "run",
                    return_value=SimpleNamespace(returncode=0),
                ) as run,
            ):
                pipeline.main()
                return run.call_args_list

    def test_passthrough_is_offline_and_preserves_caller_paths(self):
        calls = self.run_pipeline(
            "--takes", "relative/take.mp4", "--out", "relative/final.mp4", "--fps", "30"
        )
        self.assertEqual(
            [Path(c.args[0][1]).name for c in calls], ["forge.py", "verify.py"]
        )
        for call in calls:
            self.assertTrue(Path(call.args[0][1]).is_absolute())
            self.assertNotIn("cwd", call.kwargs)
        self.assertIn("relative/take.mp4", calls[0].args[0])
        self.assertIn("--fps", calls[0].args[0])

    def test_passthrough_dry_run_executes_nothing(self):
        self.assertEqual(self.run_pipeline("--takes", "take.mp4", "--dry-run"), [])

    def test_passthrough_rejects_prop_before_execution(self):
        with self.assertRaises(SystemExit):
            self.run_pipeline("--takes", "take.mp4", "--prop", "chrome")

    def test_collision_blocks_all_provider_stages(self):
        with tempfile.TemporaryDirectory() as directory:
            out = Path(directory) / "final.mp4"
            out.touch()
            with patch.object(pipeline, "_run") as run:
                with self.assertRaises(FileExistsError):
                    self.run_pipeline("--out", str(out), "--prop", "chrome")
                run.assert_not_called()

    def test_tier_is_forwarded(self):
        calls = self.run_pipeline("--tier", "value", "--no-distill", "--dry-run")
        self.assertIn("--tier", calls[0].args[0])
        self.assertIn("value", calls[0].args[0])

    def test_invalid_fps_rejected_before_execution(self):
        for fps in ["0", "-1", "nan", "inf"]:
            with self.subTest(fps=fps), self.assertRaises(SystemExit):
                self.run_pipeline("--takes", "take.mp4", "--fps", fps)


class ApplyTests(unittest.TestCase):
    def test_tier_selected_before_provider_calls(self):
        with (
            tempfile.TemporaryDirectory() as directory,
            patch.object(apply.falapi, "use_tier") as tier,
            patch.object(
                apply.pack_mod,
                "load",
                side_effect=RuntimeError("stop before generation"),
            ),
        ):
            with self.assertRaisesRegex(RuntimeError, "stop before generation"):
                apply.apply(
                    "look",
                    "",
                    "",
                    1,
                    out=str(Path(directory) / "fresh.mp4"),
                    tier="value",
                )
            tier.assert_called_once_with("reference_to_video", "value")

    def test_collision_rejected_before_pack_or_provider_access(self):
        with (
            tempfile.TemporaryDirectory() as directory,
            patch.object(apply.pack_mod, "load") as pack,
        ):
            out = Path(directory) / "final.mp4"
            for collision in (
                out,
                out.with_suffix(".generation.json"),
                out.parent / "final_takes",
            ):
                collision.touch()
                with self.assertRaises(FileExistsError):
                    apply.apply("look", "", "", 1, out=str(out))
                pack.assert_not_called()
                collision.unlink()

    def test_invalid_fps_rejected_before_pack_or_provider_access(self):
        with patch.object(apply.pack_mod, "load") as pack:
            with self.assertRaises(ValueError):
                apply.apply("look", "", "", 1, fps=float("nan"))
            pack.assert_not_called()


class ForgeTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.take = self.root / "take.mp4"
        self.take.touch()
        self.work = self.root / "work"
        self.out = self.root / "final.mp4"
        info = SimpleNamespace(width=640, height=480, fps=24.0, duration=1.0)
        cadence = SimpleNamespace(
            mean_shot=1, cuts_per_min=60, rhythm_variance=0, plan_shots=lambda _: [1]
        )
        stats = SimpleNamespace(contrast=1, black_point=0, white_point=1)
        for target, value in [
            (
                forge.pack_mod,
                ("load", SimpleNamespace(grade_path="grade", cadence_path="cadence")),
            ),
            (forge.grade_mod, ("load_stats", stats)),
            (forge.cad_mod, ("load", cadence)),
            (forge.frame_mod, ("probe", info)),
        ]:
            p = patch.object(target, value[0], return_value=value[1])
            p.start()
            self.addCleanup(p.stop)

    def render(self, **kwargs):
        def write(_src, dst, *_args, **_kwargs):
            Path(dst).parent.mkdir(parents=True, exist_ok=True)
            Path(dst).touch()
            return Path(dst)

        def cuts(_src, _shots, dst, **_kwargs):
            return [write(None, Path(dst) / "shot.mp4")]

        def timeline(*_args, **kwargs):
            return write(None, kwargs["out_path"])

        with (
            patch.object(forge.asm, "normalize", side_effect=write) as normalize,
            patch.object(forge.grade_mod, "grade_clip_direct", side_effect=write),
            patch.object(forge.asm, "cut_take", side_effect=cuts),
            patch.object(forge.asm, "concat", side_effect=write),
            patch.object(forge.tl_mod, "write_timeline", side_effect=timeline),
            patch.object(forge.asm, "write_manifest"),
        ):
            result = forge.forge(
                "look", [str(self.take)], str(self.out), work=str(self.work), **kwargs
            )
            return result, normalize.call_args

    def test_keeps_previous_editable_shots_and_uses_explicit_fps(self):
        self.work.mkdir()
        old = self.work / "sole-editable.mp4"
        old.write_bytes(b"precious")
        _, call = self.render(fps=30)
        self.assertEqual(old.read_bytes(), b"precious")
        self.assertEqual(call.args[-1], 30)
        self.assertNotEqual(call.args[1].parent, self.work)

    def test_output_collision_rejected_without_writes(self):
        for suffix in [".mp4", ".fcpxml", ".edl", ".json"]:
            with self.subTest(suffix=suffix):
                existing = self.out.with_suffix(suffix)
                existing.touch()
                with self.assertRaises((ValueError, FileExistsError)):
                    self.render()
                self.assertFalse(self.work.exists())
                existing.unlink()

    def test_invalid_input_does_not_create_work(self):
        self.take.unlink()
        with self.assertRaises((ValueError, FileNotFoundError, SystemExit)):
            self.render()
        self.assertFalse(self.work.exists())

    def test_nonfinite_fps_does_not_create_work(self):
        for fps in [0, -1, float("nan"), float("inf")]:
            with self.subTest(fps=fps), self.assertRaises(ValueError):
                self.render(fps=fps)
        self.assertFalse(self.work.exists())

    def test_timeline_export_failure_propagates(self):
        for failing_format in ("fcpxml", "edl"):

            def export(*args, **kwargs):
                if kwargs["fmt"] == failing_format:
                    raise RuntimeError("export broken")
                path = kwargs["out_path"]
                path.touch()
                return path

            with (
                self.subTest(format=failing_format),
                patch.object(forge.tl_mod, "write_timeline", side_effect=export),
                patch.object(forge.asm, "normalize", return_value=self.take),
                patch.object(forge.grade_mod, "grade_clip_direct"),
                patch.object(forge.asm, "cut_take", return_value=[self.take]),
                patch.object(forge.asm, "concat"),
                patch.object(forge.asm, "write_manifest") as manifest,
            ):
                with self.assertRaisesRegex(RuntimeError, "export broken"):
                    forge.forge(
                        "look", [str(self.take)], str(self.out), work=str(self.work)
                    )
                manifest.assert_not_called()


if __name__ == "__main__":
    unittest.main()
