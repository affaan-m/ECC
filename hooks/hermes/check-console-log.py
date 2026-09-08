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

Error handling: fail-open by design (observers must not brick the agent),
but never silent — every swallowed path writes a one-line stderr diagnostic.
"""
import json
import os
import re
import sys

EDIT_TOOLS = {"patch", "write_file", "edit", "write", "apply_patch", "str_replace_editor"}
EXCLUDE = re.compile(r"(\.d\.ts$|/__tests?__/|\.test\.[tj]sx?$|\.spec\.[tj]sx?$|/scripts/|console-safety)")


def _warn(msg: str) -> None:
    sys.stderr.write(f"[ecc-check-console-log] {msg}\n")


def main() -> int:
    raw = sys.stdin.read()
    try:
        payload = json.loads(raw) if raw.strip() else {}
        if not isinstance(payload, dict):
            _warn(f"payload is {type(payload).__name__}, not an object — skipping")
            return 0
    except ValueError as exc:
        _warn(f"unparseable payload ({exc}) — skipping")
        return 0

    tool = str(payload.get("tool_name") or "")
    if tool not in EDIT_TOOLS:
        return 0

    ti = payload.get("tool_input") or {}
    if not isinstance(ti, dict):
        _warn("tool_input is not an object — skipping")
        return 0
    path = None
    for key in ("path", "file_path", "filePath", "target"):
        v = ti.get(key)
        if isinstance(v, str) and v.strip():
            path = v.strip()
            break
    if not path:
        _warn(f"no path found in tool_input for tool {tool!r} — skipping")
        return 0
    if not re.search(r"\.[tj]sx?$", path) or EXCLUDE.search(path):
        return 0
    if not os.path.isfile(path):
        _warn(f"{path} is not a regular file on disk — skipping")
        return 0

    try:
        with open(path, "r", errors="replace") as f:
            content = f.read()
    except OSError as exc:
        _warn(f"could not read {path} ({exc.strerror or exc}) — skipping")
        return 0

    if "console.log(" in content:
        _warn(
            f"console.log() present in {path} — remove it before committing "
            "(use the project logger instead)."
        )
    return 0


if __name__ == "__main__":
    sys.exit(main())