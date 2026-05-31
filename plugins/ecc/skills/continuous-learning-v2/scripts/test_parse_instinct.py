"""Tests for continuous-learning-v2 instinct-cli.py

Covers:
  - parse_instinct_file() — content preservation, edge cases
  - _validate_file_path() — path traversal blocking
  - detect_project() — project detection with mocked git/env
  - load_all_instincts() — loading from project + global dirs, dedup
  - _load_instincts_from_dir() — directory scanning
  - cmd_projects() — listing projects from registry
  - cmd_status() — status display
  - _promote_specific() — single instinct promotion
  - _promote_auto() — auto-promotion across projects
"""

import importlib.util
import io
import json
import os
import sys
from pathlib import Path
from types import SimpleNamespace
from unittest import mock

import pytest

# Load instinct-cli.py (hyphenated filename requires importlib)
_spec = importlib.util.spec_from_file_location(
    "instinct_cli",
    os.path.join(os.path.dirname(__file__), "instinct-cli.py"),
)
_mod = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_mod)

parse_instinct_file = _mod.parse_instinct_file
_validate_file_path = _mod._validate_file_path
detect_project = _mod.detect_project
load_all_instincts = _mod.load_all_instincts
load_project_only_instincts = _mod.load_project_only_instincts
_load_instincts_from_dir = _mod._load_instincts_from_dir
cmd_status = _mod.cmd_status
cmd_projects = _mod.cmd_projects
_promote_specific = _mod._promote_specific
_promote_auto = _mod._promote_auto
_find_cross_project_instincts = _mod._find_cross_project_instincts
load_registry = _mod.load_registry
_validate_instinct_id = _mod._validate_instinct_id
_update_registry = _mod._update_registry
_confidence_bar = _mod._confidence_bar


# ─────────────────────────────────────────────
# Fixtures
# ─────────────────────────────────────────────

SAMPLE_INSTINCT_YAML = """\
---
id: test-instinct
trigger: "when writing tests"
confidence: 0.8
domain: testing
scope: project
---

## Action
Always write tests first.

## Evidence
TDD leads to better design.
"""

SAMPLE_GLOBAL_INSTINCT_YAML = """\
---
id: global-instinct
trigger: "always"
confidence: 0.9
domain: security
scope: global
---

## Action
Validate all user input.
"""


@pytest.fixture
def project_tree(tmp_path):
    """Create a realistic project directory tree for testing."""
    homunculus = tmp_path / ".claude" / "homunculus"
    projects_dir = homunculus / "projects"
    global_personal = homunculus / "instincts" / "personal"
    global_inherited = homunculus / "instincts" / "inherited"
    global_evolved = homunculus / "evolved"

    for d in [
        global_personal, global_inherited,
        global_evolved / "skills", global_evolved / "commands", global_evolved / "agents",
        projects_dir,
    ]:
        d.mkdir(parents=True, exist_ok=True)

    return {
        "root": tmp_path,
        "homunculus": homunculus,
        "projects_dir": projects_dir,
        "global_personal": global_personal,
        "global_inherited": global_inherited,
        "global_evolved": global_evolved,
        "registry_file": homunculus / "projects.json",
    }


@pytest.fixture
def patch_globals(project_tree, monkeypatch):
    """Patch module-level globals to use tmp_path-based directories."""
    monkeypatch.setattr(_mod, "HOMUNCULUS_DIR", project_tree["homunculus"])
    monkeypatch.setattr(_mod, "PROJECTS_DIR", project_tree["projects_dir"])
    monkeypatch.setattr(_mod, "REGISTRY_FILE", project_tree["registry_file"])
    monkeypatch.setattr(_mod, "GLOBAL_PERSONAL_DIR", project_tree["global_personal"])
    monkeypatch.setattr(_mod, "GLOBAL_INHERITED_DIR", project_tree["global_inherited"])
    monkeypatch.setattr(_mod, "GLOBAL_EVOLVED_DIR", project_tree["global_evolved"])
    monkeypatch.setattr(_mod, "GLOBAL_OBSERVATIONS_FILE", project_tree["homunculus"] / "observations.jsonl")
    return project_tree


def _make_project(tree, pid="abc123", pname="test-project"):
    """Create project directory structure and return a project dict."""
    project_dir = tree["projects_dir"] / pid
    personal_dir = project_dir / "instincts" / "personal"
    inherited_dir = project_dir / "instincts" / "inherited"
    for d in [personal_dir, inherited_dir,
              project_dir / "evolved" / "skills",
              project_dir / "evolved" / "commands",
              project_dir / "evolved" / "agents",
              project_dir / "observations.archive"]:
        d.mkdir(parents=True, exist_ok=True)

    return {
        "id": pid,
        "name": pname,
        "root": str(tree["root"] / "fake-repo"),
        "remote": "https://github.com/test/test-project.git",
        "project_dir": project_dir,
        "instincts_personal": personal_dir,
        "instincts_inherited": inherited_dir,
        "evolved_dir": project_dir / "evolved",
        "observations_file": project_dir / "observations.jsonl",
    }


# ─────────────────────────────────────────────
# parse_instinct_file tests
# ─────────────────────────────────────────────

MULTI_SECTION = """\
---
id: instinct-a
trigger: "when coding"
confidence: 0.9
domain: general
---

## Action
Do thing A.

## Examples
- Example A1

---
id: instinct-b
trigger: "when testing"
confidence: 0.7
domain: testing
---

## Action
Do thing B.
"""


def test_multiple_instincts_preserve_content():
    result = parse_instinct_file(MULTI_SECTION)
    assert len(result) == 2
    assert "Do thing A." in result[0]["content"]
    assert "Example A1" in result[0]["content"]
    assert "Do thing B." in result[1]["content"]


def test_single_instinct_preserves_content():
    content = """\
---
id: solo
trigger: "when reviewing"
confidence: 0.8
domain: review
---

## Action
Check for security issues.

## Evidence
Prevents vulnerabilities.
"""
    result = parse_instinct_file(content)
    assert len(result) == 1
    assert "Check for security issues." in result[0]["content"]
    assert "Prevents vulnerabilities." in result[0]["content"]


def test_empty_content_no_error():
    content = """\
---
id: empty
trigger: "placeholder"
confidence: 0.5
domain: general
---
"""
    result = parse_instinct_file(content)
    assert len(result) == 1
    assert result[0]["content"] == ""


def test_parse_no_id_skipped():
    """Instincts without an 'id' field should be silently dropped."""
    content = """\
---
trigger: "when doing nothing"
confidence: 0.5
---

No id here.
"""
    result = parse_instinct_file(content)
    assert len(result) == 0


def test_parse_confidence_is_float():
    content = """\
---
id: float-check
trigger: "when parsing"
confidence: 0.42
domain: general
---

Body.
"""
    result = parse_instinct_file(content)
    assert isinstance(result[0]["confidence"], float)
    assert result[0]["confidence"] == pytest.approx(0.42)


def test_parse_trigger_strips_quotes():
    content = """\
---
id: quote-check
trigger: "when quoting"
confidence: 0.5
domain: general
---

Body.
"""
    result = parse_instinct_file(content)
    assert result[0]["trigger"] == "when quoting"


def test_parse_empty_string():
    result = parse_instinct_file("")
    assert result == []


def test_parse_garbage_input():
    result = parse_instinct_file("this is not yaml at all\nno frontmatter here")
    assert result == []


# ─────────────────────────────────────────────
# _validate_file_path tests
# ─────────────────────────────────────────────

def test_validate_normal_path(tmp_path):
    test_file = tmp_path / "test.yaml"
    test_file.write_text("hello")
    result = _validate_file_path(str(test_file), must_exist=True)
    assert result == test_file.resolve()


def test_validate_rejects_etc():
    with pytest.raises(ValueError, match="system directory"):
        _validate_file_path("/etc/passwd")


def test_validate_rejects_var_log():
    with pytest.raises(ValueError, match="system directory"):
        _validate_file_path("/var/log/syslog")


def test_validate_rejects_usr():
    with pytest.raises(ValueError, match="system directory"):
        _validate_file_path("/usr/local/bin/foo")


def test_validate_rejects_proc():
    with pytest.raises(ValueError, match="system directory"):
        _validate_file_path("/proc/self/status")


def test_validate_must_exist_fails(tmp_path):
    with pytest.raises(ValueError, match="does not exist"):
        _validate_file_path(str(tmp_path / "nonexistent.yaml"), must_exist=True)


def test_validate_home_expansion(tmp_path):
    """Tilde expansion should work."""
    result = _validate_file_path("~/test.yaml")
    assert str(result).startswith(str(Path.home()))


def test_validate_relative_path(tmp_path, monkeypatch):
    """Relative paths should be resolved."""
    monkeypatch.chdir(tmp_path)
    test_file = tmp_path / "rel.yaml"
    test_file.write_text("content")
    result = _validate_file_path("rel.yaml", must_exist=True)
    assert result == test_file.resolve()


# ─────────────────────────────────────────────
# detect_project tests
# ─────────────────────────────────────────────

def test_detect_project_global_fallback(patch_globals, monkeypatch):
    """When no git and no env var, should return global project."""
    monkeypatch.delenv("CLAUDE_PROJECT_DIR", raising=False)

    # Mock subprocess.run to simulate git not available
    def mock_run(*args, **kwargs):
        raise FileNotFoundError("git not found")

    monkeypatch.setattr("subprocess.run", mock_run)

    project = detect_project()
    assert project["id"] == "global"
    assert project["name"] == "global"


def test_detect_project_from_env(patch_globals, monkeypatch, tmp_path):
    """CLAUDE_PROJECT_DIR env var should be used as project root."""
    fake_repo = tmp_path / "my-repo"
    fake_repo.mkdir()
    monkeypatch.setenv("CLAUDE_PROJECT_DIR", str(fake_repo))

    # Mock git remote to return a URL
    def mock_run(cmd, **kwargs):
        if "rev-parse" in cmd:
            return SimpleNamespace(returncode=0, stdout=str(fake_repo) + "\n", stderr="")
        if "get-url" in cmd:
            return SimpleNamespace(returncode=0, stdout="https://github.com/test/my-repo.git\n", stderr="")
        return SimpleNamespace(returncode=1, stdout="", stderr="")

    monkeypatch.setattr("subprocess.run", mock_run)

    project = detect_project()
    assert project["id"] != "global"
    assert project["name"] == "my-repo"


def test_detect_project_git_timeout(patch_globals, monkeypatch):
    """Git timeout should fall through to global."""
    monkeypatch.delenv("CLAUDE_PROJECT_DIR", raising=False)
    import subprocess as sp

    def mock_run(cmd, **kwargs):
        raise sp.TimeoutExpired(cmd, 5)

    monkeypatch.setattr("subprocess.run", mock_run)

    project = detect_project()
    assert project["id"] == "global"


def test_detect_project_creates_directories(patch_globals, monkeypatch, tmp_path):
    """detect_project should create the project dir structure."""
    fake_repo = tmp_path / "structured-repo"
    fake_repo.mkdir()
    monkeypatch.setenv("CLAUDE_PROJECT_DIR", str(fake_repo))

    def mock_run(cmd, **kwargs):
        if "rev-parse" in cmd:
            return SimpleNamespace(returncode=0, stdout=str(fake_repo) + "\n", stderr="")
        if "get-url" in cmd:
            return SimpleNamespace(returncode=1, stdout="", stderr="no remote")
        return SimpleNamespace(returncode=1, stdout="", stderr="")

    monkeypatch.setattr("subprocess.run", mock_run)

    project = detect_project()
    assert project["instincts_personal"].exists()
    assert project["instincts_inherited"].exists()
    assert (project["evolved_dir"] / "skills").exists()


# ─────────────────────────────────────────────
# _load_instincts_from_dir tests
# ─────────────────────────────────────────────

def test_load_from_empty_dir(tmp_path):
    result = _load_instincts_from_dir(tmp_path, "personal", "project")
    assert result == []


def test_load_from_nonexistent_dir(tmp_path):
    result = _load_instincts_from_dir(tmp_path / "does-not-exist", "personal", "project")
    assert result == []


def test_load_annotates_metadata(tmp_path):
    """Loaded instincts should have _source_file, _source_type, _scope_label."""
    yaml_file = tmp_path / "test.yaml"
    yaml_file.write_text(SAMPLE_INSTINCT_YAML)

    result = _load_instincts_from_dir(tmp_path, "personal", "project")
    assert len(result) == 1
    assert result[0]["_source_file"] == str(yaml_file)
    assert result[0]["_source_type"] == "personal"
    assert result[0]["_scope_label"] == "project"


def test_load_defaults_scope_from_label(tmp_path):
    """If an instinct has no 'scope' in frontmatter, it should default to scope_label."""
    no_scope_yaml = """\
---
id: no-scope
trigger: "test"
confidence: 0.5
domain: general
---

Body.
"""
    (tmp_path / "no-scope.yaml").write_text(no_scope_yaml)
    result = _load_instincts_from_dir(tmp_path, "inherited", "global")
    assert result[0]["scope"] == "global"


def test_load_preserves_explicit_scope(tmp_path):
    """If frontmatter has explicit scope, it should be preserved."""
    yaml_file = tmp_path / "test.yaml"
    yaml_file.write_text(SAMPLE_INSTINCT_YAML)

    result = _load_instincts_from_dir(tmp_path, "personal", "global")
    # Frontmatter says scope: project, scope_label is global
    # The explicit scope should be preserved (not overwritten)
    assert result[0]["scope"] == "project"


def test_load_handles_corrupt_file(tmp_path, capsys):
    """Corrupt YAML files should be warned about but not crash."""
    # A file that will cause parse_instinct_file to return empty
    (tmp_path / "good.yaml").write_text(SAMPLE_INSTINCT_YAML)
    (tmp_path / "bad.yaml").write_text("not yaml\nno frontmatter")

    result = _load_instincts_from_dir(tmp_path, "personal", "project")
    # bad.yaml has no valid instincts (no id), so only good.yaml contributes
    assert len(result) == 1
    assert result[0]["id"] == "test-instinct"


def test_load_supports_yml_extension(tmp_path):
    yml_file = tmp_path / "test.yml"
    yml_file.write_text(SAMPLE_INSTINCT_YAML)

    result = _load_instincts_from_dir(tmp_path, "personal", "project")
    ids = {i["id"] for i in result}
    assert "test-instinct" in ids


def test_load_supports_md_extension(tmp_path):
    md_file = tmp_path / "legacy-instinct.md"
    md_file.write_text(SAMPLE_INSTINCT_YAML)

    result = _load_instincts_from_dir(tmp_path, "personal", "project")
    ids = {i["id"] for i in result}
    assert "test-instinct" in ids


def test_load_instincts_from_dir_uses_utf8_encoding(tmp_path, monkeypatch):
    yaml_file = tmp_path / "test.yaml"
    yaml_file.write_text("placeholder")
    calls = []

    def fake_read_text(self, *args, **kwargs):
        calls.append(kwargs.get("encoding"))
        return SAMPLE_INSTINCT_YAML

    monkeypatch.setattr(Path, "read_text", fake_read_text)
    result = _load_instincts_from_dir(tmp_path, "personal", "project")
    assert result[0]["id"] == "test-instinct"
    assert calls == ["utf-8"]


# ─────────────────────────────────────────────
# load_all_instincts tests
# ─────────────────────────────────────────────

def test_load_all_project_and_global(patch_globals):
    """Should load from both project and global directories."""
    tree = patch_globals
    project = _make_project(tree)

    # Write a project instinct
    (project["instincts_personal"] / "proj.yaml").write_text(SAMPLE_INSTINCT_YAML)
    # Write a global instinct
    (tree["global_personal"] / "glob.yaml").write_text(SAMPLE_GLOBAL_INSTINCT_YAML)

    result = load_all_instincts(project)
    ids = {i["id"] for i in result}
    assert "test-instinct" in ids
    assert "global-instinct" in ids


def test_load_all_project_overrides_global(patch_globals):
    """When project and global have same ID, project wins."""
    tree = patch_globals
    project = _make_project(tree)

    # Same ID but different confidence
    proj_yaml = SAMPLE_INSTINCT_YAML.replace("id: test-instinct", "id: shared-id")
    proj_yaml = proj_yaml.replace("confidence: 0.8", "confidence: 0.9")
    glob_yaml = SAMPLE_GLOBAL_INSTINCT_YAML.replace("id: global-instinct", "id: shared-id")
    glob_yaml = glob_yaml.replace("confidence: 0.9", "confidence: 0.3")

    (project["instincts_personal"] / "shared.yaml").write_text(proj_yaml)
    (tree["global_personal"] / "shared.yaml").write_text(glob_yaml)

    result = load_all_instincts(project)
    shared = [i for i in result if i["id"] == "shared-id"]
    assert len(shared) == 1
    assert shared[0]["_scope_label"] == "project"
    assert shared[0]["confidence"] == 0.9


def test_load_all_global_only(patch_globals):
    """Global project should only load global instincts."""
    tree = patch_globals
    (tree["global_personal"] / "glob.yaml").write_text(SAMPLE_GLOBAL_INSTINCT_YAML)

    global_project = {
        "id": "global",
        "name": "global",
        "root": "",
        "project_dir": tree["homunculus"],
        "instincts_personal": tree["global_personal"],
        "instincts_inherited": tree["global_inherited"],
        "evolved_dir": tree["global_evolved"],
        "observations_file": tree["homunculus"] / "observations.jsonl",
    }

    result = load_all_instincts(global_project)
    assert len(result) == 1
    assert result[0]["id"] == "global-instinct"


def test_load_project_only_excludes_global(patch_globals):
    """load_project_only_instincts should NOT include global instincts."""
    tree = patch_globals
    project = _make_project(tree)

    (project["instincts_personal"] / "proj.yaml").write_text(SAMPLE_INSTINCT_YAML)
    (tree["global_personal"] / "glob.yaml").write_text(SAMPLE_GLOBAL_INSTINCT_YAML)

    result = load_project_only_instincts(project)
    ids = {i["id"] for i in result}
    assert "test-instinct" in ids
    assert "global-instinct" not in ids


def test_load_project_only_global_fallback_loads_global(patch_globals):
    """Global fallback should return global instincts for project-only queries."""
    tree = patch_globals
    (tree["global_personal"] / "glob.yaml").write_text(SAMPLE_GLOBAL_INSTINCT_YAML)

    global_project = {
        "id": "global",
        "name": "global",
        "root": "",
        "project_dir": tree["homunculus"],
        "instincts_personal": tree["global_personal"],
        "instincts_inherited": tree["global_inherited"],
        "evolved_dir": tree["global_evolved"],
        "observations_file": tree["homunculus"] / "observations.jsonl",
    }

    result = load_project_only_instincts(global_project)
    assert len(result) == 1
    assert result[0]["id"] == "global-instinct"


def test_load_all_empty(patch_globals):
    """No instincts at all should return empty list."""
    tree = patch_globals
    project = _make_project(tree)

    result = load_all_instincts(project)
    assert result == []


# ─────────────────────────────────────────────
# cmd_status tests
# ─────────────────────────────────────────────

def test_cmd_status_no_instincts(patch_globals, monkeypatch, capsys):
    """Status with no instincts should print fallback message."""
    tree = patch_globals
    project = _make_project(tree)
    monkeypatch.setattr(_mod, "detect_project", lambda: project)

    args = SimpleNamespace()
    ret = cmd_status(args)
    assert ret == 0
    out = capsys.readouterr().out
    assert "No instincts found." in out


def test_cmd_status_with_instincts(patch_globals, monkeypatch, capsys):
    """Status should show project and global instinct counts."""
    tree = patch_globals
    project = _make_project(tree)
    monkeypatch.setattr(_mod, "detect_project", lambda: project)

    (project["instincts_personal"] / "proj.yaml").write_text(SAMPLE_INSTINCT_YAML)
    (tree["global_personal"] / "glob.yaml").write_text(SAMPLE_GLOBAL_INSTINCT_YAML)

    args = SimpleNamespace()
    ret = cmd_status(args)
    assert ret == 0
    out = capsys.readouterr().out
    assert "INSTINCT STATUS" in out
    assert "Project instincts: 1" in out
    assert "Global instincts:  1" in out
    assert "PROJECT-SCOPED" in out
    assert "GLOBAL" in out


def test_confidence_bar_uses_unicode_when_supported():
    """Confidence bars should retain block glyphs on UTF-8 streams."""
    stream = SimpleNamespace(encoding="utf-8")
    assert _confidence_bar(0.8, stream=stream) == "\u2588" * 8 + "\u2591" * 2


def test_confidence_bar_uses_ascii_when_stream_rejects_block_glyphs():
    """Windows cp1252 streams cannot encode block glyphs."""
    stream = SimpleNamespace(encoding="cp1252")
    assert _confidence_bar(0.8, stream=stream) == "########.."


def test_print_instincts_by_domain_is_cp1252_safe(monkeypatch):
    """Status rendering should not crash on Windows cp1252 stdout."""
    raw = io.BytesIO()
    stream = io.TextIOWrapper(raw, encoding="cp1252")
    monkeypatch.setattr(_mod.sys, "stdout", stream)

    _mod._print_instincts_by_domain([{
        "id": "windows-safe",
        "trigger": "when stdout uses cp1252",
        "confidence": 0.8,
        "domain": "platform",
        "scope": "project",
    }])

    stream.flush()
    out = raw.getvalue().decode("cp1252")
    assert "########.." in out
    assert "\u2588" not in out
    assert "\u2591" not in out


def test_cmd_status_returns_int(patch_globals, monkeypatch):
    """cmd_status should always return an int."""
    tree = patch_globals
    project = _make_project(tree)
    monkeypatch.setattr(_mod, "detect_project", lambda: project)

    args = SimpleNamespace()
    ret = cmd_status(args)
    assert isinstance(ret, int)


# ─────────────────────────────────────────────
# cmd_projects tests
# ─────────────────────────────────────────────

def test_cmd_projects_empty_registry(patch_globals, capsys):
    """No projects should print helpful message."""
    args = SimpleNamespace()
    ret = cmd_projects(args)
    assert ret == 0
    out = capsys.readouterr().out
    assert "No projects registered yet." in out


def test_cmd_projects_with_registry(patch_globals, capsys):
    """Should list projects from registry."""
    tree = patch_globals

    # Create a project dir with instincts
    pid = "test123abc"
    project = _make_project(tree, pid=pid, pname="my-app")
    (project["instincts_personal"] / "inst.yaml").write_text(SAMPLE_INSTINCT_YAML)

    # Write registry
    registry = {
        pid: {
            "name": "my-app",
            "root": "/home/user/my-app",
            "remote": "https://github.com/user/my-app.git",
            "last_seen": "2025-01-15T12:00:00Z",
        }
    }
    tree["registry_file"].write_text(json.dumps(registry))

    args = SimpleNamespace()
    ret = cmd_projects(args)
    assert ret == 0
    out = capsys.readouterr().out
    assert "my-app" in out
    assert pid in out
    assert "1 personal" in out


# ─────────────────────────────────────────────
# _promote_specific tests
# ─────────────────────────────────────────────

def test_promote_specific_not_found(patch_globals, capsys):
    """Promoting nonexistent instinct should fail."""
    tree = patch_globals
    project = _make_project(tree)

    ret = _promote_specific(project, "nonexistent", force=True)
    assert ret == 1
    out = capsys.readouterr().out
    assert "not found" in out


def test_promote_specific_rejects_invalid_id(patch_globals, capsys):
    """Path-like instinct IDs should be rejected before file writes."""
    tree = patch_globals
    project = _make_project(tree)

    ret = _promote_specific(project, "../escape", force=True)
    assert ret == 1
    err = capsys.readouterr().err
    assert "Invalid instinct ID" in err


def test_promote_specific_already_global(patch_globals, capsys):
    """Promoting an instinct that already exists globally should fail."""
    tree = patch_globals
    project = _make_project(tree)

    # Write same-id instinct in both project and global
    (project["instincts_personal"] / "shared.yaml").write_text(SAMPLE_INSTINCT_YAML)
    global_yaml = SAMPLE_INSTINCT_YAML  # same id: test-instinct
    (tree["global_personal"] / "shared.yaml").write_text(global_yaml)

    ret = _promote_specific(project, "test-instinct", force=True)
    assert ret == 1
    out = capsys.readouterr().out
    assert "already exists in global" in out


def test_promote_specific_success(patch_globals, capsys):
    """Promote a project instinct to global with --force."""
    tree = patch_globals
    project = _make_project(tree)

    (project["instincts_personal"] / "inst.yaml").write_text(SAMPLE_INSTINCT_YAML)

    ret = _promote_specific(project, "test-instinct", force=True)
    assert ret == 0
    out = capsys.readouterr().out
    assert "Promoted" in out

    # Verify file was created in global dir
    promoted_file = tree["global_personal"] / "test-instinct.yaml"
    assert promoted_file.exists()
    content = promoted_file.read_text()
    assert "scope: global" in content
    assert "promoted_from: abc123" in content


# ─────────────────────────────────────────────
# _promote_auto tests
# ─────────────────────────────────────────────

def test_promote_auto_no_candidates(patch_globals, capsys):
    """Auto-promote with no cross-project instincts should say so."""
    tree = patch_globals
    project = _make_project(tree)

    # Empty registry
    tree["registry_file"].write_text("{}")

    ret = _promote_auto(project, force=True, dry_run=False)
    assert ret == 0
    out = capsys.readouterr().out
    assert "No instincts qualify" in out


def test_promote_auto_dry_run(patch_globals, capsys):
    """Dry run should list candidates but not write files."""
    tree = patch_globals

    # Create two projects with the same high-confidence instinct
    p1 = _make_project(tree, pid="proj1", pname="project-one")
    p2 = _make_project(tree, pid="proj2", pname="project-two")

    high_conf_yaml = """\
---
id: cross-project-instinct
trigger: "when reviewing"
confidence: 0.95
domain: security
scope: project
---

## Action
Always review for injection.
"""
    (p1["instincts_personal"] / "cross.yaml").write_text(high_conf_yaml)
    (p2["instincts_personal"] / "cross.yaml").write_text(high_conf_yaml)

    # Write registry
    registry = {
        "proj1": {"name": "project-one", "root": "/a", "remote": "", "last_seen": "2025-01-01T00:00:00Z"},
        "proj2": {"name": "project-two", "root": "/b", "remote": "", "last_seen": "2025-01-01T00:00:00Z"},
    }
    tree["registry_file"].write_text(json.dumps(registry))

    project = p1
    ret = _promote_auto(project, force=True, dry_run=True)
    assert ret == 0
    out = capsys.readouterr().out
    assert "DRY RUN" in out
    assert "cross-project-instinct" in out

    # Verify no file was created
    assert not (tree["global_personal"] / "cross-project-instinct.yaml").exists()


def test_promote_auto_writes_file(patch_globals, capsys):
    """Auto-promote with force should write global instinct file."""
    tree = patch_globals

    p1 = _make_project(tree, pid="proj1", pname="project-one")
    p2 = _make_project(tree, pid="proj2", pname="project-two")

    high_conf_yaml = """\
---
id: universal-pattern
trigger: "when coding"
confidence: 0.85
domain: general
scope: project
---

## Action
Use descriptive variable names.
"""
    (p1["instincts_personal"] / "uni.yaml").write_text(high_conf_yaml)
    (p2["instincts_personal"] / "uni.yaml").write_text(high_conf_yaml)

    registry = {
        "proj1": {"name": "project-one", "root": "/a", "remote": "", "last_seen": "2025-01-01T00:00:00Z"},
        "proj2": {"name": "project-two", "root": "/b", "remote": "", "last_seen": "2025-01-01T00:00:00Z"},
    }
    tree["registry_file"].write_text(json.dumps(registry))

    ret = _promote_auto(p1, force=True, dry_run=False)
    assert ret == 0

    promoted = tree["global_personal"] / "universal-pattern.yaml"
    assert promoted.exists()
    content = promoted.read_text()
    assert "scope: global" in content
    assert "auto-promoted" in content


def test_promote_auto_skips_invalid_id(patch_globals, capsys):
    tree = patch_globals

    p1 = _make_project(tree, pid="proj1", pname="project-one")
    p2 = _make_project(tree, pid="proj2", pname="project-two")

    bad_id_yaml = """\
---
id: ../escape
trigger: "when coding"
confidence: 0.9
domain: general
scope: project
---

## Action
Invalid id should be skipped.
"""
    (p1["instincts_personal"] / "bad.yaml").write_text(bad_id_yaml)
    (p2["instincts_personal"] / "bad.yaml").write_text(bad_id_yaml)

    registry = {
        "proj1": {"name": "project-one", "root": "/a", "remote": "", "last_seen": "2025-01-01T00:00:00Z"},
        "proj2": {"name": "project-two", "root": "/b", "remote": "", "last_seen": "2025-01-01T00:00:00Z"},
    }
    tree["registry_file"].write_text(json.dumps(registry))

    ret = _promote_auto(p1, force=True, dry_run=False)
    assert ret == 0
    err = capsys.readouterr().err
    assert "Skipping invalid instinct ID" in err
    assert not (tree["global_personal"] / "../escape.yaml").exists()


# ─────────────────────────────────────────────
# _find_cross_project_instincts tests
# ─────────────────────────────────────────────

def test_find_cross_project_empty_registry(patch_globals):
    tree = patch_globals
    tree["registry_file"].write_text("{}")
    result = _find_cross_project_instincts()
    assert result == {}


def test_find_cross_project_single_project(patch_globals):
    """Single project should return nothing (need 2+)."""
    tree = patch_globals
    p1 = _make_project(tree, pid="proj1", pname="project-one")
    (p1["instincts_personal"] / "inst.yaml").write_text(SAMPLE_INSTINCT_YAML)

    registry = {"proj1": {"name": "project-one", "root": "/a", "remote": "", "last_seen": "2025-01-01T00:00:00Z"}}
    tree["registry_file"].write_text(json.dumps(registry))

    result = _find_cross_project_instincts()
    assert result == {}


def test_find_cross_project_shared_instinct(patch_globals):
    """Same instinct ID in 2 projects should be found."""
    tree = patch_globals
    p1 = _make_project(tree, pid="proj1", pname="project-one")
    p2 = _make_project(tree, pid="proj2", pname="project-two")

    (p1["instincts_personal"] / "shared.yaml").write_text(SAMPLE_INSTINCT_YAML)
    (p2["instincts_personal"] / "shared.yaml").write_text(SAMPLE_INSTINCT_YAML)

    registry = {
        "proj1": {"name": "project-one", "root": "/a", "remote": "", "last_seen": "2025-01-01T00:00:00Z"},
        "proj2": {"name": "project-two", "root": "/b", "remote": "", "last_seen": "2025-01-01T00:00:00Z"},
    }
    tree["registry_file"].write_text(json.dumps(registry))

    result = _find_cross_project_instincts()
    assert "test-instinct" in result
    assert len(result["test-instinct"]) == 2


# ─────────────────────────────────────────────
# load_registry tests
# ─────────────────────────────────────────────

def test_load_registry_missing_file(patch_globals):
    result = load_registry()
    assert result == {}


def test_load_registry_corrupt_json(patch_globals):
    tree = patch_globals
    tree["registry_file"].write_text("not json at all {{{")
    result = load_registry()
    assert result == {}


def test_load_registry_valid(patch_globals):
    tree = patch_globals
    data = {"abc": {"name": "test", "root": "/test"}}
    tree["registry_file"].write_text(json.dumps(data))
    result = load_registry()
    assert result == data


def test_load_registry_uses_utf8_encoding(monkeypatch):
    calls = []

    def fake_open(path, mode="r", *args, **kwargs):
        calls.append(kwargs.get("encoding"))
        return io.StringIO("{}")

    monkeypatch.setattr(_mod, "open", fake_open, raising=False)
    assert load_registry() == {}
    assert calls == ["utf-8"]


def test_validate_instinct_id():
    assert _validate_instinct_id("good-id_1.0")
    assert not _validate_instinct_id("../bad")
    assert not _validate_instinct_id("bad/name")
    assert not _validate_instinct_id(".hidden")


def test_update_registry_atomic_replaces_file(patch_globals):
    tree = patch_globals
    _update_registry("abc123", "demo", "/repo", "https://example.com/repo.git")
    data = json.loads(tree["registry_file"].read_text())
    assert "abc123" in data
    leftovers = list(tree["registry_file"].parent.glob(".projects.json.tmp.*"))
    assert leftovers == []
