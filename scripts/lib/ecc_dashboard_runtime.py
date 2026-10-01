#!/usr/bin/env python3
"""
Runtime helpers for ecc_dashboard.py that do not depend on tkinter.
"""

from __future__ import annotations

import os
import platform
import subprocess
import json
import re
from typing import Optional, Tuple, Dict, List


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
            if re.fullmatch(r'[>|][+-]?', value):
                parts = []
                for line in lines[index + 1:end]:
                    if line and not line[0].isspace():
                        break
                    parts.append(line.strip())
                value = ' '.join(parts).strip()
            elif value.startswith('"'):
                try:
                    value = json.loads(value)
                except ValueError:
                    value = ''
            elif value.startswith("'") and value.endswith("'"):
                value = value[1:-1].replace("''", "'")
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
