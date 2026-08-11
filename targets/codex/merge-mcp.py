#!/usr/bin/env python3
"""Merge MCP server definitions into a Codex config.toml.

Only ``[mcp_servers.*]`` tables are touched. All other keys, comments, and
formatting are preserved via tomlkit. A timestamped backup is written before
any modification. Run via ``uv run --with tomlkit python3 merge-mcp.py ...``.
"""

import argparse
import json
import shutil
import sys
import time
from pathlib import Path

import tomlkit

COPIED_KEYS = ('command', 'args', 'env')


def main() -> int:
    """Merge servers.json entries into config.toml and report actions."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--config', required=True, type=Path)
    parser.add_argument('--servers', required=True, type=Path)
    parser.add_argument('--force', action='store_true')
    parser.add_argument('--dry-run', action='store_true')
    args = parser.parse_args()

    try:
        servers = json.loads(args.servers.read_text())['mcpServers']
    except (OSError, json.JSONDecodeError, KeyError) as e:
        print(f'ERROR: cannot read MCP servers from {args.servers}: {e}', file=sys.stderr)
        return 1

    try:
        doc = (
            tomlkit.parse(args.config.read_text())
            if args.config.exists()
            else tomlkit.document()
        )
    except (OSError, tomlkit.exceptions.ParseError) as e:
        print(f'ERROR: cannot parse {args.config}: {e}', file=sys.stderr)
        return 1
    if 'mcp_servers' not in doc:
        doc['mcp_servers'] = tomlkit.table(True)
    table = doc['mcp_servers']

    added = []
    for name, spec in servers.items():
        if name in table and not args.force:
            print(f'SKIP mcp_servers.{name} (exists; use --force to overwrite)')
            continue
        entry = tomlkit.table()
        for key in COPIED_KEYS:
            if spec.get(key):
                entry[key] = spec[key]
        table[name] = entry
        added.append(name)
        print(f'ADD  mcp_servers.{name}')

    if args.dry_run or not added:
        return 0

    args.config.parent.mkdir(parents=True, exist_ok=True)
    if args.config.exists():
        backup = args.config.with_name(f'{args.config.name}.bak.{int(time.time())}')
        shutil.copy2(args.config, backup)
        print(f'BACKUP {backup}')
    args.config.write_text(tomlkit.dumps(doc))
    return 0


if __name__ == '__main__':
    sys.exit(main())
