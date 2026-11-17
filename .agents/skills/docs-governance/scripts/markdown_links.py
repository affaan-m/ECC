"""Small Markdown link parser used by the documentation-governance audit."""

from __future__ import annotations

import re
from urllib.parse import unquote

INLINE_LINK_START_RE = re.compile(r"\[[^\]\n]*\]\(")
REFERENCE_DEFINITION_RE = re.compile(
    r"""(?mx)
    ^\ {0,3}\[(?P<label>[^\]\n]+)\]:[\t\ ]*
    (?:\r?\n[\t\ ]*)?
    (?P<target><[^>\n]+>|[^\t\ \n]+)
    (?:[\t\ ]+(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\([^()]*\)))?
    [\t\ ]*$
    """
)
REFERENCE_USAGE_RE = re.compile(
    r"(?<![\\])(?:\\\\)*\[(?P<text>[^\]\n]+)\](?:\[(?P<label>[^\]\n]*)\])?"
)
LINK_TITLE_RE = re.compile(
    r'\s+(?:"(?:\\.|[^"\\])*"|\'(?:\\.|[^\'\\])*\'|\([^()]*\))\s*$'
)
EXTERNAL_URI_RE = re.compile(
    r"^(?:[A-Za-z][A-Za-z0-9+.-]*://|(?:data|doi|geo|irc|magnet|mailto|news|sms|tel|urn):)",
    re.IGNORECASE,
)


def without_fenced_code(text: str) -> str:
    output: list[str] = []
    fence_character: str | None = None
    fence_length = 0
    # -- inside an HTML comment block that opened on an earlier line, a fence line is comment
    # -- text, which the inline pass blanks with the rest of the comment --
    in_comment = False
    after_blank = True
    for line in text.splitlines(keepends=True):
        if in_comment:
            in_comment = "-->" not in line
            output.append(line)
            after_blank = False
            continue
        marker = re.match(r"^ {0,3}(`{3,}|~{3,})(.*)$", line)
        if fence_character is None and marker:
            fence_character = marker.group(1)[0]
            fence_length = len(marker.group(1))
            output.append("\n" if line.endswith("\n") else "")
            after_blank = True
            continue
        if fence_character is not None:
            closing = re.match(
                rf"^ {{0,3}}{re.escape(fence_character)}{{{fence_length},}}[ \t]*(?:\r?\n)?$",
                line,
            )
            if closing:
                fence_character = None
                fence_length = 0
            output.append("\n" if line.endswith("\n") else "")
            after_blank = True
            continue
        # -- the same comment blocks as `_html_comment_end`: <!-- at column 0 after a blank line --
        in_comment = after_blank and line.startswith("<!--") and "-->" not in line[2:]
        output.append(line)
        after_blank = not line.strip()
    return "".join(output)


def _is_escaped(text: str, index: int) -> bool:
    backslashes = 0
    while index - backslashes > 0 and text[index - backslashes - 1] == "\\":
        backslashes += 1
    return backslashes % 2 == 1


def _html_comment_end(text: str, start: int, closing: int) -> int:
    """Where the comment that opens at `start` and closes at `closing` ends, or -1 if it is text.

    One whose `<!--` starts a line at column 0, after a blank line or at the start of the text,
    opens a top-level HTML block. No list item or block quote holds that block, so only its closer
    ends it: it may span lines and takes the rest of the line that holds the closer. Any other
    comment is hidden only when it closes on the line it opens on, which it cannot leave. Across
    lines it stays text, so a container that ends before its closer does not hide the links that
    follow.
    """
    if start == 0 or text[start - 1] == "\n":
        previous_line = text[text.rfind("\n", 0, start - 1) + 1 : start - 1] if start else ""
        if not previous_line.strip():
            newline = text.find("\n", closing + 3)
            return len(text) if newline == -1 else newline
    return -1 if text.find("\n", start, closing) != -1 else closing + 3


def without_inline_code_and_html_comments(text: str) -> str:
    """Blank out inline code spans and HTML comments, whichever opens first.

    A comment runs from `<!--` to the first `-->` after it (`<!-->` and `<!--->` included), within
    the limits that `_html_comment_end` sets. It becomes an opaque run of NUL characters, so a
    link or a reference definition cannot continue through it, as none can through raw HTML. An
    escaped `\\<!--`, or an opener with no closer, stays literal text, as in CommonMark.
    """
    output: list[str] = []
    cursor = 0
    # -- the first closer after an opener, kept while it is still ahead --
    closing = -1
    comments_can_close = True
    while cursor < len(text):
        if (
            comments_can_close
            and text.startswith("<!--", cursor)
            and not _is_escaped(text, cursor)
        ):
            if closing < cursor + 2:
                closing = text.find("-->", cursor + 2)
            end = -1 if closing == -1 else _html_comment_end(text, cursor, closing)
            if end != -1:
                output.extend(
                    "\n" if character == "\n" else "\0"
                    for character in text[cursor:end]
                )
                cursor = end
                continue
            # -- no closer here means none for any later opener either --
            comments_can_close = closing != -1
        if text[cursor] != "`":
            output.append(text[cursor])
            cursor += 1
            continue
        end_of_marker = cursor
        while end_of_marker < len(text) and text[end_of_marker] == "`":
            end_of_marker += 1
        marker = text[cursor:end_of_marker]
        closing = text.find(marker, end_of_marker)
        if closing == -1:
            output.append(marker)
            cursor = end_of_marker
            continue
        output.extend(
            "\n" if character == "\n" else " "
            for character in text[cursor : closing + len(marker)]
        )
        cursor = closing + len(marker)
    return "".join(output)


def inline_link_targets(text: str) -> list[str]:
    targets: list[str] = []
    matches = list(INLINE_LINK_START_RE.finditer(text))
    index = 0
    cursor = 0
    while index < len(matches):
        match = matches[index]
        if match.start() < cursor:
            index += 1
            continue
        start = match.end()
        if start < len(text) and text[start] == "<":
            end = text.find(">", start + 1)
            if end != -1:
                targets.append(text[start : end + 1])
                cursor = end + 1
                index += 1
                continue
            index += 1
            if index < len(matches):
                continue
            break
        depth = 0
        quote: str | None = None
        escaped = False
        closed = False
        saw_closing = False
        for end in range(start, len(text)):
            character = text[end]
            if quote is not None:
                if escaped:
                    escaped = False
                elif character == "\\":
                    escaped = True
                elif character == quote:
                    quote = None
                continue
            if escaped:
                escaped = False
                continue
            if character == "\\":
                escaped = True
                continue
            if (
                character in {"'", '"'}
                and depth == 0
                and end > start
                and text[end - 1].isspace()
            ):
                quote = character
                continue
            if character == "(":
                depth += 1
            elif character == ")":
                saw_closing = True
                if depth == 0:
                    targets.append(text[start:end])
                    cursor = end + 1
                    closed = True
                    break
                depth -= 1
        if closed:
            index += 1
            continue
        index += 1
        if not saw_closing or index >= len(matches):
            break
    return targets


def normalize_reference_label(label: str) -> str:
    unescaped = re.sub(r"\\([\\\[\]])", r"\1", label)
    return re.sub(r"\s+", " ", unescaped.strip()).casefold()


def reference_link_targets(text: str) -> list[str]:
    definition_matches = list(REFERENCE_DEFINITION_RE.finditer(text))
    definitions = {
        normalize_reference_label(match.group("label")): match.group("target")
        for match in definition_matches
    }
    targets: list[str] = []
    for match in REFERENCE_USAGE_RE.finditer(text):
        if any(
            definition.start() <= match.start() < definition.end()
            for definition in definition_matches
        ):
            continue
        following = text[match.end() : match.end() + 1]
        if following == "(":
            continue
        label = match.group("label")
        key = normalize_reference_label(label or match.group("text"))
        if key in definitions:
            targets.append(definitions[key])
    return targets


def markdown_link_targets(text: str) -> list[str]:
    text = without_inline_code_and_html_comments(without_fenced_code(text))
    targets = inline_link_targets(text) + reference_link_targets(text)
    # -- a destination made of a blanked comment is no link; a title may hold one --
    return [target for target in targets if "\0" not in _without_title(target)]


def _without_title(raw: str) -> str:
    target = raw.strip()
    title = None if target.startswith("<") else LINK_TITLE_RE.search(target)
    return target[: title.start()] if title else target


def normalize_link_target(raw: str) -> str | None:
    target = raw.strip()
    is_unc_path = target.startswith("\\\\")
    if target.startswith("<"):
        closing = target.find(">")
        if closing == -1:
            return None
        target = target[1:closing]
    else:
        target = _without_title(target)
    # Unescape supported Markdown punctuation before Windows path separators.
    target = re.sub(r"\\([()\[\]'])", r"\1", target)
    target = unquote(target.split("#", 1)[0].split("?", 1)[0]).replace("\\", "/")
    if not target or (target.startswith("//") and not is_unc_path):
        return None
    if EXTERNAL_URI_RE.match(target):
        return None
    return target
