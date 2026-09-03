#!/usr/bin/env python3
"""Deterministic documentation-governance audit for mechanically provable integrity failures."""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from collections import Counter
from pathlib import Path
from urllib.parse import unquote

DEFAULT_ROLES = {
    "constitution": "CLAUDE.md",
    "map": "CLAUDE_MAP.md",
    "status": "PROJECT_STATUS.md",
    "history": "PROJECT_LOG.md",
    "history_archive": "PROJECT_LOG.archive.md",
    "agents": "AGENTS.md",
    "context": "CONTEXT.md",
    "contract": "CONTRACT.md",
    "tests": "TESTS.md",
    "regression": "REGRESSION.md",
    "adr_dir": "docs/adr",
    "adr_index": "docs/adr/README.md",
}
ENTRY_RE = re.compile(
    r"^## \[(?P<date>\d{4}-\d{2}-\d{2})\]\s+(?P<type>[^|\n]+?)\s*\|\s*(?P<summary>[^\n]+)$",
    re.MULTILINE,
)
MARKDOWN_LINK_START_RE = re.compile(r"\[[^\]\n]*\]\(")
CODE_PATH_RE = re.compile(r"`([^`\n]+)`")
TEST_ID_RE = re.compile(r"\bTEST-[A-Z0-9][A-Z0-9-]*\b", re.IGNORECASE)
EXTERNAL_URI_RE = re.compile(
    r"^(?:[A-Za-z][A-Za-z0-9+.-]*://|(?:data|doi|geo|irc|magnet|mailto|news|sms|tel|urn):)",
    re.IGNORECASE,
)
ADR_TARGET_RE = re.compile(r"\b(?:ADR-)?\d{3,4}-[a-z0-9-]+\.md\b", re.IGNORECASE)
IGNORED_DIRS = {".git", ".governance", ".venv", "node_modules", "vendor", "__pycache__"}
IGNORED_REFERENCE_MARKERS = ("*", "{", "}", "<", ">", "…", "...")


class Report:
    def __init__(self) -> None:
        self.failures = 0

    def section(self, title: str) -> None:
        print(f"\n[{title}]")

    def ok(self, message: str) -> None:
        print(f"  ✓ {message}")

    def warn(self, message: str) -> None:
        print(f"  WARN: {message}")

    def fail(self, message: str) -> None:
        self.failures += 1
        print(f"  ✗ {message}")


def diagnostic(value: object) -> str:
    return repr(str(value))


def resolved_within_root(root: Path, path: Path) -> Path | None:
    try:
        candidate = path.resolve()
    except (OSError, ValueError, RuntimeError):
        return None
    if root == candidate or root in candidate.parents:
        return candidate
    return None


def read_utf8(path: Path, report: Report, label: str) -> str | None:
    try:
        return path.read_text(encoding="utf-8")
    except (OSError, UnicodeError):
        report.fail(f"Cannot read {label} as a UTF-8 regular file: {diagnostic(path)}")
        return None


def load_custom_roles(root: Path, report: Report) -> tuple[dict[object, object], bool]:
    mapping_path = root / ".governance" / "docs-map.json"
    mapping_present = mapping_path.exists() or mapping_path.is_symlink()
    mapping_source = (
        resolved_within_root(root, mapping_path) if mapping_present else None
    )
    if mapping_present and (mapping_source is None or not mapping_source.is_file()):
        report.fail(
            ".governance/docs-map.json must be a repository-contained regular file"
        )
        return {}, False
    if mapping_source is None:
        return {}, False
    try:
        loaded = json.loads(mapping_source.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        report.fail(f"Cannot read .governance/docs-map.json: {diagnostic(exc)}")
        return {}, False
    if not isinstance(loaded, dict):
        report.fail(".governance/docs-map.json must be a role-to-relative-path object")
        return {}, False
    return loaded, True


def apply_custom_roles(
    root: Path,
    roles: dict[str, str],
    custom: dict[object, object],
    report: Report,
) -> None:
    for role, value in custom.items():
        if role not in roles or not isinstance(value, str) or not value.strip():
            report.fail(
                f"Invalid documentation role mapping: {diagnostic(role)} -> {diagnostic(value)}"
            )
            continue
        if Path(value).is_absolute():
            report.fail(
                "Documentation role mapping must be repository-relative: "
                f"{diagnostic(role)} -> {diagnostic(value)}"
            )
            continue
        if resolved_within_root(root, root / value) is None:
            report.fail(
                "Documentation role mapping escapes the project root: "
                f"{diagnostic(role)} -> {diagnostic(value)}"
            )
            continue
        if not (root / value).exists():
            report.fail(
                "Mapped documentation source does not exist: "
                f"{diagnostic(role)} -> {diagnostic(value)}"
            )
            continue
        roles[role] = value


def validate_role_targets(root: Path, roles: dict[str, str], report: Report) -> None:
    for role, value in tuple(roles.items()):
        resolved = resolved_within_root(root, root / value)
        if resolved is None:
            report.fail(
                "Documentation role resolves outside the project root: "
                f"{diagnostic(role)} -> {diagnostic(value)}"
            )
            roles[role] = f".governance/invalid-role/{role}"
            continue
        if resolved.exists() and role == "adr_dir" and not resolved.is_dir():
            report.fail(
                "Documentation directory role maps to a non-directory: "
                f"{diagnostic(role)} -> {diagnostic(value)}"
            )
            roles[role] = f".governance/invalid-role/{role}"
        elif resolved.exists() and role != "adr_dir" and not resolved.is_file():
            report.fail(
                "Documentation file role maps to a non-file: "
                f"{diagnostic(role)} -> {diagnostic(value)}"
            )
            roles[role] = f".governance/invalid-role/{role}"


def load_roles(root: Path, report: Report) -> dict[str, str]:
    roles = dict(DEFAULT_ROLES)
    custom, mapping_loaded = load_custom_roles(root, report)
    apply_custom_roles(root, roles, custom, report)
    validate_role_targets(root, roles, report)
    if mapping_loaded:
        report.ok(
            "Loaded custom documentation role mapping from .governance/docs-map.json"
        )
    return roles


def role_path(root: Path, roles: dict[str, str], role: str) -> Path:
    return root / roles[role]


def markdown_files(root: Path, report: Report) -> list[Path]:
    result: list[Path] = []
    for path in root.rglob("*.md"):
        relative = path.relative_to(root)
        if any(part in IGNORED_DIRS for part in relative.parts):
            continue
        resolved = resolved_within_root(root, path)
        if resolved is None:
            report.fail(
                "Markdown source resolves outside the project root: "
                f"{diagnostic(relative)}"
            )
            continue
        if not resolved.is_file():
            report.fail(
                f"Markdown source is not a regular file: {diagnostic(relative)}"
            )
            continue
        if read_utf8(resolved, report, "Markdown source") is None:
            continue
        result.append(resolved)
    return sorted(set(result))


def event_contents(text: str) -> list[str]:
    matches = list(ENTRY_RE.finditer(text))
    result: list[str] = []
    for index, match in enumerate(matches):
        end = matches[index + 1].start() if index + 1 < len(matches) else len(text)
        result.append(text[match.start() : end].strip())
    return result


def without_fenced_code(text: str) -> str:
    output: list[str] = []
    fence_character: str | None = None
    fence_length = 0
    for line in text.splitlines(keepends=True):
        marker = re.match(r"^ {0,3}(`{3,}|~{3,})(.*)$", line)
        if fence_character is None and marker:
            fence_character = marker.group(1)[0]
            fence_length = len(marker.group(1))
            output.append("\n" if line.endswith("\n") else "")
            continue
        if fence_character is not None:
            closing = re.match(
                rf"^ {{0,3}}{re.escape(fence_character)}{{{fence_length},}}[ \t]*(?:\r?\n)?$",
                line,
            )
            if closing:
                fence_character = None
                fence_length = 0
            output.append("\n" if line.endswith("\n") else "")
            continue
        output.append(line)
    return "".join(output)


def without_inline_code(text: str) -> str:
    output: list[str] = []
    cursor = 0
    while cursor < len(text):
        if text[cursor] != "`":
            output.append(text[cursor])
            cursor += 1
            continue
        end_of_marker = cursor
        while end_of_marker < len(text) and text[end_of_marker] == "`":
            end_of_marker += 1
        marker = text[cursor:end_of_marker]
        closing = text.find(marker, end_of_marker)
        if closing == -1:
            output.append(marker)
            cursor = end_of_marker
            continue
        output.extend(
            "\n" if character == "\n" else " "
            for character in text[cursor : closing + len(marker)]
        )
        cursor = closing + len(marker)
    return "".join(output)


def git_show(root: Path, relative: str) -> str | None:
    command = subprocess.run(
        ["git", "show", f"HEAD:{relative}"],
        cwd=root,
        text=True,
        capture_output=True,
        check=False,
    )
    return command.stdout if command.returncode == 0 else None


def markdown_link_targets(text: str) -> list[str]:
    text = without_inline_code(without_fenced_code(text))
    targets: list[str] = []
    for match in MARKDOWN_LINK_START_RE.finditer(text):
        start = match.end()
        if start < len(text) and text[start] == "<":
            end = text.find(">", start + 1)
            if end != -1:
                targets.append(text[start : end + 1])
            continue
        depth = 0
        quote: str | None = None
        escaped = False
        for end in range(start, len(text)):
            character = text[end]
            if quote is not None:
                if escaped:
                    escaped = False
                elif character == "\\":
                    escaped = True
                elif character == quote:
                    quote = None
                continue
            if character in {"'", '"'}:
                quote = character
                continue
            if character == "(":
                depth += 1
            elif character == ")":
                if depth == 0:
                    targets.append(text[start:end])
                    break
                depth -= 1
    return targets


def normalize_link_target(raw: str) -> str | None:
    target = raw.strip()
    if target.startswith("<"):
        closing = target.find(">")
        if closing == -1:
            return None
        target = target[1:closing]
    else:
        title = re.search(
            r'\s+(?:"(?:\\.|[^"\\])*"|\'(?:\\.|[^\'\\])*\'|\([^()]*\))\s*$', target
        )
        if title:
            target = target[: title.start()]
    target = unquote(target.split("#", 1)[0].split("?", 1)[0])
    if not target or target.startswith("//"):
        return None
    if EXTERNAL_URI_RE.match(target):
        return None
    return target


def resolve_within_root(root: Path, base: Path, target: str) -> Path | None:
    return resolved_within_root(root, base / target)


def resolve_target(root: Path, source: Path, target: str) -> Path | None:
    if target.startswith("/"):
        return resolve_within_root(root, root, target.lstrip("/"))
    return resolve_within_root(root, source.parent, target)


def check_markdown_links(root: Path, files: list[Path], report: Report) -> None:
    broken: list[str] = []
    for source in files:
        if "templates" in source.relative_to(root).parts:
            continue
        text = source.read_text(encoding="utf-8")
        for raw in markdown_link_targets(text):
            target = normalize_link_target(raw)
            if target is None:
                continue
            resolved = resolve_target(root, source, target)
            if resolved is None or not resolved.exists():
                broken.append(
                    f"{diagnostic(source.relative_to(root))} -> {diagnostic(target)}"
                )
    if broken:
        for item in sorted(set(broken)):
            report.fail(f"Broken Markdown link: {item}")
    else:
        report.ok("All local Markdown links resolve")


def plausible_code_path(value: str) -> bool:
    if any(marker in value for marker in IGNORED_REFERENCE_MARKERS):
        return False
    if any(character.isspace() for character in value):
        return False
    if value.startswith(("http://", "https://", "$", ".governance/")):
        return False
    if re.fullmatch(r"/[a-z0-9-]+", value):
        return False
    return "/" in value


def check_spine_paths(root: Path, roles: dict[str, str], report: Report) -> None:
    broken: list[str] = []
    for role in (
        "constitution",
        "map",
        "agents",
        "context",
        "contract",
        "tests",
        "regression",
    ):
        source = role_path(root, roles, role)
        if not source.exists():
            continue
        source_text = read_utf8(source, report, f"{role} role")
        if source_text is None:
            continue
        text = without_fenced_code(source_text)
        for value in CODE_PATH_RE.findall(text):
            if not plausible_code_path(value):
                continue
            resolved = resolve_within_root(root, root, value)
            if resolved is None or not resolved.exists():
                broken.append(
                    f"{diagnostic(source.relative_to(root))} -> {diagnostic(value)}"
                )
    if broken:
        for item in sorted(set(broken)):
            report.fail(f"Referenced spine/artifact path does not exist: {item}")
    else:
        report.ok("Referenced paths in spine and optional artifacts exist")


def check_status_resurrection(
    root: Path, roles: dict[str, str], report: Report
) -> None:
    status = role_path(root, roles, "status")
    if not status.exists():
        report.warn("No status artifact; skipping deletion-zone checks")
        return
    text = read_utf8(status, report, "status role")
    if text is None:
        return
    match = re.search(
        r"(?:Deletion Zone|\u5220\u9664\u533a)(?P<body>.*?)(?:\n## |\Z)",
        text,
        re.DOTALL | re.IGNORECASE,
    )
    resurrected: list[str] = []
    if match:
        for value in CODE_PATH_RE.findall(match.group("body")):
            if plausible_code_path(value):
                resolved = resolve_within_root(root, root, value)
                if resolved is not None and resolved.exists():
                    resurrected.append(value)
    if resurrected:
        for value in sorted(set(resurrected)):
            report.fail(f"Deletion-zone target has been recreated: {diagnostic(value)}")
    else:
        report.ok("No deletion-zone targets were recreated")


def combined_history_events(
    active_path: Path, archive_path: Path, report: Report
) -> tuple[list[str], Counter[str]] | None:
    active_text = read_utf8(active_path, report, "history role")
    if active_text is None:
        return None
    archive_text = ""
    if archive_path.exists():
        loaded_archive = read_utf8(archive_path, report, "history_archive role")
        if loaded_archive is None:
            return None
        archive_text = loaded_archive
    active_events = event_contents(active_text)
    return active_events, Counter(active_events + event_contents(archive_text))


def previous_history_events(root: Path, roles: dict[str, str]) -> Counter[str]:
    previous_events: Counter[str] = Counter()
    for relative in (roles["history"], roles["history_archive"]):
        previous = git_show(root, relative)
        if previous is not None:
            previous_events.update(event_contents(previous))
    return previous_events


def check_derived_history_index(root: Path, report: Report) -> None:
    tracked = subprocess.run(
        ["git", "ls-files", "--error-unmatch", ".governance/project-log.sqlite"],
        cwd=root,
        text=True,
        capture_output=True,
        check=False,
    )
    if tracked.returncode == 0:
        report.fail(
            ".governance/project-log.sqlite is a derived index and must not be committed"
        )


def check_log(
    root: Path, roles: dict[str, str], report: Report, threshold: int
) -> None:
    active_path = role_path(root, roles, "history")
    archive_path = role_path(root, roles, "history_archive")
    if not active_path.exists():
        report.warn("No history artifact; skipping append-only integrity checks")
        return
    events = combined_history_events(active_path, archive_path, report)
    if events is None:
        return
    active_events, current_events = events
    missing = previous_history_events(root, roles) - current_events
    if missing:
        report.warn(
            f"{sum(missing.values())} working-tree history events differ from HEAD; confirm intentional correction or redaction"
        )
    else:
        report.ok("Active and archived history remain append-only when combined")
    if len(active_events) > threshold:
        report.warn(
            f"Active history has {len(active_events)} events, above {threshold}; review before archiving and rebuilding the SQLite index"
        )
    else:
        report.ok(
            f"Active history has {len(active_events)} events, within the {threshold} threshold"
        )
    check_derived_history_index(root, report)


def parse_adr_status(text: str) -> str | None:
    patterns = (
        r"(?im)^[-*]?\s*(?:status|\u72b6\u6001)\s*[:\uFF1A]\s*`?([a-z]+)`?\s*$",
        r"(?im)^##\s+(?:status|\u72b6\u6001)\s*\n+\s*`?([a-z]+)`?\s*$",
    )
    for pattern in patterns:
        match = re.search(pattern, text)
        if match:
            return match.group(1).lower()
    return None


def indexed_adr_paths(
    root: Path, index: Path, index_text: str, report: Report
) -> set[Path]:
    indexed: set[Path] = set()
    for raw in markdown_link_targets(index_text):
        target = normalize_link_target(raw)
        resolved = resolve_target(root, index, target) if target is not None else None
        if (
            target is not None
            and target.endswith(".md")
            and (resolved is None or not resolved.exists())
        ):
            report.fail(
                "ADR index link does not exist: "
                f"{diagnostic(index.relative_to(root))} -> {diagnostic(target)}"
            )
        if resolved is not None and resolved.suffix.lower() == ".md":
            indexed.add(resolved)
    return indexed


def collect_adr_sources(
    root: Path, adr_dir: Path, index: Path, report: Report
) -> dict[Path, str]:
    sources: dict[Path, str] = {}
    index_resolved = resolved_within_root(root, index)
    for path in sorted(adr_dir.glob("*.md")):
        resolved = resolved_within_root(root, path)
        if resolved is None:
            report.fail(
                "ADR source resolves outside the project root: "
                f"{diagnostic(path.relative_to(root))}"
            )
            continue
        if not resolved.is_file():
            report.fail(
                f"ADR source is not a regular file: {diagnostic(path.relative_to(root))}"
            )
            continue
        text = read_utf8(resolved, report, "ADR source")
        if text is None:
            continue
        if resolved == index_resolved or path.name.lower() == "template.md":
            continue
        sources[resolved] = text
    return sources


def report_unindexed_adrs(
    root: Path, sources: dict[Path, str], indexed_paths: set[Path], report: Report
) -> list[Path]:
    missing = [path for path in sources if path not in indexed_paths]
    for path in missing:
        report.fail(
            "ADR is missing from the canonical index: "
            f"{diagnostic(path.relative_to(root))}"
        )
    return missing


def check_adr_lifecycle(
    root: Path, adr_dir: Path, sources: dict[Path, str], report: Report
) -> bool:
    allowed = {"proposed", "accepted", "deprecated", "superseded"}
    statuses_supported = True
    for path, text in sources.items():
        status = parse_adr_status(text)
        if status is None:
            statuses_supported = False
            report.fail(
                f"ADR has no parseable status: {diagnostic(path.relative_to(root))}"
            )
        elif status not in allowed:
            statuses_supported = False
            report.fail(
                "ADR status is unsupported: "
                f"{diagnostic(path.relative_to(root))} -> {status}"
            )
        supersedes = re.search(
            r"(?ims)^##\s+Supersedes\s*\n(?P<body>.*?)(?:\n## |\Z)", text
        )
        if supersedes and supersedes.group("body").strip().lower() not in {
            "none",
            "\u65e0",
        }:
            targets = ADR_TARGET_RE.findall(supersedes.group("body"))
            if not targets:
                report.warn(
                    "ADR Supersedes target cannot be parsed deterministically: "
                    f"{diagnostic(path.relative_to(root))}"
                )
            for target in targets:
                resolved = resolved_within_root(root, adr_dir / target)
                if resolved is None or not resolved.is_file():
                    report.fail(
                        "ADR Supersedes target does not exist: "
                        f"{diagnostic(path.relative_to(root))} -> {target}"
                    )
    return statuses_supported


def check_adr(root: Path, roles: dict[str, str], report: Report) -> None:
    adr_dir = role_path(root, roles, "adr_dir")
    if not adr_dir.exists():
        report.warn("No ADR directory exists; create ADRs lazily for real decisions")
        return
    index = role_path(root, roles, "adr_index")
    if not index.exists():
        report.fail("ADR directory exists without a canonical README.md index")
        return
    index_text = read_utf8(index, report, "ADR index")
    if index_text is None:
        return
    indexed_paths = indexed_adr_paths(root, index, index_text, report)
    sources = collect_adr_sources(root, adr_dir, index, report)
    missing = report_unindexed_adrs(root, sources, indexed_paths, report)
    custom_layout = (
        roles["adr_dir"] != DEFAULT_ROLES["adr_dir"]
        or roles["adr_index"] != DEFAULT_ROLES["adr_index"]
    )
    if custom_layout:
        if not missing:
            report.ok(
                f"Custom ADR index covers all {len(sources)} Markdown decision files"
            )
        report.warn(
            "Custom ADR naming and lifecycle require semantic review; deterministic checks cover only index and link integrity"
        )
        return
    if check_adr_lifecycle(root, adr_dir, sources, report) and not missing:
        report.ok(f"ADR index covers all {len(sources)} decision files")


def check_test_ids(
    root: Path, roles: dict[str, str], files: list[Path], report: Report
) -> None:
    tests_file = role_path(root, roles, "tests")
    refs: set[str] = set()
    for path in files:
        parts = path.relative_to(root).parts
        if path == tests_file or any(
            section in parts
            for section in ("templates", "skills", "commands", "agents", "references")
        ):
            continue
        refs.update(
            value.upper()
            for value in TEST_ID_RE.findall(path.read_text(encoding="utf-8"))
        )
    refs.discard("TEST-ID")
    if not refs:
        report.ok("No cross-document TEST-ID references found")
        return
    if not tests_file.exists():
        report.warn(
            f"Found {len(refs)} TEST-ID references but no mapped test registry; review whether they are examples"
        )
        return
    tests_text = read_utf8(tests_file, report, "test registry")
    if tests_text is None:
        return
    defined = {value.upper() for value in TEST_ID_RE.findall(tests_text)}
    missing = refs - defined
    if missing:
        report.fail(
            "TEST-IDs are missing from the test registry: " + ", ".join(sorted(missing))
        )
    else:
        report.ok("All cross-document TEST-IDs resolve to the test registry")


def check_orphans(root: Path, files: list[Path], report: Report) -> None:
    candidates = [
        path
        for path in files
        if "docs" in path.relative_to(root).parts
        and "templates" not in path.relative_to(root).parts
        and path.name != "README.md"
    ]
    all_text = {path: path.read_text(encoding="utf-8") for path in files}
    orphans: list[str] = []
    for candidate in candidates:
        relative = candidate.relative_to(root).as_posix()
        if not any(
            path != candidate and (relative in text or candidate.name in text)
            for path, text in all_text.items()
        ):
            orphans.append(diagnostic(relative))
    if orphans:
        report.warn(
            "Possible orphan documents; review whether to link or archive: "
            + ", ".join(orphans)
        )
    else:
        report.ok("No possible orphan documents found under docs/")


def check_spine(
    root: Path, roles: dict[str, str], report: Report, threshold: int
) -> None:
    report.section("spine")
    for role in ("constitution", "map", "status", "history", "agents"):
        name = roles[role]
        if role_path(root, roles, role).exists():
            report.ok(f"{diagnostic(name)} exists ({role})")
        else:
            report.warn(
                f"{diagnostic(name)} is missing ({role}); this may be valid under progressive adoption"
            )
    check_spine_paths(root, roles, report)
    check_status_resurrection(root, roles, report)
    check_log(root, roles, report, threshold)


def check_context(root: Path, roles: dict[str, str], report: Report) -> None:
    report.section("context")
    context = role_path(root, roles, "context")
    if not context.exists():
        report.warn(
            "No context artifact; do not create an empty shell without stable domain language"
        )
        return
    report.ok(
        "Context artifact exists; terminology boundaries and code consistency require semantic review"
    )


def check_artifacts(root: Path, roles: dict[str, str], report: Report) -> None:
    report.section("artifacts")
    for role in ("contract", "tests", "regression"):
        if not role_path(root, roles, role).exists():
            report.warn(
                f"{diagnostic(roles[role])} is missing ({role}); this may be valid under progressive adoption"
            )
    files = markdown_files(root, report)
    check_markdown_links(root, files, report)
    check_test_ids(root, roles, files, report)
    check_orphans(root, files, report)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=Path.cwd())
    parser.add_argument(
        "--scope",
        choices=("spine", "context", "adr", "artifacts", "full"),
        default="full",
    )
    parser.add_argument("--log-threshold", type=int, default=200)
    args = parser.parse_args()

    root = args.root.resolve()
    if not root.is_dir():
        print(f"Not a directory: {diagnostic(root)}", file=sys.stderr)
        return 2
    report = Report()
    roles = load_roles(root, report)
    if args.scope in ("spine", "full"):
        check_spine(root, roles, report, args.log_threshold)
    if args.scope in ("context", "full"):
        check_context(root, roles, report)
    if args.scope in ("adr", "full"):
        report.section("adr")
        check_adr(root, roles, report)
    if args.scope in ("artifacts", "full"):
        check_artifacts(root, roles, report)

    print()
    if report.failures:
        print(
            f"✗ Deterministic audit failed with {report.failures} issue(s). Fix integrity errors before semantic review."
        )
        return 1
    print(
        "✓ Deterministic audit passed. Review warnings manually, then continue to semantic audit."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
