# Session Aliases — alias-first session management

**Status:** shipped 2026-07-08 (PR #19)
**Verification:** e2e-verified 2026-07-08 — [verify report](./verify/session-alias-registry-2026-07-08.md), 12/12 items VERIFIED PASS. **BA sign-off: ACCEPTED 2026-07-08** (items 9-12 closed the initial coverage objection; every spec promise now has verified evidence). Three honest gaps remain accepted — see limitations. Status flips to "shipped" only when PR #19 merges.
**Owner intent (Frank):** "I want persistent sessions I can switch to by alias. Hide session IDs from me. One alias = one project/topic. Same-alias context should be together, otherwise it's confusing."

## Problem

Sessions were addressed by opaque IDs, and context for one project/topic ended up
scattered across many session files and folders. Switching back to a piece of work
meant remembering IDs and manually stitching context together.

## What it does

An **alias** is the human name for a project/topic. Everything session-related is
organized around aliases, and session IDs are hidden from the user.

- **Explicit registry** (`~/.claude/session-registry.json`) is the source of truth:
  many sessions map to exactly one alias; an alias can own one or more folders
  (e.g. worktrees). New sessions automatically join their folder's alias.
- **`/sessions`** shows an alias overview: the current folder's alias, a table of
  all aliases, and any unassigned folders with *suggested* names — it suggests and
  waits for confirmation, never silently creates.
- **`/sessions switch <alias>`** loads the WHOLE alias context: all member
  summaries (unbudgeted) plus transcripts from every attached folder
  (token-budgeted). When a folder is shared by two aliases, transcripts are
  scoped to THIS alias's own sessions by default (added 2026-07-08);
  `--all-transcripts` opts into loading the folder's full history for richer
  context.
- **Organizing verbs** (all human-initiated):
  - `attach` — let one alias span multiple folders
  - `assign` — move a session to an alias
  - `gather --topic` — pull topic-matching sessions (from anywhere) into an alias
  - `absorb` — merge whole aliases into one
  - `consolidate` — fold all members into ONE latest session file; older files
    are archived (`session-data/archive/`), never deleted
  - `rename`, `unalias`
  - `ignore` — mark scratch folders (e.g. `~/claude_adhoc`) as never-tracked
- **Session-start hint:** when a session starts, the user gets a contextual nudge —
  folder has an alias (offer to switch into it), folder hosts multiple aliases
  (ask which), no alias (ask to create one, suggested name = folder name),
  ignored folder (stay silent).
- **No automatic pruning:** session retention cleanup is disabled globally;
  any cleanup is manual and human-confirmed.

## Decisions (product altitude)

| # | Decision | Why |
|---|----------|-----|
| 1 | Membership lives in an explicit, inspectable **registry file** — not derived from folder layout | One folder can host two aliases, and sessions must be reassignable; deriving from folders can't express either |
| 2 | **Many sessions → one alias**; each session belongs to exactly one alias | Frank: "One alias = one project/topic. Same-alias context should be together, otherwise it's confusing" |
| 3 | Merging is **lazy at load time** by default; physical `consolidate` is opt-in and **archives rather than deletes** | Full context on switch without destructive side effects; nothing is lost by default |
| 4 | **Nothing is created or deleted silently** — unaliased folders get a suggestion and wait for a human yes; cleanup is manual | Trust: the registry stays something the human recognizes as their own organization |
| 5 | "Ask to persist" moved from session **exit** to session **start** | An exit-time prompt is infeasible (hooks can't prompt the user); continuous auto-save after every response already covers persistence, so the human question happens as a start-of-session hint instead |

## Honest limitations

- Alias switching loads transcripts under a token budget — very large aliases
  won't fit their entire history in one switch.
- `gather --topic` depends on topic matching quality; it proposes membership,
  it doesn't guarantee perfect recall.
- With global retention pruning off, session data grows until the human
  consolidates or cleans up manually — that's by design, but it's on the human.
- **No unit tests for the overlay code** (accepted 2026-07-08): matches the
  existing precedent for `fsun_config/custom` overlays; the risky paths are
  covered by e2e evidence in the verify report instead. Known residual risk: a
  future change to scanning at scale could silently drop memberships — the
  verify report recommends pinning that behavior with a test before it's touched.
- **Real interactive scratch-folder session not yet exercised by a human**
  (accepted 2026-07-08): the no-persist gate for `~/claude_adhoc` was verified
  exactly as wired, but only a real interactive session proves Claude Code
  injects the disabling setting end-to-end. Human check (from the
  [verify report](./verify/session-alias-registry-2026-07-08.md), "NOT VERIFIED"):
  start a session in `~/claude_adhoc`, exit, then confirm NO new file appears in
  `~/.claude/session-data/`.
- **LLM-assisted paths not exercised** (accepted 2026-07-08): all verification
  ran with LLM scoring/summarizing switched off, so topic relevance was proven
  only on the keyword fallback. The LLM path's quality is unproven until someone
  runs a real topic-filtered switch interactively (human check documented in the
  verify report, "NOT VERIFIED").

## Machine wiring (per-computer, manual)

`ecc.js sync` installs the code, but each machine needs five manual setup
steps (they are settings/folders, not repo files):

1. **Stop hook -> gated save** (also fixes the phantom-stub bug, found
   2026-07-08: every ECC save spawns a `claude -p` summarizer helper whose own
   Stop event wrote a ~27-line stub into session-data/):

   ```json
   "Stop": [{ "hooks": [{ "type": "command",
     "command": "node \"$HOME/.claude/scripts/hooks/session-save-gate-fsun.js\"" }]}]
   ```

2. **SessionStart hook -> alias hint**:

   ```json
   "SessionStart": [{ "hooks": [{ "type": "command",
     "command": "node \"$HOME/.claude/scripts/hooks/session-alias-hint-fsun.js\"", "timeout": 10 }]}]
   ```

3. **Retention off**: `"env": { "ECC_SESSION_RETENTION_DAYS": "off" }`

4. **Scratch folder**: `mkdir -p ~/claude_adhoc/.claude` with a local
   `settings.json` of `{"env": {"ECC_DISABLED_HOOKS": "stop:session-end,session:end:marker"}}`,
   plus `/sessions ignore ~/claude_adhoc`.

5. **No AI attribution in commits/PRs**: in `~/.claude/settings.json` set
   `"attribution": {"commit": "", "pr": "", "sessionUrl": false}` (the older
   `"includeCoAuthoredBy": false` is deprecated but harmless to keep). Claude Code adds a
   `Co-Authored-By: Claude` trailer and a "Generated with Claude Code" footer by default;
   `rules/frank/preferences.md` forbids both.

## Verification & evidence

Evidence for this feature lives in [`docs/verify/`](./verify/) — one dated report
per verification run; the report is the durable record, this section is the BA's
criterion-by-criterion acceptance against the spec.

**Report:** [session-alias-registry-2026-07-08.md](./verify/session-alias-registry-2026-07-08.md)
— verdict PASS-WITH-GAPS, all 12 checklist items VERIFIED PASS (items 9-12 added
after the BA's first review objected to coverage gaps). Item 7 (scratch
no-persist) initially FAILED — the disable setting was set but nothing honored
it — fixed same day and re-verified PASS; the FAIL is preserved in the report as
history.

**BA review 2026-07-08 (final, after items 9-12) — spec promise vs verified evidence:**

| Spec promise | Evidence | Coverage |
|---|---|---|
| Registry as source of truth; create/rename/unalias round-trip | item 1 | covered |
| New sessions auto-join folder's alias; ambiguous (two-alias) folder is never silently assigned | items 2a, 2b | covered |
| Suggest-and-confirm, never silent-create; suggested name = folder name | item 6c | covered |
| `absorb` merges aliases and their folders | item 3 | covered |
| `consolidate` archives, never deletes | item 4 | covered |
| Session-start hint — all four branches, plus broken/unreachable-registry failure modes | items 6a-6f | covered |
| `ignore`: scratch folders silent + not persisted | items 6b, 7a, 7b | covered (except human step above) |
| No member lost when scanning at scale | item 8 | covered |
| **`switch <alias>` loads the WHOLE alias context** (member summaries + transcripts from every attached folder) | items 9, 9b, 9c: all member summaries loaded, transcripts from BOTH attached folders, budget enforced (tiny budget skips whole transcripts rather than truncating), rendered output complete, read-only run on a real alias left the registry untouched | covered |
| `gather --topic` actually moves sessions | items 5 (dry-run: no change) + 10 (real run: membership moved in the live registry) | covered |
| `attach` / `assign` verbs | item 11: alias grew a second folder, new sessions auto-joined from it, explicit assign moved a session between aliases | covered |
| Retention pruning disabled globally | item 12: setting confirmed "off", the pruning logic verified to stand down on it, and no pruning path is active at all | covered |

**BA verdict: ACCEPTED (signed-off) 2026-07-08.** First review (same day) withheld
sign-off because `switch` — the behavior the whole feature exists for — plus
mutating `gather`, `attach`/`assign`, and retention-off had no verified evidence;
items 9-12 closed all four gaps. Evidence quality is high throughout: registry
integrity proven byte-identical before/after every mutation test, zero test
residue, honest FAIL history kept. The earlier pre-merge caveat (verified code
included uncommitted changes) is resolved: the verified code is now committed at
the branch head, independently cross-checked by the BA; remaining working-tree
changes are these docs only. Sign-off covers verification, not release — status
flipped to shipped when PR #19 merged (2026-07-08).

## Relationship to prior work

Extends the context-rich `/sessions load` overlay (see
[sessions-extended.md](./sessions-extended.md)). That doc covers budgeted
transcript loading and topic filtering; this doc covers the alias/registry
organization layer built on top of it.
