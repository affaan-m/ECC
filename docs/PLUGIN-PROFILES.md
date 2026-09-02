# Plugin Profiles

Generate slim, per-project ECC plugin carriers for Claude Code from the
selective-install manifests.

## The Problem

Installing ECC as a Claude Code plugin loads the frontmatter of every skill,
agent, and command into session context in every session, in every project.
The selective-install system (`manifests/install-profiles.json`,
`install-modules.json`, `install-components.json`) already describes smaller
surfaces, but it only serves installer targets (`./install.sh`, `ecc install`).
The marketplace plugin path ignores it, and Claude Code has no native way to
enable a subset of one plugin.

Plugin profiles close that gap: an install selection is materialized as a
standalone slim plugin (a *carrier*), published through a local marketplace,
and chosen per project via `enabledPlugins`.

## Design Rules

The generator follows five rules. Each is enforced in code and tested.

1. **Context and capabilities are separate decisions.** A narrow context
   profile never implies the hook runtime. If the selection includes
   `hooks-runtime`, `generate` refuses until you pass `--hooks
   <minimal|standard|strict>` or `--hooks off`, showing the same six-group
   capability disclosure the installer uses. The decision is recorded in the
   receipt.
2. **Generation fails closed.** Every shipped command's script dependency
   closure is resolved from the command body. An unresolved static
   dependency aborts generation with the file and specifier named. The
   staged tree is re-verified before it is swapped in.
3. **The carrier is self-contained.** On-demand skill content is copied into
   the carrier under `on-demand/` and content-addressed with sha256. No
   absolute path from the generating machine is written anywhere.
4. **Generation is staged, bounded, and receipted.** Output is built in a
   dot-prefixed staging directory beside the target, verified, then swapped
   in atomically. The target is only replaced when it is an unmodified
   generated carrier (receipt present *and* tree digest matches). The
   receipt, `ecc-profile.json`, records inputs, digests, decisions, and the
   ledger.
5. **The token ledger is labelled and enforced.** The listing payload is
   measured with a named method and version and gated against a declared
   budget (default 8000 tokens). Over budget refuses unless
   `--allow-over-budget`.

## Quick Start

```bash
# See available install profiles
node scripts/plugin-profiles.js list

# Preview the surface, the ledger, and the capability decision
node scripts/plugin-profiles.js plan --profile developer

# See the exact file list, deletions, and any blockers; write nothing
node scripts/plugin-profiles.js generate --profile developer --hooks off --dry-run

# Generate the carrier + local marketplace (default: ~/.claude/ecc-profiles)
node scripts/plugin-profiles.js generate --profile developer --hooks off --allow-over-budget

# Register and install it
claude plugin marketplace add ~/.claude/ecc-profiles
claude plugin install ecc-developer@ecc-profiles
```

Then choose the profile per project. In a project's `.claude/settings.json`
(or `settings.local.json`):

```json
{
  "enabledPlugins": {
    "ecc@ecc": false,
    "ecc-developer@ecc-profiles": true
  }
}
```

Settings resolution happens before session context assembly, so this is the
one lever that actually shrinks the injected catalog. Subagents inherit the
session's plugin surface, so the slim profile applies to every spawned agent.

Note: `claude plugin install` enables the new plugin at user scope. For
per-project use, set it back to `false` in `~/.claude/settings.json` after
installing, and enable it only inside the projects that want it.

## What Gets Generated

For each selected module, paths are classified into the plugin surface:

| Module path | Plugin surface | Context cost |
|---|---|---|
| `skills/<id>` / `skills` | `skills/` (copied) | listed per skill |
| `agents` / `agents/<f>.md` | `agents/` (copied) | listed per agent |
| `commands` / `commands/<f>.md` | `commands/` (copied) | listed per command |
| `scripts/**` | copied verbatim | zero (runtime only) |
| `hooks`, `scripts/hooks` | copied only with a `--hooks` decision | zero (runtime only) |
| command runtime closure | copied verbatim | zero (runtime only) |
| on-demand skills | `on-demand/<id>/` (copied) | zero (not listed) |
| `rules`, `.agents`, platform configs | skipped | installer-only surfaces |

The generated `.claude-plugin/plugin.json` follows the Claude validator rules
pinned in `tests/plugin-manifest.test.js` (no `agents` or `hooks` keys,
explicit empty `mcpServers`).

### Command runtime closure

Commands ship as Markdown under `commands/`, but many are backed by scripts
that live outside the modules a profile selects (`/skill-health`,
`/plugin-profiles`, `/epic-*`, `/project-init`, ...). The generator scans
each shipped command body for `scripts/*.js` references, walks the
transitive `require()` graph of every referenced script, and copies the
closure. Directories copied wholesale (for example `scripts/lib` from
`hooks-runtime`) are closed over too.

Static requires that do not resolve abort generation. Non-literal requires
(`require(variable)`) cannot be resolved statically; they are reported in
`plan` output and recorded in the receipt, not silently ignored.

## Hooks Are a Capability Decision

Hooks cost no session context, but a narrow context profile does not
authorize lifecycle automation. `generate` therefore requires an explicit
decision whenever the selection would carry the hook runtime:

```text
$ node scripts/plugin-profiles.js generate --profile developer
plugin-profiles: This selection would carry ECC's automatic hook runtime, which can:
  1. Automatically format or otherwise modify project source files.
  2. Rewrite requested commands and start, replace, or terminate processes.
  ...
A context profile does not authorize lifecycle automation. Pass
--hooks <minimal|standard|strict> to carry the hook runtime at that
profile, or --hooks off (alias --no-hooks) to generate the carrier without it.
```

With `--hooks <profile>`, the carrier ships `hooks/` and `scripts/hooks/` and
pins the profile in `ecc/setup.json`, the managed-config fallback
`scripts/lib/hook-flags.js` already honours. Precedence at runtime is
unchanged: `ECC_HOOK_PROFILE` (environment), then the plugin option, then the
carrier's `ecc/setup.json`. `--dry-run` reports a pending decision as a
blocker without failing.

## The Token Ledger

`plan` and `generate` print a ledger for the listing payload — one
`name: description` line per installed skill, agent, and command, in the
shape Claude Code lists them:

```text
Ledger:     6647 tokens (chars-per-token-estimate@1, 26585 chars, 49 skills/0 agents/95 commands) - within budget 8000
```

The default measurer is a labelled estimate (`chars-per-token-estimate@1`,
four characters per token). Claude's tokenizer is not public, so the number
is not exact; the method and version travel with the number in the receipt
so it is never mistaken for a measurement. Library callers can inject a
provider-backed measurer through `measureContextLedger(plan, { measurer })`.

The budget is declared per invocation (`--budget <tokens>`, default 8000).
When the ledger exceeds it, `generate` refuses; pass `--allow-over-budget`
to proceed with the over-budget verdict recorded in the receipt.

Approximate ledger by install profile at ecc@2.2.1 (estimate, catalog skill
included; regenerate with `plan` for current numbers):

| Profile | Skills | Agents | Commands | Estimated tokens |
|---|---|---|---|---|
| opencode | 48 | 0 | 95 | ~6.6k |
| minimal | 48 | 68 | 95 | ~10.5k |
| developer | 125 | 68 | 95 | ~15.6k |
| full | 286 | 68 | 95 | ~28.3k |

`commands-core` ships every command and `agents-core` every agent, so the
install profiles are not tuned to the default budget; use `--without` or
module-level selection to narrow, or declare a budget that matches the
profile.

## The ecc-catalog Skill and On-Demand Content

Every carrier includes a synthesized `ecc-catalog` skill (disable with
`--no-catalog`): one cheap listing entry whose body indexes the full ECC
skill catalog with install status and a carrier-relative path. Skills that
are not installed in the profile are copied into `on-demand/<id>/` and hashed;
the catalog row points at that copy, never at a source tree. When a task
needs a skill outside the profile, the agent reads it from inside the plugin.

Because on-demand content is copied at generation time, a carrier reflects the
catalog as it was when generated. Regenerate after updating ECC.

## Custom Selections

`plan` and `generate` accept the same selection vocabulary as the installer:

```bash
# Profile plus extra components
node scripts/plugin-profiles.js generate --profile minimal \
  --with skill:react-patterns,agent:python-reviewer --name ecc-frontend

# Module-level, no profile
node scripts/plugin-profiles.js generate \
  --modules commands-core,workflow-quality --name ecc-lite

# Exclude components from a profile
node scripts/plugin-profiles.js generate --profile developer --hooks off \
  --without capability:orchestration
```

Component IDs come from `manifests/install-components.json` plus synthetic
per-skill components (`skill:<dir>`), exactly as in `install-plan.js`.

## The Receipt

`ecc-profile.json` at the carrier root is both the ownership marker and the
generation receipt:

| Field | Meaning |
|---|---|
| `schemaVersion`, `generatedFrom`, `generatorVersion`, `eccVersion`, `createdAt` | provenance |
| `profileInput`, `selectedModuleIds` | the exact selection inputs |
| `context.skills/agents/commands`, `context.digest` | the context surface and a sha256 over every file's content |
| `capabilities.hooks` | `decision` (`off`/`enabled`), `profile`, capability `groups` |
| `runtime.paths`, `runtime.held`, `runtime.closureEntries`, `runtime.dynamicRequires` | what shipped, what was withheld, why |
| `tokenLedger` | method, version, payload format, counts, tokens, budget, verdict |
| `catalog[]` | every catalog skill with `installed`, carrier-relative `path`, `sha256` |
| `treeDigest` | sha256 over every file in the carrier except the receipt |
| `previous` | the replaced carrier's `treeDigest` and `createdAt`, or null |

## Overwrite Safety

`generate` replaces an existing plugin directory of the same name only when
it is an unmodified carrier this tool produced: the receipt must be present,
name this generator, and its `treeDigest` must match the directory's current
contents. A directory with a copied-in marker, a hand-edited carrier, or any
unrelated directory is refused:

```text
Refusing to overwrite /path/to/ecc-minimal: it is not an unmodified generated
profile plugin (ecc-profile.json missing, foreign, or its tree digest no
longer matches). Choose another --name/--out, or pass --force to replace it.
```

`--force` skips that check and deletes the target. When stdin is not a
terminal it also requires `--yes`. `--dry-run` prints the full copy list and
whether the target would be replaced, so the deletion is visible before it
happens. `--keep-prev` parks the replaced tree as `.prev-<name>-<pid>` next to
the new one instead of deleting it.

Generation never writes into the target directly. If it fails at any point,
the staging directory is removed and the existing target is untouched; if the
final swap fails, the parked previous tree is moved back.

## Refreshing After Updates

Carriers snapshot the repo at generation time. After updating ECC, re-run the
same `generate` command, then reinstall the plugin (`claude plugin uninstall`
followed by `install`) so the plugin cache picks up the new content. The generated
plugin version tracks the source `package.json` version; the receipt's
`context.digest` changes whenever any listed file changes.

## Limitations

- Claude Code cannot partially enable a plugin, so a project uses either the
  full `ecc` plugin or a generated carrier — the carrier replaces the
  monolith in that project's `enabledPlugins`.
- Rules and platform configs are installer surfaces; Claude plugins do not
  load them, so they are skipped (use `./install.sh` for those).
- The generated marketplace is local to the machine. Carriers contain no
  machine-specific paths and can be copied, but treat them as build
  artifacts and regenerate rather than edit them.
- The token ledger is an estimate unless a provider-backed measurer is
  injected; the method label says which.
- Install profiles are not context profiles. Until ECC publishes a canonical
  context-profile registry, the profile ids here are the install profiles
  and the budget is declared per invocation.
