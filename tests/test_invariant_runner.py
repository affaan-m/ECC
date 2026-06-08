import os
import sys
import pytest
from pathlib import Path

_SKILL_COMPLY_ROOT = Path(__file__).resolve().parent.parent / "skills" / "skill-comply"
if str(_SKILL_COMPLY_ROOT) not in sys.path:
    sys.path.insert(0, str(_SKILL_COMPLY_ROOT))

from scripts.runner import _setup_sandbox          # noqa: E402
from scripts.scenario_generator import Scenario    # noqa: E402

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
            ("echo hello",),
            "benign_echo",
        ),
    ],
    ids=["python_interpreter", "path_traversal", "non_allowlisted_binary", "benign_echo"],
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
