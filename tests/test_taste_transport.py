"""Offline security regression tests for the original live-capable transport."""

import importlib.util
import io
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

ROOT = Path(__file__).resolve().parents[1]
APP = ROOT / "skills/taste-application/scripts"
COPIES = [
    APP / "falapi.py",
    APP / "taste/falapi.py",
    ROOT / "skills/taste-distillation/scripts/taste/falapi.py",
]


class TransportSecurityTests(unittest.TestCase):
    def setUp(self):
        spec = importlib.util.spec_from_file_location(
            "transport_security_test", COPIES[0]
        )
        self.api = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.api)
        self.env = patch.dict(
            os.environ, {"FAL_KEY": "test-key-never-print"}, clear=True
        )
        self.env.start()
        self.addCleanup(self.env.stop)
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.dest = Path(self.tmp.name) / "out"
        blocker = patch.object(
            self.api.urllib.request,
            "urlopen",
            side_effect=AssertionError("network forbidden"),
        )
        blocker.start()
        self.addCleanup(blocker.stop)

    def test_mirrors(self):
        self.assertEqual(len({p.read_bytes() for p in COPIES}), 1)

    def test_live_gate(self):
        client = Mock()
        source = Path(self.tmp.name) / "source"
        source.write_bytes(b"image")
        with patch.object(self.api, "_fal", return_value=client):
            for action in (
                lambda: self.api.submit("model", {}),
                lambda: self.api.upload(source),
                lambda: self.api.download("https://v3.fal.media/file", self.dest),
            ):
                with self.assertRaisesRegex(
                    self.api.FalError, "TASTE_FORGE_ALLOW_LIVE"
                ):
                    action()
        self.assertFalse(client.mock_calls)

    def test_ambiguous_failure(self):
        os.environ["TASTE_FORGE_ALLOW_LIVE"] = "1"
        client = Mock()
        client.subscribe.side_effect = TimeoutError(
            "test-key-never-print ?token=secret"
        )
        with (
            patch.object(self.api, "_fal", return_value=client),
            patch.object(self.api.time, "sleep"),
        ):
            with self.assertRaises(self.api.FalError) as err:
                self.api.submit("model", {}, max_attempts=5)
        self.assertEqual(client.subscribe.call_count, 1)
        self.assertNotIn("test-key-never-print", str(err.exception))
        self.assertNotIn("?token=secret", str(err.exception))

    def test_unsafe_urls(self):
        os.environ["TASTE_FORGE_ALLOW_LIVE"] = "1"
        for url in (
            "file:///etc/passwd",
            "http://v3.fal.media/a",
            "https://127.0.0.1/a",
            "https://fal.media.evil.test/a",
            "https://user:pass@fal.media/a",
            "https://fal.media:444/a",
        ):
            with (
                self.subTest(url=url),
                patch.object(
                    self.api.urllib.request,
                    "urlopen",
                    side_effect=AssertionError("unexpected network"),
                ),
            ):
                with self.assertRaises(self.api.FalError):
                    self.api.download(url, self.dest)
        self.assertFalse(self.dest.exists())

    def test_redirect_validation(self):
        handler = self.api._SafeRedirect()
        req = self.api.urllib.request.Request("https://v3.fal.media/a")
        with self.assertRaises(self.api.FalError):
            handler.redirect_request(
                req, None, 302, "Found", {}, "https://127.0.0.1/private"
            )
        redirected = handler.redirect_request(
            req, None, 302, "Found", {}, "https://v3.fal.media/b"
        )
        self.assertEqual(redirected.full_url, "https://v3.fal.media/b")

    def test_bounded_download_preserves_destination(self):
        os.environ["TASTE_FORGE_ALLOW_LIVE"] = "1"
        opener = Mock()
        opener.open.return_value = io.BytesIO(b"too much data")
        self.dest.write_bytes(b"original")
        with (
            patch.object(self.api, "MAX_DOWNLOAD_BYTES", 4),
            patch.object(self.api.urllib.request, "build_opener", return_value=opener),
        ):
            with self.assertRaises(self.api.FalError):
                self.api.download("https://v3.fal.media/a?token=secret", self.dest)
        self.assertEqual(self.dest.read_bytes(), b"original")
        self.assertEqual(list(Path(self.tmp.name).iterdir()), [self.dest])

    def test_early_eof_preserves_destination(self):
        os.environ["TASTE_FORGE_ALLOW_LIVE"] = "1"
        response = io.BytesIO(b"short")
        response.headers = {"Content-Length": "100"}
        opener = Mock()
        opener.open.return_value = response
        self.dest.write_bytes(b"original")
        with patch.object(self.api.urllib.request, "build_opener", return_value=opener):
            with self.assertRaises(self.api.FalError):
                self.api.download("https://v3.fal.media/a", self.dest)
        self.assertEqual(self.dest.read_bytes(), b"original")

    def test_success_and_log_redaction(self):
        os.environ["TASTE_FORGE_ALLOW_LIVE"] = "1"
        opener = Mock()
        opener.open.return_value = io.BytesIO(b"media")
        with (
            patch.object(self.api.urllib.request, "build_opener", return_value=opener),
            self.assertLogs(self.api.log, level="INFO") as logs,
        ):
            self.api.download("https://v3.fal.media/a?token=secret", self.dest)
        self.assertEqual(self.dest.read_bytes(), b"media")
        self.assertNotIn("token=secret", str(logs.output))

    def test_dry_run(self):
        os.environ["TASTE_FORGE_DRY_RUN"] = "1"
        with patch.object(self.api, "_fal", side_effect=AssertionError("network")):
            self.assertIsInstance(self.api.submit("model", {}), dict)
            self.api.download("https://v3.fal.media/a", self.dest)
        self.assertIn(b"placeholder", self.dest.read_bytes())

    def test_upload_cache_cannot_bypass_gate_or_mix_dry_mode(self):
        source = Path(self.tmp.name) / "source"
        source.write_bytes(b"image")
        os.environ["TASTE_FORGE_DRY_RUN"] = "1"
        stub = self.api.upload(source)
        del os.environ["TASTE_FORGE_DRY_RUN"]
        with self.assertRaises(self.api.FalError):
            self.api.upload(source)
        os.environ["TASTE_FORGE_ALLOW_LIVE"] = "1"
        client = Mock()
        client.upload_file.return_value = "https://v3.fal.media/live?token=secret"
        with patch.object(self.api, "_fal", return_value=client):
            live = self.api.upload(source)
        self.assertNotEqual(stub, live)
        client.upload_file.assert_called_once()

    def test_provider_payload_omitted_from_errors(self):
        with self.assertRaises(self.api.FalError) as err:
            self.api.first_url({"error": "test-key-never-print"}, "model")
        self.assertNotIn("test-key-never-print", str(err.exception))

    def test_prop_names(self):
        import ast

        # Execute only the pure validator: no optional rendering dependencies required.
        tree = ast.parse((APP / "mint3d.py").read_text())
        validator = next(
            (
                n
                for n in tree.body
                if isinstance(n, ast.FunctionDef) and n.name == "_asset_name"
            ),
            None,
        )
        self.assertIsNotNone(
            validator, "validate names before pack access or provider calls"
        )
        ns = {}
        exec(
            compile(
                ast.Module(body=[validator], type_ignores=[]), "<validator>", "exec"
            ),
            ns,
        )
        for name in ("../escape", "/absolute", "..", "nested/file", "bad\\name"):
            with self.assertRaisesRegex(ValueError, "asset name"):
                ns["_asset_name"](name, "")
        self.assertEqual(ns["_asset_name"](None, "chrome visor"), "prop_chrome")


if __name__ == "__main__":
    unittest.main()
