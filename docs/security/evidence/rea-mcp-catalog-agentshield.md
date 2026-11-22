# REA MCP Catalog Entry — AgentShield Evidence

Generated on 2026-11-22 with `ecc-agentshield@1.6.0` (npm integrity
`sha512-lpeHG96DtEn7ofq7Iiyvq29piQOwParaiZOdDB206i4ZeCL4yjwT6xN5BSGI4yhCEAN0eO0f9F9hxHLBuRqf/g==`),
installed with `--ignore-scripts`. Only static analysis was run: no prompt
injection testing, sandbox execution, taint or LLM analysis, and no auto-fix.
No MCP server from the catalog was started.

## Scope

The change adds one opt-in `rea` entry to `mcp-configs/mcp-servers.json`. The
scan root is `mcp-configs/` from the tree under review, extracted into an empty
directory so that no other part of the repository is scanned:

```bash
git archive HEAD mcp-configs | tar -x -C <scan-root>
npx --yes ecc-agentshield@1.6.0 scan --path <scan-root> \
  --format json --evidence-pack <temporary-directory>
```

The same root was built from `main` at `4adeee67`, saved with
`--save-baseline`, and compared with `--baseline <file> --gate`.

`rea-mcp-catalog-agentshield.sarif` is the redacted `agentshield-results.sarif`
from the evidence pack of this branch (commit `7ef28991`). AgentShield replaced
the scan root with `<target-path>`; it contains no local path, username,
credential or token.

## Result

| | this branch (`7ef28991`) | `main` (`4adeee67`) |
| --- | ---: | ---: |
| Exit code | 0 | 0 |
| Files scanned | 1 | 1 |
| Score / grade | 98 / A | 98 / A |
| Critical / high | 0 / 0 | 0 / 0 |
| Medium / low / info | 15 / 49 / 0 | 15 / 47 / 0 |

AgentShield labels every finding in this scope as coming from an MCP template
or example inventory, not an active runtime configuration.

## Baseline comparison

`--gate` with the default threshold of 0 exits 3: two new low findings, both
on the `rea` entry. The existing `mcp-excessive-servers` finding (low) also
changes its count from 37 to 38 servers.

| Finding | Severity | Disposition |
| --- | --- | --- |
| `mcp-npx-y-rea`: uses `npx -y` | low | Accepted. Matches every other npx entry in the catalog and upstream's published `mcp.json`. MCP stdio servers have no TTY, so dropping `-y` would hang on the install prompt. The supply-chain control is the exact pin `rea-agents@6.10.1`. |
| `mcp-env-inherit-rea`: no explicit `env` block | low | Accepted. Same finding exists for most catalog entries on `main`. REA may need provider paths (Ghidra, IDA, Hopper) from the environment, so an empty `env` block was not added to silence the rule. Users who enable the entry can add a scoped `env` block. |

No medium, high or critical finding is introduced.

## Boundaries

- A static configuration scan; it does not assess REA's code, its transitive
  dependencies, or the behavior of its MCP tools.
- The pinned version comes from upstream's own `mcp.json` and `server.json` at
  `morluto/rea@61c7f2b`, not from a registry "latest" lookup.
