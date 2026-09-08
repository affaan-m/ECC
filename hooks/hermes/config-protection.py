#!/usr/bin/env python3
"""
Hermes native hook (ported from ECC's scripts/hooks/config-protection.js).

pre_tool_call guard: BLOCK edits to existing linter/formatter config files.
Agents under pressure weaken configs to make checks pass instead of fixing
the source; this hook forces the fix to land in code.

Contract (agent/shell_hooks.py):
  stdin  : JSON payload  {"hook_event_name":"pre_tool_call","tool_name":"...",
                          "tool_input": {...}}
  stdout : JSON {"decision":"block","reason":...} to block, nothing to allow
  exit   : 0 always (we speak JSON, not exit codes)

Blocks ONLY file-editing tools, ONLY when the target already exists on disk.
Creating a config from scratch is allowed (new project), and so is reading.

Error handling: the hook is fail-open BY DESIGN (a broken hook must not
brick the agent), but it never fails silently — every swallowed path writes
a one-line diagnostic to stderr.
"""
import json
import os
import sys

PROTECTED = {
    ".eslintrc", ".eslintrc.js", ".eslintrc.cjs", ".eslintrc.json", ".eslintrc.yml", ".eslintrc.yaml",
    "eslint.config.js", "eslint.config.mjs", "eslint.config.cjs", "eslint.config.ts",
    "eslint.config.mts", "eslint.config.cts",
    ".prettierrc", ".prettierrc.js", ".prettierrc.cjs", ".prettierrc.json", ".prettierrc.yml", ".prettierrc.yaml",
    "prettier.config.js", "prettier.config.cjs", "prettier.config.mjs",
    "biome.json", "biome.jsonc", ".ruff.toml", "ruff.toml", ".shellcheckrc",
    ".stylelintrc", ".stylelintrc.json", ".stylelintrc.yml",
    ".markdownlint.json", ".markdownlint.yaml", ".markdownlintrc",
    # Aarogya ratchets — same class of "weaken the check instead of fixing code"
    "lint-ratchet-baseline.json",
}

EDIT_TOOLS = {"patch", "write_file", "edit", "write", "apply_patch", "str_replace_editor"}


def _warn(msg: str) -> None:
    sys.stderr.write(f"[ecc-config-protection] {msg}\n")


def main() -> int:
    raw = sys.stdin.read()
    try:
        payload = json.loads(raw) if raw.strip() else {}
        if not isinstance(payload, dict):
            _warn(f"payload is {type(payload).__name__}, not an object — allowing")
            return 0
    except ValueError as exc:
        _warn(f"unparseable payload ({exc}) — allowing")
        return 0  # unparseable payload never blocks

    tool = str(payload.get("tool_name") or "")
    if tool not in EDIT_TOOLS:
        return 0

    ti = payload.get("tool_input") or {}
    if not isinstance(ti, dict):
        _warn("tool_input is not an object — allowing")
        return 0
    # Every Hermes/CLI editing tool puts the target somewhere obvious.
    candidates = []
    for key in ("path", "file_path", "filePath", "target", "filename", "notebook_path"):
        v = ti.get(key)
        if isinstance(v, str) and v.strip():
            candidates.append(v.strip())
    for k in ("edits", "operations"):
        seq = ti.get(k)
        if isinstance(seq, list):
            for item in seq:
                if isinstance(item, dict):
                    for key in ("path", "file_path", "filePath"):
                        v = item.get(key)
                        if isinstance(v, str) and v.strip():
                            candidates.append(v.strip())
    if not candidates:
        _warn(f"no path found in tool_input for tool {tool!r} — allowing")
        return 0

    for p in candidates:
        # Case-insensitive filesystems (macOS default, Windows) resolve
        # ESLINT.CONFIG.JS to the protected eslint.config.js; compare the
        # basename lowercased so a case variant cannot slip past.
        base = os.path.basename(p)
        if base.lower() in PROTECTED:
            # os.path.exists() is False for a dangling symlink, yet editing
            # tools happily follow/replace the link target — use lstat so a
            # dangling symlink to a protected name still counts as existing.
            try:
                os.lstat(p)
                exists = True
            except OSError:
                exists = False
            if exists:
                sys.stdout.write(
                    json.dumps(
                        {
                            "decision": "block",
                            "reason": (
                                f"BLOCKED: modifying {base} is not allowed. Fix the source code so the "
                                "linter/formatter passes instead of weakening the config. For a legitimate "
                                "config change, ask the owner to edit it directly."
                            ),
                        }
                    )
                    + "\n"
                )
                return 0
    return 0


if __name__ == "__main__":
    sys.exit(main())