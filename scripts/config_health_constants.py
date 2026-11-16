"""Constants shared by the config-health monitor."""

import re


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
