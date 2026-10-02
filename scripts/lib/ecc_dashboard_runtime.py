#!/usr/bin/env python3
"""
Runtime helpers for ecc_dashboard.py that do not depend on tkinter.
"""

from __future__ import annotations

import os
import platform
import subprocess
import re
from typing import Optional, Tuple, Dict, List


def decode_description_escapes(value: str) -> str:
    escapes = {'0': '\0', 'a': '\a', 'b': '\b', 't': '\t',
               'n': '\n', 'v': '\v', 'f': '\f', 'r': '\r',
               'e': '\x1b', ' ': ' ', '"': '"', '/': '/',
               '\\': '\\', 'N': '\x85', '_': '\xa0',
               'L': '\u2028', 'P': '\u2029'}
    def decode_escape(escape):
        token = escape.group(1)
        return chr(int(token[1:], 16)) if token[0] in 'xuU' else escapes[token]
    try:
        value = re.sub(r'\\(x[0-9a-fA-F]{2}|u[0-9a-fA-F]{4}|U[0-9a-fA-F]{8}|[0abtnvfre "/\\N_LP])', decode_escape, value)
    except ValueError:
        value = ''
    return value


def skill_description(content: str, fallback: str) -> str:
    """Read a skill summary, excluding frontmatter from body fallbacks."""
    lines = content.lstrip('\ufeff').splitlines()
    body = lines
    if lines and lines[0] == '---':
        end = next((i for i in range(1, len(lines)) if lines[i] == '---'), None)
        if end is None:
            return fallback
        body = lines[end + 1:]
        for index in range(1, end):
            match = re.match(r'^description:\s*(.*)$', lines[index])
            if not match:
                continue
            value = match.group(1).strip()
            quoted = value.startswith(('"', "'"))
            if not quoted:
                value = re.split(r'(^|\s)#', value, maxsplit=1)[0].strip()
                if value in ('~', 'null', 'Null', 'NULL'):
                    value = ''
            if re.fullmatch(r'[>|](?:[1-9][+-]?|[+-][1-9]?)?', value):
                parts = []
                for line in lines[index + 1:end]:
                    if line and not line[0].isspace():
                        break
                    parts.append(line.strip())
                value = ' '.join(parts).strip()
            elif value.startswith('"'):
                scalar = re.fullmatch(r'"((?:[^"\\]|\\.)*)"(?:\s+#.*)?\s*', value)
                value = scalar.group(1) if scalar else ''
                value = decode_description_escapes(value)
            elif value.startswith("'"):
                scalar = re.fullmatch(r"'((?:[^']|'')*)'(?:\s+#.*)?\s*", value)
                value = scalar.group(1).replace("''", "'") if scalar else ''
            if isinstance(value, str) and value.strip():
                return ' '.join(value.split())[:100]
            break
    for line in body:
        line = line.strip()
        if line.startswith('# '):
            return line[2:].strip()[:100] or fallback
        if line and not line.startswith('#') and line not in ('---', '...'):
            return line[:100]
    return fallback


def maximize_window(window) -> None:
    """Maximize the dashboard window using the safest supported method."""
    try:
        window.state('zoomed')
        return
    except Exception:
        pass

    system_name = platform.system()
    if system_name == 'Linux':
        try:
            window.attributes('-zoomed', True)
        except Exception:
            pass
    elif system_name == 'Darwin':
        try:
            window.attributes('-fullscreen', True)
        except Exception:
            pass


def build_terminal_launch(
    path: str,
    *,
    os_name: Optional[str] = None,
    system_name: Optional[str] = None,
) -> Tuple[List[str], Dict[str, object]]:
    """Return safe argv/kwargs for opening a terminal rooted at the requested path."""
    resolved_os_name = os_name or os.name
    resolved_system_name = system_name or platform.system()

    if resolved_os_name == 'nt':
        creationflags = getattr(subprocess, 'CREATE_NEW_CONSOLE', 0)
        return (
            ['cmd.exe'],
            {
                'cwd': path,
                'creationflags': creationflags,
            },
        )

    if resolved_system_name == 'Darwin':
        return (['open', '-a', 'Terminal', path], {})

    return (
        ['x-terminal-emulator', '-e', 'bash', '-lc', 'cd -- "$1"; exec bash', 'bash', path],
        {},
    )


def launch_terminal(path: str) -> None:
    """Open a terminal at the given path after validating the target directory."""
    canonical = os.path.realpath(path)
    if not os.path.isdir(canonical):
        raise ValueError(f"Path is not a valid directory: {canonical!r}")
    argv, kwargs = build_terminal_launch(canonical)
    subprocess.Popen(argv, **kwargs)  # noqa: S603 - list argv, no shell=True, path validated above
