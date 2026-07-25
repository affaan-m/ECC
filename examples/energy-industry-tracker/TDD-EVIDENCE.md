# TDD Evidence Report: energy-industry-tracker

Built by following ECC's [`tdd-workflow`](../../skills/tdd-workflow/SKILL.md)
skill directly, as a live demonstration of the ECC harness end to end.

## Source plan

No `*.plan.md` file was used. Requirements were gathered interactively
(clarifying questions on scope: manual watchlist vs. live web lookups;
companies/vendors vs. deals vs. news as the tracked entity) and the user
journeys below were written from that conversation, in the style `/plan`
would produce.

## User journeys

1. As an analyst, I want to add a company to my watchlist with its segment,
   so I can group it with similar vendors later.
2. As an analyst, I want to record optional funding stage, a source link,
   and an initial note when I add a company, so first-pass research isn't
   lost.
3. As an analyst, I want to list the companies I'm actively watching, and
   filter that list by segment, so I can review one part of the market at
   a time.
4. As an analyst, I want to append research notes to a company over time
   without losing earlier notes, so the history of what I learned and when
   is preserved.
5. As an analyst, I want to archive a company instead of deleting it, so
   companies that fall out of relevance stay in the record but out of my
   active list.
6. As an analyst, I want a segment-level summary (count of watched
   companies per segment), so I can see how the industry map is shaped at
   a glance.
7. As an analyst, I want invalid input (missing name, missing segment,
   unknown id, unknown command) to fail clearly with a non-zero exit code,
   so scripts and shells around this CLI can detect errors.

## Task report

| Task | Validation command | Result |
|---|---|---|
| RED: write failing suites for `watchlist-store.js` and the CLI | `node --test tests/*.test.js` | 25 failing on `MODULE_NOT_FOUND` (implementation absent) — commit `5888358` |
| GREEN: implement `src/watchlist-store.js`, `src/cli.js`, `bin/energy-tracker.js` | `node --test tests/*.test.js` | 25/25 passing — commit `010f907`. One real bug found and fixed during this stage: `--file` was only recognized when it appeared after the subcommand; `main()` assumed `argv[0]` was always the command. Fixed by parsing options across the full argv before splitting out the command. |
| Refactor: lint-clean unused handler params, close coverage gaps | `node --experimental-test-coverage --test-coverage-include='src/**' --test tests/cli.test.js tests/watchlist-store.test.js` | 28/28 passing, 100% line / 96.25% branch / 100% function coverage on `src/` — commit `8e22b30` |

## Test specification

| # | What is guaranteed | Test | Type | Result |
|---|---|---|---|---|
| 1 | Adding a company assigns a sequential id and defaults to `watching` with no notes | `tests/watchlist-store.test.js:createCompany adds a watching company with a sequential id` | unit | PASS |
| 2 | Ids increase monotonically based on existing companies | `tests/watchlist-store.test.js:createCompany assigns increasing ids...` | unit | PASS |
| 3 | `createCompany` never mutates the array passed in | `tests/watchlist-store.test.js:createCompany does not mutate...` | unit | PASS |
| 4 | Blank/missing name is rejected | `tests/watchlist-store.test.js:createCompany rejects a missing or blank name` | unit | PASS |
| 5 | Blank/missing segment is rejected | `tests/watchlist-store.test.js:createCompany rejects a missing or blank segment` | unit | PASS |
| 6 | Optional stage, source, and an initial note are stored correctly | `tests/watchlist-store.test.js:createCompany stores optional stage, source and an initial note` | unit | PASS |
| 7 | `listCompanies` defaults to watching-only | `tests/watchlist-store.test.js:listCompanies returns only watching companies by default` | unit | PASS |
| 8 | `--all` includes archived companies | `tests/watchlist-store.test.js:listCompanies returns archived companies too when all is set` | unit | PASS |
| 9 | Segment filter is case-insensitive | `tests/watchlist-store.test.js:listCompanies filters by segment case-insensitively` | unit | PASS |
| 10 | Notes append with a timestamp, other companies untouched | `tests/watchlist-store.test.js:addNote appends a timestamped note...` | unit | PASS |
| 11 | Blank note text rejected | `tests/watchlist-store.test.js:addNote rejects blank note text` | unit | PASS |
| 12 | Unknown id on note throws | `tests/watchlist-store.test.js:addNote throws for an unknown id` | unit | PASS |
| 13 | Archive is idempotent, sets status correctly | `tests/watchlist-store.test.js:archiveCompany marks a company archived and is idempotent` | unit | PASS |
| 14 | Unknown id on archive throws | `tests/watchlist-store.test.js:archiveCompany throws for an unknown id` | unit | PASS |
| 15 | `removeCompany` deletes only the target | `tests/watchlist-store.test.js:removeCompany removes only the matching company` | unit | PASS |
| 16 | Unknown id on remove throws | `tests/watchlist-store.test.js:removeCompany throws for an unknown id` | unit | PASS |
| 17 | Segment summary counts watching companies only, sorted by count then name | `tests/watchlist-store.test.js:segmentSummary counts watching companies...` | unit | PASS |
| 18 | `add` + `list` round-trips through the real CLI and file storage | `tests/cli.test.js:add then list shows the new company as watching` | integration | PASS |
| 19 | `add` without `--segment` fails with a usage error | `tests/cli.test.js:add without --segment exits non-zero...` | integration | PASS |
| 20 | `--segment` and `--all` filters work through the CLI | `tests/cli.test.js:list --segment filters, list --all includes archived companies` | integration | PASS |
| 21 | `--stage`/`--source`/`--notes` flags are parsed and surfaced in `show` | `tests/cli.test.js:add accepts --stage, --source and --notes...` | integration | PASS |
| 22 | `show` reports "No notes." when there are none yet | `tests/cli.test.js:show reports no notes for a freshly added company` | integration | PASS |
| 23 | `segments` reports "No segments tracked." on an empty watchlist | `tests/cli.test.js:segments reports nothing tracked...` | integration | PASS |
| 24 | `note` persists and is visible via `show` | `tests/cli.test.js:note appends research notes visible in show` | integration | PASS |
| 25 | `segments` aggregates counts correctly through the CLI | `tests/cli.test.js:segments summarizes watching companies by segment` | integration | PASS |
| 26 | `rm` permanently removes a company | `tests/cli.test.js:rm permanently removes a company` | integration | PASS |
| 27 | `show` on an unknown id fails clearly | `tests/cli.test.js:show with an unknown id exits non-zero...` | integration | PASS |
| 28 | Unknown subcommands fail clearly and list available commands | `tests/cli.test.js:unknown command exits non-zero...` | integration | PASS |

Evidence command for the full table:

```bash
node --test tests/cli.test.js tests/watchlist-store.test.js
# 1..28 / pass 28 / fail 0
```

## Coverage and known gaps

```bash
node --experimental-test-coverage --test-coverage-include='src/**' \
  --test tests/cli.test.js tests/watchlist-store.test.js
```

```text
file                | line % | branch % | funcs % | uncovered lines
src
 cli.js             | 100.00 |    93.94 |  100.00 |
 watchlist-store.js | 100.00 |    97.87 |  100.00 |
all files           | 100.00 |    96.25 |  100.00 |
```

No known gaps: every exported function and every CLI subcommand has at
least one direct test, and all error paths (missing name, missing segment,
blank note, unknown id, unknown command) are exercised.

Two things are intentionally out of scope for this example, not gaps in
what was promised:

- No live web/network lookups (by design — see README).
- No monorepo-wide `npm run lint` / `npm test` run against this example,
  because the repository's `node_modules` is not installed in this
  sandbox. The code was hand-checked against `eslint.config.js`'s rules
  (`no-unused-vars` with the `^_` ignore pattern, `eqeqeq`) instead.

## Merge evidence

Checkpoint commits on `claude/ecc-end-to-end-jiegyg`:

1. `5888358` — `test: add RED reproducer for energy-industry-tracker` (RED)
2. `010f907` — `fix: implement energy-industry-tracker to GREEN` (GREEN, includes the argv-ordering bug fix)
3. `8e22b30` — `refactor: lint-clean unused params, close coverage gaps` (refactor + coverage)

These are kept as separate commits; if this branch is ever squash-merged,
this file preserves the RED -> GREEN -> refactor trail.
