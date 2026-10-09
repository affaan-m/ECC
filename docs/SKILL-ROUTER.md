# Skill router (opt-in, proposal-only)

A `UserPromptSubmit` hook that **suggests** up to three canonical skills per
prompt. It never selects, loads, or activates a skill. The model reads a
suggested skill only if it decides to.

The hook is a thin consumer of the canonical context-profile surfaces
described in [context profiles](design/context-profiles.md). It owns no
catalog, cache, profile, carrier, or receipt.

## What it consumes, and what it leaves alone

| Concern | Owner | What the router does |
| --- | --- | --- |
| Skill inventory | Canonical registry, `skill-registry@1` ([registry library](../scripts/lib/context-pack-registry.js)) | Reads it through the resolver; keeps no copy |
| Profile | Versioned context profiles `lean@1` and `full@1` ([profile library](../scripts/lib/context-profiles.js)) | Passes a profile ID; the profile library loads and validates it |
| Ranking and admission | `resolveTaskContext` in `suggest` mode ([selection library](../scripts/lib/context-selection.js)) | Keeps candidates that pass the library's `hasSuggestionEvidence`, then the top three; adds no scoring of its own |
| Profile activation, capability grants, sandboxing, execution and evidence state | Their current owners | Nothing. Suggest mode returns `selectedIds: []` and loads no resources |

[`scripts/lib/skill-router.js`](../scripts/lib/skill-router.js) only shapes the
prompt into the resolver's task input, drops candidates below the resolver's
evidence bar, and trims the rest to three.

`hasSuggestionEvidence` reuses the selection library's calibrated tier-2
fallback bar: an exact canonical-name anchor, or BM25 at least 12 with at least
two matched terms. It omits the fallback's margin rule, which compares one pick
against the runner-up rather than judging a single candidate. Anything below
the bar is ranking noise, so the hook says nothing rather than suggesting it.
[`scripts/hooks/skill-router.js`](../scripts/hooks/skill-router.js) handles the
opt-in, the prompt filters, the time bound, and output sanitization.

Because the output is suggestion-only, a prompt crafted to steer the router can
at worst spend three lines of context on the wrong skill. It cannot load a
skill, run a script, or change a permission.

## Enabling

The hook changes what the model sees on every matching prompt, so it is off by
default and is not registered in `hooks/hooks.json`.

```bash
export ECC_SKILL_ROUTER=1                 # or CLAUDE_PLUGIN_OPTION_SKILL_ROUTER=1
export ECC_SKILL_ROUTER_PROFILE=lean@1    # optional: lean@1 (default), full@1, lean, full
export ECC_SKILL_ROUTER_BUDGET_MS=2000    # optional: hard time bound, default 2000
```

Register it as a `UserPromptSubmit` command through the hook wrapper, so that
`ECC_HOOKS_ENABLED`, `ECC_HOOK_PROFILE`, and `ECC_DISABLED_HOOKS` apply:

```bash
node <ecc-root>/scripts/hooks/run-with-flags.js user-prompt:skill-router scripts/hooks/skill-router.js standard,strict
```

An unknown profile ID fails closed: the hook emits nothing and writes the
profile library's error to stderr. It never falls back to a projection of its
own.

## Bounds

- Prompts shorter than 12 characters, slash commands, and `!` commands are
  never routed. Prompts are cut to the resolver's 8192-byte query limit on a
  character boundary.
- The canonical resolver is synchronous and hashes the registry sources on
  every call, so the hook runs it in a child process killed at
  `ECC_SKILL_ROUTER_BUDGET_MS`. The timeout bounds how long the prompt
  blocks, not only whether output is shown. A budget of `0` suppresses
  without starting the child.
- There is no cache. A missing or stale cache cannot silently suppress
  suggestions, because every call reads the current sources.
- Source integrity is the registry's: a symbolic link anywhere in the skill
  source tree makes resolution throw, and the hook emits nothing.
- Output is at most a header plus three bullets. Catalog text is flattened to
  one line with control bytes removed, so a description cannot forge extra
  bullets or terminal escapes.
- Through `run-with-flags.js`, disabled, dry-run, and missing-script paths emit
  empty stdout and never echo the prompt payload into context.

## Evidence

[`scripts/ci/skill-router-eval.js`](../scripts/ci/skill-router-eval.js) runs a
labelled fixture through the same `suggestSkills` call the hook's child makes.
It reports three metrics:

| Metric | Definition |
| --- | --- |
| Prompt hit rate | Prompts with at least one expected skill among the returned suggestions, over all prompts |
| Routed-prompt hit rate | The same hits over prompts that returned any suggestion. Prompt-level: one relevant suggestion out of three counts as a full hit |
| precision@3 | Relevant suggestions over returned suggestions, counted per suggestion |

Expected IDs in a fixture are acceptable alternatives, so recall over the
expected set is not reported.

Both fixtures were written by the router's author. They are **regression
evidence, not an independent benchmark.**
[`tests/ci/skill-router-eval.test.js`](../tests/ci/skill-router-eval.test.js)
runs both on every test run and holds each above a floor set below this
baseline. It also pins the precision@3 definition.

Measured with `lean@1` on Node v24.19.0, Windows 11, 293-skill registry:

| Fixture | Prompts with suggestions | Prompt hit rate | Routed-prompt hit rate | precision@3 |
| --- | --- | --- | --- | --- |
| `prompts.json` (52) | 51 | 0.885 (46/52) | 0.902 (46/51) | 0.553 (52/94) |
| `prompts-adversarial.json` (25) | 7 | 0.080 (2/25) | 0.286 (2/7) | 0.182 (2/11) |

Without the evidence bar, the same resolver returned three candidates for
every prompt in both fixtures:

| Fixture | Prompts with suggestions | Prompt hit rate | precision@3 |
| --- | --- | --- | --- |
| `prompts.json` (52) | 52 | 0.923 (48/52) | 0.372 (58/156) |
| `prompts-adversarial.json` (25) | 25 | 0.160 (4/25) | 0.067 (5/75) |

End-to-end hook latency, fresh process with live resolution: 1071, 1023, 1006,
965, and 908 ms (p50 1006 ms). That is down from 1439 to 1686 ms before
`resolveTaskContext` loaded the registry once and shared it with the profile
compiler; it used to hash the sources twice per call. The evidence bar filters
candidates already ranked, so it does not change latency.

Read these numbers plainly:

- The bar trades recall for precision. On the main fixture it drops two hits
  and 62 suggestions, and precision@3 rises from 0.372 to 0.553.
- On the adversarial slice, 18 of 25 prompts now get no suggestion rather
  than three wrong ones. Two prompts that were weak hits are lost with them.
- The bar is the selection library's existing calibration. It was not tuned
  on either fixture.
- Earlier revisions of this document reported `precision@3: 0.962`. That
  figure was a routed-prompt hit rate from a different, token-overlap matcher,
  so it is not comparable to the tables above.

Re-run:

```bash
node scripts/ci/skill-router-eval.js
node scripts/ci/skill-router-eval.js --fixture tests/fixtures/skill-router/prompts-adversarial.json
node scripts/ci/skill-router-eval.js --json --profile full@1
node scripts/ci/skill-router-eval.js --min-prompt-hit-rate 0.9 --min-precision-at-3 0.3   # gate
```

The evaluator loads the registry once per run and passes it to every call
through the resolver's `registry` option, because its sources cannot change
mid-run. Reads still verify each source digest. Latency is measured
separately, end to end, through the real hook entrypoint (`--latency-samples`,
default 3).

Do not tune against the adversarial fixture by adding its phrasing to skill
descriptions or trigger manifests. That would move the number without moving
the capability.
