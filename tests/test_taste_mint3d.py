"""Mocked minting regressions; no optional renderer or provider is needed."""

import importlib.util
import io
import tempfile
import unittest
from contextlib import redirect_stdout
from pathlib import Path
from types import ModuleType, SimpleNamespace
from unittest.mock import Mock, patch

SCRIPT = (
    Path(__file__).resolve().parents[1] / "skills/taste-application/scripts/mint3d.py"
)


class MintPreservationTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.props = self.root / "props"
        self.props.mkdir()
        self.fal = Mock()
        self.fal.FalError = RuntimeError
        self.fal.ENDPOINTS = dict.fromkeys(
            ("image_to_3d", "text_to_3d", "retopology", "part_split"), "model"
        )
        self.fal.is_dry_run.return_value = False
        self.fal.text_to_3d.return_value = "https://v3.fal.media/fullpbr.glb"
        self.fal.retopologize.return_value = "https://v3.fal.media/proxy.glb"
        self.fal.download.side_effect = lambda url, dest: Path(dest).write_text(url)
        pack = SimpleNamespace(
            dir=self.root, spec_path=self.root / "spec.json", read_json=lambda _: {}
        )
        self.loader = Mock(return_value=pack)
        self.renderer = Mock()
        self.renderer.turntable.return_value = (["frame.png"], "mock")
        fake = ModuleType("taste")
        fake.falapi = self.fal
        fake.pack = SimpleNamespace(load=self.loader)
        fake.render3d = self.renderer
        spec = importlib.util.spec_from_file_location("mint_preservation_test", SCRIPT)
        self.module = importlib.util.module_from_spec(spec)
        with patch.dict("sys.modules", {"taste": fake}):
            spec.loader.exec_module(self.module)
        quiet = redirect_stdout(io.StringIO())
        quiet.__enter__()
        self.addCleanup(quiet.__exit__, None, None, None)

    def test_raw_retained_before_remesh_and_rendered(self):
        def remesh(url, **kwargs):
            self.assertEqual((self.props / "visor.glb").read_text(), url)
            return "https://v3.fal.media/proxy.glb"

        self.fal.retopologize.side_effect = remesh
        record = self.module.mint3d(
            "genre", prompt="chrome visor", name="visor", retopo=True
        )
        self.assertEqual(
            (self.props / "visor.glb").read_text(), "https://v3.fal.media/fullpbr.glb"
        )
        self.assertEqual(
            (self.props / "visor_retopo.glb").read_text(),
            "https://v3.fal.media/proxy.glb",
        )
        self.assertEqual(record["mesh"], str(self.props / "visor.glb"))
        self.assertEqual(record["retopo_mesh"], str(self.props / "visor_retopo.glb"))
        self.assertEqual(
            self.renderer.turntable.call_args.args[0], self.props / "visor.glb"
        )

    def test_existing_artifacts_refused_before_generation(self):
        for relative in (
            "props/visor.glb",
            "props/visor_plate.png",
            "props/visor_retopo.glb",
            "props/visor.json",
            "props/visor_part00.glb",
            "turntables/visor.mp4",
            "turntables/visor",
        ):
            with self.subTest(relative=relative):
                artifact = self.root / relative
                artifact.parent.mkdir(parents=True, exist_ok=True)
                artifact.write_bytes(b"original")
                with self.assertRaises(FileExistsError):
                    self.module.mint3d(
                        "genre", prompt="chrome visor", name="visor", retopo=True
                    )
                self.assertEqual(artifact.read_bytes(), b"original")
                artifact.unlink()
        self.fal.text_to_3d.assert_not_called()
        self.fal.text_to_image.assert_not_called()
        self.fal.image_to_3d.assert_not_called()

    def test_remesh_failure_keeps_original_renderable(self):
        self.fal.retopologize.side_effect = RuntimeError("mock failure")
        record = self.module.mint3d("genre", prompt="visor", name="visor", retopo=True)
        self.assertEqual(
            (self.props / "visor.glb").read_text(), "https://v3.fal.media/fullpbr.glb"
        )
        self.assertNotIn("retopo_mesh", record)
        self.assertEqual(
            self.renderer.turntable.call_args.args[0], self.props / "visor.glb"
        )


if __name__ == "__main__":
    unittest.main()
