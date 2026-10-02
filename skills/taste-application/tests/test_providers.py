"""Failing-first tests: provider adapters must fail closed, always."""

from __future__ import annotations

import subprocess
import sys
import unittest
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1] / "scripts"
sys.path.insert(0, str(REPO_ROOT))

from tasteforge import providers  # noqa: E402


class RegistryFailClosedTests(unittest.TestCase):
    def test_default_registry_has_no_providers(self):
        self.assertEqual(providers.list_providers(), [])

    def test_get_unknown_provider_raises_not_authorized(self):
        with self.assertRaises(providers.ProviderNotAuthorizedError) as ctx:
            providers.get("fal")
        self.assertIn("separately authorized", str(ctx.exception))

    def test_env_flag_alone_does_not_enable(self):
        import os

        old = os.environ.get("TASTEFORGE_ALLOW_PROVIDERS")
        os.environ["TASTEFORGE_ALLOW_PROVIDERS"] = "1"
        try:
            with self.assertRaises(providers.ProviderNotAuthorizedError):
                providers.get("fal")
        finally:
            if old is None:
                del os.environ["TASTEFORGE_ALLOW_PROVIDERS"]
            else:
                os.environ["TASTEFORGE_ALLOW_PROVIDERS"] = old

    def test_explicit_registration_requires_authorization_flag(self):
        with self.assertRaises(providers.ProviderNotAuthorizedError):
            providers.register(
                "fal",
                callable_factory=lambda: (_ for _ in ()).throw(AssertionError("never")),
            )

    def test_no_network_modules_imported(self):
        # Inspect this import boundary without inheriting other tests' modules.
        result = subprocess.run(
            [
                sys.executable, "-I", "-c",
                """
import sys
sys.path.insert(0, sys.argv[1])
from tasteforge import providers
try:
    providers.get("fal")
except providers.ProviderNotAuthorizedError:
    pass
else:
    raise AssertionError("unregistered providers must fail closed")
for name in ("fal_client", "requests", "http.client", "urllib.request"):
    assert name not in sys.modules, name
""",
                str(REPO_ROOT),
            ],
            capture_output=True, text=True, timeout=30, check=False,
        )
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)


if __name__ == "__main__":
    unittest.main()
