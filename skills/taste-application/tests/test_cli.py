"""Failing-first tests for the tasteforge CLI (python3 -m tasteforge)."""

from __future__ import annotations

import io
import json
import shutil
import subprocess
import sys
import tempfile
import unittest
from contextlib import redirect_stderr
from pathlib import Path
from unittest import mock

from tasteforge import cli

REPO_ROOT = Path(__file__).resolve().parents[1] / "scripts"
FIXTURE = Path(__import__("tasteforge").__file__).resolve().parent / "fixtures" / "flashethereal"

ANSWERS = {
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
}

MEDIA = {
    "clips": [
        {"path": "/tmp/media/a.mov", "duration": 5.0, "name": "a"},
        {"path": "/tmp/media/b.mov", "duration": 4.0, "name": "b"},
    ]
}


def run_cli(*args, expect=0):
    proc = subprocess.run(
        [sys.executable, "-m", "tasteforge", *args],
        capture_output=True,
        text=True,
        cwd=REPO_ROOT,
        check=False,
    )
    return proc


class CliTests(unittest.TestCase):
    def test_missing_ffmpeg_or_ffprobe_is_bounded_without_traceback(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            reference = root / "reference.mov"
            reference.write_bytes(b"local-reference")
            config = root / "workflow.json"
            config.write_text(json.dumps({
                "schema_version": 1,
                "run_id": "missing-tools",
                "seed": 15,
                "dry_run": True,
                "resolve_duration": 6.0,
                "genres": [{
                    "number": 1,
                    "slug": "flash-ethereal",
                    "label": "Flash Ethereal",
                    "references": [str(reference)],
                    "signature": {
                        "materials": ["glass"],
                        "motion": ["flash"],
                        "composition": ["center"],
                        "avoid": ["mud"],
                    },
                }],
            }), encoding="utf-8")
            fake_bin = root / "bin"
            fake_bin.mkdir()
            ffprobe = fake_bin / "ffprobe"
            ffprobe.write_text(
                "#!/bin/sh\nprintf '%s\\n' "
                "'{\"streams\":[{\"codec_type\":\"video\",\"duration\":\"1\","
                "\"avg_frame_rate\":\"24/1\"}],\"format\":{\"duration\":\"1\"}}'\n",
                encoding="utf-8",
            )
            ffprobe.chmod(0o700)

            for label, path_value in (("ffprobe", ""), ("ffmpeg", str(fake_bin))):
                with self.subTest(tool=label):
                    proc = subprocess.run(
                        [sys.executable, "-m", "tasteforge", "multimodal",
                         "--config", str(config), "--out-dir", str(root / f"out-{label}")],
                        capture_output=True,
                        text=True,
                        cwd=REPO_ROOT,
                        env={"PATH": path_value},
                        check=False,
                    )
                    self.assertEqual(proc.returncode, cli.EXIT_INVALID)
                    self.assertEqual(proc.stderr, "ERROR local media processing unavailable\n")
                    self.assertNotIn("Traceback", proc.stderr)

    def test_corrupt_media_process_failure_is_bounded_and_redacted(self):
        failure = subprocess.CalledProcessError(
            1,
            ["ffprobe", "https://provider.invalid/?token=secret-value"],
            stderr="provider response secret-value",
        )
        stderr = io.StringIO()
        with mock.patch(
            "tasteforge.cli.workflow_mod.run_workflow", side_effect=failure
        ), redirect_stderr(stderr):
            status = cli.main([
                "multimodal", "--config", "corrupt.json", "--out-dir", "out"
            ])
        message = stderr.getvalue()
        self.assertEqual(status, cli.EXIT_INVALID)
        self.assertEqual(message, "ERROR local media processing failed\n")
        self.assertNotIn("Traceback", message)
        self.assertNotIn("secret-value", message)
        self.assertNotIn("provider.invalid", message)

    def test_multimodal_command_routes_file_contract_and_validates_bundle(self):
        with tempfile.TemporaryDirectory() as td:
            config = Path(td) / "workflow.json"
            config.write_text("{}", encoding="utf-8")
            out = Path(td) / "out"
            expected = {"provider_calls": 0, "provider_execution": False}
            with mock.patch(
                "tasteforge.cli.workflow_mod.run_workflow", return_value=expected
            ) as run, mock.patch("tasteforge.cli.contract_mod.validate_bundle") as validate:
                status = cli.main([
                    "multimodal", "--config", str(config), "--out-dir", str(out)
                ])
            self.assertEqual(status, 0)
            run.assert_called_once_with(config, out)
            validate.assert_called_once_with(out)
    def test_provenance_subcommand(self):
        proc = run_cli("provenance", "--json")
        self.assertEqual(proc.returncode, 0, proc.stderr)
        data = json.loads(proc.stdout)
        self.assertIn("generations", data)

    def test_inspect_subcommand(self):
        proc = run_cli("inspect", str(FIXTURE), "--json")
        self.assertEqual(proc.returncode, 0, proc.stderr)
        data = json.loads(proc.stdout)
        self.assertEqual(data["name"], "flashethereal")

    def test_validate_subcommand_ok_and_fail(self):
        proc = run_cli("validate", str(FIXTURE))
        self.assertEqual(proc.returncode, 0, proc.stderr)
        with tempfile.TemporaryDirectory() as td:
            bad = Path(td) / "badpack"
            bad.mkdir()
            (bad / "pack.json").write_text("{}")
            proc = run_cli("validate", str(bad))
            self.assertNotEqual(proc.returncode, 0)

    def test_interview_distill_apply_export_roundtrip(self):
        with tempfile.TemporaryDirectory() as td:
            answers_p = Path(td) / "answers.json"
            profile_p = Path(td) / "profile.json"
            spec_p = Path(td) / "spec.json"
            report_p = Path(td) / "report.json"
            media_p = Path(td) / "media.json"
            events_p = Path(td) / "events.json"
            answers_p.write_text(json.dumps(ANSWERS))
            media_p.write_text(json.dumps(MEDIA))

            proc = run_cli("interview", "--answers", str(answers_p),
                           "--genre", "flashethereal", "--out", str(profile_p))
            self.assertEqual(proc.returncode, 0, proc.stderr)
            self.assertTrue(profile_p.exists())

            proc = run_cli("distill", "--profile", str(profile_p),
                           "--pack", str(FIXTURE), "--out", str(spec_p))
            self.assertEqual(proc.returncode, 0, proc.stderr)
            spec = json.loads(spec_p.read_text())
            self.assertTrue(spec["source"]["dry_run"])

            proc = run_cli("apply", "--pack", str(FIXTURE), "--media", str(media_p),
                           "--duration", "10", "--out", str(report_p))
            self.assertEqual(proc.returncode, 0, proc.stderr)
            report = json.loads(report_p.read_text())
            self.assertEqual(report["provider"], "none")
            events_p.write_text(json.dumps({"clips": report["timeline_events"]}))

            proc = run_cli("export", "--events", str(events_p),
                           "--out-dir", td, "--title", "cli-test")
            self.assertEqual(proc.returncode, 0, proc.stderr)
            self.assertTrue((Path(td) / "cli-test.edl").exists())
            self.assertTrue((Path(td) / "cli-test.fcpxml").exists())

    def test_apply_strict_cli_emits_exact_frame_report(self):
        with tempfile.TemporaryDirectory() as td:
            media = {"clips": [{"path": f"/tmp/clip-{i}.mov", "duration": 5}
                               for i in range(20)]}
            media_p = Path(td) / "media.json"
            media_p.write_text(json.dumps(media))
            out = Path(td) / "report.json"
            proc = run_cli("apply", "--pack", str(FIXTURE), "--media", str(media_p),
                           "--duration", "2.25", "--fps", "20", "--no-repeat", "--out", str(out))
            self.assertEqual(proc.returncode, 0, proc.stderr)
            report = json.loads(out.read_text())
            events = report["timeline_events"]
            self.assertEqual(sum(e["frames"] for e in events), 45)
            self.assertTrue(all(e["fps"] == 20 for e in events))
            self.assertEqual(len(events), len({e["path"] for e in events}))

    def test_apply_invalid_or_insufficient_strict_input_creates_no_report(self):
        with tempfile.TemporaryDirectory() as td:
            media_p = Path(td) / "media.json"
            media_p.write_text(json.dumps(MEDIA))
            out = Path(td) / "report.json"
            for options in (("--duration", "20", "--no-repeat"),
                            ("--duration", "0"), ("--fps", "nan")):
                with self.subTest(options=options):
                    proc = run_cli("apply", "--pack", str(FIXTURE), "--media", str(media_p),
                                   "--out", str(out), *options)
                    self.assertEqual(proc.returncode, 1, proc.stderr)
                    self.assertNotIn("Traceback", proc.stderr)
                    self.assertFalse(out.exists())

    def test_default_output_names_reject_path_traversal(self):
        with tempfile.TemporaryDirectory() as td:
            # pack.json name with traversal: default report path must not be derived from it
            pack = Path(td) / "pack"
            shutil.copytree(FIXTURE, pack)
            manifest = json.loads((pack / "pack.json").read_text())
            manifest["name"] = "../../escaped"
            (pack / "pack.json").write_text(json.dumps(manifest))
            media_p = Path(td) / "media.json"
            media_p.write_text(json.dumps(MEDIA))
            proc = run_cli("apply", "--pack", str(pack), "--media", str(media_p), "--duration", "4")
            self.assertEqual(proc.returncode, 1, proc.stderr)
            self.assertNotIn("Traceback", proc.stderr)
            self.assertIn("pack name", proc.stderr)
            self.assertFalse((REPO_ROOT.parent / "escaped_apply_report.json").exists())
            self.assertFalse((REPO_ROOT / "out").exists() and any(REPO_ROOT.glob("out/*escaped*")))
            # profile genre with traversal: default spec path must not be derived from it
            answers_p = Path(td) / "answers.json"
            answers_p.write_text(json.dumps(ANSWERS))
            profile_p = Path(td) / "profile.json"
            proc = run_cli("interview", "--answers", str(answers_p), "--genre", "flashethereal", "--out", str(profile_p))
            self.assertEqual(proc.returncode, 0, proc.stderr)
            profile = json.loads(profile_p.read_text())
            profile["genre"] = "../escaped"
            profile_p.write_text(json.dumps(profile))
            proc = run_cli("distill", "--profile", str(profile_p), "--pack", str(FIXTURE))
            self.assertEqual(proc.returncode, 1, proc.stderr)
            self.assertNotIn("Traceback", proc.stderr)
            self.assertIn("profile genre", proc.stderr)
            self.assertFalse((REPO_ROOT.parent / "escaped-spec.json").exists())
            # an explicit --out still works with an odd genre
            spec_p = Path(td) / "spec.json"
            proc = run_cli("distill", "--profile", str(profile_p), "--pack", str(FIXTURE), "--out", str(spec_p))
            self.assertEqual(proc.returncode, 0, proc.stderr)

    def test_live_provider_flags_fail_closed(self):
        with tempfile.TemporaryDirectory() as td:
            profile_p = Path(td) / "profile.json"
            run_cli("interview", "--answers", self._write(td, ANSWERS),
                    "--genre", "g", "--out", str(profile_p))
            proc = run_cli("distill", "--profile", str(profile_p), "--live")
            self.assertNotEqual(proc.returncode, 0)
            self.assertIn("separately authorized", proc.stderr + proc.stdout)
            media_p = Path(td) / "media.json"
            media_p.write_text(json.dumps(MEDIA))
            proc = run_cli("apply", "--pack", str(FIXTURE),
                           "--media", str(media_p), "--live")
            self.assertNotEqual(proc.returncode, 0)
            self.assertIn("separately authorized", proc.stderr + proc.stdout)

    @staticmethod
    def _write(td, obj):
        p = Path(td) / "answers.json"
        p.write_text(json.dumps(obj))
        return str(p)


@unittest.skipUnless(shutil.which("ffmpeg") and shutil.which("ffprobe"), "ffmpeg tools unavailable")
class RealMediaCliIntegrationTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.media = self.root / "reference.mp4"
        ffmpeg = shutil.which("ffmpeg")
        assert ffmpeg is not None
        generated = subprocess.run(
            [
                ffmpeg, "-v", "error", "-f", "lavfi", "-i",
                "color=c=blue:s=64x64:r=12:d=1", "-c:v", "mpeg4", "-y", str(self.media),
            ],
            capture_output=True,
            text=True,
            check=False,
        )
        if generated.returncode != 0:
            self.skipTest("local ffmpeg cannot generate the integration fixture")

    def tearDown(self):
        self.tmp.cleanup()

    def _config(self, reference: Path) -> Path:
        genres = []
        values = [
            (1, "flash-ethereal", "Flash Ethereal", "glass", "flash", "center", "mud"),
            (2, "3d-cyber-glitch", "3D Cyber Glitch", "chrome", "orbit", "full", "corner"),
            (3, "fluid-sketch", "Fluid Sketch", "ink", "bleed", "space", "grid"),
        ]
        for number, slug, label, material, motion, composition, avoid in values:
            genres.append({
                "number": number,
                "slug": slug,
                "label": label,
                "references": [str(reference)],
                "signature": {
                    "materials": [material],
                    "motion": [motion],
                    "composition": [composition],
                    "avoid": [avoid],
                },
            })
        config = self.root / "workflow.json"
        config.write_text(json.dumps({
            "schema_version": 1,
            "run_id": "real-tools",
            "seed": 15,
            "dry_run": True,
            "resolve_duration": 6.0,
            "genres": genres,
        }), encoding="utf-8")
        return config

    def test_real_ffmpeg_ffprobe_cli_emits_and_validates_bundle(self):
        out = self.root / "out"
        proc = run_cli(
            "multimodal", "--config", str(self._config(self.media)), "--out-dir", str(out)
        )
        self.assertEqual(proc.returncode, 0, proc.stderr)
        receipt = json.loads(proc.stdout)
        self.assertEqual(receipt["provider_calls"], 0)
        self.assertFalse(receipt["provider_execution"])
        self.assertTrue((out / "receipt.json").is_file())

    def test_real_corrupt_media_cli_failure_is_bounded_and_redacted(self):
        corrupt = self.root / "corrupt.mov"
        corrupt.write_bytes(b"not-media-secret-marker")
        proc = run_cli(
            "multimodal", "--config", str(self._config(corrupt)),
            "--out-dir", str(self.root / "corrupt-out"),
        )
        self.assertEqual(proc.returncode, cli.EXIT_INVALID)
        self.assertEqual(proc.stderr, "ERROR local media processing failed\n")
        self.assertNotIn("Traceback", proc.stderr)
        self.assertNotIn("not-media-secret-marker", proc.stderr)


if __name__ == "__main__":
    unittest.main()
