"""Run scenarios via claude -p and parse tool calls from stream-json output."""

from __future__ import annotations

import json
import os
import re
import shlex
import shutil
import stat
import subprocess
import tarfile
import tempfile
import zipfile
from dataclasses import dataclass
from pathlib import Path

from scripts.parser import ObservationEvent
from scripts.scenario_generator import Scenario

# Per-user base: another local user cannot pre-create or replace it in the
# sticky temp dir, and _setup_sandbox() keeps it at mode 0700.
SANDBOX_BASE = Path(tempfile.gettempdir()) / (
    f"skill-comply-sandbox-{os.getuid()}" if hasattr(os, "getuid") else "skill-comply-sandbox"
)
ALLOWED_MODELS = frozenset({"haiku", "sonnet", "opus"})
ALLOWED_SETUP_EXECUTABLES = frozenset({
    "git", "npm", "pip", "pip3",
    "touch", "mkdir", "cp", "mv", "echo",
    "chmod", "unzip", "tar",
})
# Setup commands are model output generated from the skill under test, so each
# allowed tool is limited to its file-creating uses. These lists are allowlists
# on purpose: git, tar, npm and pip all have options that run other programs.
# Options each git subcommand may take. Everything else is refused: options such
# as --template, --separate-git-dir or --exec-path can install or run hooks.
SAFE_GIT_OPTIONS = {
    "init": frozenset({"-q", "--quiet", "-b", "--initial-branch"}),
    "add": frozenset({"-A", "--all", "-u", "--update", "-f", "--force", "-v", "--verbose", "--"}),
    "commit": frozenset({"-m", "--message", "-a", "--all", "-am", "-q", "--quiet", "--allow-empty", "--no-verify"}),
    "checkout": frozenset({"-b", "-B", "-q", "--quiet", "--"}),
    "switch": frozenset({"-c", "-C", "--create", "-q", "--quiet"}),
    "branch": frozenset({"-m", "-M", "-d", "-D", "-q", "--quiet"}),
    "tag": frozenset({"-a", "-m", "--message", "-d"}),
    "rm": frozenset({"-r", "-f", "--cached", "-q", "--quiet", "--"}),
    "mv": frozenset({"-f", "-k", "-v", "--"}),
    "config": frozenset(),
}
SAFE_GIT_CONFIG_KEYS = frozenset({"user.name", "user.email", "init.defaultbranch", "commit.gpgsign"})
SAFE_TAR_SHORT_FLAGS = frozenset("cxtvfzjJC")
SAFE_UNZIP_SHORT_FLAGS = frozenset("onqjlt")
TAR_VALUE_LETTERS = frozenset("bCfFgHIKLNTVX")  # GNU tar short options that take a value
SAFE_TAR_LONG_OPTIONS = frozenset({
    "--create", "--extract", "--list", "--file", "--directory", "--verbose",
    "--gzip", "--gunzip", "--bzip2", "--xz", "--no-same-owner", "--no-same-permissions",
})
NPM_INSTALL_SUBCOMMANDS = frozenset({"install", "i", "add", "ci"})
NPM_INSTALL_OPTIONS = frozenset({"-D", "--save-dev", "-E", "--save-exact", "--no-save"})
PIP_INSTALL_OPTIONS = frozenset({"-q", "--quiet", "-U", "--upgrade"})
# Registry package names with an optional version; no URLs, paths or git specs.
PACKAGE_SPEC = re.compile(
    r"(@[a-z0-9][\w.-]*/)?[A-Za-z0-9][\w.-]*(\[[\w.,-]+\])?([@=<>!~^][\w.*^~<>=!,-]*)?",
    re.ASCII,
)
# Shell builtins cannot be invoked via subprocess.run; cwd is already
# controlled by the cwd= keyword. Scenarios that include these in
# setup_commands (a common shell-style convention) must be tolerated.
SHELL_BUILTINS = frozenset({"cd", "pushd", "popd"})
REPORT_VALUE_LIMIT = 5000


@dataclass(frozen=True)
class ScenarioRun:
    scenario: Scenario
    observations: tuple[ObservationEvent, ...]
    sandbox_dir: Path
    timed_out: bool = False
    simulated_github: bool = True


def run_scenario(
    scenario: Scenario,
    model: str = "sonnet",
    max_turns: int = 30,
    timeout: int = 900,
    fixtures_dir: Path | None = None,
) -> ScenarioRun:
    """Execute a scenario with local fixture GitHub responses, never real PRs."""
    if model not in ALLOWED_MODELS:
        raise ValueError(f"Unknown model: {model!r}. Allowed: {ALLOWED_MODELS}")
    if max_turns < 1 or timeout < 1:
        raise ValueError("max_turns and timeout must be positive")
    sandbox_dir = _safe_sandbox_dir(scenario.id)
    if fixtures_dir is None:
        _setup_sandbox(sandbox_dir, scenario)
    else:
        _setup_sandbox(sandbox_dir, scenario, fixtures_dir=fixtures_dir)
    gh_bin = _install_gh_stub(sandbox_dir)
    env = {**os.environ, "PATH": f"{gh_bin}{os.pathsep}{os.environ.get('PATH', '')}"}
    try:
        result = subprocess.run(
            [
                "claude", "-p",
                "--model", model,
                "--max-turns", str(max_turns),
                "--add-dir", str(sandbox_dir),
                "--allowedTools", "Read,Write,Edit,Bash,Glob,Grep",
                "--output-format", "stream-json",
                "--verbose",
            ],
            input=scenario.prompt,
            capture_output=True,
            encoding="utf-8",
            timeout=timeout,
            cwd=sandbox_dir,
            env=env,
        )
    except subprocess.TimeoutExpired as exc:
        partial = exc.output or ""
        if isinstance(partial, bytes):
            partial = partial.decode("utf-8", errors="replace")
        return ScenarioRun(
            scenario=scenario, observations=tuple(_parse_stream_json(partial)),
            sandbox_dir=sandbox_dir, timed_out=True,
        )
    nonfatal_max_turns = (
        result.returncode == 1
        and '\"terminal_reason\":\"max_turns\"' in result.stdout
    )
    if result.returncode != 0 and not nonfatal_max_turns:
        raise RuntimeError(
            f"claude -p failed (rc={result.returncode}): "
            f"stderr={result.stderr[:500]!r} stdout_tail={result.stdout[-500:]!r}"
        )
    return ScenarioRun(
        scenario=scenario, observations=tuple(_parse_stream_json(result.stdout)),
        sandbox_dir=sandbox_dir,
    )


def _validate_sandbox_base() -> None:
    """Reject links at the base itself; trusted parent aliases remain usable.

    This is a point-in-time preflight, not protection against concurrent
    replacement of filesystem entries during setup.
    """
    try:
        metadata = SANDBOX_BASE.lstat()
    except FileNotFoundError:
        return
    reparse_point = getattr(stat, "FILE_ATTRIBUTE_REPARSE_POINT", 0x400)
    if stat.S_ISLNK(metadata.st_mode) or getattr(metadata, "st_file_attributes", 0) & reparse_point:
        raise ValueError("Sandbox base must not be a symlink or directory reparse point")
    if not stat.S_ISDIR(metadata.st_mode):
        raise ValueError("Sandbox base must be a directory")
    if hasattr(os, "getuid") and metadata.st_uid != os.getuid():
        raise ValueError("Sandbox base must be owned by the current user")


def _safe_sandbox_dir(scenario_id: str) -> Path:
    """Sanitize scenario ID and ensure path stays within sandbox base."""
    _validate_sandbox_base()
    safe_id = re.sub(r"[^a-zA-Z0-9\-_]", "_", scenario_id)
    path = SANDBOX_BASE / safe_id
    resolved_path = path.resolve()
    resolved_base = SANDBOX_BASE.resolve()
    if not safe_id or resolved_path == resolved_base:
        raise ValueError("Scenario sandbox must be a subdirectory of the sandbox base")
    # Validate path stays within sandbox base (raises ValueError on traversal)
    resolved_path.relative_to(resolved_base)
    return path


def _setup_sandbox(
    sandbox_dir: Path, scenario: Scenario, fixtures_dir: Path | None = None,
) -> None:
    """Create a private fixture repo while retaining the setup-command allowlists."""
    _validate_sandbox_base()
    SANDBOX_BASE.mkdir(mode=0o700, parents=True, exist_ok=True)
    _validate_sandbox_base()
    SANDBOX_BASE.chmod(0o700)
    if sandbox_dir.is_symlink():
        raise ValueError("Sandbox directory must not be a symlink")
    if sandbox_dir.exists():
        shutil.rmtree(sandbox_dir)
    sandbox_dir.mkdir(parents=True)
    _git(sandbox_dir, "init")
    if fixtures_dir is not None:
        _copy_fixtures(fixtures_dir, sandbox_dir)
    _write_scenario_files(sandbox_dir, getattr(scenario, "files", ()))
    for cmd in scenario.setup_commands:
        parts = shlex.split(cmd)
        if not parts or parts[0] in SHELL_BUILTINS:
            continue
        argv = _sandboxed_setup_command(parts, sandbox_dir)
        if argv is None:
            continue
        try:
            subprocess.run(
                argv, cwd=sandbox_dir, capture_output=True, stdin=subprocess.DEVNULL,
                env=_fixture_git_env() if argv[0] == "git" else None,
            )
        except FileNotFoundError:
            continue
    _commit_initial_state(sandbox_dir)
    _add_local_origin(sandbox_dir)


def _git_metadata_name(name: str) -> bool:
    # Windows aliases trailing dots/spaces to the same metadata directory.
    return name.rstrip(" .").lower() == ".git"


def _copy_fixtures(fixtures_dir: Path, sandbox_dir: Path) -> None:
    """Copy regular fixture files only, ignoring Git metadata at every depth."""
    root = fixtures_dir.resolve()
    metadata = fixtures_dir.lstat()
    reparse = getattr(stat, "FILE_ATTRIBUTE_REPARSE_POINT", 0x400)
    if (fixtures_dir.is_symlink() or not root.is_dir()
            or getattr(metadata, "st_file_attributes", 0) & reparse):
        raise ValueError("Fixtures directory must be a regular directory, not a symlink")
    def inspect(directory: Path) -> None:
        for source in directory.iterdir():
            if _git_metadata_name(source.name):
                continue
            metadata = source.lstat()
            reparse = getattr(stat, "FILE_ATTRIBUTE_REPARSE_POINT", 0x400)
            if stat.S_ISLNK(metadata.st_mode) or getattr(metadata, "st_file_attributes", 0) & reparse:
                raise ValueError(f"Fixture symlink or reparse point is not allowed: {source.name}")
            if stat.S_ISDIR(metadata.st_mode):
                inspect(source)
            elif not stat.S_ISREG(metadata.st_mode):
                raise ValueError(f"Fixture must be a regular file or directory: {source.name}")
    inspect(root)
    shutil.copytree(
        root, sandbox_dir, dirs_exist_ok=True, symlinks=True,
        ignore=lambda _directory, names: {name for name in names if _git_metadata_name(name)},
    )
    inspect(sandbox_dir)


def _write_scenario_files(sandbox_dir: Path, files: tuple[tuple[str, str], ...]) -> None:
    """Write declared fixture text without crossing links or Git metadata."""
    root = sandbox_dir.resolve()
    for rel, content in files:
        if not isinstance(rel, str) or not isinstance(content, str):
            raise ValueError("Scenario files must map paths to text")
        if not rel or rel.startswith(("/", "\\", "~")) or re.match(r"^[A-Za-z]:", rel):
            raise ValueError(f"Scenario file path must be relative: {rel!r}")
        if ":" in rel or any(_git_metadata_name(part) for part in re.split(r"[\\/]", rel)):
            raise ValueError(f"Scenario file path must not reach .git: {rel!r}")
        target = (root / rel).resolve()
        target.relative_to(root)
        if target == root:
            raise ValueError("Scenario file path must name a file")
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(content, encoding="utf-8")


_AUX_MARKER = ".skill-comply-owned.json"


def _prepare_aux_dir(sandbox_dir: Path, suffix: str) -> Path:
    """Replace only a tool-created sibling with matching ownership metadata."""
    auxiliary = sandbox_dir.parent / f"{sandbox_dir.name}{suffix}"
    expected = {"owner": "skill-comply", "sandbox": sandbox_dir.name, "kind": suffix}
    try:
        metadata = auxiliary.lstat()
    except FileNotFoundError:
        metadata = None
    if metadata is not None:
        reparse = getattr(stat, "FILE_ATTRIBUTE_REPARSE_POINT", 0x400)
        if (not stat.S_ISDIR(metadata.st_mode) or stat.S_ISLNK(metadata.st_mode)
                or getattr(metadata, "st_file_attributes", 0) & reparse):
            raise ValueError("Auxiliary ownership path must be a directory without links")
        if hasattr(os, "getuid") and metadata.st_uid != os.getuid():
            raise ValueError("Auxiliary directory is not owned by the current user")
        marker = auxiliary / _AUX_MARKER
        try:
            valid = not marker.is_symlink() and json.loads(marker.read_text(encoding="utf-8")) == expected
        except (OSError, ValueError):
            valid = False
        if not valid:
            raise ValueError("Refusing to replace an unowned auxiliary directory")
        shutil.rmtree(auxiliary)
    auxiliary.mkdir(mode=0o700, parents=True)
    (auxiliary / _AUX_MARKER).write_text(json.dumps(expected), encoding="utf-8")
    return auxiliary


GH_STUB = """#!/bin/sh
echo "skill-comply GitHub simulation: no network or real pull request" >&2
case "$1 $2" in
  "pr create") echo "https://example.invalid/skill-comply/simulation/pull/1" ;;
  "pr view") echo '{"number":1,"state":"SIMULATED","simulation":true}' ;;
  "pr list") echo '[]' ;;
  "repo view") echo '{"nameWithOwner":"skill-comply/simulation","simulation":true}' ;;
  *) echo "skill-comply gh simulation: unsupported command" >&2; exit 1 ;;
esac
"""


def _install_gh_stub(sandbox_dir: Path) -> Path:
    directory = _prepare_aux_dir(sandbox_dir, ".bin")
    gh = directory / "gh"
    gh.write_text(GH_STUB, encoding="utf-8")
    gh.chmod(0o755)
    return directory


def _fixture_git_env() -> dict[str, str]:
    """Keep generated files from activating host Git filters or remote rewrites."""
    env = {key: value for key, value in os.environ.items() if not key.startswith("GIT_")}
    return {**env, "GIT_CONFIG_GLOBAL": os.devnull, "GIT_CONFIG_NOSYSTEM": "1",
            "GIT_ALLOW_PROTOCOL": "file", "GIT_TERMINAL_PROMPT": "0"}


def _git(cwd: Path, *args: str) -> subprocess.CompletedProcess:
    """Run local fixture Git without ambient hooks, config or network protocols."""
    result = subprocess.run(
        ["git", "-c", f"core.hooksPath={os.devnull}", "-c", "init.templateDir=", *args],
        cwd=cwd, capture_output=True, encoding="utf-8", env=_fixture_git_env(),
    )
    if result.returncode != 0:
        raise RuntimeError(f"sandbox setup git failed (rc={result.returncode}): {(result.stderr or '')[:300]}")
    return result


def _commit_initial_state(sandbox_dir: Path) -> None:
    _git(sandbox_dir, "add", "-A")
    _git(sandbox_dir, "-c", "user.name=skill-comply", "-c", "user.email=skill-comply@localhost",
         "-c", "commit.gpgsign=false", "commit", "--allow-empty", "-m", "chore: sandbox baseline")


def _add_local_origin(sandbox_dir: Path) -> None:
    origin = _prepare_aux_dir(sandbox_dir, ".origin.git")
    branch = (_git(sandbox_dir, "symbolic-ref", "--short", "HEAD").stdout or "main").strip()
    _git(sandbox_dir, "init", "--bare", f"--initial-branch={branch}", str(origin))
    _git(sandbox_dir, "remote", "add", "origin", str(origin))
    _git(sandbox_dir, "push", "-u", "origin", branch)
    _git(sandbox_dir, "remote", "set-head", "origin", branch)


def _attached_values(arg: str) -> list[str]:
    """Every possible value attached to an option: -t.git, -rt.git, --directory=.git."""
    body = arg.lstrip("-")
    return [body[index:] for index in range(len(body))]


def _arg_stays_in_sandbox(arg: str, sandbox_dir: Path) -> bool:
    """True if a path-like argument resolves inside the sandbox, outside its .git."""
    if arg.startswith("-"):
        # Option values attached to the flag (--file=/x, -t.., -C/) are not
        # parsed per tool, so refuse any that could name another directory
        # and check every suffix as if it were the value.
        if any(token in arg for token in ("/", "\\", "~", "..")):
            return False
        return all(_path_stays_in_sandbox(value, sandbox_dir) for value in _attached_values(arg))
    return _path_stays_in_sandbox(arg, sandbox_dir)


def _path_stays_in_sandbox(arg: str, sandbox_dir: Path) -> bool:
    if arg.startswith("~"):
        return False
    root = sandbox_dir.resolve()
    try:
        relative = (root / arg).resolve().relative_to(root)
    except ValueError:
        return False
    return ".git" not in {part.lower() for part in relative.parts}


def _archive_member_safe(name: str) -> bool:
    parts = re.split(r"[\\/]+", name)
    return (
        not name.startswith(("/", "\\"))
        and not re.match(r"[A-Za-z]:", name)
        and ".." not in parts
        and ".git" not in {part.lower() for part in parts}
    )


def _archive_safe(path: Path) -> bool:
    """True if path is a tar or zip archive of plain files and directories, none under .git."""
    names: list[str] = []
    recognized = False
    try:
        if tarfile.is_tarfile(path):
            recognized = True
            with tarfile.open(path) as archive:
                for member in archive.getmembers():
                    if not (member.isfile() or member.isdir()):
                        return False  # links, devices and fifos
                    names.append(member.name)
        if zipfile.is_zipfile(path):
            recognized = True
            with zipfile.ZipFile(path) as archive:
                for info in archive.infolist():
                    if stat.S_ISLNK(info.external_attr >> 16):
                        return False
                    names.append(info.filename)
    except (tarfile.TarError, zipfile.BadZipFile, OSError):
        return False
    return recognized and all(_archive_member_safe(name) for name in names)


def _extracted_archives_safe(tool: str, args: list[str], sandbox_dir: Path) -> bool:
    """Before tar -x or unzip runs, check the members of every archive it could read.

    Any existing file named by an argument (or attached to an option) must be a
    tar/zip archive that _archive_safe() accepts, so an unreadable format fails
    closed instead of being extracted unchecked.
    """
    if tool == "tar":
        flags = [arg for index, arg in enumerate(args) if arg[:2] != "--" and (arg[:1] == "-" or index == 0)]
        if "--extract" not in args and not any("x" in flag for flag in flags):
            return True
    elif any(char in arg for arg in args for char in "*?["):
        return False  # unzip expands wildcards in the archive name itself
    root = sandbox_dir.resolve()
    operands = _archive_operands(tool, args)
    if tool == "unzip" and not operands:
        return False
    for value in operands:
        path = (root / value).resolve()
        # unzip searches for an implicit .zip suffix when its operand is
        # missing. Check an existing ZIP, never an alternate extractor lookup.
        if tool == "unzip" and (not path.is_file() or not zipfile.is_zipfile(path)):
            return False
        if path.is_file() and not _archive_safe(path):
            return False
    return True



def _unzip_archive_index(args: list[str]) -> int | None:
    """Parse bounded unzip flags; only -d takes a following argument.

    No password, zipinfo-mode or attached-value options are admitted: their
    operands must not be confused with the archive whose members we inspect.
    """
    archive_index = None
    destination_pending = False
    for index, arg in enumerate(args):
        if destination_pending:
            if not arg or arg.startswith("-"):
                return None
            destination_pending = False
        elif arg == "-d":
            destination_pending = True
        elif arg.startswith("-"):
            if len(arg) < 2 or not set(arg[1:]) <= SAFE_UNZIP_SHORT_FLAGS:
                return None
        elif archive_index is None:
            archive_index = index
    return None if destination_pending else archive_index

def _archive_operands(tool: str, args: list[str]) -> list[str]:
    """The archive file names only; members named after them are entry names, not files."""
    found: list[str] = []
    if tool == "unzip":
        archive_index = _unzip_archive_index(args)
        return [] if archive_index is None else [args[archive_index]]
    # Each pending entry is True when the next argument is the archive, False for another option's value.
    pending: list[bool] = []
    for index, arg in enumerate(args):
        if pending:
            if pending.pop(0):
                found.append(arg)
        elif arg.startswith("--"):
            name, _, value = arg.partition("=")
            if name == "--file":
                found.append(value) if value else pending.append(True)
        elif not arg.startswith("-") and index == 0:
            # Old style (`tar xCf DIR ARCHIVE`): every letter that takes a value takes the next argument, in order.
            pending = [letter == "f" for letter in arg if letter in TAR_VALUE_LETTERS]
        elif arg.startswith("-"):
            # Short cluster: the first letter that takes a value takes the rest of the cluster or the next argument.
            cluster = arg[1:]
            for at, letter in enumerate(cluster):
                if letter in TAR_VALUE_LETTERS:
                    rest = cluster[at + 1:]
                    if letter == "f" and rest:
                        found.append(rest)
                    elif not rest:
                        pending.append(letter == "f")
                    break
    return found


def _packages_allowed(args: list[str], options: frozenset[str]) -> bool:
    return all(
        arg in options or (not arg.startswith("-") and PACKAGE_SPEC.fullmatch(arg))
        for arg in args
    )


def _tar_args_allowed(args: list[str]) -> bool:
    for index, arg in enumerate(args):
        if arg.startswith("--"):
            if arg.split("=", 1)[0] not in SAFE_TAR_LONG_OPTIONS:
                return False
        elif arg.startswith("-") or index == 0:
            # tar also reads a bare first argument as bundled flags ("tar xzf").
            if not set(arg.removeprefix("-")) <= SAFE_TAR_SHORT_FLAGS:
                return False
        elif ":" in arg:
            return False  # host:file archives run a remote shell
    return True


def _sandboxed_setup_command(parts: list[str], sandbox_dir: Path) -> list[str] | None:
    """Return the argv to run for one setup command, or None to skip it.

    Keeps every allowed tool, but only for uses that create files inside the
    sandbox: no option that runs another program, no path outside the sandbox,
    and nothing under the sandbox's .git directory (hooks, config).
    """
    tool, args = parts[0], parts[1:]
    if tool not in ALLOWED_SETUP_EXECUTABLES:
        return None
    if not all(_arg_stays_in_sandbox(arg, sandbox_dir) for arg in args):
        return None
    if tool == "git":
        # The subcommand must come first, which also rules out global
        # options such as -c, -C, --config-env and --exec-path.
        if not args or args[0] not in SAFE_GIT_OPTIONS:
            return None
        allowed = SAFE_GIT_OPTIONS[args[0]]
        if any(arg.startswith("-") and arg.split("=", 1)[0] not in allowed for arg in args[1:]):
            return None
        if args[0] == "config" and (len(args) != 3 or args[1].lower() not in SAFE_GIT_CONFIG_KEYS):
            return None
        # Defense in depth: no hook runs during setup even if one slipped in.
        return ["git", "-c", f"core.hooksPath={os.devnull}", *args]
    if tool in {"tar", "unzip"} and not _extracted_archives_safe(tool, args, sandbox_dir):
        return None
    if tool == "unzip":
        archive_index = _unzip_archive_index(args)
        if archive_index is None:
            return None
        checked_args = list(args)
        # Bind execution to the checked, existing archive. No implicit suffix
        # lookup or a different option operand may reach the extractor.
        checked_args[archive_index] = str((sandbox_dir.resolve() / args[archive_index]).resolve())
        return [tool, *checked_args]
    if tool == "tar":
        return parts if _tar_args_allowed(args) else None
    if tool == "npm":
        if args in (["init", "-y"], ["init", "--yes"]):
            return parts
        if args and args[0] in NPM_INSTALL_SUBCOMMANDS and _packages_allowed(args[1:], NPM_INSTALL_OPTIONS):
            return [*parts, "--ignore-scripts"]
        return None
    if tool in {"pip", "pip3"}:
        if args and args[0] == "install" and _packages_allowed(args[1:], PIP_INSTALL_OPTIONS):
            # Wheels only (no setup.py), installed into the sandbox rather than
            # a site dir where a .pth file would run on every Python start.
            return [*parts, "--only-binary=:all:", "--target", str(sandbox_dir / ".pip-packages")]
        return None
    return parts


def _redact_home_path(text: str) -> str:
    """Replace the operator's home directory with a portable placeholder.

    Observations flow into grade() and then into a written report
    (results/<skill>.md) that's meant to be read, diffed, and shared —
    an absolute path bakes the operator's username into every tool call
    that happened to touch anything under $HOME (including the sandbox
    itself, which lives under a tempdir but scenario setup_commands or
    an agent's own tool calls can still reference $HOME directly).
    """
    home = str(Path.home()).rstrip("/\\")
    if not home or home == "/" or re.fullmatch(r"[A-Za-z]:", home):
        return text

    parts = re.split(r"[\\/]+", home)
    home_pattern = r"[\\/]".join(re.escape(part) for part in parts)
    right_boundary = r"(?=$|[\\/]|[\s\"'`,;:)}\]])"
    flags = re.IGNORECASE if re.match(r"^[A-Za-z]:[\\/]", home) else 0
    pattern = re.compile(
        rf"(?<![\w.~+-]){home_pattern}{right_boundary}",
        flags,
    )
    return pattern.sub("~", text)


def _redact_home_paths(value: object) -> object:
    """Return a copy with home paths redacted from string keys and leaves.

    Redacted mapping keys receive a stable numeric suffix when two original
    keys collapse to the same portable value. This preserves every observation
    without leaking the original home path or silently dropping data.
    """
    if isinstance(value, str):
        return _redact_home_path(value)
    if isinstance(value, dict):
        redacted: dict[object, object] = {}
        for key, item in value.items():
            redacted_key = _redact_home_path(key) if isinstance(key, str) else key
            candidate = redacted_key
            suffix = 2
            while candidate in redacted:
                candidate = f"{redacted_key}#{suffix}"
                suffix += 1
            redacted[candidate] = _redact_home_paths(item)
        return redacted
    if isinstance(value, list):
        return [_redact_home_paths(item) for item in value]
    return value


def _serialize_report_value(value: object) -> str:
    """Redact structured report data before encoding and truncating it."""
    redacted = _redact_home_paths(value)
    if isinstance(redacted, (dict, list)):
        serialized = json.dumps(redacted)
    else:
        serialized = str(redacted)
    return serialized[:REPORT_VALUE_LIMIT]


def _parse_stream_json(stdout: str) -> list[ObservationEvent]:
    """Parse claude -p stream-json output into ObservationEvents.

    Stream-json format:
    - type=assistant with content[].type=tool_use → tool call (name, input)
    - type=user with content[].type=tool_result → tool result (output)
    """
    events: list[ObservationEvent] = []
    pending: dict[str, dict] = {}
    event_counter = 0

    for line in stdout.strip().splitlines():
        try:
            msg = json.loads(line)
        except json.JSONDecodeError:
            continue

        msg_type = msg.get("type")

        if msg_type == "assistant":
            content = msg.get("message", {}).get("content", [])
            for block in content:
                if block.get("type") == "tool_use":
                    tool_use_id = block.get("id", "")
                    tool_input = block.get("input", {})
                    pending[tool_use_id] = {
                        "tool": block.get("name", "unknown"),
                        "input": _serialize_report_value(tool_input),
                        "order": event_counter,
                    }
                    event_counter += 1

        elif msg_type == "user":
            content = msg.get("message", {}).get("content", [])
            if isinstance(content, list):
                for block in content:
                    tool_use_id = block.get("tool_use_id", "")
                    if tool_use_id in pending:
                        info = pending.pop(tool_use_id)
                        output_content = block.get("content", "")
                        events.append(ObservationEvent(
                            timestamp=f"T{info['order']:04d}",
                            event="tool_complete",
                            tool=info["tool"],
                            session=msg.get("session_id", "unknown"),
                            input=info["input"],
                            output=_serialize_report_value(output_content),
                        ))

    for _tool_use_id, info in pending.items():
        events.append(ObservationEvent(
            timestamp=f"T{info['order']:04d}",
            event="tool_complete",
            tool=info["tool"],
            session="unknown",
            input=info["input"],
            output="",
        ))

    return sorted(events, key=lambda e: e.timestamp)
