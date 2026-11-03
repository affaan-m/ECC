#!/usr/bin/env python3
"""Copilot-scoped, bounded launcher for ECC's canonical instinct algorithms.

The canonical backend is reused without changing its Claude entrypoints. This
launcher binds its data home and project, disables legacy migration inspection,
and keeps mutation and candidate activation separate. It requires Python 3.9+.
"""

import argparse
import contextlib
import importlib.util
import io
import json
import os
from pathlib import Path
import re
import stat
import sys
import tempfile

MAX_IMPORT_BYTES = 256 * 1024
MAX_FILE_BYTES = 4 * 1024 * 1024
MAX_STORE_BYTES = 32 * 1024 * 1024
MAX_ENTRIES = 4000
MAX_OUTPUT_BYTES = 1024 * 1024
SLUG = re.compile(r"^[a-z0-9][a-z0-9_-]{0,127}$")
RESERVED = re.compile(r"^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$", re.I)
SECRETS = re.compile(
    r"(?:\bsk-[A-Za-z0-9_-]{16,}|\bgh[pors]_[A-Za-z0-9]{16,}|"
    r"\bgithub_pat_[A-Za-z0-9_]{16,}|\bnpm_[A-Za-z0-9]{20,}|"
    r"\b(?:AKIA|ASIA)[A-Z0-9]{16}\b|-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----|"
    r"\b(?:password|api[_-]?key|access[_-]?token|secret)\s*[:=]\s*\S+)", re.I)


class LearningError(Exception):
    """A fixed, non-sensitive action-boundary failure."""


class BoundedOutput(io.StringIO):
    encoding = "utf-8"

    def __init__(self):
        super().__init__()
        self.bytes = 0

    def write(self, value):
        self.bytes += len(value.encode("utf-8"))
        if self.bytes > MAX_OUTPUT_BYTES:
            raise LearningError("Backend output exceeded its limit.")
        return super().write(value)


def safe_text(text):
    return not SECRETS.search(text) and not any(
        (ord(char) < 32 and char not in "\n\r\t")
        or 127 <= ord(char) <= 159
        or 0x202A <= ord(char) <= 0x202E
        or 0x2066 <= ord(char) <= 0x2069 for char in text)


def read_file(file, max_bytes):
    before = file.lstat()
    if not stat.S_ISREG(before.st_mode) or before.st_nlink != 1 or before.st_size > max_bytes:
        raise LearningError("Unsafe or oversized learning file.")
    descriptor = os.open(file, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
    with os.fdopen(descriptor, "rb") as handle:
        opened = os.fstat(handle.fileno())
        if (opened.st_ino, opened.st_dev) != (before.st_ino, before.st_dev):
            raise LearningError("Learning file changed while opening.")
        data = handle.read(max_bytes + 1)
    if len(data) > max_bytes:
        raise LearningError("Learning file exceeded its read limit.")
    text = data.decode("utf-8")
    if not safe_text(text):
        raise LearningError("Learning data contains unsafe controls or suspected secrets.")
    return text


def private_directory(base, parts):
    current = base
    for part in parts:
        current = current / part
        try:
            entry = current.lstat()
            if not stat.S_ISDIR(entry.st_mode):
                raise LearningError("Learning directory must not redirect through a symlink.")
        except FileNotFoundError:
            current.mkdir(mode=0o700)
    return current


def store_home():
    configured = os.environ.get("COPILOT_HOME")
    if configured is not None and (not configured.strip() or not Path(configured).is_absolute()):
        raise LearningError("COPILOT_HOME must be absolute.")
    config = Path(configured) if configured else Path.home() / ".copilot"
    config.mkdir(parents=True, mode=0o700, exist_ok=True)
    return private_directory(config.resolve(), ["ecc", "homunculus"])


def preflight_tree(root):
    count = 0
    total = 0
    for parent, directories, files in os.walk(root, followlinks=False):
        for name in directories + files:
            count += 1
            if count > MAX_ENTRIES:
                raise LearningError("Learning store entry limit exceeded.")
            file = Path(parent) / name
            entry = file.lstat()
            if stat.S_ISLNK(entry.st_mode) or not (stat.S_ISDIR(entry.st_mode) or stat.S_ISREG(entry.st_mode)):
                raise LearningError("Learning store contains an unsafe filesystem entry.")
            if stat.S_ISREG(entry.st_mode):
                total += entry.st_size
                if total > MAX_STORE_BYTES:
                    raise LearningError("Learning store byte limit exceeded.")
                read_file(file, MAX_FILE_BYTES)


def workspace_path(value, workspace, must_exist=False):
    normalized = value.replace("\\", "/")
    parts = normalized.split("/")
    if not normalized or Path(normalized).is_absolute() or any(
        part in ("", ".", "..") or ":" in part or part.endswith((".", " ")) or RESERVED.fullmatch(part)
        for part in parts):
        raise LearningError("Learning transfer paths must be portable workspace-relative paths.")
    target = workspace
    for part in parts:
        target = target / part
        if target.is_symlink():
            raise LearningError("Learning transfer path must not contain symlinks.")
    if not target.resolve().is_relative_to(workspace):
        raise LearningError("Learning transfer path escapes the workspace.")
    if must_exist and not target.is_file():
        raise LearningError("Learning import source is unavailable.")
    return target


def parser():
    result = argparse.ArgumentParser(description=__doc__)
    sub = result.add_subparsers(dest="command", required=True)
    sub.add_parser("status")
    importing = sub.add_parser("import")
    importing.add_argument("source", nargs="?")
    importing.add_argument("--stdin", action="store_true")
    importing.add_argument("--scope", choices=("project", "global"), default="project")
    importing.add_argument("--min-confidence", type=float, default=0)
    exporting = sub.add_parser("export")
    exporting.add_argument("--scope", choices=("project", "global", "all"), default="project")
    exporting.add_argument("--domain")
    exporting.add_argument("--min-confidence", type=float, default=0)
    exporting.add_argument("--output", "-o")
    evolve = sub.add_parser("evolve")
    evolve.add_argument("--generate", action="store_true")
    evolve.add_argument("--limit", type=int, default=20)
    promote = sub.add_parser("promote")
    promote.add_argument("instinct_id", nargs="?")
    projects = sub.add_parser("projects")
    projects.add_argument("project_action", nargs="?", choices=("delete", "merge", "gc"))
    projects.add_argument("project_ids", nargs="*")
    prune = sub.add_parser("prune")
    prune.add_argument("--max-age", type=int, default=30)
    for command in (importing, evolve, promote, projects, prune):
        command.add_argument("--apply", action="store_true")
        command.add_argument("--dry-run", action="store_true")
    return result


def validate_arguments(args, workspace):
    if getattr(args, "apply", False) and getattr(args, "dry_run", False):
        raise LearningError("Choose either apply or dry-run.")
    if not 0 <= getattr(args, "min_confidence", 0) <= 1:
        raise LearningError("Confidence must be between zero and one.")
    if args.command == "evolve" and not 1 <= args.limit <= 100:
        raise LearningError("Evolution limit must be between one and one hundred.")
    if args.command == "prune" and not 1 <= args.max_age <= 3650:
        raise LearningError("Pending TTL must be between one and 3650 days.")
    if getattr(args, "instinct_id", None) and not portable_id(args.instinct_id):
        raise LearningError("Invalid portable instinct identity.")
    if args.command == "projects":
        expected = {None: 0, "gc": 0, "delete": 1, "merge": 2}[args.project_action]
        if len(args.project_ids) != expected or any(not re.fullmatch(r"[a-f0-9]{12}", value) for value in args.project_ids):
            raise LearningError("Invalid project operation identities.")
    if args.command == "import":
        if args.stdin == bool(args.source):
            raise LearningError("Choose stdin or one local source file.")
        return None if args.stdin else workspace_path(args.source, workspace, True)
    if args.command == "export" and args.output:
        target = workspace_path(args.output, workspace)
        if target.exists():
            raise LearningError("Learning export destination already exists.")
        return target
    return None


def portable_id(value):
    return isinstance(value, str) and SLUG.fullmatch(value) and not RESERVED.fullmatch(value)


def load_backend(home, workspace):
    # These variables belong only to this subprocess; inherited Claude/CLV2
    # preferences cannot redirect the independent Copilot data store.
    for key in list(os.environ):
        if key.startswith(("CLAUDE_", "CLV2_")):
            os.environ.pop(key)
    os.environ["CLV2_HOMUNCULUS_DIR"] = str(home)
    os.environ["CLAUDE_PROJECT_DIR"] = str(workspace)  # Canonical backend's internal project selector.
    sys.dont_write_bytecode = True
    file = Path(__file__).resolve().parent.parent / "skills/continuous-learning-v2/scripts/instinct-cli.py"
    spec = importlib.util.spec_from_file_location("ecc_copilot_instinct_backend", file)
    backend = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(backend)
    backend._warn_legacy_data = lambda: None
    backend._ensure_global_dirs()
    return backend


def import_content(backend, args, source, home):
    if args.stdin:
        data = sys.stdin.buffer.read(MAX_IMPORT_BYTES + 1)
        if len(data) > MAX_IMPORT_BYTES:
            raise LearningError("Instinct import exceeded 256 KiB.")
        text = data.decode("utf-8")
    else:
        text = read_file(source, MAX_IMPORT_BYTES)
    instincts = backend.parse_instinct_file(text)
    if not safe_text(text) or not 1 <= len(instincts) <= 512:
        raise LearningError("Import contains no valid bounded instincts or contains suspected secrets.")
    for instinct in instincts:
        if not portable_id(instinct.get("id")) or not portable_id(instinct.get("domain", "general")):
            raise LearningError("Import contains an invalid portable identity or domain.")
        if not 0 <= instinct.get("confidence", 0.5) <= 1:
            raise LearningError("Import contains an invalid confidence value.")
    descriptor, temporary = tempfile.mkstemp(prefix="copilot-import-", suffix=".yaml", dir=home)
    with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
        handle.write(text)
    return Path(temporary)


def dispatch(backend, args, transfer):
    args.dry_run = not getattr(args, "apply", False)
    args.force = True  # Explicit --apply is the operation-scoped mutation gate.
    if args.command == "import":
        args.source = str(transfer)
    if args.command == "export":
        args.output = None  # Parent writes an exclusive validated file after output validation.
    if args.command == "evolve":
        args.generate = args.generate and args.apply
    if args.command == "prune":
        args.quiet = False
    if args.command == "projects":
        args.project_id = args.project_ids[0] if args.project_ids else None
        args.from_id = args.project_ids[0] if args.project_ids else None
        args.into_id = args.project_ids[1] if len(args.project_ids) == 2 else None
    return getattr(backend, "cmd_" + args.command)(args)


def main():
    os.umask(0o077)
    args = parser().parse_args()
    workspace = Path.cwd().resolve()
    transfer = validate_arguments(args, workspace)
    home = store_home()
    lock = home.parent / ".learning.lock"
    lock.mkdir(mode=0o700)
    temporary = None
    try:
        preflight_tree(home)
        backend = load_backend(home, workspace)
        if args.command == "import":
            temporary = import_content(backend, args, transfer, home)
            transfer = temporary
        captured = BoundedOutput()
        with contextlib.redirect_stdout(captured), contextlib.redirect_stderr(captured):
            code = dispatch(backend, args, transfer)
        output = captured.getvalue()
        if not safe_text(output):
            raise LearningError("Learning output contains unsafe data.")
        if args.command == "export" and transfer and code == 0:
            # No implicit directory provisioning or overwriting user files.
            with transfer.open("x", encoding="utf-8") as handle:
                handle.write(output)
            output = "Exported reviewed transfer to the requested workspace file."
        print(json.dumps({"ok": code == 0, "operation": args.command, "output": output}, ensure_ascii=False))
        return code
    finally:
        if temporary:
            temporary.unlink(missing_ok=True)
        lock.rmdir()


if __name__ == "__main__":
    try:
        sys.exit(main())
    except (OSError, ValueError, LearningError, TypeError, AttributeError):
        print(json.dumps({"ok": False, "error": "ECC_COPILOT_LEARNING_REJECTED", "message": "Invalid, unavailable, busy, oversized, or unsafe learning data; no input body is echoed."}))
        sys.exit(1)
