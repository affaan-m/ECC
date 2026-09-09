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
   selection never implies the hook runtime. If the selection includes
   `hooks-runtime`, `generate` refuses until you pass `--hooks
   <minimal|standard|strict>` or `--hooks off`, showing the same six-group
   capability disclosure the installer uses. The decision is recorded in the
   receipt.
2. **Generation fails closed.** Every shipped command's script dependency
   closure is resolved from the command body. An unresolved static
   dependency aborts generation with the file and specifier named, and a
   non-literal `require(...)` aborts it too unless the file containing it is
   proven to load from the staged tree. The staged tree is re-verified, and
   then load-smoked, before it is swapped in.
3. **The carrier is self-contained.** On-demand skill content is copied into
   the carrier under `on-demand/` and content-addressed with sha256. No
   absolute path from the generating machine is written anywhere.
4. **Generation is staged, bounded, and receipted.** Output is built in a
   dot-prefixed staging directory beside the target, verified, then swapped
   in atomically. The target is only replaced when it is an unmodified
   generated carrier (receipt present *and* tree digest matches). The
   receipt, `ecc-profile.json`, records inputs, digests, decisions, and the
   ledger.
5. **The token ledger is labelled, conservative, and enforced.** The listing
   payload is measured with a named method and version, hashed, and gated
   against a declared budget (default 8000 tokens). The offline default
   over-counts on purpose, so "within budget" is safe to act on and "over
   budget" can be a false positive that `--measure provider` clears. Over
   budget refuses unless `--allow-over-budget`.

## Quick Start

```bash
# See available install profiles
node scripts/plugin-profiles.js list

# Preview the surface, the ledger, and the capability decision
node scripts/plugin-profiles.js plan --profile developer

# See the exact file list, deletions, and any blockers; write nothing
node scripts/plugin-profiles.js generate --profile developer --hooks off --dry-run

# Clear an over-budget verdict with the real tokenizer before accepting it
ANTHROPIC_API_KEY=... node scripts/plugin-profiles.js plan --profile developer --measure provider

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

### Fail closed: the three kinds of module reference

Every `require`/`import` in a shipped script is classified as exactly one of:

| Kind | Example | Treatment |
|---|---|---|
| `static-resolved` | `require('./lib/x')` that resolves | copied into the closure |
| `static-unresolved` | `require('./lib/x')` that does not resolve | **refuses generation**, naming file and specifier |
| `dynamic` | `require(scriptPath)` | **refuses generation** unless the containing file passes the staged load smoke |

A require shape that appears inside a string or template literal is text, not
a dependency: `scripts/lib/resolve-ecc-root.js` embeds an entire inline
resolver in a template literal, and reading that as a dynamic require would
refuse every carrier that ships it. String and template literals are blanked
before dynamic detection, so only executable `require(` tokens count.

Bare specifiers (Node builtins, npm packages) are not repo files and are not
part of the closure — see the load smoke below for how they are surfaced.

### The staged load smoke

A dynamic require cannot be resolved without running the code, so after the
staged tree passes static verification the generator runs the files that
contain one, from inside the staged tree, with `cwd` and
`CLAUDE_PLUGIN_ROOT` set to the staged root, no stdin, and a 10s timeout.
Every shipped command entry point that advertises `--help` is exercised the
same way.

What runs is bounded on purpose, because executing shipped code is a real
action:

| File shape | How it is exercised |
|---|---|
| advertises `--help` | `node <file> --help` — loads the whole module graph, then exits without doing work |
| no shebang (a library module) | `require()`d in a child process |
| shebang, no `--help`, contains a dynamic require | run with no arguments — the only way to clear the require, and the carrier is about to ship and run that file anyway |
| shebang, no `--help`, no dynamic require | **not run** — its module scope would do arbitrary work with an empty argv |

Running an installer or an updater to prove a carrier is loadable would be a
worse outcome than the bug it detects, which is why the last row exists.

A load that fails only because an **npm package** is absent is reported
separately, as an external dependency, not as a closure failure. Carriers
have never shipped `node_modules`, and the closure has always been defined
over repo-relative requires. Those loads are recorded in the receipt under
`dependencies.external`, and the command(s) they back are omitted from the
carrier rather than shipped guaranteed to crash — at ecc@2.2.1 that is every
command backed by `scripts/github-coordination.js` (needs `sql.js`) or
`scripts/install-plan.js` (needs `ajv`), named under
`dependencies.omittedCommands` and printed as a warning at generation time.
A command with more than one entry script is omitted whole when any one of
them is unshippable. The backing script itself stays in the carrier — it may
still be required by something else, and an unreferenced script costs
nothing toward the ledger.

`--dry-run` writes nothing, so it cannot run the smoke. It instead lists what
the smoke would check under "Checks that only run against the staged tree",
so a clean dry run is never mistaken for a verified carrier.

## Hooks Are a Capability Decision

Hooks cost no session context, but a narrow context selection does not
authorize lifecycle automation. `generate` therefore requires an explicit
decision whenever the selection would carry the hook runtime:

```text
$ node scripts/plugin-profiles.js generate --profile developer
plugin-profiles: This selection would carry ECC's automatic hook runtime, which can:
  1. Automatically format or otherwise modify project source files.
  2. Rewrite requested commands and start, replace, or terminate processes.
  ...
A narrow context selection does not authorize lifecycle automation. Pass
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
Ledger:     8431 tokens (chars-per-token-conservative@1, 26977 chars, 50 skills/0 agents/95 commands) - OVER budget 8000
```

### The estimate is conservative by construction

Claude's tokenizer is not public and this CLI is network-free by default, so
the default number is an estimate. It is deliberately **conservative**:
`chars-per-token-conservative@1` divides by **3.2** characters per token, not
the ~4 rule of thumb, so it over-counts.

That asymmetry is the point. The verdict is only safe in one direction:

- **"within budget" can be trusted.** The real count is very unlikely to be
  higher than an estimate that already over-counts.
- **"OVER budget" may be a false positive.** Clear it with
  `--measure provider`, which counts the exact payload with the real
  tokenizer, or accept it with `--allow-over-budget`.

Every ledger records `method`, `methodVersion`, `model` (provider only),
`listingTokens`, `budget`, the verdict, and `payloadSha256` — the hash of the
exact string that was measured — so a number can always be tied back to what
produced it, and an estimate is never mistaken for a measurement.

### Measuring with the provider

```bash
ANTHROPIC_API_KEY=... node scripts/plugin-profiles.js plan --profile opencode --measure provider
ANTHROPIC_API_KEY=... node scripts/plugin-profiles.js plan --profile opencode --measure provider --model claude-opus-4-1
```

`--measure provider` calls Anthropic `count_tokens` on the exact listing
payload. Without `ANTHROPIC_API_KEY` it **refuses**; it never silently falls
back to the estimate, because a caller who asked for a measurement must not
be handed an estimate wearing the measurement's label. `--model` defaults to
`claude-sonnet-4-5` and only applies to `--measure provider`.

### Calibrating the ratio

`3.2` is a **placeholder, not yet a measurement.** The tool that turns it into
one is manual, because it needs the network and a key:

```bash
ANTHROPIC_API_KEY=... node scripts/ci/calibrate-token-estimate.js
```

It measures `tests/fixtures/token-calibration/*.txt` — real listing payloads,
the only text this estimate is ever applied to — reports the observed
chars/token per file, and prints the ratio that keeps the estimate
conservative at the 95th percentile. Record the result here:

| Date | Model | Corpus files | Observed p5 chars/token | Adopted ratio |
|---|---|---|---|---|
| *not yet run* | — | 15 | — | 3.2 (placeholder) |

Until that row is filled in, treat the ratio as an assumption that
over-counts on purpose, not as a calibrated constant.

### Budget

The budget is declared per invocation (`--budget <tokens>`, default 8000).
When the ledger exceeds it, `generate` refuses; pass `--allow-over-budget`
to proceed with the over-budget verdict recorded in the receipt.

Ledger by install profile at ecc@2.2.1 (conservative estimate, catalog skill
included; regenerate with `plan` for current numbers):

| Profile | Skills | Agents | Commands | Chars | Estimated tokens |
|---|---|---|---|---|---|
| opencode | 49 | 0 | 95 | 26,977 | 8,431 |
| minimal | 49 | 68 | 95 | 42,422 | 13,257 |
| core | 49 | 68 | 95 | 42,422 | 13,257 |
| security | 68 | 68 | 95 | 48,080 | 15,025 |
| research | 75 | 68 | 95 | 50,190 | 15,685 |
| developer | 126 | 68 | 95 | 62,982 | 19,682 |
| full | 287 | 68 | 95 | 113,687 | 35,528 |

Every install profile is over the 8k default budget, `opencode` included —
it was within budget under the old four-chars-per-token estimate and is not
under the conservative one. `commands-core` ships every command and
`agents-core` every agent, so no install profile is tuned to a context
budget. Narrow with `--without` or module-level selection, declare a budget
that matches the profile, or use finer-grained modules.

## Measured impact

The token ledger measures the *listing payload this repository builds*. What a
session actually pays is a different number, observable only in a real Claude
Code session, and it is the one worth quoting.

`scripts/ci/measure-session-context.md` is the procedure: three otherwise
identical fresh sessions (full `ecc@ecc`, a generated `ecc-minimal`, a
generated `ecc-opencode`), reading `cache_creation_input_tokens` off the first
assistant turn, run twice in opposite order.

| Arm | cache_creation_input_tokens | Saving vs full |
|---|---|---|
| full `ecc@ecc` | *pending* | — |
| `ecc-minimal` carrier | *pending* | *pending* |
| `ecc-opencode` carrier | *pending* | *pending* |

Environment: *pending*.

**These are not yet filled in.** An earlier, pre-rework single-machine
observation of roughly 7.2k tokens saved is not carried forward here: it was
taken before the module split, the conservative ledger, and the
`commands-runtime` change, on an unscripted setup, and a saving reported
without its baseline and its environment cannot be checked. Run the procedure
and record all three raw numbers before quoting any figure.

## Context-profile binding

A carrier's context surface has to be resolved from *something*. The intended
source is ECC's canonical, versioned context-profile registry — the thing ids
like `lean@1` and `full@1` name. **That registry is not published, so nothing
in this repository binds to it.**

What this generator deliberately does *not* do is invent a second one.
Defining profile ids here with their own semantics would create a parallel
contract that has to be reconciled later, and every carrier generated in the
meantime would be indistinguishable from a canonically-bound one.

Instead there is a single, visible seam:
`scripts/lib/plugin-profiles/context-profile.js`.

- **Today** it *projects* ECC's install-profile ids
  (`manifests/install-profiles.json`) onto a context surface. Install
  profiles are an installer concept; `minimal`, `developer`, `opencode` and
  the rest are **install-profile projections**, not context profiles.
- **The registry field is the literal string `install-profiles@unbound`**,
  and `contextProfileDigest` is `null`. Both are written into every receipt
  and printed by `plan`:

  ```text
  Profile:    minimal (registry: install-profiles@unbound, projected from manifests/install-profiles.json)
  ```

  so no carrier can be read as bound to a registry that does not exist.
- **`resolvePluginProfilePlan` calls `resolveContextProfile` and nothing else**
  to obtain the surface. That is enforced by the code path, not by
  convention.

When the canonical registry is published, binding to it is a change to that
one file plus the receipt schema — the `registry` literal and the digest.
No call site moves.

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
| `context.skills/agents/commands`, `context.digest` | the context surface actually shipped (an omitted command is not in this list) and a sha256 over every file's content |
| `capabilities.hooks` | `decision` (`off`/`enabled`), `profile`, capability `groups` |
| `runtime.paths`, `runtime.held`, `runtime.closureEntries`, `runtime.dynamicRequires` | what shipped, what was withheld, why |
| `dependencies.dynamic[]` | every non-literal module load, with `smokeTested`, the smoke `shape`, and the file it lives in |
| `dependencies.external[]` | npm packages a shipped script needs that no carrier carries |
| `dependencies.omittedCommands[]` | commands removed from `context.commands` because of an entry in `external[]`, with the `commands`, `script`, and `module` responsible |
| `dependencies.loadSmoke[]` | every file the smoke exercised and how it went |
| `tokenLedger` | method, version, model (provider only), payload format, `payloadSha256`, counts, chars, tokens, budget, verdict |
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
- Carriers do not ship `node_modules`. A command whose entry script needs an
  npm package is omitted rather than shipped broken; the load smoke names
  the package under `dependencies.external` and the omission under
  `dependencies.omittedCommands` at generation time instead of leaving it to
  fail in a session. At ecc@2.2.1 that omits every `/epic-*` command
  (`sql.js`) and `/project-init` (`ajv`) from every carrier until one of
  those packages is bundled.
- The token ledger is a conservative estimate unless `--measure provider` is
  used; the method label and `payloadSha256` say exactly what produced the
  number. The 3.2 chars/token ratio is a placeholder until
  `scripts/ci/calibrate-token-estimate.js` is run and its result recorded.
- The context surface is a projection of install profiles, not a binding to
  a canonical context-profile registry. See "Context-profile binding" above
  for the seam and what changes when that registry exists.
