---
name: token-card
description: Render a token-usage stat card from local Claude Code, Codex, and OpenCode session logs and commit it into the repository as a file. Use when someone wants a current usage figure in a README, or asks for a shareable card of their coding-agent activity.
metadata:
  origin: community
---

# Token Card

Produce an SVG card summarising this machine's AI coding agent usage — total tokens,
equivalent API cost, current streak, and the split across agents — and write it into the
working tree as a file the README can reference.

The card is a committed artifact rather than a hosted image, so it renders from the
repository itself and does not depend on a third-party endpoint staying up.

## When to Use

- Someone wants a usage figure visible in a README or docs page.
- Someone asks for a shareable summary of their agent activity across tools.

Use `/cost-report` instead when the question is "what did I spend this week". The two read
different sources and produce different things:

| | `/cost-report` | Token Card |
|---|---|---|
| Source | `~/.claude/metrics/costs.jsonl`, written by ECC's `stop:cost-tracker` hook | The agents' own session logs |
| Agents | Claude Code | Claude Code, Codex, OpenCode |
| Output | Terminal summary, optional CSV | An SVG file committed to the repo |

## The tool this runs

`@tokenchit/cli`, MIT licensed: <https://github.com/iyashjayesh/tokenchit>

**Pinned to an exact version, deliberately.** `@latest` resolves to whatever the registry
currently serves, and this tool reads local session logs — so a compromised future release
would be executed with access to them before anyone had reviewed it. Pin, and raise the pin
knowingly:

```bash
TOKENCHIT_VERSION=0.7.0
```

To check the pinned artifact before running it the first time:

```bash
npm view @tokenchit/cli@0.7.0 dist.integrity dist.tarball
```

## Workflow

1. **Ask before the first download.** `npx` fetches the package from the npm registry and
   executes it. That is a remote download of code that will read local logs, so get explicit
   confirmation from the user before the first run on a machine. If they decline, stop here
   and say what would have run.

2. **Configure, unless this is a dry run.** If `.tokenchit.json` is absent, run:

   ```bash
   npx -y @tokenchit/cli@0.7.0 init
   ```

   It detects which agents have logs on this machine and records them. The file is meant to
   be committed and never contains a credential.

   **Skip this entirely when the user passed `--dry-run`**, and report that `.tokenchit.json`
   *would* be created. A preview that writes a config file is not a preview.

3. **Render the card:**

   ```bash
   npx -y @tokenchit/cli@0.7.0 sync [--out PATH] [--theme auto|light|dark] [--dry-run]
   ```

   `sync` reads local files and sends nothing: no prompts, no code, no file contents leave
   the machine, and it transmits nothing to any server. The npx invocation around it is a
   registry download — that is the network access in this workflow, and step 1 is where it
   is agreed.

4. **Report and offer.** Print the figures it produced — tokens, equivalent cost, streak,
   per-agent split — and the path written. If the repository has a README that does not yet
   reference the card, offer to add:

   ```markdown
   ![tokenchit](./tokenchit.svg)
   ```

   Do not edit the README without being asked.

Stop after step 4. Publishing to the public leaderboard is a separate `publish` command that
requires explicit opt-in, and is not part of this workflow — run it only if the user asks for
it by name. `unpublish` removes the row and the account again.

## Output

The path of the SVG, the figures it contains, and the markdown snippet for referencing it.
On a dry run: what would have been written, and nothing on disk changed.

## Notes

- Requires Node.js. Nothing is installed globally; `npx` fetches the pinned version per run.
- Reads token counts and timestamps only.
