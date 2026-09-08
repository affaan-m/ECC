from pathlib import Path
import json
import os
import subprocess
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[1]
HOOK = ROOT / "templates" / "pre-commit.example"


class PreCommitGuardTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        self.project = Path(self.temp_dir.name)
        subprocess.run(["git", "init"], cwd=self.project, capture_output=True, check=True)
        subprocess.run(["git", "config", "user.email", "test@example.com"], cwd=self.project, check=True)
        subprocess.run(["git", "config", "user.name", "Test"], cwd=self.project, check=True)

        governance = self.project / ".governance"
        governance.mkdir()
        (governance / "docs-map.json").write_text(
            json.dumps({"history": "PROJECT_LOG.md"}),
            encoding="utf-8",
        )
        (self.project / "PROJECT_LOG.md").write_text(
            "# History\n\n## [2026-01-01] init | initial state\n",
            encoding="utf-8",
        )
        (self.project / "app.py").write_text("value = 1\n", encoding="utf-8")
        subprocess.run(["git", "add", "."], cwd=self.project, check=True)
        subprocess.run(
            ["git", "commit", "-m", "initial"],
            cwd=self.project,
            capture_output=True,
            check=True,
        )

    def tearDown(self) -> None:
        self.temp_dir.cleanup()

    def run_hook(self, *, optimized: bool = False) -> subprocess.CompletedProcess[str]:
        environment = os.environ.copy()
        if optimized:
            environment["PYTHONOPTIMIZE"] = "1"
        return subprocess.run(
            ["/bin/sh", str(HOOK)],
            cwd=self.project,
            env=environment,
            text=True,
            capture_output=True,
            check=False,
        )

    def test_invalid_staged_map_fails_under_optimized_python(self) -> None:
        (self.project / ".governance" / "docs-map.json").write_text(
            json.dumps({"history": "/tmp/outside.md"}),
            encoding="utf-8",
        )
        subprocess.run(
            ["git", "add", ".governance/docs-map.json"],
            cwd=self.project,
            check=True,
        )

        result = self.run_hook(optimized=True)

        self.assertNotEqual(result.returncode, 0)
        self.assertIn("invalid .governance/docs-map.json", result.stderr)

    def test_unstaged_map_change_cannot_redirect_staged_history_check(self) -> None:
        with (self.project / "PROJECT_LOG.md").open("a", encoding="utf-8") as stream:
            stream.write("## [2026-01-02] fix | changed application\n")
        (self.project / "app.py").write_text("value = 2\n", encoding="utf-8")
        subprocess.run(["git", "add", "PROJECT_LOG.md", "app.py"], cwd=self.project, check=True)

        (self.project / ".governance" / "docs-map.json").write_text(
            json.dumps({"history": "/tmp/outside.md"}),
            encoding="utf-8",
        )

        result = self.run_hook()

        self.assertEqual(result.returncode, 0, result.stderr)

    def test_staged_history_deletion_fails_closed(self) -> None:
        (self.project / "PROJECT_LOG.md").unlink()
        (self.project / "app.py").write_text("value = 2\n", encoding="utf-8")
        subprocess.run(["git", "add", "-A"], cwd=self.project, check=True)

        result = self.run_hook()

        self.assertNotEqual(result.returncode, 0)
        self.assertIn("staged deletion of the history artifact", result.stderr)

    def test_mapped_history_missing_from_index_fails_closed(self) -> None:
        (self.project / ".governance" / "docs-map.json").write_text(
            json.dumps({"history": "docs/CHANGELOG.md"}),
            encoding="utf-8",
        )
        (self.project / "app.py").write_text("value = 2\n", encoding="utf-8")
        subprocess.run(
            ["git", "add", ".governance/docs-map.json", "app.py"],
            cwd=self.project,
            check=True,
        )

        result = self.run_hook()

        self.assertNotEqual(result.returncode, 0)
        self.assertIn("mapped history artifact is missing from the index", result.stderr)


if __name__ == "__main__":
    unittest.main()
