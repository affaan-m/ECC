#!/usr/bin/env python3
"""文档治理确定性审计：先报告可机械证明的断链与完整性问题。"""

from __future__ import annotations

import argparse
from pathlib import Path
import re
import subprocess
import sys
from urllib.parse import unquote


SPINE = ("CLAUDE.md", "CLAUDE_MAP.md", "PROJECT_STATUS.md", "PROJECT_LOG.md")
OPTIONAL_CARRIERS = ("AGENTS.md", "CONTEXT.md", "CONTRACT.md", "TESTS.md", "REGRESSION.md")
ENTRY_RE = re.compile(
    r"^## \[(?P<date>\d{4}-\d{2}-\d{2})\]\s+(?P<type>[^|\n]+?)\s*\|\s*(?P<summary>[^\n]+)$",
    re.MULTILINE,
)
MARKDOWN_LINK_RE = re.compile(r"\[[^\]]*\]\(([^)]+)\)")
CODE_PATH_RE = re.compile(r"`([^`\n]+)`")
TEST_ID_RE = re.compile(r"\bTEST-[A-Z0-9][A-Z0-9-]*\b", re.IGNORECASE)
ADR_FILE_RE = re.compile(r"^\d{4}-[a-z0-9-]+\.md$")
ADR_TARGET_RE = re.compile(r"\b\d{4}-[a-z0-9-]+\.md\b")
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


def markdown_files(root: Path) -> list[Path]:
    result: list[Path] = []
    for path in root.rglob("*.md"):
        relative = path.relative_to(root)
        if any(part in IGNORED_DIRS for part in relative.parts):
            continue
        result.append(path)
    return sorted(result)


def event_contents(text: str) -> list[str]:
    matches = list(ENTRY_RE.finditer(text))
    result: list[str] = []
    for index, match in enumerate(matches):
        end = matches[index + 1].start() if index + 1 < len(matches) else len(text)
        result.append(text[match.start() : end].strip())
    return result


def git_show(root: Path, relative: str) -> str | None:
    command = subprocess.run(
        ["git", "show", f"HEAD:{relative}"],
        cwd=root,
        text=True,
        capture_output=True,
        check=False,
    )
    return command.stdout if command.returncode == 0 else None


def normalize_link_target(raw: str) -> str | None:
    target = raw.strip().split(maxsplit=1)[0].strip("<>")
    target = unquote(target.split("#", 1)[0])
    if not target or target.startswith(("#", "http://", "https://", "mailto:", "tel:", "data:")):
        return None
    return target


def resolve_target(root: Path, source: Path, target: str) -> Path:
    if target.startswith("/"):
        return Path(target)
    return (source.parent / target).resolve()


def check_markdown_links(root: Path, files: list[Path], report: Report) -> None:
    broken: list[str] = []
    for source in files:
        if "templates" in source.relative_to(root).parts:
            continue
        text = source.read_text(encoding="utf-8")
        for raw in MARKDOWN_LINK_RE.findall(text):
            target = normalize_link_target(raw)
            if target is None:
                continue
            resolved = resolve_target(root, source, target)
            if not resolved.exists():
                broken.append(f"{source.relative_to(root)} -> {target}")
    if broken:
        for item in sorted(set(broken)):
            report.fail(f"Markdown 链接断裂：{item}")
    else:
        report.ok("Markdown 本地链接无断链")


def plausible_code_path(value: str) -> bool:
    if any(marker in value for marker in IGNORED_REFERENCE_MARKERS):
        return False
    if any(character.isspace() for character in value):
        return False
    if value.startswith(("http://", "https://", "$", ".governance/")):
        return False
    if re.fullmatch(r"/[a-z0-9-]+", value):
        return False
    return "/" in value or value.endswith((".md", ".py", ".sh", ".json", ".yaml", ".yml"))


def check_spine_paths(root: Path, report: Report) -> None:
    broken: list[str] = []
    for name in ("CLAUDE.md", "CLAUDE_MAP.md") + OPTIONAL_CARRIERS:
        source = root / name
        if not source.exists():
            continue
        for value in CODE_PATH_RE.findall(source.read_text(encoding="utf-8")):
            if not plausible_code_path(value):
                continue
            candidate = Path(value)
            resolved = candidate if candidate.is_absolute() else root / candidate
            if not resolved.exists():
                broken.append(f"{name} -> {value}")
    if broken:
        for item in sorted(set(broken)):
            report.fail(f"脊柱/载体路径不存在：{item}")
    else:
        report.ok("脊柱与可选载体中的路径引用存在")


def check_status_resurrection(root: Path, report: Report) -> None:
    status = root / "PROJECT_STATUS.md"
    if not status.exists():
        report.warn("缺少 PROJECT_STATUS.md，跳过删除区检查")
        return
    text = status.read_text(encoding="utf-8")
    match = re.search(r"删除区(?P<body>.*?)(?:\n## |\Z)", text, re.DOTALL)
    resurrected: list[str] = []
    if match:
        for value in CODE_PATH_RE.findall(match.group("body")):
            if plausible_code_path(value) and (root / value).exists():
                resurrected.append(value)
    if resurrected:
        for value in sorted(set(resurrected)):
            report.fail(f"删除区目标已复活：{value}")
    else:
        report.ok("删除区无复活")


def check_log(root: Path, report: Report, threshold: int) -> None:
    active_path = root / "PROJECT_LOG.md"
    archive_path = root / "PROJECT_LOG.archive.md"
    if not active_path.exists():
        report.warn("缺少 PROJECT_LOG.md，跳过历史完整性检查")
        return

    active_text = active_path.read_text(encoding="utf-8")
    archive_text = archive_path.read_text(encoding="utf-8") if archive_path.exists() else ""
    active_events = event_contents(active_text)
    current_events = set(active_events + event_contents(archive_text))
    previous_events: set[str] = set()
    for relative in ("PROJECT_LOG.md", "PROJECT_LOG.archive.md"):
        previous = git_show(root, relative)
        if previous is not None:
            previous_events.update(event_contents(previous))
    missing = previous_events - current_events
    if missing:
        report.fail(f"PROJECT_LOG 历史有 {len(missing)} 条被删除或改写，且未原样进入归档")
    else:
        report.ok("PROJECT_LOG 活跃文件与归档合并后保持只追加")

    if len(active_events) > threshold:
        report.warn(
            f"PROJECT_LOG 活跃事件 {len(active_events)} 条，超过 {threshold}；应先复盘，再归档并重建 SQLite 索引"
        )
    else:
        report.ok(f"PROJECT_LOG 活跃事件 {len(active_events)} 条，未超过 {threshold}")

    tracked = subprocess.run(
        ["git", "ls-files", "--error-unmatch", ".governance/project-log.sqlite"],
        cwd=root,
        text=True,
        capture_output=True,
        check=False,
    )
    if tracked.returncode == 0:
        report.fail(".governance/project-log.sqlite 是派生索引，不应提交进 git")


def parse_adr_status(text: str) -> str | None:
    patterns = (
        r"(?im)^[-*]?\s*(?:status|状态)\s*[:：]\s*`?([a-z]+)`?\s*$",
        r"(?im)^##\s+(?:status|状态)\s*\n+\s*`?([a-z]+)`?\s*$",
    )
    for pattern in patterns:
        match = re.search(pattern, text)
        if match:
            return match.group(1).lower()
    return None


def check_adr(root: Path, report: Report) -> None:
    adr_dir = root / "docs" / "adr"
    if not adr_dir.exists():
        report.warn("docs/adr/ 尚未创建；ADR 按实际决策懒创建")
        return
    index = adr_dir / "README.md"
    if not index.exists():
        report.fail("docs/adr/ 存在但缺少 README.md 统一索引")
        return
    index_text = index.read_text(encoding="utf-8")
    for raw in MARKDOWN_LINK_RE.findall(index_text):
        target = normalize_link_target(raw)
        if target is not None and target.endswith(".md") and not resolve_target(root, index, target).exists():
            report.fail(f"ADR 索引链接不存在：docs/adr/README.md -> {target}")
    adr_files = sorted(path for path in adr_dir.glob("*.md") if ADR_FILE_RE.match(path.name))
    missing_from_index = [path.name for path in adr_files if path.name not in index_text]
    for name in missing_from_index:
        report.fail(f"ADR 未登记到统一索引：docs/adr/{name}")

    allowed = {"proposed", "accepted", "deprecated", "superseded"}
    for path in adr_files:
        text = path.read_text(encoding="utf-8")
        status = parse_adr_status(text)
        if status is None:
            report.fail(f"ADR 缺少可解析状态：{path.relative_to(root)}")
        elif status not in allowed:
            report.fail(f"ADR 状态不受支持：{path.relative_to(root)} -> {status}")
        supersedes = re.search(r"(?ims)^##\s+Supersedes\s*\n(?P<body>.*?)(?:\n## |\Z)", text)
        if supersedes and supersedes.group("body").strip().lower() not in {"none", "无"}:
            targets = ADR_TARGET_RE.findall(supersedes.group("body"))
            if not targets:
                report.warn(f"ADR Supersedes 无法机械解析，需人工核对：{path.relative_to(root)}")
            for target in targets:
                if not (adr_dir / target).exists():
                    report.fail(f"ADR Supersedes 目标不存在：{path.relative_to(root)} -> {target}")
    if not missing_from_index and all(parse_adr_status(path.read_text(encoding="utf-8")) in allowed for path in adr_files):
        report.ok(f"ADR 索引与 {len(adr_files)} 个决策文件一致")


def check_test_ids(root: Path, files: list[Path], report: Report) -> None:
    tests_file = root / "TESTS.md"
    refs: set[str] = set()
    for path in files:
        parts = path.relative_to(root).parts
        if path == tests_file or any(
            section in parts for section in ("templates", "skills", "commands", "agents", "references")
        ):
            continue
        refs.update(value.upper() for value in TEST_ID_RE.findall(path.read_text(encoding="utf-8")))
    refs.discard("TEST-ID")
    if not refs:
        report.ok("未发现跨文档 TEST-ID 引用")
        return
    if not tests_file.exists():
        report.warn(f"发现 {len(refs)} 个具体 TEST-ID 引用，但项目未启用 TESTS.md；需人工判断是否只是方案示例")
        return
    defined = {value.upper() for value in TEST_ID_RE.findall(tests_file.read_text(encoding="utf-8"))}
    missing = refs - defined
    if missing:
        report.fail("TEST-ID 未在 TESTS.md 登记：" + ", ".join(sorted(missing)))
    else:
        report.ok("跨文档 TEST-ID 均可回到 TESTS.md")


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
            orphans.append(relative)
    if orphans:
        report.warn("疑似孤儿文档（需人工判断挂索引或归档）：" + ", ".join(orphans))
    else:
        report.ok("docs/ 下未发现疑似孤儿文档")


def check_spine(root: Path, report: Report, threshold: int) -> None:
    report.section("spine · 脊柱")
    for name in SPINE:
        if (root / name).exists():
            report.ok(f"{name} 存在")
        else:
            report.warn(f"{name} 缺失（渐进采用时可能合理）")
    check_spine_paths(root, report)
    check_status_resurrection(root, report)
    check_log(root, report, threshold)


def check_context(root: Path, report: Report) -> None:
    report.section("context · 领域上下文")
    context = root / "CONTEXT.md"
    if not context.exists():
        report.warn("CONTEXT.md 未创建；没有稳定领域词汇时无需补空壳")
        return
    report.ok("CONTEXT.md 存在；术语边界与代码一致性留给语义层判断")


def check_artifacts(root: Path, report: Report) -> None:
    report.section("artifacts · 产物链接")
    files = markdown_files(root)
    check_markdown_links(root, files, report)
    check_test_ids(root, files, report)
    check_orphans(root, files, report)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=Path.cwd())
    parser.add_argument("--scope", choices=("spine", "context", "adr", "artifacts", "full"), default="full")
    parser.add_argument("--log-threshold", type=int, default=200)
    args = parser.parse_args()

    root = args.root.resolve()
    if not root.is_dir():
        print(f"不是目录：{root}", file=sys.stderr)
        return 2
    report = Report()
    if args.scope in ("spine", "full"):
        check_spine(root, report, args.log_threshold)
    if args.scope in ("context", "full"):
        check_context(root, report)
    if args.scope in ("adr", "full"):
        report.section("adr · 决策记录")
        check_adr(root, report)
    if args.scope in ("artifacts", "full"):
        check_artifacts(root, report)

    print()
    if report.failures:
        print(f"✗ 确定性审计失败：{report.failures} 项。先修断链，再进入语义审计。")
        return 1
    print("✓ 确定性审计通过；警告项需人工判断，可继续语义审计。")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
