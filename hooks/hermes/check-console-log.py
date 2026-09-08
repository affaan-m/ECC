#!/usr/bin/env python3
"""
Hermes native hook (ported from ECC's scripts/hooks/check-console-log.js).

post_tool_call observer: after any file edit, WARN (never block) when the
edited file now contains console.log(). Print to stderr only — Hermes shows
hook stderr as a warning line.

Contract (agent/shell_hooks.py):
  stdin : JSON payload {"hook_event_name":"post_tool_call","tool_name":"...",
                        "tool_input":{...},"tool_result":{...}}
  exit  : 0 (observer, no stdout JSON)
"""
import json
import os
import re
import sys

EDIT_TOOLS = {"patch", "write_file", "edit", "write", "apply_patch", "str_replace_editor"}
EXCLUDE = re.compile(r"(\.d\.ts$|/__tests?__/|\.test\.[tj]sx?$|\.spec\.[tj]sx?$|/scripts/|console-safety)")


def main() -> int:
    try:
        raw = sys.stdin.read()
        payload = json.loads(raw) if raw.strip() else {}
    except Exception:
        return 0

    tool = str(payload.get("tool_name") or "")
    if tool not in EDIT_TOOLS:
        return 0

    ti = payload.get("tool_input") or {}
    path = None
    for key in ("path", "file_path", "filePath", "target"):
        v = ti.get(key)
        if isinstance(v, str) and v.strip():
            path = v.strip()
            break
    if not path or not os.path.isfile(path):
        return 0
    if not re.search(r"\.[tj]sx?$", path) or EXCLUDE.search(path):
        return 0

    try:
        with open(path, "r", errors="replace") as f:
            content = f.read()
    except OSError:
        return 0

    if "console.log(" in content:
        sys.stderr.write(
            f"[hook] console.log() present in {path} — remove it before committing "
            "(use the project logger instead)."
        )
    return 0


if __name__ == "__main__":
    sys.exit(main())