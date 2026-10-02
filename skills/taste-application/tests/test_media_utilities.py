import io
import json
import pathlib
import shutil
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import Mock, call, patch

sys.path.insert(0, str(pathlib.Path(__file__).parents[1] / "scripts"))
from tasteforge.media import capcut, stills


class MediaUtilitiesTests(unittest.TestCase):
    def test_reject_bad_geometry_before_execution(self):
        runner = Mock()
        for kwargs in ({"width": 0}, {"fps": float("nan")}, {"duration": -1}):
            with self.assertRaises(ValueError):
                stills.make_clip("missing.png", "out.mp4", runner=runner, **kwargs)
        runner.assert_not_called()

    def test_still_failure_propagates_and_preserves_destination(self):
        with tempfile.TemporaryDirectory() as directory:
            source = pathlib.Path(directory) / "in.png"
            source.touch()
            target = pathlib.Path(directory) / "out.mp4"
            target.write_bytes(b"old")
            runner = Mock(side_effect=subprocess.CalledProcessError(1, "ffmpeg"))
            with self.assertRaises(FileExistsError):
                stills.make_clip(source, target, runner=runner)
            runner.assert_not_called()
            with self.assertRaises(subprocess.CalledProcessError):
                stills.make_clip(source, target, overwrite=True, runner=runner)
            self.assertEqual(target.read_bytes(), b"old")

    def test_crop_changes_filter(self):
        first = stills.filter_graph(
            (0, 0, 1, 1), (0.1, 0.1, 0.8, 0.8), 60, 320, 180, 30
        )
        second = stills.filter_graph(
            (0.2, 0.1, 0.5, 0.6), (0.1, 0.1, 0.8, 0.8), 60, 320, 180, 30
        )
        self.assertNotEqual(first, second)

    def test_capcut_preflight_before_draft_creation(self):
        cc = Mock()
        with self.assertRaises(ValueError):
            capcut.export_draft([], "/tmp/drafts", "../escape", cc=cc)
        cc.DraftFolder.assert_not_called()

    def test_capcut_overwrite_refused_before_app_mutation(self):
        cc = Mock()
        with self.assertRaises(ValueError):
            capcut.export_draft(
                ["clip.mp4"], "/tmp/drafts", "draft", overwrite=True, cc=cc
            )
        cc.DraftFolder.assert_not_called()

    def test_crop_height_changes_aspect_fit(self):
        first = stills.filter_graph(
            (0.25, 0.25, 0.5, 0.5), (0, 0, 1, 1), 60, 320, 180, 30
        )
        second = stills.filter_graph(
            (0.25, 0.125, 0.5, 0.75), (0, 0, 1, 1), 60, 320, 180, 30
        )
        self.assertNotEqual(first, second)

    def test_capcut_duration_failure_prevents_creation(self):
        cc = Mock()
        with tempfile.TemporaryDirectory() as directory:
            source = pathlib.Path(directory) / "clip.mp4"
            source.touch()
            with self.assertRaises(ValueError):
                capcut.export_draft(
                    [source], directory, "draft", cc=cc, probe=lambda _: float("nan")
                )
        cc.DraftFolder.assert_not_called()

    @unittest.skipUnless(
        shutil.which("ffmpeg") and shutil.which("ffprobe"), "FFmpeg required"
    )
    def test_real_ffmpeg_still_and_feedback(self):
        try:
            import PIL  # noqa: F401
            from tasteforge.media.glitch import render
        except ImportError:
            self.skipTest("numpy and Pillow required for effect smoke")
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            image = root / "source.ppm"
            image.write_bytes(b"P6\n32 18\n255\n" + bytes([100, 20, 200]) * 32 * 18)
            clip = root / "still.mp4"
            stills.make_clip(image, clip, duration=0.5, width=32, height=18, fps=10)
            final = root / "feedback.mp4"
            self.assertEqual(render(clip, 0, 0.5, final, 42, "feedback", 32, 18, 10), 5)
            result = subprocess.run(
                [
                    "ffprobe",
                    "-v",
                    "error",
                    "-count_frames",
                    "-show_entries",
                    "stream=width,height,nb_read_frames,r_frame_rate",
                    "-of",
                    "json",
                    str(final),
                ],
                check=True,
                capture_output=True,
                text=True,
            )
            stream = json.loads(result.stdout)["streams"][0]
            self.assertEqual(
                (stream["width"], stream["height"], stream["nb_read_frames"]),
                (32, 18, "5"),
            )
            self.assertEqual(stream["r_frame_rate"], "10/1")

    def test_empty_decoder_fails(self):
        try:
            from tasteforge.media.glitch import transform_stream
        except ImportError:
            self.skipTest("numpy required")
        with self.assertRaises(RuntimeError):
            transform_stream(
                Mock(stdout=io.BytesIO()),
                Mock(stdin=io.BytesIO()),
                1,
                32,
                18,
                30,
                42,
                "drift",
            )

    def test_seeded_effect_is_repeatable(self):
        try:
            from tasteforge.media.glitch import transform_stream
        except ImportError:
            self.skipTest("numpy required")
        frame = bytes(range(256)) * (32 * 18 * 3 // 256) + bytes(range(192))
        results = []
        for _ in range(2):
            destination = io.BytesIO()
            transform_stream(
                Mock(stdout=io.BytesIO(frame)),
                Mock(stdin=destination),
                1,
                32,
                18,
                30,
                42,
                "drift",
            )
            results.append(destination.getvalue())
        self.assertEqual(results[0], results[1])

    def test_capcut_success_preserves_order_and_frame_rate(self):
        cc = Mock()
        with tempfile.TemporaryDirectory() as directory:
            sources = [
                pathlib.Path(directory) / name for name in ("first.mp4", "second.mp4")
            ]
            for source in sources:
                source.touch()
            receipt = capcut.export_draft(
                sources,
                directory,
                "Review 2",
                width=320,
                height=180,
                fps=24,
                cc=cc,
                probe=Mock(side_effect=[1.25, 2.5]),
            )
            cc.DraftFolder.return_value.create_draft.assert_called_once_with(
                "Review 2", 320, 180, fps=24, allow_replace=False
            )
            self.assertEqual(
                cc.trange.call_args_list,
                [call("0.000000s", "1.250000s"), call("1.250000s", "2.500000s")],
            )
            self.assertEqual(
                [entry.args[0] for entry in cc.VideoSegment.call_args_list],
                [str(source.resolve()) for source in sources],
            )
            self.assertEqual(receipt["duration"], 3.75)
            self.assertEqual(receipt["segments"], 2)
            cc.DraftFolder.return_value.create_draft.return_value.save.assert_called_once()

    def test_capcut_save_failure_is_not_reported_as_success(self):
        cc = Mock()
        cc.DraftFolder.return_value.create_draft.return_value.save.side_effect = (
            OSError("disk full")
        )
        with tempfile.TemporaryDirectory() as directory:
            source = pathlib.Path(directory) / "clip.mp4"
            source.touch()
            with self.assertRaisesRegex(OSError, "disk full"):
                capcut.export_draft(
                    [source], directory, "new-draft", cc=cc, probe=lambda _: 1
                )

    def test_capcut_empty_list_rejected(self):
        with self.assertRaises(ValueError):
            capcut.export_draft([], "/tmp/drafts", "valid-name", cc=Mock())

    def test_concat_paths_resolve_against_list_not_current_directory(self):
        with tempfile.TemporaryDirectory() as directory:
            concat = pathlib.Path(directory) / "concat.txt"
            concat.write_text("# heading\nfile 'with space.mp4'\n\nfile second.mp4\n")
            self.assertEqual(
                capcut.read_concat(concat),
                [
                    (pathlib.Path(directory) / "with space.mp4").resolve(),
                    (pathlib.Path(directory) / "second.mp4").resolve(),
                ],
            )
            concat.write_text("file first.mp4 unexpected\n")
            with self.assertRaises(ValueError):
                capcut.read_concat(concat)

    def test_probe_failure_and_valid_duration(self):
        with patch.object(
            capcut.subprocess, "run", return_value=Mock(stdout="1.125\n")
        ) as runner:
            self.assertEqual(capcut.duration_of("source.mp4"), 1.125)
            self.assertTrue(runner.call_args.kwargs["check"])
        with patch.object(
            capcut.subprocess,
            "run",
            side_effect=subprocess.CalledProcessError(1, "ffprobe"),
        ):
            with self.assertRaises(subprocess.CalledProcessError):
                capcut.duration_of("source.mp4")

    def test_media_cli_parameter_forwarding(self):
        with patch.object(stills, "make_clip") as renderer:
            stills.main(
                [
                    "source.png",
                    "final.mp4",
                    "--duration",
                    ".5",
                    "--width",
                    "320",
                    "--height",
                    "180",
                    "--fps",
                    "24",
                    "--overwrite",
                ]
            )
            self.assertEqual(renderer.call_args.kwargs["fps"], 24)
            self.assertTrue(renderer.call_args.kwargs["overwrite"])
        with (
            patch.object(capcut, "read_concat", return_value=["source.mp4"]),
            patch.object(capcut, "export_draft") as exporter,
        ):
            capcut.main(
                [
                    "list.txt",
                    "--drafts",
                    "/tmp/drafts",
                    "--name",
                    "review",
                    "--fps",
                    "24",
                ]
            )
            self.assertEqual(exporter.call_args.kwargs["files"], ["source.mp4"])
            self.assertEqual(exporter.call_args.kwargs["name"], "review")
            self.assertEqual(exporter.call_args.kwargs["fps"], 24)

    def test_crop_bounds_missing_source_and_odd_geometry(self):
        for crop in ((0, 0, 1), (0, 0, float("nan"), 1), (0.5, 0, 1, 1)):
            with self.assertRaises(ValueError):
                stills.filter_graph(crop, (0, 0, 1, 1), 10, 320, 180, 30)
        with self.assertRaises(ValueError):
            stills.make_clip("missing.png", "out.mp4", width=319)
        with self.assertRaises(FileNotFoundError):
            stills.make_clip("missing.png", "out.mp4")

    def test_output_empty_rejected_and_successful_replace_atomic(self):
        from tasteforge.media.common import output_file

        with tempfile.TemporaryDirectory() as directory:
            target = pathlib.Path(directory) / "out.mp4"
            target.write_bytes(b"previous")
            with self.assertRaises(RuntimeError):
                with output_file(target, overwrite=True):
                    pass
            self.assertEqual(target.read_bytes(), b"previous")
            with output_file(target, overwrite=True) as temporary:
                temporary.write_bytes(b"complete")
                self.assertEqual(target.read_bytes(), b"previous")
            self.assertEqual(target.read_bytes(), b"complete")
            self.assertEqual(list(pathlib.Path(directory).glob(".media-*")), [])

    def test_glitch_validation_and_cli(self):
        try:
            from tasteforge.media import glitch
        except ImportError:
            self.skipTest("numpy required")
        with tempfile.TemporaryDirectory() as directory:
            source = pathlib.Path(directory) / "source.mp4"
            source.touch()
            for options in ({"start": -1}, {"mode": "unknown"}, {"seed": -1}):
                params = dict(
                    source=source, start=0, duration=1, output="out.mp4", seed=42
                )
                params.update(options)
                with self.assertRaises(ValueError):
                    glitch.render(**params)
            with self.assertRaises(FileNotFoundError):
                glitch.render(source / "missing", 0, 1, "out.mp4", 42)
        with (
            patch.object(glitch, "render", return_value=12) as renderer,
            patch("builtins.print"),
        ):
            glitch.main(
                ["source.mp4", "1", ".5", "out.mp4", "42", "mosh", "--fps", "24"]
            )
            self.assertEqual(renderer.call_args.kwargs["mode"], "mosh")
            self.assertEqual(renderer.call_args.kwargs["fps"], 24)

    def test_glitch_truncated_frame_and_mosh_are_explicit(self):
        try:
            from tasteforge.media.glitch import transform_stream
        except ImportError:
            self.skipTest("numpy required")
        with self.assertRaisesRegex(RuntimeError, "truncated"):
            transform_stream(
                Mock(stdout=io.BytesIO(b"truncated")),
                Mock(stdin=io.BytesIO()),
                1,
                32,
                18,
                30,
                42,
                "drift",
            )
        frame = bytes(range(256)) * 6 + bytes(range(192))
        destination = io.BytesIO()
        self.assertEqual(
            transform_stream(
                Mock(stdout=io.BytesIO(frame * 3)),
                Mock(stdin=destination),
                0.1,
                32,
                18,
                30,
                42,
                "mosh",
            ),
            3,
        )
        self.assertEqual(len(destination.getvalue()), len(frame) * 3)
        self.assertNotEqual(destination.getvalue(), frame * 3)

    def test_encoder_launch_failure_reaps_decoder(self):
        try:
            from tasteforge.media import glitch
        except ImportError:
            self.skipTest("numpy required")
        decoder = Mock(stdin=None, stdout=io.BytesIO(), poll=Mock(return_value=None))
        with tempfile.TemporaryDirectory() as directory:
            source = pathlib.Path(directory) / "source.mp4"
            source.touch()
            target = pathlib.Path(directory) / "out.mp4"
            with patch.object(
                glitch.subprocess,
                "Popen",
                side_effect=[decoder, OSError("encoder unavailable")],
            ):
                with self.assertRaisesRegex(OSError, "encoder unavailable"):
                    glitch.render(source, 0, 1, target, 42)
            decoder.kill.assert_called_once()
            decoder.wait.assert_called_once()
            self.assertTrue(decoder.stdout.closed)
            self.assertFalse(target.exists())

    def test_still_cannot_replace_source_through_same_path_or_symlink(self):
        with tempfile.TemporaryDirectory() as directory:
            source = pathlib.Path(directory) / "source.png"
            source.write_bytes(b"original")
            alias = pathlib.Path(directory) / "alias.png"
            alias.symlink_to(source)
            renderer = Mock()
            for output in (source, alias):
                with self.assertRaises(ValueError):
                    stills.make_clip(source, output, overwrite=True, runner=renderer)
            renderer.assert_not_called()
            self.assertEqual(source.read_bytes(), b"original")
            self.assertTrue(alias.is_symlink())

    def test_glitch_cannot_replace_source_through_same_path_or_symlink(self):
        try:
            from tasteforge.media import glitch
        except ImportError:
            self.skipTest("numpy required")
        with tempfile.TemporaryDirectory() as directory:
            source = pathlib.Path(directory) / "source.mp4"
            source.write_bytes(b"original")
            alias = pathlib.Path(directory) / "alias.mp4"
            alias.symlink_to(source)
            with patch.object(glitch.subprocess, "Popen") as process:
                for output in (source, alias):
                    with self.assertRaises(ValueError):
                        glitch.render(source, 0, 1, output, 42, overwrite=True)
            process.assert_not_called()
            self.assertEqual(source.read_bytes(), b"original")
            self.assertTrue(alias.is_symlink())


if __name__ == "__main__":
    unittest.main()
