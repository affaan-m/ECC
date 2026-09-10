---
name: plugin-profiles
description: Generate, inspect, and activate slim ECC plugin carriers so a project loads only the skills, agents, and commands it needs instead of the whole catalog. Use when a session's plugin listing is too expensive, when a project should carry a narrower ECC surface, or when a generated carrier needs regenerating after an ECC update.
metadata:
  version: "1.0.0"
  origin: ECC
---

# Plugin Profiles

Installing ECC as a Claude Code plugin loads the frontmatter of **every**
skill, agent, and command into session context, in every session, in every
project. Claude Code has no native way to enable a subset of one plugin.

A **carrier** closes that gap: a standalone slim plugin generated from an
install selection, published through a local marketplace, and enabled per
project via `enabledPlugins`. It lists only the selected surface, keeps the
rest of the catalog reachable on demand *inside* the plugin, and records how
it was built in `ecc-profile.json`.

`docs/PLUGIN-PROFILES.md` is the reference for the underlying tool. This
skill is the workflow.

## When to Use

- A project's session context is dominated by the ECC plugin listing and you
  want a narrower surface for that project only.
- Someone asks what a profile would cost before committing to it — the
  `plan` step answers that with a labelled token ledger.
- A carrier already exists and ECC has been updated, so it needs
  regenerating (a carrier is a snapshot, not a live link).
- A generated carrier's command fails at runtime and you need the receipt to
  say what shipped and what did not.

Do **not** use this to install ECC itself, to change hook behaviour, or to
edit a generated carrier by hand. Carriers are build artifacts: regenerate,
never patch.

## Two Decisions, Never Conflated

Every run separates them, and so should you:

1. **Context** — which skills, agents, and commands the carrier lists. This
   is what costs session tokens.
2. **Capabilities** — whether the carrier ships ECC's hook runtime, which
   can format files, rewrite commands, and start processes. This costs zero
   context and is a *separate authorization*.

A narrow context selection never implies hooks. If the selection would carry
the hook runtime, `generate` refuses until the user passes
`--hooks <minimal|standard|strict>` or `--hooks off`. **Never choose for
them.** Show the capability disclosure and ask.

## Workflow

Run everything from the ECC plugin root (`${CLAUDE_PLUGIN_ROOT}` when set,
otherwise the everything-claude-code checkout).

### 1. List what is available

```bash
node scripts/plugin-profiles.js list
```

Profile ids here (`minimal`, `developer`, `opencode`, ...) are
**install-profile projections**, not context profiles: ECC has no canonical
context-profile registry yet, so every receipt records
`registry: install-profiles@unbound`. Say so if the user asks what a profile
"is".

### 2. Plan before generating

```bash
node scripts/plugin-profiles.js plan --profile <id>
```

Report back:

- the context surface (skills / agents / commands) and the **token ledger**
  with its method label and budget verdict;
- the capability selection: hooks off, enabled at a profile, or awaiting a
  decision.

On the ledger, the direction of error matters and is worth stating plainly:
the default measurer over-counts on purpose, so **"within budget" can be
trusted** and **"OVER budget" may be a false positive**. Clear a false
positive with the real tokenizer rather than guessing:

```bash
ANTHROPIC_API_KEY=... node scripts/plugin-profiles.js plan --profile <id> --measure provider
```

Without the key that command refuses; it never silently falls back to the
estimate. If the user has no key, say the number is an over-count and let
them decide.

### 3. Dry run

```bash
node scripts/plugin-profiles.js generate --profile <id> --dry-run
```

Show the target path, whether an existing directory would be replaced, the
ledger, any blockers, and the checks that only run against a staged tree.
Resolve each blocker *with the user*:

| Blocker | Resolution |
|---|---|
| hook decision required | `--hooks minimal\|standard\|strict` or `--hooks off` — ask, never assume |
| ledger over budget | `--measure provider` to check it is real, then `--budget <n>` or `--allow-over-budget` |
| target is not an unmodified generated carrier | `--force`, **only** with explicit confirmation that the directory may be deleted |
| unresolved or unclearable module load | a real defect; report the named file, do not work around it |

A dry run writes nothing, so it cannot run the staged load smoke. Do not
describe a clean dry run as a verified carrier.

### 4. Generate

```bash
node scripts/plugin-profiles.js generate --profile <id> --hooks <decision> [flags]
```

Show the generated path, the receipt digests, and the printed next steps.
If the output warns about **external dependencies**, relay it: those
commands need npm packages no carrier ships and will fail at runtime.

Pass through any extra flags the user asks for: `--name`, `--out`,
`--modules`, `--with`, `--without`, `--no-catalog`, `--keep-prev`.

### 5. Activate per project

Offer to write the opt-in to the project's `.claude/settings.json`:

```json
{
  "enabledPlugins": {
    "ecc@ecc": false,
    "<plugin-name>@ecc-profiles": true
  }
}
```

Merge with any existing `enabledPlugins` block instead of overwriting the
file. **Always show the resulting JSON and get confirmation before writing** —
never change plugin activation silently. Remind the user it takes effect on
the next session.

## Custom Selections

The same vocabulary as the installer:

```bash
# Profile plus extra components
node scripts/plugin-profiles.js generate --profile minimal \
  --with skill:react-patterns,agent:python-reviewer --name ecc-frontend

# Module-level, no profile
node scripts/plugin-profiles.js generate --modules commands-core,workflow-quality --name ecc-lite

# Exclude components from a profile
node scripts/plugin-profiles.js generate --profile developer --hooks off \
  --without capability:orchestration
```

Component ids come from `manifests/install-components.json` plus synthetic
per-skill components (`skill:<dir>`).

## Reading a Receipt

`ecc-profile.json` at the carrier root is both the ownership marker and the
build record. When something is wrong, read it before guessing:

- `contextProfile` — the id, and `registry: install-profiles@unbound`
- `context.*` and `context.digest` — exactly what was listed, hashed
- `capabilities.hooks` — the decision, its profile, and the capability groups
- `runtime.paths` / `runtime.held` — what shipped and what was withheld
- `dependencies.dynamic[]` — non-literal module loads and whether the staged
  smoke cleared them
- `dependencies.external[]` — npm packages a shipped script needs and no
  carrier carries
- `tokenLedger` — method, model, `payloadSha256`, tokens, budget, verdict
- `treeDigest` — proves the carrier is unmodified since generation

## Rules

- Never edit a generated carrier. Regenerate.
- Never pass `--force` without explicit confirmation naming the directory.
- Never decide the hook question for the user.
- Never present an estimate as a measurement; the method label says which.
- Regenerate after updating ECC, then reinstall the plugin so the cache
  picks up the new content.

## Related

- `/plugin-profiles` — the slash-command entry point to this skill
- `docs/PLUGIN-PROFILES.md` — design rules, fail-closed behaviour, receipt schema
- Source: `scripts/plugin-profiles.js`, `scripts/lib/plugin-profiles/`
