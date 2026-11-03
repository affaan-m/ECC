import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("ecc_install", ROOT / "scripts" / "install.py")
installer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(installer)


class InstallerTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="ecc test ")
        self.addCleanup(self.temp.cleanup)
        self.base = Path(self.temp.name).resolve()
        self.source = self.base / "исходник с пробелами"
        (self.source / "scripts").mkdir(parents=True)
        shutil.copy2(ROOT / "scripts" / "install.py", self.source / "scripts" / "install.py")
        self.manifest = {
            "default_profiles": ["go"],
            "profiles": {"go": ["ecc-go"], "zig": ["ecc-zig"]},
        }
        for name in ["ecc-go", "ecc-zig"]:
            path = self.source / "skills" / name
            path.mkdir(parents=True)
            (path / "SKILL.md").write_text(f"---\nname: {name}\ndescription: Test fixture\n---\n")
        self.write_manifest()
        self.target = self.base / "цель с пробелами" / "skills"

    def write_manifest(self):
        (self.source / "skills.json").write_text(json.dumps(self.manifest))

    def run_cli(self, *args, target=True, code=0):
        command = [sys.executable, str(self.source / "scripts" / "install.py")]
        if target:
            command += ["--dest", str(self.target)]
        command += list(args)
        env = dict(os.environ, HOME=str(self.base / "home"), PYTHONDONTWRITEBYTECODE="1")
        result = subprocess.run(command, capture_output=True, text=True, env=env)
        self.assertEqual(result.returncode, code, result.stdout + result.stderr)
        return result

    def test_install_is_idempotent_and_changes_follow_source(self):
        self.run_cli()
        link = self.target / "ecc-go"
        self.assertTrue(link.is_symlink())
        self.assertEqual(link.resolve(), self.source / "skills" / "ecc-go")
        before = link.lstat().st_ino
        self.run_cli()
        self.assertEqual(before, link.lstat().st_ino)
        (self.source / "skills/ecc-go/reference.md").write_text("updated")
        self.assertEqual((link / "reference.md").read_text(), "updated")

    def test_dry_run_and_list_create_nothing(self):
        self.run_cli("--profile", "all", "--dry-run")
        self.assertFalse(self.target.parent.exists())
        self.run_cli("--list")
        self.assertFalse(self.target.parent.exists())

    def test_all_and_repeated_profiles_install_union(self):
        self.run_cli("--profile", "go", "--profile", "zig", "--profile", "go")
        self.assertEqual(sorted(p.name for p in self.target.iterdir()), ["ecc-go", "ecc-zig"])
        self.run_cli("--profile", "all")

    def test_conflict_preflight_does_not_partially_install(self):
        self.target.mkdir(parents=True)
        (self.target / "ecc-zig").mkdir()
        marker = self.target / "ecc-zig/local.md"
        marker.write_text("local edits")
        self.run_cli("--profile", "all", code=1)
        self.assertFalse((self.target / "ecc-go").exists())
        self.assertEqual(marker.read_text(), "local edits")

    def test_broken_foreign_symlink_is_preserved(self):
        self.target.mkdir(parents=True)
        link = self.target / "ecc-go"
        link.symlink_to(self.base / "missing")
        self.run_cli(code=1)
        self.assertEqual(os.readlink(link), str(self.base / "missing"))
        self.run_cli("--uninstall")
        self.assertTrue(link.is_symlink())

    def test_uninstall_preserves_foreign_and_other_profiles(self):
        self.run_cli("--profile", "all")
        foreign = self.target / "other-skill"
        foreign.mkdir()
        (foreign / "notes.md").write_text("keep")
        self.run_cli("--uninstall", "--dry-run")
        self.assertTrue((self.target / "ecc-go").is_symlink())
        self.run_cli("--uninstall")
        self.assertFalse((self.target / "ecc-go").is_symlink())
        self.assertTrue((self.target / "ecc-zig").is_symlink())
        self.assertEqual((foreign / "notes.md").read_text(), "keep")
        self.run_cli("--uninstall")

    def test_changed_owned_link_is_preserved(self):
        self.run_cli()
        link = self.target / "ecc-go"
        link.unlink()
        link.symlink_to(self.base)
        self.run_cli("--uninstall")
        self.assertEqual(link.resolve(), self.base)

    def test_uninstall_from_missing_destination_creates_nothing(self):
        self.run_cli("--uninstall", "--profile", "all")
        self.assertFalse(self.target.parent.exists())

    def test_project_and_user_scope(self):
        project = self.base / "project"
        project.mkdir()
        self.run_cli("--project", str(project), target=False)
        self.assertTrue((project / ".agents/skills/ecc-go").is_symlink())
        self.run_cli("--user", target=False)
        self.assertTrue((self.base / "home/.agents/skills/ecc-go").is_symlink())
        self.run_cli("--project", str(self.base / "missing-project"), target=False, code=1)

    def test_unknown_profile_has_no_side_effects(self):
        self.run_cli("--profile", "python", code=1)
        self.assertFalse(self.target.parent.exists())

    def test_target_cannot_be_a_file_or_source_subdirectory(self):
        self.target.parent.mkdir(parents=True)
        self.target.write_text("keep")
        self.run_cli(code=1)
        self.assertEqual(self.target.read_text(), "keep")
        self.run_cli("--dest", str(self.source / "skills/ecc-go/nested"), target=False, code=1)
        self.assertFalse((self.source / "skills/ecc-go/nested").exists())

    def test_dry_run_rejects_file_or_broken_link_as_parent(self):
        parent = self.base / "file-parent"
        parent.write_text("keep")
        self.run_cli("--dest", str(parent / "skills"), "--dry-run", target=False, code=1)
        self.assertEqual(parent.read_text(), "keep")
        parent.unlink()
        parent.symlink_to(self.base / "missing-parent")
        self.run_cli("--dest", str(parent / "skills"), "--dry-run", target=False, code=1)
        self.assertTrue(parent.is_symlink())

    def test_invalid_catalog_cannot_escape_skills_directory(self):
        self.manifest["profiles"]["go"] = ["../../victim"]
        self.write_manifest()
        self.run_cli(code=1)
        self.assertFalse(self.target.parent.exists())

    def test_invalid_source_or_name_is_rejected_before_writes(self):
        entry = self.source / "skills/ecc-go/SKILL.md"
        entry.write_text("---\nname: wrong\n---\n")
        self.run_cli(code=1)
        self.assertFalse(self.target.parent.exists())

    def test_source_resource_symlink_is_rejected(self):
        (self.source / "skills/ecc-go/secret").symlink_to(self.base / "outside")
        self.run_cli(code=1)
        self.assertFalse(self.target.parent.exists())

    def test_failed_link_creation_rolls_back_only_created_links(self):
        source = self.source / "skills"
        plan = installer.plan_install(self.target, ["ecc-go", "ecc-zig"], root=self.source)
        original = Path.symlink_to

        def fail_second(link, other, **kwargs):
            if link.name == "ecc-zig":
                raise OSError("simulated filesystem failure")
            return original(link, other, **kwargs)

        with patch.object(Path, "symlink_to", fail_second):
            with self.assertRaises(OSError):
                installer.apply(plan)
        self.assertFalse(os.path.lexists(self.target / "ecc-go"))
        self.assertTrue((source / "ecc-go/SKILL.md").is_file())

    def test_uninstall_rechecks_ownership_after_preflight(self):
        self.run_cli()
        plan = installer.plan_install(self.target, ["ecc-go"], uninstall=True, root=self.source)
        link = self.target / "ecc-go"
        link.unlink()
        link.symlink_to(self.base)
        with self.assertRaises(ValueError):
            installer.apply(plan)
        self.assertEqual(link.resolve(), self.base)


if __name__ == "__main__":
    unittest.main()
