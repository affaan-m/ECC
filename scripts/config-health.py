#!/usr/bin/env python3
"""
config-health — runtime configuration integrity monitoring for Claude Code.

Deterministic, read-only, non-blocking monitor. Complements delivery-gate:
delivery-gate blocks at session end (missing growth-log = not retroactively
fixable); config-health warns during the session (config drift = fixable).

Modes:
  --startup   SessionStart: audit hook wiring, rule references, guard staleness.
  --pretool   PreToolUse:   re-verify matched hook scripts exist and are wired.
              Reads tool_use JSON on stdin but NEVER echoes it to stdout.
  --check     Manual:       tri-color health overview on stdout.

Contract (from the ECC config-health skill):
  - read-only   — never writes to disk
  - non-blocking — always exits 0, even on malformed input
  - no leak      — --pretool never prints raw hook input, commands, or secrets
  - deterministic — same inputs → same findings (missing script = fact, not heuristic)

Config path resolution:
  - user settings:   $CONFIG_HEALTH_USER_HOME/.claude/settings.json
                     (defaults to ~/.claude/settings.json)
  - project settings: $CLAUDE_PROJECT_DIR/.claude/settings.json
                     (defaults to <cwd>/.claude/settings.json)

Install: cp to ~/.claude/scripts/config-health.py
Wire (in your settings.json hooks — merge, don't replace):
  SessionStart:  python3 ~/.claude/scripts/config-health.py --startup
  PreToolUse:    python3 ~/.claude/scripts/config-health.py --pretool
"""
from __future__ import annotations

import json
import os
import re
import sys

# Windows GBK console can't encode emoji — force UTF-8 on stdout/stderr.
# This script's warnings may be captured by hook logs, so reconfigure to
# prevent UnicodeEncodeError on non-UTF-8 consoles.
try:
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    sys.stderr.reconfigure(encoding='utf-8', errors='replace')
except (AttributeError, OSError):
    pass  # Python <3.7 or stdout is not a TTY/stream


WARN_PREFIX = '[config-health] WARN: '

# Sessions of rule-health history to look back for guard staleness.
STALENESS_WINDOW = 5
# Minimum tool calls for a session to be "complex enough" to expect rule markers.
MIN_TOOL_CALLS_FOR_CHECK = 5
# Rule-health log written by the earlier Stop-hook monitor (read-only here).
RULE_HEALTH_LOG = '.claude/session-data/rule-health.jsonl'
# Metadata keys in each rule-health record, not rule counters.
NON_RULE_KEYS = {'ts', 'date', 'time', 'tool_calls', 'edits'}

# Matches a script path in a hook command: ~/.claude/scripts/x.py, scripts/x.js,
# C:/path/x.py, ./hooks/x.py. Misses inline shell one-liners, which is fine —
# we only audit references that look like files on disk.
SCRIPT_TOKEN = re.compile(r'([^\s"\']+\.(?:py|js|mjs|cjs|sh))')


def resolve_dirs():
    """Return (user_home, project_dir) honoring env overrides for determinism."""
    user_home = os.environ.get('CONFIG_HEALTH_USER_HOME') or os.path.expanduser('~')
    project_dir = os.environ.get('CLAUDE_PROJECT_DIR') or os.getcwd()
    return user_home, project_dir


def read_text(path):
    """Read a file defensively; return None on any read/decode error."""
    if not os.path.exists(path):
        return None
    try:
        with open(path, 'r', encoding='utf-8') as f:
            return f.read()
    except (OSError, UnicodeDecodeError):
        return None


def read_json(path):
    """Parse a JSON file defensively; return None if missing or malformed."""
    text = read_text(path)
    if text is None:
        return None
    try:
        return json.loads(text)
    except (ValueError, TypeError):
        return None


def resolve_script_path(raw, project_dir):
    """Turn a token from a hook command into an absolute path.

    `~` resolves against CONFIG_HEALTH_USER_HOME when set (the same override
    used for the user settings path), else the real home — so tests stay
    deterministic without affecting real users.
    """
    if raw.startswith('~'):
        override = os.environ.get('CONFIG_HEALTH_USER_HOME')
        if override:
            return os.path.join(override, raw[1:].lstrip('/\\'))
        return os.path.expanduser(raw)
    if os.path.isabs(raw):
        return raw
    return os.path.join(project_dir, raw)


def iter_hook_commands(settings):
    """Yield (event, command) for every command hook in a parsed settings.json.

    Handles both the grouped form
      {"hooks": {"PreToolUse": [{"matcher": "...", "hooks": [{"command": ...}]}]}}
    and the flat form
      {"hooks": {"PreToolUse": [{"command": ...}]}}.
    """
    if not isinstance(settings, dict):
        return
    hooks = settings.get('hooks')
    if not isinstance(hooks, dict):
        return
    for event, groups in hooks.items():
        if not isinstance(groups, list):
            continue
        for group in groups:
            if not isinstance(group, dict):
                continue
            inner = group.get('hooks')
            if isinstance(inner, list):
                for hook in inner:
                    if isinstance(hook, dict) and isinstance(hook.get('command'), str):
                        yield event, hook['command']
            elif isinstance(group.get('command'), str):
                yield event, group['command']


def audit_hook_wiring(settings, project_dir):
    """Verify every script referenced by a hook command exists on disk.

    A referenced-but-missing script is a fact, not a heuristic — this is the
    core deterministic check. Never prints the full command (may hold secrets);
    only the missing path is reported.
    """
    findings = []
    for event, command in iter_hook_commands(settings):
        for token in SCRIPT_TOKEN.findall(command):
            path = resolve_script_path(token, project_dir)
            if not os.path.exists(path):
                findings.append(
                    f'hook "{event}" references missing script: {token}'
                )
    return findings


def audit_rule_references(project_dir):
    """Verify rule files referenced by CLAUDE.md exist on disk."""
    findings = []
    for base in ('CLAUDE.md', os.path.join('.claude', 'CLAUDE.md')):
        content = read_text(os.path.join(project_dir, base))
        if content is None:
            continue
        for ref in re.finditer(r'(?:\.claude/)?rules/[A-Za-z0-9_.-]+\.md', content):
            rel = ref.group(0)
            fp = os.path.join(project_dir, rel)
            if not os.path.exists(fp):
                findings.append(f'CLAUDE.md references missing rule file: {rel}')
    return findings


def audit_guard_staleness(user_home):
    """Flag rules that stopped firing in recent sessions.

    Only fires when a rule-health.jsonl log exists (written by the earlier
    Stop-hook monitor). No log → no staleness judgment (avoids false positives).
    """
    log_path = os.path.join(user_home, RULE_HEALTH_LOG)
    content = read_text(log_path)
    if content is None:
        return []

    records = []
    for line in content.splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            records.append(json.loads(line))
        except (ValueError, TypeError):
            continue
    if not records:
        return []

    recent = records[-STALENESS_WINDOW:]
    if len(recent) < STALENESS_WINDOW:
        return []  # Not enough history yet

    rule_keys = set()
    for rec in recent:
        rule_keys.update(k for k in rec if k not in NON_RULE_KEYS)

    findings = []
    for rule in sorted(rule_keys):
        complex_sessions = [
            rec for rec in recent if rec.get('tool_calls', 0) >= MIN_TOOL_CALLS_FOR_CHECK
        ]
        if not complex_sessions:
            continue
        if all(rec.get(rule, 0) == 0 for rec in complex_sessions):
            findings.append(
                f'rule "{rule}" last fired {STALENESS_WINDOW}+ sessions ago → may be dead'
            )
    return findings


def run_startup_audit(user_home, project_dir):
    """SessionStart audit: hook wiring + rule references + guard staleness."""
    findings = []

    user_settings = read_json(os.path.join(user_home, '.claude', 'settings.json'))
    project_settings = read_json(os.path.join(project_dir, '.claude', 'settings.json'))

    # Both settings may be absent or malformed — each is handled independently
    # and never blocks. A malformed file yields no findings (nothing to audit)
    # rather than a crash.
    if user_settings is not None:
        findings.extend(audit_hook_wiring(user_settings, project_dir))
    if project_settings is not None:
        findings.extend(audit_hook_wiring(project_settings, project_dir))

    findings.extend(audit_rule_references(project_dir))
    findings.extend(audit_guard_staleness(user_home))

    return findings


def startup_mode():
    user_home, project_dir = resolve_dirs()
    findings = run_startup_audit(user_home, project_dir)
    for finding in findings:
        print(WARN_PREFIX + finding)
    # Non-blocking by contract: never gate on process monitoring.
    sys.exit(0)


def pretool_mode():
    # Consume tool_use JSON without ever writing it to stdout. We only need the
    # fact that a hook fired, not its contents. Raw hook input / secrets are
    # never echoed — enforced by the hook-contract tests.
    sys.stdin.read()

    user_home, project_dir = resolve_dirs()
    findings = []

    user_settings = read_json(os.path.join(user_home, '.claude', 'settings.json'))
    project_settings = read_json(os.path.join(project_dir, '.claude', 'settings.json'))
    if user_settings is not None:
        findings.extend(audit_hook_wiring(user_settings, project_dir))
    if project_settings is not None:
        findings.extend(audit_hook_wiring(project_settings, project_dir))

    # PreToolUse keeps stdout clean — warnings go to stderr so a non-empty
    # stdout can never be misread as a block/allow decision.
    for finding in findings:
        print(WARN_PREFIX + finding, file=sys.stderr)
    sys.exit(0)


def check_mode():
    """Manual tri-color overview. Read-only."""
    user_home, project_dir = resolve_dirs()
    findings = run_startup_audit(user_home, project_dir)
    if findings:
        print('config-health: [warn] attention')
        for finding in findings:
            print('  ' + WARN_PREFIX + finding)
    else:
        print('config-health: [ok] normal — hook wiring, rules, and guards OK')
    sys.exit(0)


def main():
    args = sys.argv[1:]
    if '--pretool' in args:
        pretool_mode()
    elif '--check' in args:
        check_mode()
    else:
        # --startup (also the default): least surprising for a SessionStart hook.
        startup_mode()


if __name__ == '__main__':
    main()
