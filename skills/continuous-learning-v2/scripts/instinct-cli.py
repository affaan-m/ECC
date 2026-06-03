#!/usr/bin/env python3
"""
Instinct CLI - Manage instincts for Continuous Learning v2

v2.1: Project-scoped instincts — different projects get different instincts,
      with global instincts applied universally.

Commands:
  status   - Show all instincts (project + global) and their status
  import   - Import instincts from file or URL
  export   - Export instincts to file
  evolve   - Cluster instincts into skills/commands/agents
  promote  - Promote project instincts to global scope
  projects - List all known projects and their instinct counts
  prune    - Delete pending instincts older than 30 days (TTL)
"""

import argparse
import json
import hashlib
import os
import subprocess
import sys
import re
import shutil
import urllib.request
from pathlib import Path
from datetime import datetime, timedelta, timezone
from collections import defaultdict
from typing import Optional

if sys.platform == "win32":
    try:
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")
    except Exception:
        pass

try:
    import fcntl
    _HAS_FCNTL = True
except ImportError:
    _HAS_FCNTL = False  # Windows — skip file locking

# ─────────────────────────────────────────────
# Configuration
# ─────────────────────────────────────────────

def _resolve_homunculus_dir() -> Path:
    override = os.environ.get("CLV2_HOMUNCULUS_DIR")
    if override:
        if Path(override).is_absolute():
            return Path(override)
        print(f"[ecc] CLV2_HOMUNCULUS_DIR={override!r} is not absolute; ignoring", file=sys.stderr)

    xdg = os.environ.get("XDG_DATA_HOME")
    if xdg:
        if Path(xdg).is_absolute():
            return Path(xdg) / "ecc-homunculus"
        print(f"[ecc] XDG_DATA_HOME={xdg!r} is not absolute; ignoring", file=sys.stderr)

    return Path.home() / ".local" / "share" / "ecc-homunculus"


def _strip_remote_credentials(remote_url: str) -> str:
    return re.sub(r"://[^@]+@", "://", remote_url or "")


def _normalize_remote_url(remote_url: str) -> str:
    if not remote_url:
        return ""

    is_network = (
        not remote_url.startswith("file://")
        and ("://" in remote_url or re.match(r"^[^@/:]+@[^:/]+:", remote_url) is not None)
    )
    normalized = _strip_remote_credentials(remote_url)
    normalized = re.sub(r"^[A-Za-z][A-Za-z0-9+.-]*://", "", normalized)
    normalized = re.sub(r"^[^@/:]+@([^:/]+):", r"\1/", normalized)
    normalized = re.sub(r"\.git/?$", "", normalized)
    normalized = re.sub(r"/+$", "", normalized)

    return normalized.lower() if is_network else normalized


def _stream_can_encode(text: str, stream=None) -> bool:
    stream = stream or sys.stdout
    encoding = getattr(stream, "encoding", None) or sys.getdefaultencoding()
    try:
        text.encode(encoding)
    except (LookupError, UnicodeEncodeError):
        return False
    return True


def _confidence_bar(confidence, stream=None) -> str:
    try:
        filled = int(float(confidence) * 10)
    except (TypeError, ValueError):
        filled = 5
    filled = max(0, min(10, filled))

    full, empty = ("\u2588", "\u2591") if _stream_can_encode("\u2588\u2591", stream) else ("#", ".")
    return full * filled + empty * (10 - filled)


def _project_hash(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()[:12]


HOMUNCULUS_DIR = _resolve_homunculus_dir()
PROJECTS_DIR = HOMUNCULUS_DIR / "projects"
REGISTRY_FILE = HOMUNCULUS_DIR / "projects.json"

# Global (non-project-scoped) paths
GLOBAL_INSTINCTS_DIR = HOMUNCULUS_DIR / "instincts"
GLOBAL_PERSONAL_DIR = GLOBAL_INSTINCTS_DIR / "personal"
GLOBAL_INHERITED_DIR = GLOBAL_INSTINCTS_DIR / "inherited"
GLOBAL_EVOLVED_DIR = HOMUNCULUS_DIR / "evolved"
GLOBAL_OBSERVATIONS_FILE = HOMUNCULUS_DIR / "observations.jsonl"

# Thresholds for auto-promotion
PROMOTE_CONFIDENCE_THRESHOLD = 0.8
PROMOTE_MIN_PROJECTS = 2
ALLOWED_INSTINCT_EXTENSIONS = (".yaml", ".yml", ".md")

# Default TTL for pending instincts (days)
PENDING_TTL_DAYS = 30
# Warning threshold: show expiry warning when instinct expires within this many days
PENDING_EXPIRY_WARNING_DAYS = 7

# Ensure global directories exist (deferred to avoid side effects at import time)
def _ensure_global_dirs():
    for d in [GLOBAL_PERSONAL_DIR, GLOBAL_INHERITED_DIR,
              GLOBAL_EVOLVED_DIR / "skills", GLOBAL_EVOLVED_DIR / "commands", GLOBAL_EVOLVED_DIR / "agents",
              PROJECTS_DIR]:
        d.mkdir(parents=True, exist_ok=True)


# ─────────────────────────────────────────────
# Path Validation
# ─────────────────────────────────────────────

def _validate_file_path(path_str: str, must_exist: bool = False) -> Path:
    """Validate and resolve a file path, guarding against path traversal.

    Raises ValueError if the path is invalid or suspicious.
    """
    path = Path(path_str).expanduser().resolve()

    # Block paths that escape into system directories
    # We block specific system paths but allow temp dirs (/var/folders on macOS)
    blocked_prefixes = [
        "/etc", "/usr", "/bin", "/sbin", "/proc", "/sys",
        "/var/log", "/var/run", "/var/lib", "/var/spool",
        # macOS resolves /etc → /private/etc
        "/private/etc",
        "/private/var/log", "/private/var/run", "/private/var/db",
    ]
    path_s = str(path)
    for prefix in blocked_prefixes:
        if path_s.startswith(prefix + "/") or path_s == prefix:
            raise ValueError(f"Path '{path}' targets a system directory")

    if must_exist and not path.exists():
        raise ValueError(f"Path does not exist: {path}")

    return path


def _validate_instinct_id(instinct_id: str) -> bool:
    """Validate instinct IDs before using them in filenames."""
    if not instinct_id or len(instinct_id) > 128:
        return False
    if "/" in instinct_id or "\\" in instinct_id:
        return False
    if ".." in instinct_id:
        return False
    if instinct_id.startswith("."):
        return False
    return bool(re.match(r"^[A-Za-z0-9][A-Za-z0-9._-]*$", instinct_id))


def _yaml_quote(value: str) -> str:
    """Quote a string for safe YAML frontmatter serialization.

    Uses double quotes and escapes embedded double-quote characters to
    prevent malformed YAML when the value contains quotes.
    """
    escaped = value.replace('\\', '\\\\').replace('"', '\\"')
    return f'"{escaped}"'


# ─────────────────────────────────────────────
# Project Detection (Python equivalent of detect-project.sh)
# ─────────────────────────────────────────────

def _git_repo_root(cwd: Optional[str] = None) -> Optional[str]:
    args = ["git"]
    if cwd:
        args.extend(["-C", cwd])
    args.extend(["rev-parse", "--show-toplevel"])
    try:
        result = subprocess.run(args, capture_output=True, text=True, timeout=5)
        if result.returncode == 0:
            return result.stdout.strip()
    except (subprocess.TimeoutExpired, FileNotFoundError):
        pass
    return None


def _main_worktree_root(project_root: str) -> str:
    """Return the main worktree root when project_root is a linked worktree."""
    try:
        result = subprocess.run(
            ["git", "-C", project_root, "worktree", "list", "--porcelain"],
            capture_output=True, text=True, timeout=5
        )
    except (subprocess.TimeoutExpired, FileNotFoundError):
        return project_root

    if result.returncode != 0:
        return project_root

    for line in result.stdout.splitlines():
        if line.startswith("worktree "):
            main_root = line.split(" ", 1)[1].strip()
            return main_root or project_root
    return project_root


def detect_project() -> dict:
    """Detect current project context. Returns dict with id, name, root, project_dir."""
    project_root = None

    if os.environ.get("CLV2_NO_PROJECT") == "1":
        return {
            "id": "global",
            "name": "global",
            "root": "",
            "project_dir": HOMUNCULUS_DIR,
            "instincts_personal": GLOBAL_PERSONAL_DIR,
            "instincts_inherited": GLOBAL_INHERITED_DIR,
            "evolved_dir": GLOBAL_EVOLVED_DIR,
            "observations_file": GLOBAL_OBSERVATIONS_FILE,
        }

    # 1. CLAUDE_PROJECT_DIR env var
    env_dir = os.environ.get("CLAUDE_PROJECT_DIR")
    if env_dir and os.path.isdir(env_dir):
        project_root = _git_repo_root(env_dir)

    # 2. git repo root
    if not project_root:
        project_root = _git_repo_root()

    # Normalize: strip trailing slashes to keep basename and hash stable
    if project_root:
        project_root = project_root.rstrip("/")

    # 3. No project — global fallback
    if not project_root:
        return {
            "id": "global",
            "name": "global",
            "root": "",
            "project_dir": HOMUNCULUS_DIR,
            "instincts_personal": GLOBAL_PERSONAL_DIR,
            "instincts_inherited": GLOBAL_INHERITED_DIR,
            "evolved_dir": GLOBAL_EVOLVED_DIR,
            "observations_file": GLOBAL_OBSERVATIONS_FILE,
        }

    project_name = os.path.basename(project_root)

    # Derive project ID from git remote URL or path
    remote_url = ""
    try:
        result = subprocess.run(
            ["git", "-C", project_root, "remote", "get-url", "origin"],
            capture_output=True, text=True, timeout=5
        )
        if result.returncode == 0:
            remote_url = result.stdout.strip()
    except (subprocess.TimeoutExpired, FileNotFoundError):
        pass

    raw_remote_url = remote_url
    if remote_url:
        remote_url = _strip_remote_credentials(remote_url)

    fallback_root = _main_worktree_root(project_root) if not remote_url else project_root
    legacy_hash_source = remote_url if remote_url else project_root
    normalized_remote = _normalize_remote_url(remote_url) if remote_url else ""
    hash_source = normalized_remote if normalized_remote else (remote_url if remote_url else fallback_root)
    project_id = _project_hash(hash_source)

    project_dir = PROJECTS_DIR / project_id

    if not project_dir.exists():
        legacy_sources = []
        if legacy_hash_source and legacy_hash_source != hash_source:
            legacy_sources.append(legacy_hash_source)
        if raw_remote_url and raw_remote_url not in {hash_source, legacy_hash_source}:
            legacy_sources.append(raw_remote_url)

        for legacy_source in legacy_sources:
            legacy_id = _project_hash(legacy_source)
            legacy_dir = PROJECTS_DIR / legacy_id
            if legacy_id != project_id and legacy_dir.exists():
                try:
                    legacy_dir.rename(project_dir)
                except OSError:
                    project_id = legacy_id
                    project_dir = legacy_dir
                break

    # Ensure project directory structure
    for d in [
        project_dir / "instincts" / "personal",
        project_dir / "instincts" / "inherited",
        project_dir / "observations.archive",
        project_dir / "evolved" / "skills",
        project_dir / "evolved" / "commands",
        project_dir / "evolved" / "agents",
    ]:
        d.mkdir(parents=True, exist_ok=True)

    # Update registry
    _update_registry(project_id, project_name, project_root, remote_url)

    return {
        "id": project_id,
        "name": project_name,
        "root": project_root,
        "remote": remote_url,
        "project_dir": project_dir,
        "instincts_personal": project_dir / "instincts" / "personal",
        "instincts_inherited": project_dir / "instincts" / "inherited",
        "evolved_dir": project_dir / "evolved",
        "observations_file": project_dir / "observations.jsonl",
    }


def _update_registry(pid: str, pname: str, proot: str, premote: str) -> None:
    """Update the projects.json registry.

    Uses file locking (where available) to prevent concurrent sessions from
    overwriting each other's updates.
    """
    REGISTRY_FILE.parent.mkdir(parents=True, exist_ok=True)
    lock_path = REGISTRY_FILE.parent / f".{REGISTRY_FILE.name}.lock"
    lock_fd = None

    try:
        # Acquire advisory lock to serialize read-modify-write
        if _HAS_FCNTL:
            lock_fd = open(lock_path, "w")
            fcntl.flock(lock_fd, fcntl.LOCK_EX)

        try:
            with open(REGISTRY_FILE, encoding="utf-8") as f:
                registry = json.load(f)
        except (FileNotFoundError, json.JSONDecodeError):
            registry = {}

        registry[pid] = {
            "name": pname,
            "root": proot,
            "remote": premote,
            "last_seen": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        }

        tmp_file = REGISTRY_FILE.parent / f".{REGISTRY_FILE.name}.tmp.{os.getpid()}"
        with open(tmp_file, "w", encoding="utf-8") as f:
            json.dump(registry, f, indent=2)
            f.flush()
            os.fsync(f.fileno())
        os.replace(tmp_file, REGISTRY_FILE)
    finally:
        if lock_fd is not None:
            fcntl.flock(lock_fd, fcntl.LOCK_UN)
            lock_fd.close()


def load_registry() -> dict:
    """Load the projects registry."""
    try:
        with open(REGISTRY_FILE, encoding="utf-8") as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return {}


def _write_registry(registry: dict) -> None:
    """Write the project registry atomically."""
    REGISTRY_FILE.parent.mkdir(parents=True, exist_ok=True)
    tmp_file = REGISTRY_FILE.parent / f".{REGISTRY_FILE.name}.tmp.{os.getpid()}"
    with open(tmp_file, "w", encoding="utf-8") as f:
        json.dump(registry, f, indent=2)
        f.write("\n")
        f.flush()
        os.fsync(f.fileno())
    os.replace(tmp_file, REGISTRY_FILE)


def _validate_project_id(project_id: str) -> bool:
    if not project_id or len(project_id) > 128:
        return False
    if "/" in project_id or "\\" in project_id or ".." in project_id:
        return False
    return bool(re.match(r"^[A-Za-z0-9][A-Za-z0-9._-]*$", project_id))


# ─────────────────────────────────────────────
# Instinct Parser
# ─────────────────────────────────────────────

def parse_instinct_file(content: str) -> list[dict]:
    """Parse YAML-like instinct file format.

    Each instinct is delimited by a pair of ``---`` markers (YAML frontmatter).
    Note: ``---`` is always treated as a frontmatter boundary; instinct body
    content must use ``***`` or ``___`` for horizontal rules to avoid ambiguity.
    """
    instincts = []
    current = {}
    in_frontmatter = False
    content_lines = []

    for line in content.split('\n'):
        if line.strip() == '---':
            if in_frontmatter:
                # End of frontmatter - content comes next
                in_frontmatter = False
            else:
                # Start of new frontmatter block
                in_frontmatter = True
                if current:
                    current['content'] = '\n'.join(content_lines).strip()
                    instincts.append(current)
                current = {}
                content_lines = []
        elif in_frontmatter:
            # Parse YAML-like frontmatter
            if ':' in line:
                key, value = line.split(':', 1)
                key = key.strip()
                value = value.strip()
                # Unescape quoted YAML strings
                if value.startswith('"') and value.endswith('"'):
                    value = value[1:-1].replace('\\"', '"').replace('\\\\', '\\')
                elif value.startswith("'") and value.endswith("'"):
                    value = value[1:-1].replace("''", "'")
                if key == 'confidence':
                    try:
                        current[key] = float(value)
                    except ValueError:
                        current[key] = 0.5  # default on malformed confidence
                else:
                    current[key] = value
        else:
            content_lines.append(line)

    # Don't forget the last instinct
    if current:
        current['content'] = '\n'.join(content_lines).strip()
        instincts.append(current)

    return [i for i in instincts if i.get('id')]


def _load_instincts_from_dir(directory: Path, source_type: str, scope_label: str) -> list[dict]:
    """Load instincts from a single directory."""
    instincts = []
    if not directory.exists():
        return instincts
    files = [
        file for file in sorted(directory.iterdir())
        if file.is_file() and file.suffix.lower() in ALLOWED_INSTINCT_EXTENSIONS
    ]
    for file in files:
        try:
            content = file.read_text(encoding="utf-8")
            parsed = parse_instinct_file(content)
            for inst in parsed:
                inst['_source_file'] = str(file)
                inst['_source_type'] = source_type
                inst['_scope_label'] = scope_label
                # Default scope if not set in frontmatter
                if 'scope' not in inst:
                    inst['scope'] = scope_label
            instincts.extend(parsed)
        except Exception as e:
            print(f"Warning: Failed to parse {file}: {e}", file=sys.stderr)
    return instincts


def _project_counts(project_id: str) -> dict:
    project_dir = PROJECTS_DIR / project_id
    personal_dir = project_dir / "instincts" / "personal"
    inherited_dir = project_dir / "instincts" / "inherited"
    observations_file = project_dir / "observations.jsonl"

    personal_count = len(_load_instincts_from_dir(personal_dir, "personal", "project"))
    inherited_count = len(_load_instincts_from_dir(inherited_dir, "inherited", "project"))
    observations_count = 0
    if observations_file.exists():
        try:
            with open(observations_file, encoding="utf-8") as f:
                observations_count = sum(1 for _ in f)
        except OSError:
            observations_count = 0

    return {
        "personal": personal_count,
        "inherited": inherited_count,
        "observations": observations_count,
        "total": personal_count + inherited_count + observations_count,
    }


def _remove_project_storage(project_id: str) -> None:
    project_dir = PROJECTS_DIR / project_id
    if project_dir.exists():
        shutil.rmtree(project_dir)


def _project_instinct_ids(project_dir: Path, source_type: str) -> set[str]:
    instinct_dir = project_dir / "instincts" / source_type
    return {
        inst.get("id")
        for inst in _load_instincts_from_dir(instinct_dir, source_type, "project")
        if inst.get("id")
    }


def _merge_instinct_dir(from_dir: Path, into_dir: Path, existing_ids: set[str]) -> tuple[int, int]:
    moved = 0
    skipped = 0
    if not from_dir.exists():
        return moved, skipped

    into_dir.mkdir(parents=True, exist_ok=True)
    for file_path in sorted(from_dir.iterdir()):
        if not file_path.is_file() or file_path.suffix.lower() not in ALLOWED_INSTINCT_EXTENSIONS:
            continue
        try:
            instincts = parse_instinct_file(file_path.read_text(encoding="utf-8"))
        except (OSError, UnicodeDecodeError):
            instincts = []
        instinct_ids = [inst.get("id") for inst in instincts if inst.get("id")]
        if any(instinct_id in existing_ids for instinct_id in instinct_ids):
            skipped += 1
            continue

        target_path = into_dir / file_path.name
        if target_path.exists():
            target_path = into_dir / f"{file_path.stem}-{_project_hash(str(file_path))}{file_path.suffix}"
        shutil.copy2(file_path, target_path)
        existing_ids.update(instinct_ids)
        moved += 1

    return moved, skipped


def _append_observations(from_project_dir: Path, into_project_dir: Path) -> int:
    from_file = from_project_dir / "observations.jsonl"
    if not from_file.exists():
        return 0

    into_file = into_project_dir / "observations.jsonl"
    into_file.parent.mkdir(parents=True, exist_ok=True)
    try:
        lines = from_file.read_text(encoding="utf-8").splitlines()
    except (OSError, UnicodeDecodeError):
        return 0

    if not lines:
        return 0

    with open(into_file, "a", encoding="utf-8") as f:
        for line in lines:
            if line.strip():
                f.write(line.rstrip("\n") + "\n")
    return len([line for line in lines if line.strip()])


def load_all_instincts(project: dict, include_global: bool = True) -> list[dict]:
    """Load all instincts: project-scoped + global.

    Project-scoped instincts take precedence over global ones when IDs conflict.
    """
    instincts = []

    # 1. Load project-scoped instincts (if not already global)
    if project["id"] != "global":
        instincts.extend(_load_instincts_from_dir(
            project["instincts_personal"], "personal", "project"
        ))
        instincts.extend(_load_instincts_from_dir(
            project["instincts_inherited"], "inherited", "project"
        ))

    # 2. Load global instincts
    if include_global:
        global_instincts = []
        global_instincts.extend(_load_instincts_from_dir(
            GLOBAL_PERSONAL_DIR, "personal", "global"
        ))
        global_instincts.extend(_load_instincts_from_dir(
            GLOBAL_INHERITED_DIR, "inherited", "global"
        ))

        # Deduplicate: project-scoped wins over global when same ID
        project_ids = {i.get('id') for i in instincts}
        for gi in global_instincts:
            if gi.get('id') not in project_ids:
                instincts.append(gi)

    return instincts


def load_project_only_instincts(project: dict) -> list[dict]:
    """Load only project-scoped instincts (no global).

    In global fallback mode (no git project), returns global instincts.
    """
    if project.get("id") == "global":
        instincts = _load_instincts_from_dir(GLOBAL_PERSONAL_DIR, "personal", "global")
        instincts += _load_instincts_from_dir(GLOBAL_INHERITED_DIR, "inherited", "global")
        return instincts
    return load_all_instincts(project, include_global=False)


# ─────────────────────────────────────────────
# Status Command
# ─────────────────────────────────────────────

def cmd_status(args) -> int:
    """Show status of all instincts (project + global)."""
    project = detect_project()
    instincts = load_all_instincts(project)

    if not instincts:
        print("No instincts found.")
        print(f"\nProject: {project['name']} ({project['id']})")
        print(f"  Project instincts:  {project['instincts_personal']}")
        print(f"  Global instincts:   {GLOBAL_PERSONAL_DIR}")
    else:
        # Split by scope
        project_instincts = [i for i in instincts if i.get('_scope_label') == 'project']
        global_instincts = [i for i in instincts if i.get('_scope_label') == 'global']

        # Print header
        print(f"\n{'='*60}")
        print(f"  INSTINCT STATUS - {len(instincts)} total")
        print(f"{'='*60}\n")

        print(f"  Project:  {project['name']} ({project['id']})")
        print(f"  Project instincts: {len(project_instincts)}")
        print(f"  Global instincts:  {len(global_instincts)}")
        print()

        # Print project-scoped instincts
        if project_instincts:
            print(f"## PROJECT-SCOPED ({project['name']})")
            print()
            _print_instincts_by_domain(project_instincts)

        # Print global instincts
        if global_instincts:
            print("## GLOBAL (apply to all projects)")
            print()
            _print_instincts_by_domain(global_instincts)

        # Observations stats
        obs_file = project.get("observations_file")
        if obs_file and Path(obs_file).exists():
            with open(obs_file, encoding="utf-8") as f:
                obs_count = sum(1 for _ in f)
            print(f"-" * 60)
            print(f"  Observations: {obs_count} events logged")
            print(f"  File: {obs_file}")

    # Pending instinct stats
    pending = _collect_pending_instincts()
    if pending:
        print(f"\n{'-'*60}")
        print(f"  Pending instincts: {len(pending)} awaiting review")

        if len(pending) >= 5:
            print(f"\n  \u26a0 {len(pending)} pending instincts awaiting review."
                  f" Unreviewed instincts auto-delete after {PENDING_TTL_DAYS} days.")

        # Show instincts expiring within PENDING_EXPIRY_WARNING_DAYS
        expiry_threshold = PENDING_TTL_DAYS - PENDING_EXPIRY_WARNING_DAYS
        expiring_soon = [p for p in pending
                         if p["age_days"] >= expiry_threshold and p["age_days"] < PENDING_TTL_DAYS]
        if expiring_soon:
            print(f"\n  Expiring within {PENDING_EXPIRY_WARNING_DAYS} days:")
            for item in expiring_soon:
                days_left = max(0, PENDING_TTL_DAYS - item["age_days"])
                print(f"    - {item['name']} ({days_left}d remaining)")

    # Legacy data warning
    _warn_legacy_data()

    print(f"\n{'='*60}\n")
    return 0


def _warn_legacy_data() -> None:
    """Warn if legacy ~/.claude/homunculus/ contains data while the active
    path has moved to the XDG directory."""
    legacy_dir = Path.home() / ".claude" / "homunculus"
    if legacy_dir == HOMUNCULUS_DIR:
        return  # CLV2_HOMUNCULUS_DIR explicitly points at the legacy path
    if not legacy_dir.is_dir():
        return

    # Count substantive files (skip empty dirs and the directory itself)
    try:
        legacy_files = [f for f in legacy_dir.rglob("*") if f.is_file()]
    except (PermissionError, OSError):
        print(f"\n  Note: legacy directory exists but cannot be read: {legacy_dir}", file=sys.stderr)
        return
    if not legacy_files:
        return

    migrate_script = Path(__file__).resolve().parent / "migrate-homunculus.sh"

    print(f"\n{'!'*60}")
    print("  LEGACY DATA DETECTED")
    print(f"{'!'*60}")
    print(f"  Found {len(legacy_files)} file(s) in legacy path:")
    print(f"    {legacy_dir}")
    print("  Active data directory:")
    print(f"    {HOMUNCULUS_DIR}")
    print()
    print("  Run the migration script to move your data:")
    print(f'    bash "{migrate_script}"')
    print(f"  Or set CLV2_HOMUNCULUS_DIR={legacy_dir} to use the legacy path.")
    print(f"{'!'*60}\n")


def _print_instincts_by_domain(instincts: list[dict]) -> None:
    """Helper to print instincts grouped by domain."""
    by_domain = defaultdict(list)
    for inst in instincts:
        domain = inst.get('domain', 'general')
        by_domain[domain].append(inst)

    for domain in sorted(by_domain.keys()):
        domain_instincts = by_domain[domain]
        print(f"  ### {domain.upper()} ({len(domain_instincts)})")
        print()

        for inst in sorted(domain_instincts, key=lambda x: -x.get('confidence', 0.5)):
            conf = inst.get('confidence', 0.5)
            conf_bar = _confidence_bar(conf)
            trigger = inst.get('trigger', 'unknown trigger')
            scope_tag = f"[{inst.get('scope', '?')}]"

            print(f"    {conf_bar} {int(conf*100):3d}%  {inst.get('id', 'unnamed')} {scope_tag}")
            print(f"              trigger: {trigger}")

            # Extract action from content
            content = inst.get('content', '')
            action_match = re.search(r'## Action\s*\n\s*(.+?)(?:\n\n|\n##|$)', content, re.DOTALL)
            if action_match:
                action = action_match.group(1).strip().split('\n')[0]
                print(f"              action: {action[:60]}{'...' if len(action) > 60 else ''}")

            print()


# ─────────────────────────────────────────────
# Import Command
# ─────────────────────────────────────────────

def cmd_import(args) -> int:
    """Import instincts from file or URL."""
    project = detect_project()
    source = args.source

    # Determine target scope
    target_scope = args.scope or "project"
    if target_scope == "project" and project["id"] == "global":
        print("No project detected. Importing as global scope.")
        target_scope = "global"

    # Fetch content
    if source.startswith('http://') or source.startswith('https://'):
        print(f"Fetching from URL: {source}")
        try:
            with urllib.request.urlopen(source) as response:
                content = response.read().decode('utf-8')
        except Exception as e:
            print(f"Error fetching URL: {e}", file=sys.stderr)
            return 1
    else:
        try:
            path = _validate_file_path(source, must_exist=True)
        except ValueError as e:
            print(f"Invalid path: {e}", file=sys.stderr)
            return 1
        if not path.is_file():
            print(f"Error: '{path}' is not a regular file.", file=sys.stderr)
            return 1
        content = path.read_text(encoding="utf-8")

    # Parse instincts
    new_instincts = parse_instinct_file(content)
    if not new_instincts:
        print("No valid instincts found in source.")
        return 1

    print(f"\nFound {len(new_instincts)} instincts to import.")
    print(f"Target scope: {target_scope}")
    if target_scope == "project":
        print(f"Target project: {project['name']} ({project['id']})")
    print()

    # Load existing instincts for dedup, scoped to the target to avoid
    # cross-scope shadowing (project instincts hiding global ones or vice versa)
    if target_scope == "global":
        existing = _load_instincts_from_dir(GLOBAL_PERSONAL_DIR, "personal", "global")
        existing += _load_instincts_from_dir(GLOBAL_INHERITED_DIR, "inherited", "global")
    else:
        existing = load_project_only_instincts(project)
    existing_ids = {i.get('id') for i in existing}

    # Deduplicate within the import source: keep highest confidence per ID
    best_by_id = {}
    for inst in new_instincts:
        inst_id = inst.get('id')
        if inst_id not in best_by_id or inst.get('confidence', 0.5) > best_by_id[inst_id].get('confidence', 0.5):
            best_by_id[inst_id] = inst
    deduped_instincts = list(best_by_id.values())

    # Categorize against existing instincts on disk
    to_add = []
    duplicates = []
    to_update = []

    for inst in deduped_instincts:
        inst_id = inst.get('id')
        if inst_id in existing_ids:
            existing_inst = next((e for e in existing if e.get('id') == inst_id), None)
            if existing_inst:
                if inst.get('confidence', 0) > existing_inst.get('confidence', 0):
                    to_update.append(inst)
                else:
                    duplicates.append(inst)
        else:
            to_add.append(inst)

    # Filter by minimum confidence
    min_conf = args.min_confidence if args.min_confidence is not None else 0.0
    to_add = [i for i in to_add if i.get('confidence', 0.5) >= min_conf]
    to_update = [i for i in to_update if i.get('confidence', 0.5) >= min_conf]

    # Display summary
    if to_add:
        print(f"NEW ({len(to_add)}):")
        for inst in to_add:
            print(f"  + {inst.get('id')} (confidence: {inst.get('confidence', 0.5):.2f})")

    if to_update:
        print(f"\nUPDATE ({len(to_update)}):")
        for inst in to_update:
            print(f"  ~ {inst.get('id')} (confidence: {inst.get('confidence', 0.5):.2f})")

    if duplicates:
        print(f"\nSKIP ({len(duplicates)} - already exists with equal/higher confidence):")
        for inst in duplicates[:5]:
            print(f"  - {inst.get('id')}")
        if len(duplicates) > 5:
            print(f"  ... and {len(duplicates) - 5} more")

    if args.dry_run:
        print("\n[DRY RUN] No changes made.")
        return 0

    if not to_add and not to_update:
        print("\nNothing to import.")
        return 0

    # Confirm
    if not args.force:
        response = input(f"\nImport {len(to_add)} new, update {len(to_update)}? [y/N] ")
        if response.lower() != 'y':
            print("Cancelled.")
            return 0

    # Determine output directory based on scope
    if target_scope == "global":
        output_dir = GLOBAL_INHERITED_DIR
    else:
        output_dir = project["instincts_inherited"]

    output_dir.mkdir(parents=True, exist_ok=True)

    # Collect stale files for instincts being updated (deleted after new file is written).
    # Allow deletion from any subdirectory (personal/ or inherited/) within the
    # target scope to prevent the same ID existing in both places. Guard against
    # cross-scope deletion by restricting to the scope's instincts root.
    if target_scope == "global":
        scope_root = GLOBAL_INSTINCTS_DIR.resolve()
    else:
        scope_root = (project["project_dir"] / "instincts").resolve() if project["id"] != "global" else GLOBAL_INSTINCTS_DIR.resolve()
    stale_paths = []
    for inst in to_update:
        inst_id = inst.get('id')
        stale = next((e for e in existing if e.get('id') == inst_id), None)
        if stale and stale.get('_source_file'):
            stale_path = Path(stale['_source_file']).resolve()
            if stale_path.exists() and str(stale_path).startswith(str(scope_root) + os.sep):
                stale_paths.append(stale_path)

    # Write new file first (safe: if this fails, stale files are preserved)
    timestamp = datetime.now().strftime('%Y%m%d-%H%M%S')
    source_name = Path(source).stem if not source.startswith('http') else 'web-import'
    output_file = output_dir / f"{source_name}-{timestamp}.yaml"

    all_to_write = to_add + to_update
    output_content = f"# Imported from {source}\n# Date: {datetime.now().isoformat()}\n# Scope: {target_scope}\n"
    if target_scope == "project":
        output_content += f"# Project: {project['name']} ({project['id']})\n"
    output_content += "\n"

    for inst in all_to_write:
        output_content += "---\n"
        output_content += f"id: {inst.get('id')}\n"
        output_content += f"trigger: {_yaml_quote(inst.get('trigger', 'unknown'))}\n"
        output_content += f"confidence: {inst.get('confidence', 0.5)}\n"
        output_content += f"domain: {inst.get('domain', 'general')}\n"
        output_content += "source: inherited\n"
        output_content += f"scope: {target_scope}\n"
        output_content += f"imported_from: {_yaml_quote(source)}\n"
        if target_scope == "project":
            output_content += f"project_id: {project['id']}\n"
            output_content += f"project_name: {project['name']}\n"
        if inst.get('source_repo'):
            output_content += f"source_repo: {inst.get('source_repo')}\n"
        output_content += "---\n\n"
        output_content += inst.get('content', '') + "\n\n"

    output_file.write_text(output_content, encoding="utf-8")

    # Remove stale files only after the new file has been written successfully
    for stale_path in stale_paths:
        try:
            stale_path.unlink()
        except OSError:
            pass  # best-effort removal

    print(f"\nImport complete!")
    print(f"   Scope: {target_scope}")
    print(f"   Added: {len(to_add)}")
    print(f"   Updated: {len(to_update)}")
    print(f"   Saved to: {output_file}")

    return 0


# ─────────────────────────────────────────────
# Export Command
# ─────────────────────────────────────────────

def cmd_export(args) -> int:
    """Export instincts to file."""
    project = detect_project()

    # Determine what to export based on scope filter
    if args.scope == "project":
        instincts = load_project_only_instincts(project)
    elif args.scope == "global":
        instincts = _load_instincts_from_dir(GLOBAL_PERSONAL_DIR, "personal", "global")
        instincts += _load_instincts_from_dir(GLOBAL_INHERITED_DIR, "inherited", "global")
    else:
        instincts = load_all_instincts(project)

    if not instincts:
        print("No instincts to export.")
        return 1

    # Filter by domain if specified
    if args.domain:
        instincts = [i for i in instincts if i.get('domain') == args.domain]

    # Filter by minimum confidence
    if args.min_confidence:
        instincts = [i for i in instincts if i.get('confidence', 0.5) >= args.min_confidence]

    if not instincts:
        print("No instincts match the criteria.")
        return 1

    # Generate output
    output = f"# Instincts export\n# Date: {datetime.now().isoformat()}\n# Total: {len(instincts)}\n"
    if args.scope:
        output += f"# Scope: {args.scope}\n"
    if project["id"] != "global":
        output += f"# Project: {project['name']} ({project['id']})\n"
    output += "\n"

    for inst in instincts:
        output += "---\n"
        for key in ['id', 'trigger', 'confidence', 'domain', 'source', 'scope',
                     'project_id', 'project_name', 'source_repo']:
            if inst.get(key):
                value = inst[key]
                if key == 'trigger':
                    output += f'{key}: {_yaml_quote(value)}\n'
                else:
                    output += f"{key}: {value}\n"
        output += "---\n\n"
        output += inst.get('content', '') + "\n\n"

    # Write to file or stdout
    if args.output:
        try:
            out_path = _validate_file_path(args.output)
        except ValueError as e:
            print(f"Invalid output path: {e}", file=sys.stderr)
            return 1
        if out_path.is_dir():
            print(f"Error: '{out_path}' is a directory, not a file.", file=sys.stderr)
            return 1
        out_path.parent.mkdir(parents=True, exist_ok=True)
        out_path.write_text(output, encoding="utf-8")
        print(f"Exported {len(instincts)} instincts to {out_path}")
    else:
        print(output)

    return 0


# ─────────────────────────────────────────────
# Evolve Command
# ─────────────────────────────────────────────

def cmd_evolve(args) -> int:
    """Analyze instincts and suggest evolutions to skills/commands/agents."""
    project = detect_project()
    instincts = load_all_instincts(project)

    if len(instincts) < 3:
        print("Need at least 3 instincts to analyze patterns.")
        print(f"Currently have: {len(instincts)}")
        return 1

    project_instincts = [i for i in instincts if i.get('_scope_label') == 'project']
    global_instincts = [i for i in instincts if i.get('_scope_label') == 'global']

    print(f"\n{'='*60}")
    print(f"  EVOLVE ANALYSIS - {len(instincts)} instincts")
    print(f"  Project: {project['name']} ({project['id']})")
    print(f"  Project-scoped: {len(project_instincts)} | Global: {len(global_instincts)}")
    print(f"{'='*60}\n")

    # Group by domain
    by_domain = defaultdict(list)
    for inst in instincts:
        domain = inst.get('domain', 'general')
        by_domain[domain].append(inst)

    # High-confidence instincts by domain (candidates for skills)
    high_conf = [i for i in instincts if i.get('confidence', 0) >= 0.8]
    print(f"High confidence instincts (>=80%): {len(high_conf)}")

    # Find clusters (instincts with similar triggers)
    trigger_clusters = defaultdict(list)
    for inst in instincts:
        trigger = inst.get('trigger', '')
        # Normalize trigger
        trigger_key = trigger.lower()
        for keyword in ['when', 'creating', 'writing', 'adding', 'implementing', 'testing']:
            trigger_key = trigger_key.replace(keyword, '').strip()
        trigger_clusters[trigger_key].append(inst)

    # Find clusters with 2+ instincts (good skill candidates)
    skill_candidates = []
    for trigger, cluster in trigger_clusters.items():
        if len(cluster) >= 2:
            avg_conf = sum(i.get('confidence', 0.5) for i in cluster) / len(cluster)
            skill_candidates.append({
                'trigger': trigger,
                'instincts': cluster,
                'avg_confidence': avg_conf,
                'domains': list(set(i.get('domain', 'general') for i in cluster)),
                'scopes': list(set(i.get('scope', 'project') for i in cluster)),
            })

    # Sort by cluster size and confidence
    skill_candidates.sort(key=lambda x: (-len(x['instincts']), -x['avg_confidence']))

    print(f"\nPotential skill clusters found: {len(skill_candidates)}")

    if skill_candidates:
        print(f"\n## SKILL CANDIDATES\n")
        for i, cand in enumerate(skill_candidates[:5], 1):
            scope_info = ', '.join(cand['scopes'])
            print(f"{i}. Cluster: \"{cand['trigger']}\"")
            print(f"   Instincts: {len(cand['instincts'])}")
            print(f"   Avg confidence: {cand['avg_confidence']:.0%}")
            print(f"   Domains: {', '.join(cand['domains'])}")
            print(f"   Scopes: {scope_info}")
            print(f"   Instincts:")
            for inst in cand['instincts'][:3]:
                print(f"     - {inst.get('id')} [{inst.get('scope', '?')}]")
            print()

    # Command candidates (workflow instincts with high confidence)
    workflow_instincts = [i for i in instincts if i.get('domain') == 'workflow' and i.get('confidence', 0) >= 0.7]
    if workflow_instincts:
        print(f"\n## COMMAND CANDIDATES ({len(workflow_instincts)})\n")
        for inst in workflow_instincts[:5]:
            trigger = inst.get('trigger', 'unknown')
            cmd_name = trigger.replace('when ', '').replace('implementing ', '').replace('a ', '')
            cmd_name = cmd_name.replace(' ', '-')[:20]
            print(f"  /{cmd_name}")
            print(f"    From: {inst.get('id')} [{inst.get('scope', '?')}]")
            print(f"    Confidence: {inst.get('confidence', 0.5):.0%}")
            print()

    # Agent candidates (complex multi-step patterns)
    agent_candidates = [c for c in skill_candidates if len(c['instincts']) >= 3 and c['avg_confidence'] >= 0.75]
    if agent_candidates:
        print(f"\n## AGENT CANDIDATES ({len(agent_candidates)})\n")
        for cand in agent_candidates[:3]:
            agent_name = cand['trigger'].replace(' ', '-')[:20] + '-agent'
            print(f"  {agent_name}")
            print(f"    Covers {len(cand['instincts'])} instincts")
            print(f"    Avg confidence: {cand['avg_confidence']:.0%}")
            print()

    # Promotion candidates (project instincts that could be global)
    _show_promotion_candidates(project)

    if args.generate:
        evolved_dir = project["evolved_dir"] if project["id"] != "global" else GLOBAL_EVOLVED_DIR
        generated = _generate_evolved(skill_candidates, workflow_instincts, agent_candidates, evolved_dir)
        if generated:
            print(f"\nGenerated {len(generated)} evolved structures:")
            for path in generated:
                print(f"   {path}")
        else:
            print("\nNo structures generated (need higher-confidence clusters).")

    print(f"\n{'='*60}\n")
    return 0


# ─────────────────────────────────────────────
# Promote Command
# ─────────────────────────────────────────────

def _find_cross_project_instincts() -> dict:
    """Find instincts that appear in multiple projects (promotion candidates).

    Returns dict mapping instinct ID → list of (project_id, instinct) tuples.
    """
    registry = load_registry()
    cross_project = defaultdict(list)

    for pid, pinfo in registry.items():
        project_dir = PROJECTS_DIR / pid
        personal_dir = project_dir / "instincts" / "personal"
        inherited_dir = project_dir / "instincts" / "inherited"

        # Track instinct IDs already seen for this project to avoid counting
        # the same instinct twice within one project (e.g. in both personal/ and inherited/)
        seen_in_project = set()
        for d, stype in [(personal_dir, "personal"), (inherited_dir, "inherited")]:
            for inst in _load_instincts_from_dir(d, stype, "project"):
                iid = inst.get('id')
                if iid and iid not in seen_in_project:
                    seen_in_project.add(iid)
                    cross_project[iid].append((pid, pinfo.get('name', pid), inst))

    # Filter to only those appearing in 2+ unique projects
    return {iid: entries for iid, entries in cross_project.items() if len(entries) >= 2}


def _show_promotion_candidates(project: dict) -> None:
    """Show instincts that could be promoted from project to global."""
    cross = _find_cross_project_instincts()

    if not cross:
        return

    # Filter to high-confidence ones not already global
    global_instincts = _load_instincts_from_dir(GLOBAL_PERSONAL_DIR, "personal", "global")
    global_instincts += _load_instincts_from_dir(GLOBAL_INHERITED_DIR, "inherited", "global")
    global_ids = {i.get('id') for i in global_instincts}

    candidates = []
    for iid, entries in cross.items():
        if iid in global_ids:
            continue
        avg_conf = sum(e[2].get('confidence', 0.5) for e in entries) / len(entries)
        if avg_conf >= PROMOTE_CONFIDENCE_THRESHOLD:
            candidates.append({
                'id': iid,
                'projects': [(pid, pname) for pid, pname, _ in entries],
                'avg_confidence': avg_conf,
                'sample': entries[0][2],
            })

    if candidates:
        print(f"\n## PROMOTION CANDIDATES (project -> global)\n")
        print(f"  These instincts appear in {PROMOTE_MIN_PROJECTS}+ projects with high confidence:\n")
        for cand in candidates[:10]:
            proj_names = ', '.join(pname for _, pname in cand['projects'])
            print(f"  * {cand['id']} (avg: {cand['avg_confidence']:.0%})")
            print(f"    Found in: {proj_names}")
            print()
        print(f"  Run `instinct-cli.py promote` to promote these to global scope.\n")


def cmd_promote(args) -> int:
    """Promote project-scoped instincts to global scope."""
    project = detect_project()

    if args.instinct_id:
        # Promote a specific instinct
        return _promote_specific(project, args.instinct_id, args.force, args.dry_run)
    else:
        # Auto-detect promotion candidates
        return _promote_auto(project, args.force, args.dry_run)


def _promote_specific(project: dict, instinct_id: str, force: bool, dry_run: bool = False) -> int:
    """Promote a specific instinct by ID from current project to global."""
    if not _validate_instinct_id(instinct_id):
        print(f"Invalid instinct ID: '{instinct_id}'.", file=sys.stderr)
        return 1

    project_instincts = load_project_only_instincts(project)
    target = next((i for i in project_instincts if i.get('id') == instinct_id), None)

    if not target:
        print(f"Instinct '{instinct_id}' not found in project {project['name']}.")
        return 1

    # Check if already global
    global_instincts = _load_instincts_from_dir(GLOBAL_PERSONAL_DIR, "personal", "global")
    global_instincts += _load_instincts_from_dir(GLOBAL_INHERITED_DIR, "inherited", "global")
    if any(i.get('id') == instinct_id for i in global_instincts):
        print(f"Instinct '{instinct_id}' already exists in global scope.")
        return 1

    print(f"\nPromoting: {instinct_id}")
    print(f"  From: project '{project['name']}'")
    print(f"  Confidence: {target.get('confidence', 0.5):.0%}")
    print(f"  Domain: {target.get('domain', 'general')}")

    if dry_run:
        print("\n[DRY RUN] No changes made.")
        return 0

    if not force:
        response = input(f"\nPromote to global? [y/N] ")
        if response.lower() != 'y':
            print("Cancelled.")
            return 0

    # Write to global personal directory
    output_file = GLOBAL_PERSONAL_DIR / f"{instinct_id}.yaml"
    output_content = "---\n"
    output_content += f"id: {target.get('id')}\n"
    output_content += f"trigger: {_yaml_quote(target.get('trigger', 'unknown'))}\n"
    output_content += f"confidence: {target.get('confidence', 0.5)}\n"
    output_content += f"domain: {target.get('domain', 'general')}\n"
    output_content += f"source: {target.get('source', 'promoted')}\n"
    output_content += f"scope: global\n"
    output_content += f"promoted_from: {project['id']}\n"
    output_content += f"promoted_date: {datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z')}\n"
    output_content += "---\n\n"
    output_content += target.get('content', '') + "\n"

    output_file.write_text(output_content, encoding="utf-8")
    print(f"\nPromoted '{instinct_id}' to global scope.")
    print(f"  Saved to: {output_file}")
    return 0


def _promote_auto(project: dict, force: bool, dry_run: bool) -> int:
    """Auto-promote instincts found in multiple projects."""
    cross = _find_cross_project_instincts()

    global_instincts = _load_instincts_from_dir(GLOBAL_PERSONAL_DIR, "personal", "global")
    global_instincts += _load_instincts_from_dir(GLOBAL_INHERITED_DIR, "inherited", "global")
    global_ids = {i.get('id') for i in global_instincts}

    candidates = []
    for iid, entries in cross.items():
        if iid in global_ids:
            continue
        avg_conf = sum(e[2].get('confidence', 0.5) for e in entries) / len(entries)
        if avg_conf >= PROMOTE_CONFIDENCE_THRESHOLD and len(entries) >= PROMOTE_MIN_PROJECTS:
            candidates.append({
                'id': iid,
                'entries': entries,
                'avg_confidence': avg_conf,
            })

    if not candidates:
        print("No instincts qualify for auto-promotion.")
        print(f"  Criteria: appears in {PROMOTE_MIN_PROJECTS}+ projects, avg confidence >= {PROMOTE_CONFIDENCE_THRESHOLD:.0%}")
        return 0

    print(f"\n{'='*60}")
    print(f"  AUTO-PROMOTION CANDIDATES - {len(candidates)} found")
    print(f"{'='*60}\n")

    for cand in candidates:
        proj_names = ', '.join(pname for _, pname, _ in cand['entries'])
        print(f"  {cand['id']} (avg: {cand['avg_confidence']:.0%})")
        print(f"    Found in {len(cand['entries'])} projects: {proj_names}")

    if dry_run:
        print(f"\n[DRY RUN] No changes made.")
        return 0

    if not force:
        response = input(f"\nPromote {len(candidates)} instincts to global? [y/N] ")
        if response.lower() != 'y':
            print("Cancelled.")
            return 0

    promoted = 0
    for cand in candidates:
        if not _validate_instinct_id(cand['id']):
            print(f"Skipping invalid instinct ID during promotion: {cand['id']}", file=sys.stderr)
            continue

        # Use the highest-confidence version
        best_entry = max(cand['entries'], key=lambda e: e[2].get('confidence', 0.5))
        inst = best_entry[2]

        output_file = GLOBAL_PERSONAL_DIR / f"{cand['id']}.yaml"
        output_content = "---\n"
        output_content += f"id: {inst.get('id')}\n"
        output_content += f"trigger: {_yaml_quote(inst.get('trigger', 'unknown'))}\n"
        output_content += f"confidence: {cand['avg_confidence']}\n"
        output_content += f"domain: {inst.get('domain', 'general')}\n"
        output_content += f"source: auto-promoted\n"
        output_content += f"scope: global\n"
        output_content += f"promoted_date: {datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z')}\n"
        output_content += f"seen_in_projects: {len(cand['entries'])}\n"
        output_content += "---\n\n"
        output_content += inst.get('content', '') + "\n"

        output_file.write_text(output_content, encoding="utf-8")
        promoted += 1

    print(f"\nPromoted {promoted} instincts to global scope.")
    return 0


# ─────────────────────────────────────────────
# Projects Command
# ─────────────────────────────────────────────

def cmd_projects(args) -> int:
    """List or maintain known projects and their instinct counts."""
    if getattr(args, "project_action", None) == "delete":
        return _cmd_projects_delete(args)
    if getattr(args, "project_action", None) == "merge":
        return _cmd_projects_merge(args)
    if getattr(args, "project_action", None) == "gc":
        return _cmd_projects_gc(args)

    registry = load_registry()

    if not registry:
        print("No projects registered yet.")
        print("Projects are auto-detected when you use Claude Code in a git repo.")
        return 0

    print(f"\n{'='*60}")
    print(f"  KNOWN PROJECTS - {len(registry)} total")
    print(f"{'='*60}\n")

    for pid, pinfo in sorted(registry.items(), key=lambda x: x[1].get('last_seen', ''), reverse=True):
        project_dir = PROJECTS_DIR / pid
        personal_dir = project_dir / "instincts" / "personal"
        inherited_dir = project_dir / "instincts" / "inherited"

        personal_count = len(_load_instincts_from_dir(personal_dir, "personal", "project"))
        inherited_count = len(_load_instincts_from_dir(inherited_dir, "inherited", "project"))
        obs_file = project_dir / "observations.jsonl"
        if obs_file.exists():
            with open(obs_file, encoding="utf-8") as f:
                obs_count = sum(1 for _ in f)
        else:
            obs_count = 0

        print(f"  {pinfo.get('name', pid)} [{pid}]")
        print(f"    Root: {pinfo.get('root', 'unknown')}")
        if pinfo.get('remote'):
            print(f"    Remote: {pinfo['remote']}")
        print(f"    Instincts: {personal_count} personal, {inherited_count} inherited")
        print(f"    Observations: {obs_count} events")
        print(f"    Last seen: {pinfo.get('last_seen', 'unknown')}")
        print()

    # Global stats
    global_personal = len(_load_instincts_from_dir(GLOBAL_PERSONAL_DIR, "personal", "global"))
    global_inherited = len(_load_instincts_from_dir(GLOBAL_INHERITED_DIR, "inherited", "global"))
    print(f"  GLOBAL")
    print(f"    Instincts: {global_personal} personal, {global_inherited} inherited")

    print(f"\n{'='*60}\n")
    return 0


def _cmd_projects_delete(args) -> int:
    registry = load_registry()
    project_id = args.project_id

    if not _validate_project_id(project_id):
        print(f"Invalid project ID: {project_id}", file=sys.stderr)
        return 1
    if project_id not in registry and not (PROJECTS_DIR / project_id).exists():
        print(f"Project '{project_id}' not found.", file=sys.stderr)
        return 1

    counts = _project_counts(project_id)
    print(f"Project: {project_id}")
    print(f"  Instincts: {counts['personal']} personal, {counts['inherited']} inherited")
    print(f"  Observations: {counts['observations']} events")

    if args.dry_run:
        print(f"\n[DRY RUN] Would delete project '{project_id}' from registry and storage.")
        return 0

    if not args.force:
        if counts["total"] > 0:
            print("\nWarning: this project has instincts or observations.")
        response = input(f"Delete project '{project_id}'? [y/N] ")
        if response.lower() != "y":
            print("Cancelled.")
            return 0

    registry.pop(project_id, None)
    _write_registry(registry)
    _remove_project_storage(project_id)
    print(f"\nDeleted project '{project_id}'.")
    return 0


def _cmd_projects_gc(args) -> int:
    registry = load_registry()
    candidates = [
        project_id
        for project_id in sorted(registry)
        if _validate_project_id(project_id) and _project_counts(project_id)["total"] == 0
    ]

    if not candidates:
        print("No zero-value project entries found.")
        return 0

    print(f"Zero-value project entries: {len(candidates)}")
    for project_id in candidates:
        pinfo = registry.get(project_id, {})
        print(f"  - {pinfo.get('name', project_id)} [{project_id}]")

    if args.dry_run:
        print(f"\n[DRY RUN] Would delete {len(candidates)} project entr{'y' if len(candidates) == 1 else 'ies'}.")
        return 0

    if not args.force:
        response = input(f"\nDelete {len(candidates)} zero-value project entr{'y' if len(candidates) == 1 else 'ies'}? [y/N] ")
        if response.lower() != "y":
            print("Cancelled.")
            return 0

    for project_id in candidates:
        registry.pop(project_id, None)
        _remove_project_storage(project_id)
    _write_registry(registry)
    print(f"\nDeleted {len(candidates)} zero-value project entr{'y' if len(candidates) == 1 else 'ies'}.")
    return 0


def _cmd_projects_merge(args) -> int:
    from_id = args.from_id
    into_id = args.into_id

    if not _validate_project_id(from_id) or not _validate_project_id(into_id):
        print("Invalid project ID.", file=sys.stderr)
        return 1
    if from_id == into_id:
        print("Cannot merge a project into itself.", file=sys.stderr)
        return 1

    registry = load_registry()
    if from_id not in registry:
        print(f"Source project '{from_id}' not found.", file=sys.stderr)
        return 1
    if into_id not in registry:
        print(f"Destination project '{into_id}' not found.", file=sys.stderr)
        return 1

    from_counts = _project_counts(from_id)
    into_counts = _project_counts(into_id)
    print(f"Merge: {from_id} -> {into_id}")
    print(f"  Source: {from_counts['personal']} personal, {from_counts['inherited']} inherited, {from_counts['observations']} observations")
    print(f"  Destination before merge: {into_counts['personal']} personal, {into_counts['inherited']} inherited, {into_counts['observations']} observations")

    if args.dry_run:
        print("\n[DRY RUN] Would merge source project into destination and remove source.")
        return 0

    if not args.force:
        response = input(f"\nMerge '{from_id}' into '{into_id}' and remove source? [y/N] ")
        if response.lower() != "y":
            print("Cancelled.")
            return 0

    from_project_dir = PROJECTS_DIR / from_id
    into_project_dir = PROJECTS_DIR / into_id
    into_project_dir.mkdir(parents=True, exist_ok=True)

    personal_existing = _project_instinct_ids(into_project_dir, "personal")
    inherited_existing = _project_instinct_ids(into_project_dir, "inherited")
    personal_moved, personal_skipped = _merge_instinct_dir(
        from_project_dir / "instincts" / "personal",
        into_project_dir / "instincts" / "personal",
        personal_existing,
    )
    inherited_moved, inherited_skipped = _merge_instinct_dir(
        from_project_dir / "instincts" / "inherited",
        into_project_dir / "instincts" / "inherited",
        inherited_existing,
    )
    observations_moved = _append_observations(from_project_dir, into_project_dir)

    registry.pop(from_id, None)
    destination = registry.get(into_id, {})
    destination["last_seen"] = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    registry[into_id] = destination
    _write_registry(registry)
    _remove_project_storage(from_id)

    print("\nMerged project registry entry.")
    print(f"  Moved instincts: {personal_moved + inherited_moved}")
    print(f"  Skipped duplicate instincts: {personal_skipped + inherited_skipped}")
    print(f"  Appended observations: {observations_moved}")
    return 0


# ─────────────────────────────────────────────
# Generate Evolved Structures
# ─────────────────────────────────────────────

def _generate_evolved(skill_candidates: list, workflow_instincts: list, agent_candidates: list, evolved_dir: Path) -> list[str]:
    """Generate skill/command/agent files from analyzed instinct clusters."""
    generated = []

    # Generate skills from top candidates
    for cand in skill_candidates[:5]:
        trigger = cand['trigger'].strip()
        if not trigger:
            continue
        name = re.sub(r'[^a-z0-9]+', '-', trigger.lower()).strip('-')[:30]
        if not name:
            continue

        skill_dir = evolved_dir / "skills" / name
        skill_dir.mkdir(parents=True, exist_ok=True)

        content = f"# {name}\n\n"
        content += f"Evolved from {len(cand['instincts'])} instincts "
        content += f"(avg confidence: {cand['avg_confidence']:.0%})\n\n"
        content += f"## When to Apply\n\n"
        content += f"Trigger: {trigger}\n\n"
        content += f"## Actions\n\n"
        for inst in cand['instincts']:
            inst_content = inst.get('content', '')
            action_match = re.search(r'## Action\s*\n\s*(.+?)(?:\n\n|\n##|$)', inst_content, re.DOTALL)
            action = action_match.group(1).strip() if action_match else inst.get('id', 'unnamed')
            content += f"- {action}\n"

        (skill_dir / "SKILL.md").write_text(content, encoding="utf-8")
        generated.append(str(skill_dir / "SKILL.md"))

    # Generate commands from workflow instincts
    for inst in workflow_instincts[:5]:
        trigger = inst.get('trigger', 'unknown')
        cmd_name = re.sub(r'[^a-z0-9]+', '-', trigger.lower().replace('when ', '').replace('implementing ', ''))
        cmd_name = cmd_name.strip('-')[:20]
        if not cmd_name:
            continue

        cmd_file = evolved_dir / "commands" / f"{cmd_name}.md"
        content = f"# {cmd_name}\n\n"
        content += f"Evolved from instinct: {inst.get('id', 'unnamed')}\n"
        content += f"Confidence: {inst.get('confidence', 0.5):.0%}\n\n"
        content += inst.get('content', '')

        cmd_file.write_text(content, encoding="utf-8")
        generated.append(str(cmd_file))

    # Generate agents from complex clusters
    for cand in agent_candidates[:3]:
        trigger = cand['trigger'].strip()
        agent_name = re.sub(r'[^a-z0-9]+', '-', trigger.lower()).strip('-')[:20]
        if not agent_name:
            continue

        agent_file = evolved_dir / "agents" / f"{agent_name}.md"
        domains = ', '.join(cand['domains'])
        instinct_ids = [i.get('id', 'unnamed') for i in cand['instincts']]

        content = f"---\nmodel: sonnet\ntools: Read, Grep, Glob\n---\n"
        content += f"# {agent_name}\n\n"
        content += f"Evolved from {len(cand['instincts'])} instincts "
        content += f"(avg confidence: {cand['avg_confidence']:.0%})\n"
        content += f"Domains: {domains}\n\n"
        content += f"## Source Instincts\n\n"
        for iid in instinct_ids:
            content += f"- {iid}\n"

        agent_file.write_text(content, encoding="utf-8")
        generated.append(str(agent_file))

    return generated


# ─────────────────────────────────────────────
# Pending Instinct Helpers
# ─────────────────────────────────────────────

def _collect_pending_dirs() -> list[Path]:
    """Return all pending instinct directories (global + per-project)."""
    dirs = []
    global_pending = GLOBAL_INSTINCTS_DIR / "pending"
    if global_pending.is_dir():
        dirs.append(global_pending)
    if PROJECTS_DIR.is_dir():
        for project_dir in sorted(PROJECTS_DIR.iterdir()):
            if project_dir.is_dir():
                pending = project_dir / "instincts" / "pending"
                if pending.is_dir():
                    dirs.append(pending)
    return dirs


def _parse_created_date(file_path: Path) -> Optional[datetime]:
    """Parse the 'created' date from YAML frontmatter of an instinct file.

    Falls back to file mtime if no 'created' field is found.
    """
    try:
        content = file_path.read_text(encoding="utf-8")
    except (OSError, UnicodeDecodeError):
        return None

    in_frontmatter = False
    for line in content.split('\n'):
        stripped = line.strip()
        if stripped == '---':
            if in_frontmatter:
                break  # end of frontmatter without finding created
            in_frontmatter = True
            continue
        if in_frontmatter and ':' in line:
            key, value = line.split(':', 1)
            if key.strip() == 'created':
                date_str = value.strip().strip('"').strip("'")
                for fmt in (
                    "%Y-%m-%dT%H:%M:%S%z",
                    "%Y-%m-%dT%H:%M:%SZ",
                    "%Y-%m-%dT%H:%M:%S",
                    "%Y-%m-%d",
                ):
                    try:
                        dt = datetime.strptime(date_str, fmt)
                        if dt.tzinfo is None:
                            dt = dt.replace(tzinfo=timezone.utc)
                        return dt
                    except ValueError:
                        continue

    # Fallback: file modification time
    try:
        mtime = file_path.stat().st_mtime
        return datetime.fromtimestamp(mtime, tz=timezone.utc)
    except OSError:
        return None


def _collect_pending_instincts() -> list[dict]:
    """Scan all pending directories and return info about each pending instinct.

    Each dict contains: path, created, age_days, name, parent_dir.
    """
    now = datetime.now(timezone.utc)
    results = []
    for pending_dir in _collect_pending_dirs():
        files = [
            f for f in sorted(pending_dir.iterdir())
            if f.is_file() and f.suffix.lower() in ALLOWED_INSTINCT_EXTENSIONS
        ]
        for file_path in files:
            created = _parse_created_date(file_path)
            if created is None:
                print(f"Warning: could not parse age for pending instinct: {file_path.name}", file=sys.stderr)
                continue
            age = now - created
            results.append({
                "path": file_path,
                "created": created,
                "age_days": age.days,
                "name": file_path.stem,
                "parent_dir": str(pending_dir),
            })
    return results


# ─────────────────────────────────────────────
# Prune Command
# ─────────────────────────────────────────────

def cmd_prune(args) -> int:
    """Delete pending instincts older than the TTL threshold."""
    max_age = args.max_age
    dry_run = args.dry_run
    quiet = args.quiet

    pending = _collect_pending_instincts()

    expired = [p for p in pending if p["age_days"] >= max_age]
    remaining = [p for p in pending if p["age_days"] < max_age]

    if dry_run:
        if not quiet:
            if expired:
                print(f"\n[DRY RUN] Would prune {len(expired)} pending instinct(s) older than {max_age} days:\n")
                for item in expired:
                    print(f"  - {item['name']} (age: {item['age_days']}d) — {item['path']}")
            else:
                print(f"No pending instincts older than {max_age} days.")
            print(f"\nSummary: {len(expired)} would be pruned, {len(remaining)} remaining")
        return 0

    pruned = 0
    pruned_items = []
    for item in expired:
        try:
            item["path"].unlink()
            pruned += 1
            pruned_items.append(item)
        except OSError as e:
            if not quiet:
                print(f"Warning: Failed to delete {item['path']}: {e}", file=sys.stderr)

    if not quiet:
        if pruned > 0:
            print(f"\nPruned {pruned} pending instinct(s) older than {max_age} days.")
            for item in pruned_items:
                print(f"  - {item['name']} (age: {item['age_days']}d)")
        else:
            print(f"No pending instincts older than {max_age} days.")
        failed = len(expired) - pruned
        remaining_total = len(remaining) + failed
        print(f"\nSummary: {pruned} pruned, {remaining_total} remaining")

    return 0


# ─────────────────────────────────────────────
# Main
# ─────────────────────────────────────────────

def main() -> int:
    _ensure_global_dirs()
    parser = argparse.ArgumentParser(description='Instinct CLI for Continuous Learning v2.1 (Project-Scoped)')
    subparsers = parser.add_subparsers(dest='command', help='Available commands')

    # Status
    status_parser = subparsers.add_parser('status', help='Show instinct status (project + global)')

    # Import
    import_parser = subparsers.add_parser('import', help='Import instincts')
    import_parser.add_argument('source', help='File path or URL')
    import_parser.add_argument('--dry-run', action='store_true', help='Preview without importing')
    import_parser.add_argument('--force', action='store_true', help='Skip confirmation')
    import_parser.add_argument('--min-confidence', type=float, help='Minimum confidence threshold')
    import_parser.add_argument('--scope', choices=['project', 'global'], default='project',
                               help='Import scope (default: project)')

    # Export
    export_parser = subparsers.add_parser('export', help='Export instincts')
    export_parser.add_argument('--output', '-o', help='Output file')
    export_parser.add_argument('--domain', help='Filter by domain')
    export_parser.add_argument('--min-confidence', type=float, help='Minimum confidence')
    export_parser.add_argument('--scope', choices=['project', 'global', 'all'], default='all',
                               help='Export scope (default: all)')

    # Evolve
    evolve_parser = subparsers.add_parser('evolve', help='Analyze and evolve instincts')
    evolve_parser.add_argument('--generate', action='store_true', help='Generate evolved structures')

    # Promote (new in v2.1)
    promote_parser = subparsers.add_parser('promote', help='Promote project instincts to global scope')
    promote_parser.add_argument('instinct_id', nargs='?', help='Specific instinct ID to promote')
    promote_parser.add_argument('--force', action='store_true', help='Skip confirmation')
    promote_parser.add_argument('--dry-run', action='store_true', help='Preview without promoting')

    # Projects (new in v2.1)
    projects_parser = subparsers.add_parser('projects', help='List known projects and instinct counts')
    projects_subparsers = projects_parser.add_subparsers(dest='project_action')
    projects_delete = projects_subparsers.add_parser('delete', help='Delete a project registry entry')
    projects_delete.add_argument('project_id', help='Project ID to delete')
    projects_delete.add_argument('--dry-run', action='store_true', help='Preview without deleting')
    projects_delete.add_argument('--force', action='store_true', help='Skip confirmation')
    projects_merge = projects_subparsers.add_parser('merge', help='Merge one project registry entry into another')
    projects_merge.add_argument('from_id', help='Source project ID')
    projects_merge.add_argument('into_id', help='Destination project ID')
    projects_merge.add_argument('--dry-run', action='store_true', help='Preview without merging')
    projects_merge.add_argument('--force', action='store_true', help='Skip confirmation')
    projects_gc = projects_subparsers.add_parser('gc', help='Delete zero-value project registry entries')
    projects_gc.add_argument('--dry-run', action='store_true', help='Preview without deleting')
    projects_gc.add_argument('--force', action='store_true', help='Skip confirmation')

    # Prune (pending instinct TTL)
    prune_parser = subparsers.add_parser('prune', help='Delete pending instincts older than TTL')
    prune_parser.add_argument('--max-age', type=int, default=PENDING_TTL_DAYS,
                              help=f'Max age in days before pruning (default: {PENDING_TTL_DAYS})')
    prune_parser.add_argument('--dry-run', action='store_true', help='Preview without deleting')
    prune_parser.add_argument('--quiet', action='store_true', help='Suppress output (for automated use)')

    args = parser.parse_args()

    if args.command == 'status':
        return cmd_status(args)
    elif args.command == 'import':
        return cmd_import(args)
    elif args.command == 'export':
        return cmd_export(args)
    elif args.command == 'evolve':
        return cmd_evolve(args)
    elif args.command == 'promote':
        return cmd_promote(args)
    elif args.command == 'projects':
        return cmd_projects(args)
    elif args.command == 'prune':
        return cmd_prune(args)
    else:
        parser.print_help()
        return 1


if __name__ == '__main__':
    sys.exit(main())
