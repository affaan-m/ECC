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


def main() -> int:
    try:
        raw = sys.stdin.read()
        payload = json.loads(raw) if raw.strip() else {}
    except Exception:
        return 0  # unparseable payload never blocks

    tool = str(payload.get("tool_name") or "")
    if tool not in EDIT_TOOLS:
        return 0

    ti = payload.get("tool_input") or {}
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
        return 0

    for p in candidates:
        base = os.path.basename(p)
        if base in PROTECTED and os.path.exists(p):
            print(
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
            )
            return 0
    return 0


if __name__ == "__main__":
    sys.exit(main())