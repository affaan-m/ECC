"""Shell-command tokenising for the config-health monitor."""

from config_health_constants import (
    ESCAPABLE_BACKSLASH,
    INTERPRETERS,
    MAX_PAYLOAD_DEPTH,
    OPTION_TAKES_NEXT_WORD,
    PROGRAM_FLAG_LONG,
    SCRIPT_TOKEN,
    SHELL_INTERPRETERS,
    SHELL_SEPARATORS,
    WHOLE_WORD_SCRIPT_RE,
)


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
    while i < len(command):
        ch = command[i]
        if quote == "'":
            if ch == "'":
                quote = None
            else:
                chars.append(ch)
        elif quote == '"':
            if ch == '\\' and i + 1 < len(command) \
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
        elif ch == '\\' and i + 1 < len(command) \
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


# scan_command returns (tokens, unparsed, bodies, too_deep). `tokens` is a
# list of (token, single_quoted); `unparsed` is True when the command could
# not be split as written (an unclosed quote); `bodies` counts interpreter
# program bodies that were skipped because they are source in another
# language; `too_deep` is True when a `sh -c` chain passed
# MAX_PAYLOAD_DEPTH, with the tokens found so far still returned. Every
# reason to decline judgement is counted rather than swallowed, because
# `--check` reports the counts.
#
# Three things need more than a regex over the raw command: a quoted word is
# one argument verbatim (a path with a space stays whole); an interpreter's
# program body is not a script path (a shell's -c payload is scanned again,
# a node/python payload is skipped); and a backslash only escapes what a
# shell would let it escape (treating every backslash as an escape mangles
# C:\Users\me\guard.py).
def scan_command(command, depth=0):
    """Return (tokens, unparsed, bodies, too_deep) for `command`."""
    words = _split_shell_words(command)
    if words is None:
        return [], True, 0, False
    tokens = []
    bodies = 0
    too_deep = False
    index = 0
    interpreter = None
    option_arg = False
    while index < len(words):
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
        if interpreter and _is_program_flag(
                word, _is_shell_interpreter(interpreter)):
            (index, added, stop, unparsed,
             deep, reset) = _scan_program_body(
                 interpreter, quoted, words, index, depth, tokens)
            bodies += added
            too_deep = too_deep or deep
            interpreter = None if reset else interpreter
            if stop:
                return tokens, unparsed, bodies, too_deep
            continue
        if interpreter and word.startswith('-') and len(word) > 1:
            # An interpreter option; some take the next word as their value.
            option_arg = not quoted and word in OPTION_TAKES_NEXT_WORD
            index += 1
            continue
        if option_arg:
            option_arg = False
            index += 1
            continue
        interpreter = None
        tokens.extend(_word_tokens(word, quoted, single))
        index += 1
    return tokens, False, bodies, too_deep


def _scan_program_body(interpreter, quoted, words, index, depth, tokens):
    """Handle an interpreter program flag at `index`.

    Returns (next_index, bodies_added, stop, unparsed, too_deep,
    reset_interpreter). `stop` means the whole scan must end now, with
    `unparsed`/`too_deep` describing why.
    """
    total = len(words)
    if quoted:
        # The body is glued to the flag, as in `node -e"..."`. Nothing after
        # this word belongs to the program, and nothing inside it was judged,
        # so it counts like any other skipped body.
        return index + 1, 1, False, False, False, False
    payload_at = index + 1
    if payload_at >= total:
        return total, 0, False, False, False, False
    payload, payload_quoted, _ = words[payload_at]
    if _is_shell_interpreter(interpreter):
        if depth >= MAX_PAYLOAD_DEPTH:
            # Too deep to follow. Counted, and the tokens collected so far
            # are kept — a missing script on the outer command is still one.
            return total, 0, True, False, True, False
        if payload_quoted:
            sub = scan_command(payload, depth + 1)
            if sub[1]:
                return total, 0, True, True, False, False
            tokens.extend(sub[0])
            return payload_at + 1, sub[2], False, False, sub[3], False
        cursor = payload_at
        chunk = []
        while cursor < total and not _is_separator(words[cursor][0]):
            chunk.append(words[cursor][0])
            cursor += 1
        sub = scan_command(' '.join(chunk), depth + 1)
        if sub[1]:
            return total, 0, True, True, False, False
        tokens.extend(sub[0])
        return cursor, sub[2], False, False, sub[3], False
    # Source in another language: skip the body. Quoted, that is one word;
    # unquoted, the shell hands node every word up to the next separator as
    # the program, so all of them go. Counted, because nothing inside was
    # judged and `--check` should say so.
    if payload_quoted:
        return payload_at + 1, 1, False, False, False, True
    while payload_at < total and not _is_separator(words[payload_at][0]):
        payload_at += 1
    return payload_at, 1, False, False, False, True


def _word_tokens(word, quoted, single):
    """Turn one shell word into script-path tokens."""
    candidate = word
    if (quoted or ' ' in word) and not word.startswith('-'):
        # `"python3 scripts/hooks/guard.js"` is one shell word, but it is an
        # interpreter and its argument, not one long path.
        head, _, tail = word.partition(' ')
        if tail and _is_interpreter(head):
            candidate = tail
    if not candidate.startswith('-') and (quoted or ' ' in candidate) \
            and WHOLE_WORD_SCRIPT_RE.match(candidate):
        return [(candidate, single)]
    return [(m.group(1), single) for m in SCRIPT_TOKEN.finditer(candidate)]


def _is_shell_interpreter(word):
    """Whether `word` names an interpreter whose -c payload is a command."""
    name = word.replace('\\', '/').rsplit('/', 1)[-1].lower()
    return name in SHELL_INTERPRETERS
