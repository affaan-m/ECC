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


WARN_PREFIX = '[config-health] WARN: '

# Sessions of rule-health history to look back for guard staleness.
STALENESS_WINDOW = 5
# Minimum tool calls for a session to be "complex enough" to expect rule markers.
MIN_TOOL_CALLS_FOR_CHECK = 5
# Rule-health log written by the earlier Stop-hook monitor (read-only here).
# Relative to the Claude data root, which is CLAUDE_CONFIG_DIR or ~/.claude.
RULE_HEALTH_LOG = 'session-data/rule-health.jsonl'
# Metadata keys in each rule-health record, not rule counters.
NON_RULE_KEYS = {'ts', 'date', 'time', 'tool_calls', 'edits'}

# Matches a script path inside one shell word: ~/.claude/scripts/x.py,
# scripts/x.js, C:/path/x.py, ./hooks/x.py, ${CLAUDE_PLUGIN_ROOT}/hooks/x.js.
# Applied per shell word (see _split_shell_words) rather than to the raw
# command, so a quoted path containing a space stays one token.
#
# The trailing lookahead is load-bearing. Without it `archive.js.bak` matches
# as `archive.js`, and the monitor warns about a file that does not exist
# while the file the shell actually opens does.
SCRIPT_TOKEN = re.compile(
    r'([^\s"\']+\.(?:py|js|mjs|cjs|sh))(?![A-Za-z0-9_.~-])'
)

# A quoted shell word that ends in a script extension is one argument
# verbatim, spaces included: "C:\Program Files\ecc\hooks\guard.py". Spaces
# inside it are part of the path, not separators.
WHOLE_WORD_SCRIPT_RE = re.compile(r'[^"\']*\.(?:py|js|mjs|cjs|sh)\Z')

# A finding never quotes a whole command. The whole-word rule above can pick
# up an argument that is itself a command line, and a hook command can be
# very long; a monitor that prints 200KB of somebody's settings file has
# stopped being a monitor.
MAX_REPORTED_PATH = 160

# $NAME / ${NAME} in a hook command.
PLACEHOLDER_RE = re.compile(r'\$\{?([A-Za-z_][A-Za-z0-9_]*)\}?')

# Interpreters whose -e / -c argument is a program body rather than a script
# path. The two kinds of payload are not the same thing:
#   - a shell's -c payload is a command line, so it is scanned again as one
#   - a node/python -e payload is source in another language, where a string
#     is a string: p.join(r,'scripts/hooks/x.js') is assembled at runtime and
#     is not a file the shell will open
SHELL_INTERPRETERS = frozenset(('sh', 'bash', 'zsh'))
JS_INTERPRETERS = frozenset((
    'node', 'nodejs', 'python', 'python3', 'pythonw', 'py',
))
INTERPRETERS = SHELL_INTERPRETERS | JS_INTERPRETERS

# Long and short spellings of "the next word is a program body", plus the
# bundled short forms a shell accepts (`bash -lc "..."`).
PROGRAM_FLAG_LONG = frozenset(('--eval', '--command'))
# Options of the interpreters above whose value is the *next* word. Without
# these, `bash -o pipefail -c "..."` orphans the -c: pipefail looks like a
# command, so the payload after it is read as a path and the whole hook body
# gets printed as a missing file.
OPTION_TAKES_NEXT_WORD = frozenset(('-o', '-O', '-W', '-X', '--options'))
SHELL_SEPARATORS = (';', '&&', '||', '|', '&', '\n')

# A backslash only escapes what a shell would let it escape. Everything else
# after a backslash is literal, because on Windows — where this script also
# runs — a backslash is a path separator, not an escape. Notably absent: `\\`
# (a UNC prefix is two backslashes, not an escaped one), `$` and a backtick
# (C:\$Recycle.Bin is a directory, not an escape).
ESCAPABLE_BACKSLASH = frozenset((' ', '\t', '"', "'", ';', '&', '|',
                                 '<', '>', '(', ')'))

# How deep a `sh -c "sh -c ..."` chain is followed before giving up. A command
# nested past this is not something a settings file should contain, and an
# unbounded recursion on attacker-shaped input is worse than a missed check.
MAX_PAYLOAD_DEPTH = 3

# Root of the installed plugin, when running from a plugin install. Claude Code
# sets this for plugin-style hooks; it is the only provider placeholder this
# monitor resolves, because every other placeholder is provider-specific and
# guessing at it would turn a real signal into a false warning.
PLUGIN_ROOT_ENV = 'CLAUDE_PLUGIN_ROOT'

# Pin the plugin root explicitly. The provider sets CLAUDE_PLUGIN_ROOT to the
# root of the plugin that is *running*, so with more than one plugin installed
# a settings line wired for a different one is judged against the wrong
# directory. One value cannot describe two plugins; this override is the
# honest escape hatch, and --check names the root it used.
PLUGIN_ROOT_OVERRIDE_ENV = 'CONFIG_HEALTH_PLUGIN_ROOT'

# Cap on hook input we are willing to drain. This is a bound on bytes buffered,
# not on time: sys.stdin.read(n) returns on n characters or EOF, whichever
# comes first, so a hook that hangs is stopped by the `timeout` in its wiring,
# not by this cap.
STDIN_DRAIN_LIMIT = 64 * 1024

# audit_hook_wiring verdicts.
AUDIT_OK = 'ok'          # at least one candidate path exists
AUDIT_MISSING = 'missing'  # no candidate path exists — report the token
AUDIT_SKIP = 'skip'      # no path could be built — say nothing


def _split_shell_words(command):
    """Split `command` into (word, single_quoted) pairs, POSIX-quote aware.

    A hook command is a shell command line, so a path containing a space has
    to survive as one word. Splitting naively on whitespace turns
    ``python3 "C:\\Program Files\\ecc\\hooks\\guard.py"`` into the token
    ``Files\\ecc\\hooks\\guard.py``, which does not exist — a false alarm
    manufactured by the tokenizer.

    Args:
        command (`str`): A raw hook command.

    Returns:
        `list[tuple[str, bool, bool]] | None`: Each shell word, whether any
            part of it was quoted (a quoted word is one argument verbatim,
            spaces included), and whether any part of it was single-quoted (a
            single-quoted placeholder is not expanded by the shell, so it
            cannot be resolved from here). `None` when a quote is left open:
            the command is not parseable as written, and what a broken quote
            swallows next is a guess.
    """
    words = []
    chars = []
    quote = None
    started = False
    quoted = False
    single = False
    i = 0
    length = len(command)
    while i < length:
        ch = command[i]
        if quote == "'":
            if ch == "'":
                quote = None
            else:
                chars.append(ch)
        elif quote == '"':
            if ch == '\\' and i + 1 < length \
                    and command[i + 1] in ESCAPABLE_BACKSLASH:
                chars.append(command[i + 1])
                i += 1
            elif ch == '"':
                quote = None
            else:
                chars.append(ch)
        elif ch in '\'"':
            quote = ch
            quoted = True
            single = single or ch == "'"
            started = True
        elif ch.isspace():
            if started:
                words.append((''.join(chars), quoted, single))
            chars = []
            quoted = False
            single = False
            started = False
        elif ch == '\\' and i + 1 < length \
                and command[i + 1] in ESCAPABLE_BACKSLASH:
            chars.append(command[i + 1])
            started = True
            i += 1
        else:
            chars.append(ch)
            started = True
        i += 1
    if quote is not None:
        return None
    if started:
        words.append((''.join(chars), quoted, single))
    return words


def _is_interpreter(word):
    """Whether `word` names a shell interpreter rather than a file."""
    name = word.replace('\\', '/').rsplit('/', 1)[-1].lower()
    return name in INTERPRETERS


def _is_program_flag(word, shell):
    """Whether `word` is an option whose next word is a program body.

    Covers the long spellings, the plain short ones, and the bundled short
    forms a shell accepts — `bash -lc "..."` is the same thing as `bash -c
    "..."` and used to be read as two ordinary words.

    The letter is interpreter-specific, and getting it wrong is a false
    warning: `sh -e script.sh` is errexit, not a program body, so treating `-e`
    as one hides the script the shell will run.
    """
    if word in PROGRAM_FLAG_LONG:
        return True
    if word.startswith('--') or not word.startswith('-') or len(word) < 2:
        return False
    wanted = 'c' if shell else 'e'
    return wanted in word[1:]


def _is_separator(word):
    """Whether `word` contains a shell command separator."""
    return any(sep in word for sep in SHELL_SEPARATORS)


def scan_command(command, depth=0):
    """Return (tokens, unparsed, bodies, too_deep) for `command`.

    `tokens` is a list of (token, single_quoted). `unparsed` is True when the
    command could not be split as written — an unclosed quote. `bodies` counts
    the interpreter program bodies that were skipped: source in another
    language, where this monitor cannot tell a path from a string, so nothing
    inside was judged. `too_deep` is True when a `sh -c` chain went past
    `MAX_PAYLOAD_DEPTH`; the tokens found before that point are still returned,
    because a missing script on the outer command does not stop being one.

    Every reason this function declines to judge something is returned rather
    than swallowed, because `--check` prints the counts and a silent drop with
    no count is the failure this whole design is built against.

    Three things need more than a regex over the raw command:

    - a quoted word is one argument verbatim, so a path with a space in it has
      to be taken whole rather than cut at the space;
    - an interpreter's program body is not a script path. A shell's `-c`
      payload is itself a command line and is scanned again; a `node -e` or
      `python -c` payload is source in another language, where a string is a
      string — `p.join(r,'scripts/hooks/x.js')` is assembled at runtime and is
      not a file anything will open, so it is skipped;
    - a backslash only escapes what a shell would let it escape. Treating
      every backslash as an escape turns `C:\\Users\\me\\guard.py` into
      `C:Usersmeguard.py`, which is a false alarm on the platform this script
      is developed on.

    Args:
        command (`str`): A raw hook command.
        depth (`int`): Current `sh -c` nesting.

    Returns:
        `tuple[list[tuple[str, bool]], bool, int, bool]`: The tokens, whether
            the command was unparseable, how many program bodies were skipped,
            and whether nesting ran out.
    """
    words = _split_shell_words(command)
    if words is None:
        return [], True, 0, False

    tokens = []
    bodies = 0
    too_deep = False
    index = 0
    total = len(words)
    interpreter = None
    option_arg = False
    while index < total:
        word, quoted, single = words[index]
        # A separator only separates when the shell can see it. Inside quotes
        # it is part of the name, and `python3 "weird;name.py"` is a file.
        if not quoted and _is_separator(word):
            interpreter = None
            option_arg = False
            index += 1
            continue
        if _is_interpreter(word):
            interpreter = word
            option_arg = False
            index += 1
            continue
        if interpreter and _is_program_flag(word, _is_shell_interpreter(interpreter)):
            if quoted:
                # The body is glued to the flag, as in `node -e"..."`. Nothing
                # after this word belongs to the program, and nothing inside
                # it was judged — so it counts like any other skipped body.
                bodies += 1
                index += 1
                continue
            payload_at = index + 1
            payload = words[payload_at][0] if payload_at < total else None
            payload_quoted = words[payload_at][1] if payload_at < total else False
            if payload is None:
                index = total
                continue
            if _is_shell_interpreter(interpreter):
                if depth >= MAX_PAYLOAD_DEPTH:
                    # Too deep to follow. Counted, and the tokens collected
                    # so far are kept — a missing script on the outer command
                    # is still a missing script. Reported as its own thing,
                    # not as an unclosed quote, which it is not.
                    return tokens, False, bodies, True
                # A shell payload is a command line: scan it again rather
                # than hide a real reference behind the -c.
                if payload_quoted:
                    sub, sub_unparsed, sub_bodies, sub_deep = scan_command(
                        payload, depth + 1)
                    if sub_unparsed:
                        return tokens, True, bodies, too_deep
                    tokens.extend(sub)
                    bodies += sub_bodies
                    too_deep = too_deep or sub_deep
                    index = payload_at + 1
                    continue
                chunk = []
                cursor = payload_at
                while cursor < total and not _is_separator(words[cursor][0]):
                    chunk.append(words[cursor][0])
                    cursor += 1
                sub, sub_unparsed, sub_bodies, sub_deep = scan_command(
                    ' '.join(chunk), depth + 1)
                if sub_unparsed:
                    return tokens, True, bodies, too_deep
                tokens.extend(sub)
                bodies += sub_bodies
                too_deep = too_deep or sub_deep
                index = cursor
                continue
            # Source in another language: skip the body. Quoted, that is one
            # word; unquoted, the shell hands node every word up to the next
            # separator as the program, so all of them go. Counted, because
            # nothing inside it was judged and `--check` should say so.
            bodies += 1
            if not payload_quoted:
                while payload_at < total \
                        and not _is_separator(words[payload_at][0]):
                    payload_at += 1
            else:
                payload_at += 1
            index = payload_at
            interpreter = None
            continue
        if interpreter and word.startswith('-') and len(word) > 1:
            # An option of the interpreter seen a moment ago. Options run
            # until the first non-option word, so `bash -x -c "..."` still
            # has a program body waiting. Some of them take their value as
            # the next word, which is an option too.
            option_arg = not quoted and word in OPTION_TAKES_NEXT_WORD
            index += 1
            continue
        if option_arg:
            option_arg = False
            index += 1
            continue
        interpreter = None
        candidate = word
        if (quoted or ' ' in word) and not word.startswith('-'):
            # `"python3 scripts/hooks/guard.js"` is one shell word, but it is
            # an interpreter and its argument, not one long path. Reporting
            # the word verbatim would quote the whole command back.
            head, _, tail = word.partition(' ')
            if tail and _is_interpreter(head):
                candidate = tail
        if not candidate.startswith('-') and (quoted or ' ' in candidate) \
                and WHOLE_WORD_SCRIPT_RE.match(candidate):
            tokens.append((candidate, single))
        else:
            tokens.extend((m.group(1), single)
                          for m in SCRIPT_TOKEN.finditer(candidate))
        index += 1
    return tokens, False, bodies, too_deep


def _is_shell_interpreter(word):
    """Whether `word` names an interpreter whose -c payload is a command."""
    name = word.replace('\\', '/').rsplit('/', 1)[-1].lower()
    return name in SHELL_INTERPRETERS


def resolve_dirs():
    """Return (user_home, project_dir) honoring env overrides for determinism."""
    user_home = os.environ.get('CONFIG_HEALTH_USER_HOME') or os.path.expanduser('~')
    project_dir = os.environ.get('CLAUDE_PROJECT_DIR') or os.getcwd()
    return user_home, project_dir


def claude_data_dir(user_home):
    """Claude's user data root: CLAUDE_CONFIG_DIR when set, else ~/.claude.

    Claude Code reads user settings from this directory, and launchers move it
    with CLAUDE_CONFIG_DIR. Reading ~/.claude unconditionally would audit a
    file the harness is not loading, which is worse than not auditing at all.
    """
    configured = os.environ.get('CLAUDE_CONFIG_DIR')
    if configured:
        return os.path.abspath(os.path.expanduser(configured))
    return os.path.join(user_home, '.claude')


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


def placeholder_env(project_dir, user_home):
    """Explicit map of the placeholders this monitor is willing to resolve.

    Deliberately an allowlist rather than a copy of ``os.environ``: a hook
    command can contain a provider placeholder we cannot judge, and resolving
    an arbitrary one from ambient shell state would make findings depend on
    unrelated environment. The two provider names below are the exception,
    and only because a plugin install cannot be audited without them — both
    are overridable so an audit can be pinned rather than inherited.

    ``$HOME`` / ``$USERPROFILE`` resolve to ``user_home``, the same value
    ``~`` resolves to, so ``$HOME/x.py`` and ``~/x.py`` are judged alike.

    Args:
        project_dir (`str`): Absolute project directory.
        user_home (`str`): Absolute user home directory.

    Returns:
        `dict`: Placeholder name to absolute directory.
    """
    env = {
        'CLAUDE_PROJECT_DIR': project_dir,
        'HOME': user_home,
        'USERPROFILE': user_home,
    }
    plugin_root = (
        os.environ.get(PLUGIN_ROOT_OVERRIDE_ENV)
        or os.environ.get(PLUGIN_ROOT_ENV)
    )
    if plugin_root:
        # abspath(expanduser(...)): the audited roots are normalized against
        # the process cwd, so a `~`-prefixed or relative plugin root would
        # silently stop being the plugin root at the containment check.
        env[PLUGIN_ROOT_ENV] = os.path.abspath(os.path.expanduser(plugin_root))
    return env


def audit_roots(project_dir, user_home, env):
    """Directories a resolved hook script is allowed to live under.

    Normalized once per audit: the roots do not change within a run, and
    re-normalizing them per token is what made the first cut of this
    containment check measurably slower than the audit it replaced.
    """
    roots = [project_dir, user_home]
    plugin_root = env.get(PLUGIN_ROOT_ENV)
    if plugin_root:
        roots.append(plugin_root)
    return [_normalize(r) for r in roots]


def _normalize(path):
    """Absolute, separator-normalized, case-normalized form of `path`."""
    if not os.path.isabs(path):
        path = os.path.join(os.getcwd(), path)
    return os.path.normcase(os.path.normpath(path))


def is_within(path, roots):
    """Whether `path` is one of `roots` or lives under one of them."""
    target = _normalize(path)
    for base in roots:
        if target == base:
            return True
        if target.startswith(base.rstrip(os.sep) + os.sep):
            return True
    return False


def expand_placeholders(raw, env, single_quoted=False):
    """Expand the placeholders present in `env`, leaving the rest intact.

    Args:
        raw (`str`): A script token from a hook command.
        env (`dict`): Placeholder name to replacement, from
            :func:`placeholder_env`.
        single_quoted (`bool`): Whether the token sat inside single quotes.
            The shell does not expand those, so no path can be built from
            them and the token is treated as unresolvable.

    Returns:
        `tuple[str, list[str], bool]`: The expanded token, the names of any
        placeholders that could not be resolved, and whether anything was
        actually substituted. A token carrying an unresolved placeholder is
        skipped rather than reported as missing — we cannot tell a missing
        script from a path we failed to build.
    """
    unresolved = []

    def _replace(match):
        name = match.group(1)
        if name not in env or single_quoted:
            unresolved.append(name)
            return match.group(0)
        return env[name]

    expanded = PLACEHOLDER_RE.sub(_replace, raw)
    return expanded, unresolved, expanded != raw


def resolve_script_path(raw, project_dir, user_home, env, roots,
                        single_quoted=False):
    """Turn a token from a hook command into the paths we are willing to judge.

    `~` resolves against CONFIG_HEALTH_USER_HOME when set (the same override
    used for the user settings path), else the real home — so tests stay
    deterministic without affecting real users.

    The containment check applies to substituted paths only. A bare relative
    path is not confined to the audited roots: a hook command does not say
    which directory it runs from (plugin commands run from the plugin root,
    project wiring from the project), so such a token is resolved under every
    audited root and reported only when it is missing from all of them. An
    absolute or `~` path outside the roots is still reported — that is a real
    path to a real file, and the monitor has no reason to stay quiet about it.

    Args:
        raw (`str`): A script token from a hook command.
        project_dir (`str`): Absolute project directory.
        user_home (`str`): Absolute user home directory.
        env (`dict`): Supported placeholder replacements.
        roots (`list[str]`): Pre-normalized audited roots, from
            :func:`audit_roots`.
        single_quoted (`bool`): Whether the token sat inside single quotes.

    Returns:
        `tuple[list[str], str, bool]`: The candidate paths, a status (see
            :data:`AUDIT_OK`, :data:`AUDIT_MISSING`, :data:`AUDIT_SKIP`), and
            whether the token was a bare relative path judged against every
            root. That last flag is what lets `--check` name the one case where
            "healthy" and "the project copy is missing" look identical.

            ``'ok'``     — at least one candidate exists on disk.
            ``'missing'`` — no candidate exists; report the token.
            ``'skip'``   — no path could be built (an unresolvable or
                           single-quoted placeholder, or a substituted path
                           outside the audited roots). Reporting these is
                           how a plugin install turns into a false-warning
                           flood, and a monitor that cries wolf is worse than
                           no monitor.
    """
    expanded, unresolved, changed = expand_placeholders(
        raw, env, single_quoted,
    )
    if unresolved:
        return [], AUDIT_SKIP, False

    if expanded.startswith('~'):
        override = os.environ.get('CONFIG_HEALTH_USER_HOME')
        base = override if override else os.path.expanduser('~')
        candidates = [os.path.join(base, expanded[1:].lstrip('/\\'))]
        relative = False
    elif os.path.isabs(expanded):
        candidates = [expanded]
        relative = False
    else:
        candidates = [os.path.join(root, expanded) for root in roots]
        relative = True

    if changed and not all(is_within(c, roots) for c in candidates):
        return [], AUDIT_SKIP, relative

    existing = []
    for candidate in candidates:
        if os.path.exists(candidate):
            existing.append(candidate)
            break
    if existing:
        return existing, AUDIT_OK, relative
    return candidates, AUDIT_MISSING, relative


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
        if all(rec.get(rule, 0) == 0 for rec in complex_sessions):
            findings.append(
                f'rule "{rule}" last fired {STALENESS_WINDOW}+ sessions ago → may be dead'
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


def audit_hook_settings(user_home, project_dir, stats=None):
    """Run the hook-wiring audit over both settings files.

    Returns:
        `tuple[dict, list[str]]`: The placeholder environment, and findings.
    """
    env = placeholder_env(project_dir, user_home)
    findings = []
    claude_dir = claude_data_dir(user_home)
    user_settings, _ = read_settings(
        os.path.join(claude_dir, 'settings.json'), stats, 'user')
    project_settings, _ = read_settings(
        os.path.join(project_dir, '.claude', 'settings.json'), stats, 'project')
    # Both settings may be absent or malformed — each is handled independently
    # and never blocks. A malformed file yields no findings (nothing to audit)
    # rather than a crash.
    for settings in (user_settings, project_settings):
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
