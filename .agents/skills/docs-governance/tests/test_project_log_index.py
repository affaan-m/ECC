from pathlib import Path
import json
import os
import sqlite3
import subprocess
import sys
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "scripts" / "project-log-index.py"


def render_log(count: int) -> str:
    entries = [
        f"## [2026-01-{(index % 28) + 1:02d}] fix | module=orders fix item {index:03d} `src/orders/service.py` TEST-ORDER-{index:03d}"
        for index in range(1, count + 1)
    ]
    return "# PROJECT_LOG.md — Append-only\n\n" + "\n".join(entries) + "\n"


class ProjectLogIndexTest(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.project = Path(self.temp_dir.name)

    def tearDown(self):
        self.temp_dir.cleanup()

    def run_script(self, *args: str) -> subprocess.CompletedProcess[str]:
        return subprocess.run(
            [sys.executable, str(SCRIPT), *args, "--root", str(self.project)],
            text=True,
            capture_output=True,
            check=False,
        )

    def test_status_counts_events_not_lines(self):
        (self.project / "PROJECT_LOG.md").write_text(render_log(201), encoding="utf-8")
        result = self.run_script("status")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("events: 201", result.stdout)
        self.assertIn("above threshold", result.stdout)

    def test_rebuild_is_idempotent_and_indexes_refs(self):
        (self.project / "PROJECT_LOG.md").write_text(render_log(3), encoding="utf-8")
        first = self.run_script("rebuild")
        second = self.run_script("rebuild")
        self.assertEqual(first.returncode, 0, first.stderr)
        self.assertEqual(second.returncode, 0, second.stderr)

        database = self.project / ".governance" / "project-log.sqlite"
        connection = sqlite3.connect(database)
        try:
            self.assertEqual(connection.execute("SELECT COUNT(*) FROM events").fetchone()[0], 3)
            self.assertEqual(connection.execute("SELECT COUNT(*) FROM event_refs WHERE ref_type='test'").fetchone()[0], 3)
            self.assertEqual(connection.execute("SELECT DISTINCT module FROM events").fetchone()[0], "orders")
        finally:
            connection.close()

    def test_archive_requires_confirmation_and_preserves_every_event(self):
        log = self.project / "PROJECT_LOG.md"
        log.write_text(render_log(201), encoding="utf-8")
        original = log.read_text(encoding="utf-8")

        blocked = self.run_script("archive", "--keep", "100")
        self.assertNotEqual(blocked.returncode, 0)
        self.assertEqual(log.read_text(encoding="utf-8"), original)
        self.assertFalse((self.project / "PROJECT_LOG.archive.md").exists())

        archived = self.run_script("archive", "--keep", "100", "--yes")
        self.assertEqual(archived.returncode, 0, archived.stderr)
        active_text = log.read_text(encoding="utf-8")
        archive_text = (self.project / "PROJECT_LOG.archive.md").read_text(encoding="utf-8")
        self.assertEqual(active_text.count("\n## ["), 100)
        self.assertEqual(archive_text.count("\n## ["), 101)
        self.assertIn("Historical events are archived", active_text)

        connection = sqlite3.connect(self.project / ".governance" / "project-log.sqlite")
        try:
            self.assertEqual(connection.execute("SELECT COUNT(*) FROM events").fetchone()[0], 201)
            self.assertEqual(
                connection.execute(
                    "SELECT COUNT(*) FROM events WHERE source_file='PROJECT_LOG.archive.md'"
                ).fetchone()[0],
                101,
            )
        finally:
            connection.close()

    def test_archive_below_threshold_does_not_mutate_log(self):
        log = self.project / "PROJECT_LOG.md"
        log.write_text(render_log(20), encoding="utf-8")
        before = log.read_text(encoding="utf-8")
        result = self.run_script("archive", "--yes")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(log.read_text(encoding="utf-8"), before)
        self.assertFalse((self.project / "PROJECT_LOG.archive.md").exists())

    def test_archive_preserves_existing_file_permissions(self):
        log = self.project / "PROJECT_LOG.md"
        archive = self.project / "PROJECT_LOG.archive.md"
        log.write_text(render_log(201), encoding="utf-8")
        archive.write_text("# Archive\n", encoding="utf-8")
        os.chmod(log, 0o640)
        os.chmod(archive, 0o644)

        result = self.run_script("archive", "--keep", "100", "--yes")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(log.stat().st_mode & 0o777, 0o640)
        self.assertEqual(archive.stat().st_mode & 0o777, 0o644)

    def test_archive_preserves_duplicate_events_in_markdown(self):
        duplicate = "## [2026-01-01] fix | repeated evidence\n"
        unique = [
            f"## [2026-02-{(index % 28) + 1:02d}] fix | unique {index:03d}\n"
            for index in range(200)
        ]
        log = self.project / "PROJECT_LOG.md"
        log.write_text("# LOG\n\n" + duplicate + duplicate + "".join(unique), encoding="utf-8")

        result = self.run_script("archive", "--keep", "100", "--yes")
        self.assertEqual(result.returncode, 0, result.stderr)
        archive_text = (self.project / "PROJECT_LOG.archive.md").read_text(encoding="utf-8")
        self.assertEqual(archive_text.count("repeated evidence"), 2)

    def test_role_map_rejects_relative_history_path_outside_project(self):
        (self.project / "PROJECT_LOG.md").write_text(render_log(1), encoding="utf-8")
        outside = self.project.parent / f"{self.project.name}-outside.md"
        governance = self.project / ".governance"
        governance.mkdir()
        (governance / "docs-map.json").write_text(
            json.dumps({"history": f"../{outside.name}"}), encoding="utf-8"
        )
        result = self.run_script("status")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("must stay inside the project root", result.stderr)
        self.assertFalse(outside.exists())

    def test_role_map_rejects_absolute_history_path_outside_project(self):
        (self.project / "PROJECT_LOG.md").write_text(render_log(1), encoding="utf-8")
        outside = self.project.parent / f"{self.project.name}-absolute-outside.md"
        governance = self.project / ".governance"
        governance.mkdir()
        (governance / "docs-map.json").write_text(
            json.dumps({"history": str(outside)}), encoding="utf-8"
        )

        result = self.run_script("status")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("must stay inside the project root", result.stderr)
        self.assertFalse(outside.exists())

    def test_role_map_controls_history_status_rebuild_and_archive(self):
        docs = self.project / "docs"
        docs.mkdir()
        log = docs / "history.md"
        archive = docs / "history-archive.md"
        log.write_text(render_log(201), encoding="utf-8")
        governance = self.project / ".governance"
        governance.mkdir()
        (governance / "docs-map.json").write_text(
            json.dumps(
                {
                    "history": "docs/history.md",
                    "history_archive": "docs/history-archive.md",
                }
            ),
            encoding="utf-8",
        )

        status = self.run_script("status")
        self.assertEqual(status.returncode, 0, status.stderr)
        self.assertIn("events: 201", status.stdout)

        archived = self.run_script("archive", "--keep", "100", "--yes")
        self.assertEqual(archived.returncode, 0, archived.stderr)
        self.assertTrue(archive.exists())
        self.assertIn("docs/history-archive.md", log.read_text(encoding="utf-8"))

        connection = sqlite3.connect(governance / "project-log.sqlite")
        try:
            sources = {
                row[0] for row in connection.execute("SELECT DISTINCT source_file FROM events")
            }
            self.assertEqual(sources, {"docs/history.md", "docs/history-archive.md"})
        finally:
            connection.close()


if __name__ == "__main__":
    unittest.main()
