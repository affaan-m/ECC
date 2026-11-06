#!/usr/bin/env python3
"""
config-health — runtime configuration integrity monitoring for Claude Code.

Deterministic, read-only, non-blocking monitor. Complements delivery-gate:
delivery-gate blocks at session end (missing growth-log = not retroactively
fixable); config-health warns during the session (config drift = fixable).

Modes:
  --startup   SessionStart: audit hook wiring, rule references, guard staleness.
  --pretool   PreToolUse:   re-verify hook scripts exist and are wired.
              The audit runs on every call: "does this file exist" is a
              property of the settings files, not of the tool being run, so
              gating it on the tool class would trade a property we can prove
              (every call is verified) for one we cannot (a mutation is
              imminent). Measured on this repository's own 23 hook commands,
              the audit is 3.8 ms against a ~55 ms process, so there is
              nothing there to gate. The hook payload is drained and
              discarded, never parsed, never printed.
  --check     Manual:       tri-color health overview on stdout, plus the
              coverage counts for what was left unjudged.

Contract (from the ECC config-health skill):
  - read-only   — never writes to disk
  - non-blocking — always exits 0, even on malformed input
  - no leak      — --pretool never prints raw hook input, or a whole hook
                  command; only the one path it could not find
  - deterministic — the same settings files, the same CONFIG_HEALTH_*
                    environment and the same working directory give
                    byte-identical output. The working directory is in that
                    list because it is the fallback for an unset project dir.
                    What the findings depend on is listed under "Env inputs"
                    below; it is not the process environment.
  - asymmetric  — a path that cannot be built is skipped, not reported, and a
                  relative path is only reported when it is missing under
                  every audited root. The bias is deliberate and one-sided:
                  silence costs a missed check, a false warning costs the
                  user's trust in every other line this hook prints. Every
                  thing the monitor declines to judge is counted, and --check
                  prints the counts, because silence nobody can see is not a
                  verdict.

Env inputs (what the findings depend on, and nothing else):
  - the working directory — the fallback project dir when CLAUDE_PROJECT_DIR is
    unset, and the fallback user home when CONFIG_HEALTH_USER_HOME is unset
  - CONFIG_HEALTH_USER_HOME  — user home; also what `~` and $HOME resolve to
  - CLAUDE_CONFIG_DIR        — Claude data root; default <user_home>/.claude
  - CLAUDE_PROJECT_DIR       — project dir
  - CONFIG_HEALTH_PLUGIN_ROOT / CLAUDE_PLUGIN_ROOT — plugin root

Hook command placeholders:
  - $CLAUDE_PLUGIN_ROOT, $CLAUDE_PROJECT_DIR, $HOME and $USERPROFILE are
    expanded from an explicit allowlist, so a normal plugin install no longer
    reports every hook as referencing a missing script. Any other placeholder
    is left alone and the token is skipped — this monitor does not guess at
    provider-specific paths. A single-quoted placeholder is skipped too: the
    shell does not expand it, so no path can be built from it.
  - Only the result of a substitution is checked against the audited roots.
    A bare relative path is judged under every root instead, because a hook
    command does not say which directory it runs from.

Install: cp to ~/.claude/scripts/config-health.py
Wire (in your settings.json hooks — merge, don't replace):
  SessionStart:  python3 ~/.claude/scripts/config-health.py --startup
  PreToolUse:    optional, opt-in only: python3 .../config-health.py --pretool
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

# This monitor is read-only: importing its helper modules must not leave a
# __pycache__ directory inside the plugin install.
sys.dont_write_bytecode = True


# The helper modules are imported behind the same non-blocking contract as the
# rest of the script: a broken install (missing module) or an interpreter fault
# during import must exit 0 without a traceback, because a hook that crashes
# degrades the session it is meant to be watching.
try:
    from config_health_constants import (
        AUDIT_MISSING,
        AUDIT_OK,
        AUDIT_SKIP,
        MAX_PAYLOAD_DEPTH,
        MAX_REPORTED_PATH,
        MIN_TOOL_CALLS_FOR_CHECK,
        NON_RULE_KEYS,
        PLUGIN_ROOT_ENV,
        RULE_HEALTH_LOG,
        STALENESS_WINDOW,
        STDIN_DRAIN_LIMIT,
        WARN_PREFIX,
    )
    from config_health_paths import (
        _normalize,
        audit_roots,
        claude_data_dir,
        placeholder_env,
        read_json,
        read_text,
        resolve_dirs,
        resolve_script_path,
    )
    from config_health_scan import scan_command
except Exception:
    if __name__ == '__main__':
        sys.exit(0)
    raise



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


def audit_hook_wiring(settings, project_dir, user_home, env, stats=None):
    """Verify every script referenced by a hook command exists on disk.

    A referenced-but-missing script is a fact, not a heuristic — this is the
    core deterministic check. Never prints the full command (may hold secrets);
    only the missing path is reported.

    Anything this monitor declines to judge is counted in `stats` so `--check`
    can show it: a token carrying a placeholder we cannot resolve, a
    single-quoted one, a substituted path outside the audited roots, a command
    that could not be parsed at all, and a relative path satisfied only by a
    root other than the project. Silence is the right verdict for all of them —
    claiming a script is missing when the real problem is that we could not
    parse the command is what produces a false-warning flood, and a monitor
    whose WARN line is always red trains users to ignore it. Silence that is
    also invisible is not a verdict at all, which is what the counts are for.

    Args:
        settings (`dict`): A parsed settings.json.
        project_dir (`str`): Absolute project directory.
        user_home (`str`): Absolute user home directory.
        env (`dict`): Supported placeholder replacements.
        stats (`dict`): Optional counter dictionary, incremented in place.

    Returns:
        `list[str]`: One finding per missing script.
    """
    findings = []
    seen = set()
    roots = audit_roots(project_dir, user_home, env)
    project_norm = _normalize(project_dir)
    for event, command in iter_hook_commands(settings):
        tokens, unparsed, bodies, too_deep = scan_command(command)
        if stats is not None:
            if bodies:
                stats['bodies'] = stats.get('bodies', 0) + bodies
            if too_deep:
                stats['skipped'] = stats.get('skipped', 0) + 1
                stats['too_deep'] = stats.get('too_deep', 0) + 1
        if unparsed:
            if stats is not None:
                stats['skipped'] = stats.get('skipped', 0) + 1
                stats['unparsed'] = stats.get('unparsed', 0) + 1
            continue
        for token, single_quoted in tokens:
            paths, status, relative = resolve_script_path(
                token, project_dir, user_home, env, roots, single_quoted,
            )
            # Dedupe on the path we judged, not on the spelling: one missing
            # file referenced as both ${ROOT}/x.py and $ROOT/x.py is one
            # problem, and the two spellings are what a settings file drifts
            # into when a hook block is rewritten.
            key = (event, _dedupe_key(status, paths, token))
            if key in seen:
                continue
            seen.add(key)
            if status == AUDIT_SKIP:
                if stats is not None:
                    stats['skipped'] = stats.get('skipped', 0) + 1
                continue
            if status == AUDIT_OK and relative and stats is not None \
                    and _normalize(paths[0]) != project_norm:
                # A relative path satisfied only by a root other than the
                # project. Judged healthy, but a project-scoped hook that is
                # genuinely broken looks exactly like this, so the count is
                # what keeps the trade visible.
                stats['other_root'] = stats.get('other_root', 0) + 1
            if status == AUDIT_MISSING:
                findings.append(
                    'hook "%s" references missing script: %s'
                    % (event, _clip(token))
                )
    return findings


def _clip(token):
    """A path short enough to read, never a whole hook command."""
    if len(token) <= MAX_REPORTED_PATH:
        return token
    return token[:MAX_REPORTED_PATH] + '... (%d chars total)' % len(token)


def _dedupe_key(status, paths, raw):
    """Identity of a judged token, independent of how it was spelled."""
    if paths:
        return tuple(_normalize(p) for p in paths)
    return (raw, status)


def audit_rule_references(project_dir):
    """Verify rule files referenced by CLAUDE.md exist on disk.

    Rule paths may be nested: ECC installs rules under namespaced
    subdirectories such as `rules/ecc/common/security.md`, and a pattern that
    stopped at one path segment silently skipped every one of those.
    """
    findings = []
    for base in ('CLAUDE.md', os.path.join('.claude', 'CLAUDE.md')):
        content = read_text(os.path.join(project_dir, base))
        if content is None:
            continue
        for ref in re.finditer(
                r'(?:\.claude/)?rules/(?:[A-Za-z0-9_.-]+/)*[A-Za-z0-9_.-]+\.md',
                content):
            rel = ref.group(0)
            fp = os.path.join(project_dir, rel)
            if not os.path.exists(fp):
                findings.append(f'CLAUDE.md references missing rule file: {rel}')
    return findings


def audit_guard_staleness(claude_dir):
    """Flag rules that stopped firing in recent sessions.

    Only fires when a rule-health.jsonl log exists (written by the earlier
    Stop-hook monitor). No log → no staleness judgment (avoids false positives).
    The log lives under the Claude data root, not necessarily ~/.claude.
    """
    log_path = os.path.join(claude_dir, RULE_HEALTH_LOG)
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
        # Any positive count inside the window means the rule did fire in one
        # of the recent sessions — including a short session the complexity
        # filter leaves out of the judgment. Reporting "not fired in the last
        # five sessions" while a counter in one of those five is positive
        # sends the user to investigate a rule that worked.
        if any(rec.get(rule, 0) > 0 for rec in recent):
            continue
        findings.append(
            f'rule "{rule}" has not fired in the last '
            f'{STALENESS_WINDOW} sessions → may be dead'
        )
    return findings


def read_settings(path, stats=None, label='settings'):
    """Parse a settings file, distinguishing absent from unreadable.

    `read_json` collapses "not there" and "there but broken" into `None`. For
    a monitor that is the difference between "nothing to check" and "the one
    file whose contents decide the answer could not be read", and only the
    first of those is health.

    Returns:
        `tuple[dict | None, bool]`: The parsed settings, and whether the file
            existed but could not be parsed.
    """
    if not os.path.exists(path):
        return None, False
    parsed = read_json(path)
    # Readable JSON that is not a settings object is the same failure as
    # unparseable JSON: there are hooks in there we cannot see.
    if parsed is None or not isinstance(parsed, dict) \
            or ('hooks' in parsed and not isinstance(parsed['hooks'], dict)):
        if stats is not None:
            stats['unreadable'] = stats.get('unreadable', 0) + 1
            stats['unreadable_names'] = stats.get('unreadable_names', []) + [label]
        return None, True
    return parsed, False


def hook_sources(user_home, project_dir, env):
    """Every file that can declare a live hook, in the order Claude loads them.

    Settings are not the only source. Claude Code also loads
    `.claude/settings.local.json` (which wins over both settings files) and a
    plugin's own `hooks/hooks.json`, both of which run hooks no settings file
    mentions. Auditing only `settings.json` gives a missing script declared
    solely in one of those a clean report — the failure mode this monitor
    exists to catch.

    Args:
        user_home (`str`): Absolute user home.
        project_dir (`str`): Absolute project directory.
        env (`dict`): Placeholder environment from :func:`placeholder_env`.

    Returns:
        `list[tuple[str, str]]`: `(label, path)` pairs. A label is what
            `--check` prints when the file exists but cannot be parsed.
    """
    sources = [
        ('user', os.path.join(claude_data_dir(user_home), 'settings.json')),
        ('project', os.path.join(project_dir, '.claude', 'settings.json')),
        ('project-local',
         os.path.join(project_dir, '.claude', 'settings.local.json')),
    ]
    plugin_root = env.get(PLUGIN_ROOT_ENV)
    if plugin_root:
        sources.append(
            ('plugin', os.path.join(plugin_root, 'hooks', 'hooks.json')))
    return sources


def audit_hook_settings(user_home, project_dir, stats=None):
    """Run the hook-wiring audit over every hook source.

    Returns:
        `tuple[dict, list[str]]`: The placeholder environment, and findings.
    """
    env = placeholder_env(project_dir, user_home)
    findings = []
    claude_dir = claude_data_dir(user_home)
    # Each source may be absent or malformed — each is handled independently
    # and never blocks. A malformed file yields no findings (nothing to audit)
    # and is counted, rather than a crash or a silent clean verdict.
    for label, path in hook_sources(user_home, project_dir, env):
        settings, _ = read_settings(path, stats, label)
        if settings is not None:
            findings.extend(
                audit_hook_wiring(settings, project_dir, user_home, env, stats)
            )
    if stats is not None and env.get(PLUGIN_ROOT_ENV):
        stats['plugin_root'] = env[PLUGIN_ROOT_ENV]
    if stats is not None and os.environ.get('CLAUDE_CONFIG_DIR'):
        stats['claude_dir'] = claude_dir
    return env, findings


def run_startup_audit(user_home, project_dir, stats=None):
    """SessionStart audit: hook wiring + rule references + guard staleness."""
    claude_dir = claude_data_dir(user_home)
    _, findings = audit_hook_settings(user_home, project_dir, stats)
    findings.extend(audit_rule_references(project_dir))
    findings.extend(audit_guard_staleness(claude_dir))
    return findings


def run_hook_wiring_audit(user_home, project_dir, stats=None):
    """Just the hook-wiring half of the audit — the PreToolUse path."""
    return audit_hook_settings(user_home, project_dir, stats)[1]


def startup_mode():
    user_home, project_dir = resolve_dirs()
    findings = run_startup_audit(user_home, project_dir)
    for finding in findings:
        print(WARN_PREFIX + finding)
    # Non-blocking by contract: never gate on process monitoring.
    sys.exit(0)


def drain_stdin(limit=STDIN_DRAIN_LIMIT):
    """Read and discard at most `limit` characters of hook input.

    Nothing here is parsed and nothing here is printed. The drain exists so
    the harness's write is consumed instead of failing against a closed pipe.
    See STDIN_DRAIN_LIMIT for what this cap does and does not bound.
    """
    if sys.stdin is None:
        return
    try:
        sys.stdin.read(limit)
    except (OSError, ValueError, UnicodeDecodeError):
        pass


def pretool_mode():
    # The payload is drained, never parsed, never echoed. We need no field of
    # it: the wiring audit is a property of the settings files, not of the
    # call about to run, so it runs on every PreToolUse. Raw hook input
    # staying off stdout is enforced by the hook-contract tests.
    drain_stdin()

    user_home, project_dir = resolve_dirs()
    findings = run_hook_wiring_audit(user_home, project_dir)

    # PreToolUse keeps stdout clean — warnings go to stderr so a non-empty
    # stdout can never be misread as a block/allow decision.
    for finding in findings:
        print(WARN_PREFIX + finding, file=sys.stderr)
    sys.exit(0)


def check_mode():
    """Manual tri-color overview. Read-only."""
    user_home, project_dir = resolve_dirs()
    stats = {}
    findings = run_startup_audit(user_home, project_dir, stats)
    unreadable = stats.get('unreadable', 0)
    if findings:
        print('config-health: [warn] attention')
    elif unreadable:
        # "Nothing to report" is not the same as "healthy" when the file that
        # decides the answer could not be opened.
        print('config-health: [warn] incomplete — see below')
    else:
        print('config-health: [ok] normal — hook wiring, rules, and guards OK')
    for finding in findings:
        print('  ' + WARN_PREFIX + finding)

    _print_audit_counts(stats)
    sys.exit(0)


def _print_audit_counts(stats):
    """Print the counts behind a --check verdict."""
    # A monitor that decided not to look has to say so: unjudged paths are
    # otherwise indistinguishable from healthy ones, and a blind spot that
    # is invisible cannot be fixed. Printed here only, never per tool call.
    skipped = stats.get('skipped', 0)
    if skipped:
        print('config-health: [info] {} hook path(s) not audited — unresolved '
              'or single-quoted placeholder, a substituted path outside the '
              'audited roots, or a command that could not be parsed'
              .format(skipped))
    unparsed = stats.get('unparsed', 0)
    if unparsed:
        print('config-health: [info] {} hook command(s) have an unclosed quote '
              'and were not parsed at all'.format(unparsed))
    unreadable = stats.get('unreadable', 0)
    if unreadable:
        names = ', '.join(stats.get('unreadable_names', []))
        print('config-health: [warn] {} settings file(s) could not be read '
              '({}) — malformed JSON, a read error, or not an object. Their '
              'hooks were NOT audited; nothing below is a verdict about them.'
              .format(unreadable, names))
    too_deep = stats.get('too_deep', 0)
    if too_deep:
        print('config-health: [info] {} hook command(s) nested sh -c deeper '
              'than {} levels; the rest was still audited'
              .format(too_deep, MAX_PAYLOAD_DEPTH))
    bodies = stats.get('bodies', 0)
    if bodies:
        print('config-health: [info] {} interpreter program body/bodies were '
              'skipped unjudged — a node -e or python -c body is source in '
              'another language, so a file named inside one is not checked'
              .format(bodies))
    other_root = stats.get('other_root', 0)
    if other_root:
        print('config-health: [info] {} relative hook path(s) were satisfied '
              'by the user home or plugin root, not the project — a broken '
              'project-scoped hook is indistinguishable from a healthy '
              'plugin one here'.format(other_root))
    claude_dir = stats.get('claude_dir')
    if claude_dir:
        # Name the non-default root so a settings file the harness is not
        # loading is diagnosable instead of silently audited.
        print('config-health: [info] $CLAUDE_CONFIG_DIR resolved to '
              + claude_dir)
    plugin_root = stats.get('plugin_root')
    if plugin_root:
        # With more than one plugin installed, the provider's
        # CLAUDE_PLUGIN_ROOT is the running plugin's, so a settings line wired
        # for another plugin is judged against this directory. Naming it is
        # what makes a wrong-root false positive diagnosable.
        print('config-health: [info] $CLAUDE_PLUGIN_ROOT resolved to '
              + plugin_root)


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
    try:
        main()
    except SystemExit:
        raise
    except Exception:
        # "non-blocking — always exits 0" is the contract, and a hook that
        # raises degrades the very session it is meant to be watching. The
        # realistic triggers are a closed stdin and a deleted cwd; both are
        # environmental, not configuration faults, and neither is worth a
        # traceback in someone's terminal.
        sys.exit(0)
