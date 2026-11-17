import io
import os
import subprocess
import sys
import tarfile
import zipfile
from pathlib import Path
from typing import Any
from unittest.mock import patch

import pytest

_SKILL_COMPLY_ROOT = Path(__file__).resolve().parent.parent / "skills" / "skill-comply"
if str(_SKILL_COMPLY_ROOT) not in sys.path:
    sys.path.insert(0, str(_SKILL_COMPLY_ROOT))

from scripts.runner import _setup_sandbox  # noqa: E402
from scripts.scenario_generator import Scenario  # noqa: E402

_GLOBAL_MARKER = "/tmp/runner_test_pwned_marker"


@pytest.fixture(autouse=True)
def _remove_marker():
    if os.path.exists(_GLOBAL_MARKER):
        os.remove(_GLOBAL_MARKER)
    yield
    if os.path.exists(_GLOBAL_MARKER):
        os.remove(_GLOBAL_MARKER)


@pytest.mark.parametrize(
    "setup_commands,test_id",
    [
        (
            ("python -c \"import os; os.system('touch /tmp/runner_test_pwned_marker')\"",),
            "python_interpreter",
        ),
        (
            ("../../../../../../bin/sh -c 'touch /tmp/runner_test_pwned_marker'",),
            "path_traversal",
        ),
        (
            ("bash -c 'touch /tmp/runner_test_pwned_marker'",),
            "non_allowlisted_binary",
        ),
        (
            ("git -c 'alias.pwn=!touch /tmp/runner_test_pwned_marker' pwn",),
            "git_alias",
        ),
        (
            ("tar --checkpoint=1 --checkpoint-action=exec='touch /tmp/runner_test_pwned_marker' -cf out.tar .",),
            "tar_checkpoint_action",
        ),
        (
            ("echo hello",),
            "benign_echo",
        ),
    ],
    ids=[
        "python_interpreter", "path_traversal", "non_allowlisted_binary",
        "git_alias", "tar_checkpoint_action", "benign_echo",
    ],
)
def test_setup_sandbox_blocks_dangerous_commands(setup_commands, test_id, tmp_path):
    """Invariant: _setup_sandbox must not execute disallowed commands."""
    scenario = Scenario(
        id=f"test-{test_id}",
        level=1,
        level_name="basic",
        description="security test scenario",
        prompt="",
        setup_commands=setup_commands,
    )
    sandbox_dir = tmp_path / "sandbox"

    _setup_sandbox(sandbox_dir, scenario)

    assert not os.path.exists(_GLOBAL_MARKER), (
        f"Arbitrary command execution detected for '{test_id}': "
        f"marker file created at {_GLOBAL_MARKER}"
    )


def _plant_registry_package(sandbox_dir: Path) -> None:
    """Stand in for `npm install attacker-pkg`: a registry package that ships hook files."""
    pkg = sandbox_dir / "node_modules" / "attacker-pkg"
    hook = f"#!/bin/sh\ntouch {_GLOBAL_MARKER}\n"
    (pkg / "hooks").mkdir(parents=True)
    (pkg / "hooks" / "post-commit").write_text(hook)
    (pkg / "hooks" / "post-commit").chmod(0o755)
    info = tarfile.TarInfo("hooks/post-commit")
    info.size, info.mode = len(hook), 0o755
    with tarfile.open(pkg / "hooks.tar", "w") as archive:
        archive.addfile(info, io.BytesIO(hook.encode()))
    info.name = ".git/hooks/post-commit"
    with tarfile.open(pkg / "payload.tar", "w") as archive:
        archive.addfile(info, io.BytesIO(hook.encode()))
    member = zipfile.ZipInfo(".git/hooks/post-commit")
    member.external_attr = 0o100755 << 16
    with zipfile.ZipFile(pkg / "payload.zip", "w") as archive:
        archive.writestr(member, hook)
    with zipfile.ZipFile(pkg / "good.zip", "w") as archive:
        archive.writestr("safe.txt", "safe")


@pytest.mark.skipif(sys.platform == "win32", reason="POSIX shell hooks")
@pytest.mark.parametrize(
    "plant",
    [
        ("mkdir templates", "cp -r node_modules/attacker-pkg/hooks templates/hooks", "git init --template=templates"),
        ("cp -r --target-directory=.git node_modules/attacker-pkg/hooks",),
        ("cp -r -t.git node_modules/attacker-pkg/hooks",),
        ("tar -xf node_modules/attacker-pkg/hooks.tar --directory=.git",),
        ("tar -xf node_modules/attacker-pkg/payload.tar",),
        ("unzip -o node_modules/attacker-pkg/payload.zip",),
        ("unzip -o node_modules/attacker-pkg/payload",),
        ("unzip -P pw node_modules/attacker-pkg/payload.zip",),
        ("unzip -P node_modules/attacker-pkg/good.zip node_modules/attacker-pkg/payload.zip",),
    ],
    ids=["git_template", "cp_target_directory", "cp_attached_t", "tar_directory", "tar_member", "unzip_member", "unzip_implicit_suffix", "unzip_password", "unzip_safe_password"],
)
def test_setup_cannot_plant_git_hooks(plant: tuple[str, ...], tmp_path: Path) -> None:
    """Invariant: setup must not leave a hook that a later accepted `git commit` runs on the host."""
    real_run = subprocess.run
    sandbox_dir = tmp_path / "sandbox"

    npm_installs: list[list[str]] = []

    def run(argv: list[str], **kwargs: Any) -> subprocess.CompletedProcess[bytes]:
        if argv[0] == "npm":
            npm_installs.append(argv)
            _plant_registry_package(sandbox_dir)
            return subprocess.CompletedProcess(argv, 0)
        return real_run(argv, **kwargs)

    identity = ("git config user.name t", "git config user.email t@example.com", "git config commit.gpgsign false")
    scenario = Scenario(
        id="hook-plant", level=1, level_name="basic", description="security test scenario", prompt="",
        setup_commands=("npm install attacker-pkg", *plant, *identity, "git commit --allow-empty -m setup"),
    )
    with patch("scripts.runner.subprocess.run", side_effect=run):
        _setup_sandbox(sandbox_dir, scenario)
    assert npm_installs == [["npm", "install", "attacker-pkg", "--ignore-scripts"]]
    # The agent (or the user) commits later, without the runner's protections.
    real_run(["git", "commit", "--allow-empty", "-m", "later"], cwd=sandbox_dir, capture_output=True)

    assert not os.path.exists(_GLOBAL_MARKER), "a planted git hook ran on the host"
    assert not (sandbox_dir / ".git" / "hooks" / "post-commit").exists()
