from pathlib import Path
import json
import subprocess
import sys
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "scripts" / "audit-docs.py"


class AuditDocsTest(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.project = Path(self.temp_dir.name)

    def tearDown(self):
        self.temp_dir.cleanup()

    def run_audit(self, scope: str) -> subprocess.CompletedProcess[str]:
        return subprocess.run(
            [sys.executable, str(SCRIPT), "--root", str(self.project), "--scope", scope],
            text=True,
            capture_output=True,
            check=False,
        )

    def test_artifact_scope_fails_on_broken_markdown_link(self):
        (self.project / "guide.md").write_text("[missing](docs/missing.md)\n", encoding="utf-8")
        result = self.run_audit("artifacts")
        self.assertEqual(result.returncode, 1)
        self.assertIn("Broken Markdown link", result.stdout)

    def test_artifact_scope_resolves_root_relative_markdown_links_inside_project(self):
        docs = self.project / "docs"
        docs.mkdir()
        (self.project / "README.md").write_text("[guide](/docs/guide.md)\n", encoding="utf-8")
        (docs / "guide.md").write_text("# Guide\n", encoding="utf-8")
        result = self.run_audit("artifacts")
        self.assertEqual(result.returncode, 0, result.stdout)

    def test_artifact_scope_rejects_markdown_path_that_escapes_project(self):
        outside = self.project.parent / f"{self.project.name}-outside.md"
        outside.write_text("outside\n", encoding="utf-8")
        try:
            (self.project / "README.md").write_text("[outside](../" + outside.name + ")\n", encoding="utf-8")
            result = self.run_audit("artifacts")
        finally:
            outside.unlink(missing_ok=True)
        self.assertEqual(result.returncode, 1)
        self.assertIn("Broken Markdown link", result.stdout)

    def test_adr_scope_requires_every_file_in_index(self):
        adr_dir = self.project / "docs" / "adr"
        adr_dir.mkdir(parents=True)
        (adr_dir / "README.md").write_text("# ADR Index\n", encoding="utf-8")
        (adr_dir / "0001-storage.md").write_text(
            "# ADR-0001\n\nStatus: accepted\n",
            encoding="utf-8",
        )
        result = self.run_audit("adr")
        self.assertEqual(result.returncode, 1)
        self.assertIn("ADR is missing from the canonical index", result.stdout)

    def test_adr_scope_accepts_indexed_decision(self):
        adr_dir = self.project / "docs" / "adr"
        adr_dir.mkdir(parents=True)
        (adr_dir / "README.md").write_text("[decision](ADR-001-Storage.md)\n", encoding="utf-8")
        (adr_dir / "ADR-001-Storage.md").write_text(
            "# ADR-001\n\nStatus: final\n",
            encoding="utf-8",
        )
        result = self.run_audit("adr")
        self.assertEqual(result.returncode, 0, result.stdout)

    def test_custom_role_map_supports_existing_adr_layout(self):
        adr_dir = self.project / "docs" / "architecture" / "decisions"
        adr_dir.mkdir(parents=True)
        (adr_dir / "README.md").write_text("[0001](0001-storage.md)\n", encoding="utf-8")
        (adr_dir / "0001-storage.md").write_text(
            "# ADR-0001\n\nStatus: accepted\n",
            encoding="utf-8",
        )
        governance = self.project / ".governance"
        governance.mkdir()
        (governance / "docs-map.json").write_text(
            json.dumps(
                {
                    "adr_dir": "docs/architecture/decisions",
                    "adr_index": "docs/architecture/decisions/README.md",
                }
            ),
            encoding="utf-8",
        )
        result = self.run_audit("adr")
        self.assertEqual(result.returncode, 0, result.stdout)
        self.assertIn("custom documentation role mapping", result.stdout)

    def test_adr_scope_rejects_missing_index_link(self):
        adr_dir = self.project / "docs" / "adr"
        adr_dir.mkdir(parents=True)
        (adr_dir / "README.md").write_text("[missing](0002-missing.md)\n", encoding="utf-8")
        result = self.run_audit("adr")
        self.assertEqual(result.returncode, 1)
        self.assertIn("ADR index link does not exist", result.stdout)

    def test_adr_scope_rejects_missing_supersedes_target(self):
        adr_dir = self.project / "docs" / "adr"
        adr_dir.mkdir(parents=True)
        (adr_dir / "README.md").write_text("[new](0002-new.md)\n", encoding="utf-8")
        (adr_dir / "0002-new.md").write_text(
            "# ADR-0002\n\nStatus: accepted\n\n## Supersedes\n\n[old](0001-old.md)\n",
            encoding="utf-8",
        )
        result = self.run_audit("adr")
        self.assertEqual(result.returncode, 1)
        self.assertIn("ADR Supersedes target does not exist", result.stdout)

    def test_artifact_scope_rejects_unregistered_test_id_when_tests_ledger_exists(self):
        docs = self.project / "docs"
        docs.mkdir()
        (self.project / "TESTS.md").write_text("# TESTS\n\nTEST-ORDER-001\n", encoding="utf-8")
        (docs / "spec.md").write_text("Must be verified by TEST-ORDER-002.\n", encoding="utf-8")
        result = self.run_audit("artifacts")
        self.assertEqual(result.returncode, 1)
        self.assertIn("TEST-IDs are missing from the test registry", result.stdout)

    def test_log_move_to_archive_preserves_append_only_history(self):
        subprocess.run(["git", "init"], cwd=self.project, capture_output=True, check=True)
        subprocess.run(["git", "config", "user.email", "test@example.com"], cwd=self.project, check=True)
        subprocess.run(["git", "config", "user.name", "Test"], cwd=self.project, check=True)
        old = "# LOG\n\n## [2026-01-01] init | one\n## [2026-01-02] fix | two\n"
        (self.project / "PROJECT_LOG.md").write_text(old, encoding="utf-8")
        subprocess.run(["git", "add", "PROJECT_LOG.md"], cwd=self.project, check=True)
        subprocess.run(["git", "commit", "-m", "init"], cwd=self.project, capture_output=True, check=True)

        (self.project / "PROJECT_LOG.md").write_text("# LOG\n\n## [2026-01-02] fix | two\n", encoding="utf-8")
        (self.project / "PROJECT_LOG.archive.md").write_text(
            "# archive\n\n## [2026-01-01] init | one\n",
            encoding="utf-8",
        )
        result = self.run_audit("spine")
        self.assertEqual(result.returncode, 0, result.stdout)
        self.assertIn("Active and archived history remain append-only when combined", result.stdout)

    def test_log_rejects_removing_one_of_duplicate_events(self):
        subprocess.run(["git", "init"], cwd=self.project, capture_output=True, check=True)
        subprocess.run(["git", "config", "user.email", "test@example.com"], cwd=self.project, check=True)
        subprocess.run(["git", "config", "user.name", "Test"], cwd=self.project, check=True)
        event = "## [2026-01-01] fix | duplicate\n"
        (self.project / "PROJECT_LOG.md").write_text("# LOG\n\n" + event + event, encoding="utf-8")
        subprocess.run(["git", "add", "PROJECT_LOG.md"], cwd=self.project, check=True)
        subprocess.run(["git", "commit", "-m", "init"], cwd=self.project, capture_output=True, check=True)

        (self.project / "PROJECT_LOG.md").write_text("# LOG\n\n" + event, encoding="utf-8")
        result = self.run_audit("spine")
        self.assertEqual(result.returncode, 1)
        self.assertIn("1 history events were removed", result.stdout)


if __name__ == "__main__":
    unittest.main()
