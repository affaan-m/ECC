import pytest
import sys
import os
import tempfile
import subprocess

# Add the module path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'skills', 'skill-comply', 'scripts'))


@pytest.mark.parametrize("malicious_input", [
    # Exact exploit: command injection via crafted skill definition
    "rm -rf /tmp/pwned; echo pwned > /tmp/pwned",
    # Boundary: null bytes and shell metacharacters
    "cat /etc/passwd\x00--help",
    # Attempt to escape sandbox via path traversal in command
    "../../../../../../bin/sh -c 'id > /tmp/pwned'",
    # Valid benign input for baseline
    "echo hello",
])
def test_runner_does_not_execute_arbitrary_commands(malicious_input, tmp_path):
    """Invariant: Adversarial inputs must not result in arbitrary command execution
    that creates files or exfiltrates data outside the sandbox."""
    marker_file = tmp_path / "pwned"
    global_marker = "/tmp/runner_test_pwned_marker"

    # Clean up any pre-existing marker
    if os.path.exists(global_marker):
        os.remove(global_marker)

    # Run the runner.py as a subprocess with the malicious input to see if it
    # allows arbitrary command execution
    runner_path = os.path.join(
        os.path.dirname(__file__), '..', 'skills', 'skill-comply', 'scripts', 'runner.py'
    )

    if not os.path.exists(runner_path):
        pytest.skip("runner.py not found at expected path")

    # Attempt to invoke runner with crafted input - we pass it via stdin/args
    # depending on how runner.py accepts input
    result = subprocess.run(
        [sys.executable, runner_path, malicious_input],
        cwd=str(tmp_path),
        capture_output=True,
        timeout=10,
        env={**os.environ, "HOME": str(tmp_path)},
    )

    # Security invariant: no marker file should be created by malicious commands
    assert not os.path.exists(global_marker), \
        f"Arbitrary command execution detected: marker file created at {global_marker}"
    assert not marker_file.exists(), \
        f"Arbitrary command execution detected: marker file created in sandbox"
    # Ensure no sensitive file content leaked in output
    assert b"root:" not in result.stdout, \
        "Sensitive file content (/etc/passwd) leaked in stdout"
    assert b"root:" not in result.stderr, \
        "Sensitive file content (/etc/passwd) leaked in stderr"