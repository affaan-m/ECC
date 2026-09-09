# Measuring the session-context saving of a profile carrier

The headline number for plugin profiles is how many tokens a session no
longer spends on the ECC plugin listing. That number cannot be computed from
the repository: it depends on what Claude Code actually injects, which is
observable only in a real session.

This is the procedure that produces it. It is a document rather than a script
because every step happens inside the Claude Code client, which has no
headless capture path.

**Anyone following this should be able to reproduce the numbers in
`docs/PLUGIN-PROFILES.md` without asking a question.** If a step is
ambiguous, that is a bug in this file.

## What is being measured

`cache_creation_input_tokens` on the **first assistant turn of a fresh
session**, in an otherwise identical project, under three plugin
configurations:

| Arm | `enabledPlugins` |
|---|---|
| A. full plugin | `{"ecc@ecc": true}` |
| B. minimal carrier | `{"ecc@ecc": false, "ecc-minimal@ecc-profiles": true}` |
| C. opencode carrier | `{"ecc@ecc": false, "ecc-opencode@ecc-profiles": true}` |

The first turn is the one that matters: the plugin listing is part of the
prompt prefix, so it is written into the cache on the first turn of every
session and read back on later turns. `cache_creation_input_tokens` on that
turn is therefore the closest observable to "what this plugin costs me per
session".

**Do not** use `input_tokens` (it excludes the cached prefix) or a later
turn's `cache_read_input_tokens` (it includes conversation history).

## Controls

Every arm must be identical except `enabledPlugins`. Hold all of these fixed:

- the same project directory, at the same git commit, with a clean worktree;
- the same `CLAUDE.md` / `AGENTS.md` (do not edit between arms);
- the same first-turn prompt — use exactly `hi` so no tool use is triggered;
- the same Claude Code version, the same model, the same OS user;
- no MCP servers added or removed between arms;
- no other plugins enabled or disabled between arms;
- `~/.claude/settings.json` unchanged apart from the plugin lines.

Restart Claude Code fully between arms. A `/clear` starts a new conversation
but does not always re-resolve plugins.

## Procedure

### 0. Record the environment

Capture these before you start; they belong in the results table:

```bash
claude --version
node --version
git -C <repo> rev-parse --short HEAD
```

Plus the OS and its version, and the date.

### 1. Generate the two carriers

From the ECC checkout:

```bash
node scripts/plugin-profiles.js generate --profile minimal  --hooks off --allow-over-budget
node scripts/plugin-profiles.js generate --profile opencode --hooks off --allow-over-budget
claude plugin marketplace add ~/.claude/ecc-profiles
claude plugin install ecc-minimal@ecc-profiles
claude plugin install ecc-opencode@ecc-profiles
```

`claude plugin install` enables a plugin at **user** scope. Set both back to
`false` in `~/.claude/settings.json` before starting, so each arm is turned
on deliberately in the project settings and nothing leaks between arms.

### 2. For each arm

1. Edit the project's `.claude/settings.json` to exactly the `enabledPlugins`
   block for that arm, and nothing else.
2. Quit Claude Code completely and reopen it in the project.
3. Send exactly one message: `hi`.
4. Read the token counts (next section).
5. Record `cache_creation_input_tokens`.
6. Quit before changing arms.

Run all three arms twice, in the order A, B, C and then C, B, A. If a
number moves by more than ~2% between the two passes, something is not
controlled — find it before reporting anything.

### 3. Where to read the numbers

Any one of these works; use the same one for all arms.

**a. `/cost`** — run it immediately after the first reply. It reports the
turn's usage, including cache creation.

**b. The OTEL / usage log.** If telemetry is enabled, each request logs a
usage object containing:

```json
{
  "input_tokens": 4,
  "cache_creation_input_tokens": 31427,
  "cache_read_input_tokens": 0,
  "output_tokens": 12
}
```

`cache_creation_input_tokens` is the field. `cache_read_input_tokens` must be
`0` on a first turn — if it is not, the session was not fresh, and the
measurement is void.

**c. The session transcript.** `~/.claude/projects/<project-slug>/<session-id>.jsonl`
holds one JSON object per event. The first assistant event carries
`message.usage` with the same four fields. This is the most reliable source
because it cannot be misread off a rendering:

```bash
# newest transcript for this project, first assistant usage object
ls -t ~/.claude/projects/<project-slug>/*.jsonl | head -1 | xargs -I{} \
  node -e 'const fs=require("fs");
    for (const line of fs.readFileSync(process.argv[1],"utf8").split("\n")) {
      if (!line.trim()) continue;
      const e = JSON.parse(line);
      if (e.type === "assistant" && e.message && e.message.usage) {
        console.log(JSON.stringify(e.message.usage)); break;
      }
    }' {}
```

## Reporting

Record all three raw numbers, not just the difference, and state the
environment. A saving reported without its baseline cannot be checked.

| Arm | cache_creation_input_tokens (pass 1) | (pass 2) | Saving vs A |
|---|---|---|---|
| A. full `ecc@ecc` | | | — |
| B. `ecc-minimal` | | | |
| C. `ecc-opencode` | | | |

Environment: Claude Code `<version>`, Node `<version>`, `<OS> <version>`,
ECC `<short-sha>`, `<date>`.

Then replace the "Measured impact" section of `docs/PLUGIN-PROFILES.md` with
that table, and update the PR description to match. Do not carry a number
forward from an older run: the listing changes whenever a skill, agent, or
command description changes, so a saving is only valid for the commit it was
measured at.

## Why this is not automated

Claude Code has no headless "start a session and report first-turn usage"
mode, and the number depends on the client's own prompt assembly, which a
script in this repository cannot observe. Faking it with a token estimate
over the listing payload would measure this repository's model of the
client, not the client — which is exactly the confusion the token ledger's
method labels exist to prevent.
