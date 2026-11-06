"""Real Git and filesystem regression cases for fixture ownership boundaries."""
from dataclasses import dataclass
from pathlib import Path
import subprocess
import pytest
from scripts import runner

@dataclass(frozen=True)
class FixtureScenario:
    id: str = "fixture-test"
    prompt: str = "offline fixture"
    setup_commands: tuple[str, ...] = ()
    files: tuple[tuple[str, str], ...] = ()

@pytest.mark.parametrize("name", [".git/config", "nested/.GIT/hooks/x", ".git./config", "nested/.git /hooks/x", "../outside.txt", "C:\\outside.txt"])
def test_scenario_files_cannot_reach_metadata_or_escape(tmp_path, name):
    with pytest.raises(ValueError):
        runner._setup_sandbox(tmp_path / "box", FixtureScenario(files=((name, "blocked"),)))
    assert not (tmp_path / "outside.txt").exists()

def test_fixture_symlink_cannot_expose_outside_content(tmp_path):
    fixtures = tmp_path / "fixtures"
    fixtures.mkdir()
    outside = tmp_path / "outside"
    outside.mkdir()
    sentinel = outside / "sentinel"
    sentinel.write_text("preserve")
    try:
        (fixtures / "linked").symlink_to(outside, target_is_directory=True)
    except OSError as error:
        if getattr(error, "winerror", None) == 1314:
            pytest.skip("native Windows symlink permission unavailable")
        raise
    with pytest.raises(ValueError, match="symlink|reparse"):
        runner._setup_sandbox(tmp_path / "box", FixtureScenario(files=(("linked/sentinel", "changed"),)), fixtures_dir=fixtures)
    assert sentinel.read_text() == "preserve"

def test_fixture_git_metadata_is_ignored_at_any_depth(tmp_path):
    fixtures = tmp_path / "fixtures"
    (fixtures / "nested/.GiT").mkdir(parents=True)
    (fixtures / "nested/.GiT/config").write_text("untrusted")
    (fixtures / "safe.txt").write_text("safe")
    box = tmp_path / "box"
    runner._setup_sandbox(box, FixtureScenario(), fixtures_dir=fixtures)
    assert (box / "safe.txt").read_text() == "safe"
    assert not (box / "nested/.GiT").exists()
    assert subprocess.run(["git", "status", "--porcelain"], cwd=box, capture_output=True, text=True).stdout == ""

@pytest.mark.parametrize("suffix", [".bin", ".origin.git"])
def test_unowned_auxiliary_directory_is_never_removed_or_overwritten(tmp_path, suffix):
    box = tmp_path / "box"
    sibling = tmp_path / ("box" + suffix)
    sibling.mkdir()
    sentinel = sibling / "sentinel"
    sentinel.write_text("preserve")
    with pytest.raises(ValueError, match="owned|ownership"):
        if suffix == ".bin":
            runner._install_gh_stub(box)
        else:
            runner._setup_sandbox(box, FixtureScenario())
    assert sentinel.read_text() == "preserve"

def test_stub_is_explicit_simulation_and_never_claims_real_github_url(tmp_path):
    box = tmp_path / "box"
    directory = runner._install_gh_stub(box)
    result = subprocess.run([str(directory / "gh"), "pr", "create"], capture_output=True, text=True)
    assert result.returncode == 0
    assert "simulation" in result.stderr.lower()
    assert "example.invalid" in result.stdout
    assert "github.com" not in result.stdout

@pytest.mark.parametrize("timed_out", [False, True])
def test_written_reports_keep_simulation_and_timeout_boundaries(tmp_path, monkeypatch, timed_out):
    from scripts import run as cli
    from scripts import grader
    from scripts.parser import ComplianceSpec, Step, Detector
    from scripts.scenario_generator import Scenario
    import sys
    skill = tmp_path / "SKILL.md"
    skill.write_text("fixture skill")
    output = tmp_path / "report.md"
    scenario = Scenario("report-fixture", 1, "test", "offline fixture", "inspect", ())
    spec = ComplianceSpec("fixture", "fixture", "fixture", "1", (Step("read", "read", True, Detector("read")),), 0.8)
    monkeypatch.setattr(cli, "generate_spec", lambda *a, **k: spec)
    monkeypatch.setattr(cli, "generate_scenarios", lambda *a, **k: [scenario])
    monkeypatch.setattr(cli, "run_scenario", lambda *a, **k: runner.ScenarioRun(scenario, (), tmp_path, timed_out=timed_out))
    monkeypatch.setattr(grader, "classify_events", lambda *a, **k: {})
    monkeypatch.setattr(sys, "argv", ["skill-comply", str(skill), "--output", str(output)])
    cli.main()
    text = output.read_text()
    assert "local gh simulation" in text
    assert "verifies no live GitHub" in text
    assert ("Incomplete execution" in text) is timed_out

def test_fixture_attributes_cannot_activate_ambient_git_filters(tmp_path, monkeypatch):
    import shlex
    marker = tmp_path / "filter-executed"
    config = tmp_path / "global.gitconfig"
    command = "touch " + shlex.quote(str(marker)) + "; cat"
    result = subprocess.run(["git", "config", "--file", str(config), "filter.fixture.clean", command], capture_output=True)
    assert result.returncode == 0
    monkeypatch.setenv("GIT_CONFIG_GLOBAL", str(config))
    scenario = FixtureScenario(setup_commands=("git add .",), files=((".gitattributes", "*.txt filter=fixture\n"), ("input.txt", "data")))
    runner._setup_sandbox(tmp_path / "box", scenario)
    assert not marker.exists(), "fixture files must not activate an ambient executable filter"
