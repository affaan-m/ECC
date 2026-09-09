---
description: Render a token-usage stat card from local agent session logs and commit it to the repo.
argument-hint: [--out PATH] [--theme auto|light|dark] [--dry-run]
---

# Token Card

## Purpose

Produce an SVG card summarising this machine's AI coding agent usage — total tokens,
equivalent API cost, current streak, and the split across agents — and write it into the
working tree as a file the README can reference.

The card is a committed artifact rather than a hosted image, so it renders from the
repository itself and does not depend on a third-party endpoint staying up.

## Relationship to `/cost-report`

They read different sources and produce different things, so both are useful:

| | `/cost-report` | `/token-card` |
|---|---|---|
| Source | `~/.claude/metrics/costs.jsonl`, written by ECC's `stop:cost-tracker` hook | The agents' own session logs |
| Agents | Claude Code | Claude Code, Codex, OpenCode |
| Output | Terminal summary, optional CSV | An SVG file committed to the repo |

Use `/cost-report` to answer "what did I spend this week". Use `/token-card` to put a
current figure in a README.

## Usage

```
/token-card                       # write ./tokenchit.svg
/token-card --out docs/usage.svg  # write somewhere else
/token-card --theme dark
/token-card --dry-run             # report what would be written, write nothing
```

## Workflow

1. Check whether `.tokenchit.json` exists in the repository root. If it does not, run
   `npx -y @tokenchit/cli@latest init` to detect which agents have logs on this machine and
   record them. That file is meant to be committed and never contains a credential.
2. Run `npx -y @tokenchit/cli@latest sync` with any arguments the user supplied. This reads
   only local files and makes no network request, so it is safe before deciding whether to
   publish anything.
3. Report the figures it prints — tokens, equivalent cost, streak, per-agent split — and the
   path it wrote.
4. If the repository has a README and the card is not referenced yet, offer to add the
   image reference. Do not edit the README without asking.

Stop after step 3 unless the user asks to publish. `sync` is local-only; joining the public
leaderboard is a separate `publish` command that requires an explicit opt-in, and
`unpublish` removes the row and the account again.

## Output

The path of the SVG that was written, the figures it contains, and the markdown snippet for
referencing it:

```markdown
![tokenchit](./tokenchit.svg)
```

## Notes

- Requires Node.js. Nothing is installed globally; `npx` fetches the CLI per invocation.
- Reads token counts and timestamps only. Prompts, code, and file contents are never parsed
  or transmitted.
- `@tokenchit/cli` is MIT licensed: <https://github.com/iyashjayesh/tokenchit>
