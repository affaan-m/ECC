#!/usr/bin/env python3
"""index_repo.py — 为大型仓库生成 code-map.json（模块 / 依赖 / 符号定位）。

repo-mastery 在 Phase 0 判定仓库为大型时运行本脚本。输出一个轻量代码索引，
让学习会话可以按"文件:行"按需定位源码，而不用把整仓塞进上下文。

纯标准库实现，无第三方依赖。定位粒度是"模块边界 + 依赖边 + 入口点"，
不做完整语法树 —— 那是 tree-sitter 的事，对这个 skill 是过度设计。

用法:
    python3 index_repo.py <repo_path> [-o code-map.json] [--top N]

输出:
    code-map.json —— 结构见下方 SCHEMA 常量。
"""

from __future__ import annotations

import argparse
import json
import os
import re
from collections import Counter

# 目录/文件黑名单：绝不进索引（避免把依赖、构建产物、版本库扫进来）。
SKIP_DIRS = {
    ".git", ".hg", ".svn", "node_modules", "vendor", ".venv", "venv",
    "__pycache__", ".next", ".nuxt", "dist", "build", "target", "out",
    ".idea", ".vscode", ".gradle", "coverage", ".tox", ".mypy_cache",
    ".pytest_cache", ".ruff_cache", "site-packages", "bower_components",
}
SKIP_FILES = {"package-lock.json", "yarn.lock", "pnpm-lock.yaml", "poetry.lock", "Cargo.lock"}

# 语言 → 扩展名集合。只统计这些"源文件"，其余（图片/文档/二进制）不进统计。
LANG_EXTS: dict[str, set[str]] = {
    "python": {".py", ".pyi"},
    "typescript": {".ts", ".tsx"},
    "javascript": {".js", ".jsx", ".mjs", ".cjs"},
    "rust": {".rs"},
    "go": {".go"},
    "java": {".java"},
    "kotlin": {".kt", ".kts"},
    "c": {".c", ".h"},
    "cpp": {".cpp", ".cc", ".hpp", ".hxx", ".cxx"},
    "ruby": {".rb"},
    "php": {".php"},
    "swift": {".swift"},
    "shell": {".sh", ".bash", ".zsh"},
    "sql": {".sql"},
    "vue": {".vue"},
    "svelte": {".svelte"},
}

# 各语言的"本地模块/依赖"提取正则（保守，只抓明显的相对导入）。
# 组 1 = 被导入的路径。匹配相对导入（以 . 开头）或项目内顶层模块。
IMPORT_PATTERNS: dict[str, re.Pattern] = {
    "python": re.compile(r"^\s*(?:from\s+([.\w]+)\s+import|import\s+([.\w]+))", re.M),
    "typescript": re.compile(r"(?:import\s+(?:[\w*{},\s]+\s+from\s+)?|from\s+)['\"]([^'\"]+)['\"]"),
    "javascript": re.compile(r"(?:import\s+(?:[\w*{},\s]+\s+from\s+)?|require\s*\(\s*)['\"]([^'\"]+)['\"]"),
    "go": re.compile(r"^\s*\"([^\"]+)\"|^\s*[a-z0-9_]+\s+\"([^\"]+)\"", re.M),
    "rust": re.compile(r"^\s*(?:use\s+|mod\s+|pub\s+use\s+)([^\s;]+)", re.M),
    "java": re.compile(r"^\s*import\s+([.\w]+);", re.M),
    "kotlin": re.compile(r"^\s*import\s+([.\w]+)", re.M),
    "c": re.compile(r"^\s*#\s*include\s*[<\"]([^>\"]+)[>\"]", re.M),
    "cpp": re.compile(r"^\s*#\s*include\s*[<\"]([^>\"]+)[>\"]", re.M),
}


def classify(rel_path: str) -> str | None:
    """按扩展名返回语言名，非源文件返回 None。"""
    ext = os.path.splitext(rel_path)[1].lower()
    for lang, exts in LANG_EXTS.items():
        if ext in exts:
            return lang
    return None


def is_skip_dir(name: str) -> bool:
    return name in SKIP_DIRS or name.startswith(".")


def scan(repo: str, top: int) -> dict:
    """扫描仓库，返回 code-map 字典。"""
    by_lang: Counter = Counter()
    by_topdir: Counter = Counter()
    files: list[dict] = []
    imports: dict[str, list[str]] = {}
    entry_points: list[str] = []
    total_lines = 0

    for dirpath, dirnames, filenames in os.walk(repo):
        # 原地过滤黑名单目录，避免继续下探。
        dirnames[:] = [d for d in dirnames if not is_skip_dir(d)]
        for fname in filenames:
            if fname in SKIP_FILES:
                continue
            full = os.path.join(dirpath, fname)
            rel = os.path.relpath(full, repo)
            lang = classify(rel)
            if lang is None:
                continue
            try:
                with open(full, "r", encoding="utf-8", errors="ignore") as fh:
                    content = fh.read()
            except OSError:
                continue
            line_count = content.count("\n") + 1
            total_lines += line_count
            by_lang[lang] += 1
            topdir = rel.split(os.sep)[0]
            by_topdir[topdir] += 1
            files.append({"path": rel, "lang": lang, "lines": line_count})

            # 提取依赖边。
            pat = IMPORT_PATTERNS.get(lang)
            if pat:
                deps = []
                for m in pat.finditer(content):
                    dep = m.group(1) or m.group(2)
                    if dep:
                        deps.append(dep)
                imports[rel] = deps[:40]  # 单文件最多记 40 条，防失控

    # 探测入口点（常见约定）。
    entry_points = detect_entry_points(repo)

    # 顶层目录统计（前 top 名）。
    topdirs = [{"name": k, "files": v} for k, v in by_topdir.most_common(top)]

    # 依赖图只保留"项目内"边（相对导入 或 与某顶层目录同名的模块），
    # 外部包/标准库不进入图 —— 图的目的是看模块间耦合，不是依赖清单。
    internal = {d["path"] for d in files}
    topdir_set = {d["name"] for d in topdirs}
    graph: dict[str, list[str]] = {}
    for src, deps in imports.items():
        kept = []
        for dep in deps:
            d = dep.lstrip(".")
            d = d.split("/")[0].split(".")[0]
            if d in internal or d in topdir_set or d in {"src", "lib"}:
                kept.append(d)
        if kept:
            graph[src] = sorted(set(kept))

    return {
        "repo": os.path.basename(os.path.abspath(repo)),
        "generated": True,
        "summary": {
            "total_source_files": len(files),
            "total_lines": total_lines,
            "languages": dict(by_lang.most_common()),
            "top_dirs": topdirs,
        },
        "entry_points": entry_points,
        "dependency_graph": graph,          # 仅项目内边
        "files": files,                     # 未排序；tutor 可按 lines 降序取最重文件
        "symbol_lookup": build_symbol_lookup(files),  # 语言 → 重文件清单
    }


def detect_entry_points(repo: str) -> list[str]:
    """常见入口约定：package.json bin/main、pyproject 脚本、main.* 等。"""
    found: list[str] = []

    pkg = os.path.join(repo, "package.json")
    if os.path.isfile(pkg):
        try:
            with open(pkg, encoding="utf-8") as fh:
                data = json.load(fh)
        except Exception:
            data = {}
        for key in ("bin", "main"):
            val = data.get(key)
            if isinstance(val, str):
                found.append(f"package.json/{key}: {val}")
            elif isinstance(val, dict):
                for name, path in list(val.items())[:10]:
                    found.append(f"package.json/bin.{name}: {path}")

    for name in ("pyproject.toml", "setup.py"):
        if os.path.isfile(os.path.join(repo, name)):
            found.append(f"{name}（含入口脚本配置，见内容）")

    for pattern in ("main.py", "app.py", "cli.py", "manage.py"):
        if os.path.isfile(os.path.join(repo, pattern)):
            found.append(pattern)

    return found


def build_symbol_lookup(files: list[dict]) -> dict[str, list[str]]:
    """为最重的文件生成"符号级定位提示"：语言 → 可能含定义的重文件清单。

    不做语法分析，启发式足够：tutor 拿到清单后再 Read 对应文件精确定位。
    按行数降序取每语言前 30 个文件，供 map 阶段优先审视。
    """
    buckets: dict[str, list[tuple[int, str]]] = {}
    for f in files:
        if f["lines"] < 60:
            continue
        buckets.setdefault(f["lang"], []).append((f["lines"], f["path"]))
    return {
        lang: [p for _, p in sorted(items, reverse=True)[:30]]
        for lang, items in buckets.items()
    }


def main() -> None:
    ap = argparse.ArgumentParser(description="生成 repo-mastery 的代码索引 code-map.json")
    ap.add_argument("repo", help="要索引的仓库路径")
    ap.add_argument("-o", "--output", default="code-map.json", help="输出文件路径")
    ap.add_argument("--top", type=int, default=15, help="顶层目录统计数量")
    args = ap.parse_args()

    code_map = scan(args.repo, args.top)
    tmp = args.output + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(code_map, fh, ensure_ascii=False, indent=2)
    os.replace(tmp, args.output)  # 原子写，避免半成品
    s = code_map["summary"]
    print(f"已生成 {args.output}")
    print(f"  源文件 {s['total_source_files']} 个，共 {s['total_lines']} 行")
    print(f"  语言: {', '.join(f'{k}({v})' for k, v in s['languages'].items())}")
    print(f"  顶层目录: {', '.join(d['name'] for d in s['top_dirs'])}")
    print(f"  入口点: {', '.join(code_map['entry_points'][:5]) or '未探测到'}")


if __name__ == "__main__":
    main()
