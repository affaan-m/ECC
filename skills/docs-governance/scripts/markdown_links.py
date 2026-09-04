"""Small Markdown link parser used by the documentation-governance audit."""

from __future__ import annotations

import re
from urllib.parse import unquote

INLINE_LINK_START_RE = re.compile(r"\[[^\]\n]*\]\(")
REFERENCE_DEFINITION_RE = re.compile(
    r"""(?mx)
    ^\ {0,3}\[(?P<label>[^\]\n]+)\]:[\t\ ]*
    (?P<target><[^>\n]+>|[^\t\ \n]+)
    (?:[\t\ ]+(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\([^()]*\)))?
    [\t\ ]*$
    """
)
REFERENCE_USAGE_RE = re.compile(
    r"(?<![!\\])\[(?P<text>[^\]\n]+)\](?:\[(?P<label>[^\]\n]*)\])?"
)
EXTERNAL_URI_RE = re.compile(
    r"^(?:[A-Za-z][A-Za-z0-9+.-]*://|(?:data|doi|geo|irc|magnet|mailto|news|sms|tel|urn):)",
    re.IGNORECASE,
)


def without_fenced_code(text: str) -> str:
    output: list[str] = []
    fence_character: str | None = None
    fence_length = 0
    for line in text.splitlines(keepends=True):
        marker = re.match(r"^ {0,3}(`{3,}|~{3,})(.*)$", line)
        if fence_character is None and marker:
            fence_character = marker.group(1)[0]
            fence_length = len(marker.group(1))
            output.append("\n" if line.endswith("\n") else "")
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
            continue
        output.append(line)
    return "".join(output)


def without_inline_code(text: str) -> str:
    output: list[str] = []
    cursor = 0
    while cursor < len(text):
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
    for match in INLINE_LINK_START_RE.finditer(text):
        start = match.end()
        if start < len(text) and text[start] == "<":
            end = text.find(">", start + 1)
            if end != -1:
                targets.append(text[start : end + 1])
                continue
            break
        depth = 0
        quote: str | None = None
        escaped = False
        closed = False
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
            if character in {"'", '"'}:
                quote = character
                continue
            if character == "(":
                depth += 1
            elif character == ")":
                if depth == 0:
                    targets.append(text[start:end])
                    closed = True
                    break
                depth -= 1
        if not closed:
            break
    return targets


def normalize_reference_label(label: str) -> str:
    unescaped = re.sub(r"\\([\\\[\]])", r"\1", label)
    return re.sub(r"\s+", " ", unescaped.strip()).casefold()


def reference_link_targets(text: str) -> list[str]:
    definitions = {
        normalize_reference_label(match.group("label")): match.group("target")
        for match in REFERENCE_DEFINITION_RE.finditer(text)
    }
    targets: list[str] = []
    for match in REFERENCE_USAGE_RE.finditer(text):
        following = text[match.end() : match.end() + 1]
        if following in {"(", ":"}:
            continue
        label = match.group("label")
        key = normalize_reference_label(label or match.group("text"))
        if key in definitions:
            targets.append(definitions[key])
    return targets


def markdown_link_targets(text: str) -> list[str]:
    text = without_inline_code(without_fenced_code(text))
    return inline_link_targets(text) + reference_link_targets(text)


def normalize_link_target(raw: str) -> str | None:
    target = raw.strip()
    if target.startswith("<"):
        closing = target.find(">")
        if closing == -1:
            return None
        target = target[1:closing]
    else:
        title = re.search(
            r'\s+(?:"(?:\\.|[^"\\])*"|\'(?:\\.|[^\'\\])*\'|\([^()]*\))\s*$',
            target,
        )
        if title:
            target = target[: title.start()]
    target = unquote(target.split("#", 1)[0].split("?", 1)[0])
    if not target or target.startswith("//"):
        return None
    if EXTERNAL_URI_RE.match(target):
        return None
    return target
