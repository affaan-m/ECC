#!/usr/bin/env python3
"""Validate the curated catalog, skill metadata, and local Markdown references."""

from pathlib import Path
import re
import sys
from urllib.parse import unquote, urlsplit

from install import ROOT, catalog


def validate(root=ROOT):
    data = catalog(root)
    errors = []
    names = {name for group in data["profiles"].values() for name in group}
    for name in sorted(names):
        entry = root / "skills" / name / "SKILL.md"
        text = entry.read_text(encoding="utf-8")
        frontmatter = text.split("---", 2)[1]
        fields = dict(line.split(":", 1) for line in frontmatter.strip().splitlines())
        if set(fields) != {"name", "description"}:
            errors.append(f"{entry}: expected name and description fields")
        description = fields.get("description", "").strip()
        if not 10 <= len(description) <= 1024 or ": " in description:
            errors.append(f"{entry}: description must be a concise YAML scalar")
        if len(text.splitlines()) > 200:
            errors.append(f"{entry}: entrypoint too large; review conditional reference routing")
    for path in sorted((root / "skills").rglob("*.md")):
        text = path.read_text(encoding="utf-8")
        if re.search(r"\.claude/|mcp__|\bTask\s*\(|INSTRUCTIONS FOR CLAUDE", text):
            errors.append(f"{path}: provider-specific tool or installation requirement")
        fence = None
        for line in text.splitlines():
            marker = re.match(r"\s*(`{3,}|~{3,})", line)
            if marker:
                char = marker.group(1)[0]
                fence = None if fence == char else char if fence is None else fence
                continue
            if fence:
                continue
            for link in re.findall(r"\[[^\]]+\]\(([^)]+)\)", line):
                url = urlsplit(link)
                if url.scheme or url.netloc or not url.path:
                    continue
                target = (path.parent / unquote(url.path)).resolve()
                if not target.is_relative_to(root.resolve()) or not target.exists():
                    errors.append(f"{path}: broken/outside local reference {link}")
    return names, errors


def main():
    try:
        names, errors = validate()
    except (OSError, ValueError, KeyError, TypeError) as error:
        print(f"error: {error}", file=sys.stderr)
        return 1
    if errors:
        print("\n".join(errors), file=sys.stderr)
        return 1
    print(f"Validated {len(names)} skills, profile catalog, and local Markdown references.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
