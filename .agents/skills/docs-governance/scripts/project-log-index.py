#!/usr/bin/env python3
"""为 PROJECT_LOG.md 构建可重建索引，并在明确确认后归档旧事件。"""

from __future__ import annotations

import argparse
import hashlib
import os
from pathlib import Path
import re
import sqlite3
import tempfile
from dataclasses import dataclass


ENTRY_RE = re.compile(
    r"^## \[(?P<date>\d{4}-\d{2}-\d{2})\]\s+(?P<type>[^|\n]+?)\s*\|\s*(?P<summary>[^\n]+)$",
    re.MULTILINE,
)
PATH_RE = re.compile(r"`([^`\n]+/[^`\n]+)`")
TEST_RE = re.compile(r"\bTEST-[A-Z0-9][A-Z0-9-]*\b", re.IGNORECASE)
COMMIT_RE = re.compile(r"(?<![0-9a-f])(?:[0-9a-f]{7,40})(?![0-9a-f])", re.IGNORECASE)
ADR_RE = re.compile(r"(?:docs/adr/\d{4}-[a-z0-9-]+\.md|\bADR-?\d{4}\b)", re.IGNORECASE)
CONTRACT_RE = re.compile(r"\bCONTRACT\.md\b", re.IGNORECASE)
ARCHIVE_NOTE = "> 历史归档见 `PROJECT_LOG.archive.md`；`.governance/project-log.sqlite` 只是可重建索引。"
ARCHIVE_PREAMBLE = "# PROJECT_LOG.archive.md —— 历史归档（原始事件，只追加）\n\n"


@dataclass(frozen=True)
class Entry:
    event_date: str
    event_type: str
    summary: str
    content: str
    source_file: str
    source_line: int

    @property
    def entry_hash(self) -> str:
        return hashlib.sha256(self.content.encode("utf-8")).hexdigest()


def parse_entries(text: str, source_file: str) -> tuple[str, list[Entry]]:
    matches = list(ENTRY_RE.finditer(text))
    if not matches:
        return text.rstrip() + "\n", []

    preamble = text[: matches[0].start()].rstrip() + "\n"
    entries: list[Entry] = []
    for index, match in enumerate(matches):
        end = matches[index + 1].start() if index + 1 < len(matches) else len(text)
        content = text[match.start() : end].strip() + "\n"
        entries.append(
            Entry(
                event_date=match.group("date"),
                event_type=match.group("type").strip().lower(),
                summary=match.group("summary").strip(),
                content=content,
                source_file=source_file,
                source_line=text.count("\n", 0, match.start()) + 1,
            )
        )
    return preamble, entries


def load_entries(path: Path) -> tuple[str, list[Entry]]:
    if not path.exists():
        return "", []
    return parse_entries(path.read_text(encoding="utf-8"), path.name)


def deduplicate(entries: list[Entry]) -> list[Entry]:
    seen: set[str] = set()
    result: list[Entry] = []
    for entry in entries:
        if entry.entry_hash in seen:
            continue
        seen.add(entry.entry_hash)
        result.append(entry)
    return result


def infer_module(entry: Entry) -> str:
    explicit = re.search(r"(?:module|模块)\s*[:=]\s*([\w.-]+)", entry.content, re.IGNORECASE)
    if explicit:
        return explicit.group(1)
    path = PATH_RE.search(entry.content)
    if path:
        parts = Path(path.group(1)).parts
        return "/".join(parts[:2]) if len(parts) > 1 else parts[0]
    return "unclassified"


def extract_refs(entry: Entry) -> list[tuple[str, str]]:
    refs: set[tuple[str, str]] = set()
    for value in COMMIT_RE.findall(entry.content):
        refs.add(("commit", value.lower()))
    for value in TEST_RE.findall(entry.content):
        refs.add(("test", value.upper()))
    for value in ADR_RE.findall(entry.content):
        refs.add(("adr", value))
    for value in CONTRACT_RE.findall(entry.content):
        refs.add(("contract", value))
    for value in PATH_RE.findall(entry.content):
        if not any(marker in value for marker in ("*", "{", "}")):
            refs.add(("path", value))
    return sorted(refs)


def build_database(path: Path, entries: list[Entry]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    handle, temp_name = tempfile.mkstemp(prefix=f".{path.name}.", dir=path.parent)
    os.close(handle)
    temp_path = Path(temp_name)
    try:
        connection = sqlite3.connect(temp_path)
        with connection:
            connection.executescript(
                """
                CREATE TABLE events (
                    entry_hash TEXT PRIMARY KEY,
                    event_date TEXT NOT NULL,
                    event_type TEXT NOT NULL,
                    summary TEXT NOT NULL,
                    module TEXT NOT NULL,
                    source_file TEXT NOT NULL,
                    source_line INTEGER NOT NULL
                );
                CREATE TABLE event_refs (
                    entry_hash TEXT NOT NULL,
                    ref_type TEXT NOT NULL,
                    ref_value TEXT NOT NULL,
                    PRIMARY KEY (entry_hash, ref_type, ref_value),
                    FOREIGN KEY (entry_hash) REFERENCES events(entry_hash)
                );
                CREATE INDEX events_by_date_type ON events(event_date, event_type);
                CREATE INDEX events_by_module ON events(module);
                """
            )
            for entry in deduplicate(entries):
                connection.execute(
                    "INSERT INTO events VALUES (?, ?, ?, ?, ?, ?, ?)",
                    (
                        entry.entry_hash,
                        entry.event_date,
                        entry.event_type,
                        entry.summary,
                        infer_module(entry),
                        entry.source_file,
                        entry.source_line,
                    ),
                )
                connection.executemany(
                    "INSERT INTO event_refs VALUES (?, ?, ?)",
                    [(entry.entry_hash, ref_type, value) for ref_type, value in extract_refs(entry)],
                )
        connection.close()
        os.replace(temp_path, path)
    finally:
        temp_path.unlink(missing_ok=True)


def atomic_write(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    handle, temp_name = tempfile.mkstemp(prefix=f".{path.name}.", dir=path.parent)
    temp_path = Path(temp_name)
    try:
        with os.fdopen(handle, "w", encoding="utf-8") as stream:
            stream.write(content)
        os.replace(temp_path, path)
    finally:
        temp_path.unlink(missing_ok=True)


def render(preamble: str, entries: list[Entry]) -> str:
    body = "\n".join(entry.content.rstrip() for entry in entries)
    return preamble.rstrip() + "\n\n" + body + ("\n" if body else "")


def command_status(active: list[Entry], threshold: int) -> None:
    state = "超过阈值，应建立结构化归档/索引" if len(active) > threshold else "未超过阈值"
    print(f"PROJECT_LOG 事件数：{len(active)}；阈值：{threshold}；{state}。")


def command_rebuild(database: Path, archive: list[Entry], active: list[Entry]) -> None:
    entries = deduplicate(archive + active)
    build_database(database, entries)
    print(f"已重建 {database}：{len(entries)} 条事件。")


def command_archive(
    log_path: Path,
    archive_path: Path,
    database: Path,
    preamble: str,
    active: list[Entry],
    archive_preamble: str,
    archived: list[Entry],
    threshold: int,
    keep: int,
    confirmed: bool,
) -> None:
    if len(active) <= threshold:
        print(f"PROJECT_LOG 只有 {len(active)} 条事件，未超过阈值 {threshold}，无需归档。")
        return
    if not confirmed:
        raise SystemExit("归档会改写活跃 LOG 的事件集合；请经用户确认后加 --yes。")
    if keep < 1 or keep >= len(active):
        raise SystemExit("--keep 必须大于 0 且小于当前事件数。")

    moved = active[:-keep]
    recent = active[-keep:]
    merged_archive = deduplicate(archived + moved)
    if ARCHIVE_NOTE not in preamble:
        preamble = preamble.rstrip() + "\n" + ARCHIVE_NOTE + "\n"
    if not archive_preamble.strip():
        archive_preamble = ARCHIVE_PREAMBLE

    active_content = render(preamble, recent)
    archive_content = render(archive_preamble, merged_archive)
    before_log = log_path.read_bytes()
    before_archive = archive_path.read_bytes() if archive_path.exists() else None

    try:
        atomic_write(archive_path, archive_content)
        atomic_write(log_path, active_content)
        _, stored_archive = load_entries(archive_path)
        _, stored_active = load_entries(log_path)
        command_rebuild(database, stored_archive, stored_active)
    except Exception:
        atomic_write(log_path, before_log.decode("utf-8"))
        if before_archive is None:
            archive_path.unlink(missing_ok=True)
        else:
            atomic_write(archive_path, before_archive.decode("utf-8"))
        raise

    print(f"已归档 {len(moved)} 条，活跃 LOG 保留最近 {len(recent)} 条。")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=("status", "rebuild", "archive"), nargs="?", default="status")
    parser.add_argument("--root", type=Path, default=Path.cwd())
    parser.add_argument("--threshold", type=int, default=200)
    parser.add_argument("--keep", type=int, default=100)
    parser.add_argument("--yes", action="store_true", help="确认执行归档")
    args = parser.parse_args()

    root = args.root.resolve()
    log_path = root / "PROJECT_LOG.md"
    archive_path = root / "PROJECT_LOG.archive.md"
    database = root / ".governance" / "project-log.sqlite"
    if not log_path.exists():
        raise SystemExit(f"缺少 {log_path}")

    preamble, active = load_entries(log_path)
    archive_preamble, archived = load_entries(archive_path)
    if args.action == "status":
        command_status(active, args.threshold)
    elif args.action == "rebuild":
        command_rebuild(database, archived, active)
    else:
        command_archive(
            log_path,
            archive_path,
            database,
            preamble,
            active,
            archive_preamble,
            archived,
            args.threshold,
            args.keep,
            args.yes,
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
