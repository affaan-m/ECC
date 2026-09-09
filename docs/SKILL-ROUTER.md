# Structured task resolver (proposal-only)

A `UserPromptSubmit` hook that **suggests** up to three skills per prompt into
context. It does not select, activate, or switch profiles, and it does not
implement the `routed` disposition #3037's context-profile compiler assigns
to `routedIds` — that contract stays exactly what it says: "recorded intent;
task routing and automatic switching are not implemented." This hook proposes
candidates for a human or the model to act on; it commits to nothing on its
own.

It is a discovery affordance inside an already-selected carrier. It does not
decide what a session can do; the carrier already did that.

The hook scores each prompt against the catalog the carrier already holds and
names up to three skills that look relevant. It **suggests; it never loads**.
The model reads a skill because it decided to, from a path inside the plugin
— the resolver only shortens the distance between "I need something" and "it
is at `on-demand/<skill>/SKILL.md`".

That boundary is what makes the feature small enough to be worth having:

- **A skill the router would suggest but the carrier did not carry is a
  carrier defect, not a router job.** The fix is the profile selection, not
  a wider router.
- **Mis-selection cannot escalate capability.** Because the output is
  suggest-only, a prompt crafted to steer the router at best wastes three
  lines of context on the wrong skill. There is no path from a bad
  suggestion to a loaded skill, an executed script, or a changed permission:
  the router has no side effects and no privileges the turn did not already
  have.
- Nothing outside the plugin is ever referenced.

The router changes what the model sees on every matching prompt, so it is a
separate behavioral feature from profile carriers and is **off by default**.

## Relationship to context profiles

#3037's context-profile compiler (`scripts/lib/context-profiles.js`) assigns
every catalog skill a disposition: `selected` (eager), `routed` (recorded as
a candidate but not shipped), or `excluded`. Its own source is explicit about
what that disposition does and does not mean:

> Selection modes are recorded intent; task routing and automatic switching
> are not implemented.

and the design doc's own lane table names this hook directly:

> [#2945] Task routing and automatic-selection proposals — Future structured
> task resolver; `selectionMode: "auto"` alone implements none of this

This hook is that "future structured task resolver," landing as a proposal
step, not the routing #3037 explicitly does not implement:

- **Input**: the carrier's catalog — after the carrier binds to the compiler
  (WP-3), that catalog *is* the compiler's `routedIds` (plus the eagerly
  selected skills), copied into `on-demand/` and listed in the receipt.
- **Output**: suggestions only, printed to stdout for the model to read. No
  disposition is changed, no profile is switched, no skill is activated —
  the compiler's `selected`/`routed`/`excluded` labels for a session are
  exactly what they were before this hook ran.

Closing the gap between "recorded intent" and actual task routing — a
disposition that changes based on what this hook suggests — is future work,
not something landed here.

## Enabling

```bash
# Environment (highest precedence)
export ECC_SKILL_ROUTER=1

# Or the plugin option
CLAUDE_PLUGIN_OPTION_SKILL_ROUTER=1
```

Hook id: `user-prompt:skill-router`. It respects the usual hook controls
(`ECC_HOOKS_ENABLED`, `ECC_HOOK_PROFILE` via its `standard,strict` profile
list, `ECC_DISABLED_HOOKS`) in addition to the explicit opt-in above. Without
the opt-in the hook runs and emits nothing.

## Bounds

- Prompts shorter than 12 characters, slash commands, and `!` commands are
  never routed.
- **The hot path performs two filesystem reads and never constructs a
  catalog.** One `statSync` of the skills directory (the cache signature)
  and one `readFileSync` of the cache. Scoring is in-memory. Catalog
  construction — a directory walk that reads every `SKILL.md` — cannot
  happen on prompt submit, by construction rather than by deadline: with no
  usable cache the hook emits nothing and writes one line to stderr.
- Routing that takes longer than `ECC_SKILL_ROUTER_BUDGET_MS` (default 150)
  emits nothing and logs the overrun to stderr. This is now defence in
  depth against a pathological prompt or a very large cache rather than the
  primary bound.
- Output is at most a header plus three bullets. Catalog text is flattened
  to one line with control bytes removed before it reaches the model, so a
  crafted description cannot forge additional bullets or terminal escapes.
- Receipt catalog rows are accepted only when their path is inside
  `skills/` or `on-demand/`; anything else is dropped before scoring.
- The catalog cache lives under `~/.claude/cache` (override:
  `ECC_SKILL_ROUTER_CACHE_DIR`), is written with mode 0600 through an
  exclusive temp file and atomic rename, and never follows a planted symlink.
  A cache that is missing, stale (its signature no longer matches the skills
  directory), or malformed is treated as absent: no suggestions, no rebuild.
- Through `run-with-flags.js`, a disabled, dry-run, or missing
  UserPromptSubmit hook emits empty stdout rather than echoing the raw
  payload into context.

## Where the catalog is built

Never on prompt submit. Two places, both off the hot path:

| Install shape | Source of the catalog |
|---|---|
| Generated profile carrier | The receipt. `ecc-profile.json` already carries the full catalog with per-skill paths, so a carrier needs no cache at all. |
| Non-carrier install | `scripts/hooks/skill-router-cache.js`, a SessionStart hook gated by the same opt-in env var, with a 2s scan budget. |

A cold catalog build over this repository takes roughly **1.4 seconds**
(`skill-router-eval.js`, cold build+route). That is what used to sit behind a
deadline on a blocking prompt hook; it is now paid once per session, at
session start, where a delay costs one session start rather than every turn.

The in-scan deadline is kept for the SessionStart build as defence in depth:
an incomplete scan is never written to the long-TTL cache, because caching a
truncated scan would silently hide skills for up to six hours.

## Evidence

`scripts/ci/skill-router-eval.js` scores the router against
`tests/fixtures/skill-router/prompts.json` (52 labelled prompts across
frontend, backend, data, mobile, infra, security, research, and homelab
skill families) and measures latency. A prompt is a hit when any expected
skill appears in the routed top-3.

Measured on the commit that introduced this file (Node v24, Windows 11,
286-skill catalog):

```text
precision@3: 0.962  recall@3: 0.962  (hits 50, routed 52)
latency warm p50/p95: 2.88ms / 3.61ms; cold (3 runs): 70, 70, 70ms
miss: "migrate this component from react to vue" expected ui-to-vue|vue-patterns got react-native-patterns, react-patterns, react-testing
miss: "write pytest tests for the payment module" expected python-testing got agent-payment-x402, django-tdd, fastapi-patterns
```

Caveats, stated plainly: the fixture was written by the router's author, so
it is a regression fixture rather than an independent benchmark; "pytest"
does not tokenize to "python", and prompts that name two ecosystems rank the
one with more skills. Re-run with:

```bash
node scripts/ci/skill-router-eval.js            # human-readable
node scripts/ci/skill-router-eval.js --json     # machine-readable
node scripts/ci/skill-router-eval.js --min-precision 0.9 --min-recall 0.9   # gate
```

### The adversarial slice

`tests/fixtures/skill-router/prompts-adversarial.json` is 25 prompts phrased
the way a problem is actually experienced, deliberately sharing **no content
tokens** with the target skill's id or description ("the page jumps around
when I tab through the form" for `frontend-a11y`).

```bash
node scripts/ci/skill-router-eval.js --fixture tests/fixtures/skill-router/prompts-adversarial.json
```

| Fixture | precision@3 | recall@3 |
|---|---|---|
| `prompts.json` (52) | 0.962 | 0.962 |
| `prompts-adversarial.json` (25) | **0.214** | **0.120** |

That gap is the honest characterisation of a token-overlap router: it works
when the user already knows the vocabulary and mostly does not when they do
not. Two thirds of the adversarial prompts route nothing at all, which is the
preferable failure — silence rather than a confident wrong suggestion.

This slice is reported, not gated. Tuning the router against it by adding
these phrasings to skill descriptions would move the number without moving
the capability, and the fixture says so in its own notes.

## Scoring

Tokens are lowercase alphanumeric runs of three or more characters minus a
small stopword list; long plurals also contribute their singular. A skill-id
token match scores 3, a description token match scores 1; a skill needs a
score of at least 3 to be suggested; ties break alphabetically so output is
deterministic.
