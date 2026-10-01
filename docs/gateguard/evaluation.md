# GateGuard evaluation

How to tell whether a change to the fact-forcing gate
(`scripts/hooks/gateguard-fact-force.js`) improves it: ask the right question
at the right time, deny less where a denial repeats work already done, and
never let a security-critical target through.

`scripts/dev/gateguard-eval.js` replays a corpus of realistic sessions against
the working-tree hook and against the hook at one or more git refs, and
compares the decisions. `tests/hooks/gateguard-scenarios.test.js` replays the
same corpus against the working tree only and fails if any step's decision
changes.

## What is measured

Every step of a scenario is one hook call. The corpus author labels each step
with the decision the gate should make and why it matters:

| Label | Meaning |
|---|---|
| `expect` | `deny` or `allow` (allow covers prior-search credit, sibling collapse, trivial edits, read-only shell commands and plain passes) |
| `mustDeny` | Security-critical: sensitive targets, bypass attempts, mutating or destructive first commands. Any allow is a bypass. |
| `redundant` | A denial here would repeat investigation the session already did (a scoped search that names the file, a same-turn sibling, a comment-only edit, a read-only first command). |
| `relevantQuestions` | For code targets, the question ids the change genuinely warrants (see the question table in [design-notes.md](change-profile.md#questions-from-the-change-profile)). |

Metrics per hook:

- **Denials**: every denial costs the agent a round trip and context.
- **Redundant denials**: denials on steps labelled `redundant`.
- **Must-deny bypasses**: allows on steps labelled `mustDeny`. Must be 0 for
  the working tree.
- **Expectation mismatches**: decisions that differ from `expect`. Must be 0
  for the working tree; for a baseline they are the behaviour the branch
  changes.
- **Irrelevant questions asked**: for denials of code targets, asked question
  ids that are not in `relevantQuestions`. Questions are read from the
  numbered list of a full denial, or from the phrases of a condensed one-line
  denial (issued after the first three denials of a session): the working
  tree's per-question phrases (`condensedQuestionPhrase`) and the fixed hint
  older hooks use. The condensed rows count the ones asked in condensed
  denials only.
- **Warranted questions not asked**: `relevantQuestions` ids a code denial did
  not ask. Asking fewer questions must not drop the ones that matter.
- **Estimated denial tokens**: characters of all denial reasons divided by 4.
- **Allows with a note**: how the working tree avoided a denial.
- **Hook latency, fresh process**: `require()` of the hook plus `run()`, timed
  inside a new Node process per step, which is how Claude Code runs a hook.
  Node start-up itself is excluded; it is the same for every hook. See
  [Latency](#latency).
- **run() latency, warm**: wall time of `run()` in the scenario's worker, after
  the hook module is loaded. Modules the hook loads lazily count on the step
  that first needs them.

The latency rows are the only non-deterministic metrics.

Each scenario runs in its own temp project (files, symlinks and hard links
created from the fixture), with its own transcript, `GATEGUARD_STATE_DIR`, `HOME` and a
clean environment (`PATH`, `CLAUDE_PROJECT_DIR`, plus the scenario's `env`),
in a fresh worker thread, so module state and state files never leak between
scenarios or hooks. A baseline hook is materialised from `git show
<ref>:scripts/hooks/gateguard-fact-force.js` plus every file it requires
relatively at that ref, into a temp tree that mirrors the repo layout.

## Results

Working tree = branch `gateguard-full`; `upstream/main` = `c70874fa`;
`4b02f669` = the pull request head before this round. Node 22, Linux.

```text
Corpus: 20 scenarios, 184 steps.
```

| Metric | working tree | upstream/main | 4b02f669 |
| --- | ---: | ---: | ---: |
| Steps | 184 | 184 | 184 |
| Denials | 132 | 157 | 132 |
| Redundant denials | 0 | 38 | 0 |
| Must-deny bypasses | 0 | 8 | 0 |
| Expectation mismatches | 0 | 55 | 0 |
| Irrelevant questions asked | 2 | 187 | 2 |
| Irrelevant questions in condensed denials | 2 | 111 | 2 |
| Warranted questions not asked | 1 | 57 | 1 |
| Estimated denial tokens | 25633 | 27796 | 25633 |
| Allows with a credit note | 12 | 0 | 12 |
| Allows with a sibling note | 11 | 0 | 11 |
| Allows with a trivial-edit note | 5 | 0 | 5 |
| Hook latency p50, fresh process (ms) | 23.68 | 11.58 | 27.05 |
| Hook latency p90, fresh process (ms) | 30.94 | 14.29 | 33.61 |
| Hook latency p95, fresh process (ms) | 33.16 | 16.57 | 38.57 |
| run() latency p50, warm (ms) | 1.72 | 0.90 | 2.02 |
| run() latency p90, warm (ms) | 6.62 | 2.33 | 6.93 |
| run() latency p95, warm (ms) | 11.84 | 2.63 | 8.98 |

| Scenario | Steps | Denials: working tree | Denials: upstream/main | Denials: 4b02f669 |
| --- | ---: | ---: | ---: | ---: |
| docs-heavy-session | 14 | 6 | 12 | 6 |
| scaffold-module | 10 | 3 | 10 | 3 |
| bugfix-after-scoped-search | 6 | 1 | 3 | 1 |
| cold-writes | 5 | 3 | 4 | 3 |
| exported-api-edits | 6 | 6 | 6 | 6 |
| internal-only-edits | 5 | 4 | 4 | 4 |
| data-handling-edits | 5 | 5 | 5 | 5 |
| comment-only-edits | 10 | 6 | 9 | 6 |
| sensitive-targets | 8 | 8 | 8 | 8 |
| subagent-edits | 6 | 3 | 1 | 3 |
| first-shell-commands | 20 | 11 | 17 | 11 |
| windows-paths | 8 | 5 | 7 | 5 |
| bypass-search-filters | 19 | 15 | 19 | 15 |
| bypass-turn-and-batch | 7 | 7 | 7 | 7 |
| bypass-siblings | 11 | 11 | 11 | 11 |
| cap-with-sensitive | 6 | 4 | 6 | 4 |
| bypass-comment-context | 22 | 21 | 19 | 21 |
| exported-members | 6 | 6 | 6 | 6 |
| notebook-edits | 6 | 4 | 0 | 4 |
| hard-linked-targets | 4 | 3 | 3 | 3 |

### Reading the results

Against `upstream/main`:

- 16% fewer denials (157 to 132) and 8% fewer denial tokens, with every
  redundant denial in the corpus gone (38 to 0).
- All eight must-deny bypasses closed: `upstream/main` lets a subagent edit
  `src/auth/oauth.js`, `config/secrets.yaml` and a hard-linked file without a
  question, never gates a MultiEdit call that names its file in
  `tool_input.file_path` (the tool's own shape), so `.env`,
  `config/.env.local` from a subagent and a first-touch code file all pass,
  and never gates NotebookEdit, so notebooks under `auth/` and `payments/`
  pass from the parent and from a subagent.
- Irrelevant questions drop from 187 to 2 and warranted-but-unasked from 57
  to 1: edits without a public-surface line ask for local call sites instead
  of importers, members of exported interfaces, enums, export lists,
  dataclasses and `pub` enums keep the importer questions, the data-schema
  question is asked only when the change touches data, and condensed denials
  name the same questions as full ones.
- Denials rise only where they should: the subagent's first touch of a
  sensitive or hard-linked file, MultiEdit calls, NotebookEdit calls, the first
  mutating shell command after a read-only one (`upstream/main` spends its
  once-per-session routine gate on `ls`), and the first code-changing edit
  after a comment-only one (the comment edit no longer spends the file's first
  touch).

Against `4b02f669` (the pull request head before this round): the same
decisions, questions and notes on every step; only latency changes (see
[Latency](#latency)). `bypass-search-filters` includes a search whose
directory-qualified include (`rg -g 'src/**' sweep .`) keeps the target in
`lib/` out of the search; it must be denied, and the control that searches
the target's own directory is credited.

Four scenarios come from security reviews of this change.
`bypass-comment-context` holds 21 must-deny steps: comment-looking edits that
change code in their file (a comment line after a continued C macro, a line
break dropped so the next line joins a comment, lines inside a template
literal, a docstring and a heredoc, a snippet that starts inside a string,
`replace_all` reaching a string), directive comments (shebang, encoding
cookie, `# type:`, `# nosec`, `@ts-expect-error`, `eslint-disable`,
`//go:build`, `//go:embed`, a cgo preamble, a Rust doc test), MultiEdit calls
naming their file once, and `rg -z` as a first shell command; plus one
comment edit below closed templates and regexes that should still pass.
Before the fixes the branch let 20 of those 21 through (every edit and
`rg -z` as a trivial or read-only pass, and the three MultiEdit calls);
`upstream/main` lets the three MultiEdit calls through.
`exported-members` holds six member edits whose container declaration sits
outside the snippet; before the fixes the branch asked for local call sites
on the five public ones (5 irrelevant questions, 10 warranted ones not asked).
`notebook-edits` covers a cold NotebookEdit, its retry, a credited test
notebook, a comment-only cell and sensitive notebooks in the parent and a
subagent; every earlier hook allows all six calls. `hard-linked-targets`
edits a second name of a file after a search that names it, makes a
comment-only change to another linked file and edits a linked file from a
subagent, with a single-link control; before the fix the branch allowed all
three (credit, trivial pass, subagent bypass).

What the working tree still gets wrong, by the corpus's own labels:

- Sensitive targets are never profiled, so a sensitive code Write always asks
  the data-schema question (`symlinked-auth-first`, `symlinked-auth-sibling`:
  the 2 irrelevant questions).
- NotebookEdit and hard-linked targets always get the full questions; the
  corpus labels all four as warranted for them, so this costs nothing in the
  table, but a notebook cell that handles no data still gets the data-schema
  question.
- The C edit that turns a declaration into a comment continuation
  (`c-comment-continuation`) has no data words, so the condensed hint no
  longer mentions data schemas; the corpus labels that question as warranted
  (the 1 unasked one).
- Latency: a first touch costs more than on `upstream/main` because it reads
  the transcript, matches the searches that name the target, reads the target
  file and profiles the change (fresh-process p50 23.7 ms against 11.6 ms,
  p90 30.9 ms against 14.3 ms on this corpus, where every step is a first
  touch or a gate). The warm p95 is higher than `4b02f669`'s because modules
  now load on the first step that needs them instead of before the timer
  starts; the fresh-process rows count both. See [Latency](#latency) for
  each call type with confidence intervals.

## Reproduce

```bash
git fetch upstream main
node scripts/dev/gateguard-eval.js --markdown
node scripts/dev/gateguard-eval.js --markdown --baseline upstream/main --baseline 4b02f669
node scripts/dev/gateguard-eval.js --json > gateguard-eval.json
node scripts/dev/gateguard-eval.js --baseline upstream/main --sarif gateguard-eval.sarif
node scripts/dev/gateguard-latency.js --baseline upstream/main --runs 40
node tests/hooks/gateguard-scenarios.test.js
```

`--baseline <ref>` takes any ref and can be repeated (default
`upstream/main`); pass the pull request head (`4b02f669` above) to compare
against it. `--corpus <dir>` points at another
scenario directory. The script exits non-zero when the working tree has a
mismatch, a must-deny bypass, an explicit `allow` decision or a thrown error.
`--sarif <file>` also writes those working-tree failures as SARIF 2.1.0
(bypasses, explicit allows and errors as `error`, other mismatches as
`warning`) with each hook's totals in the run properties. Timing is left out,
so the file is identical across reruns of the same tree and corpus.

## Latency

The fresh-process pass replays every scenario again, with a new state
directory and transcript, and runs each step with
`node -e <probe> <hook> <payload>`. Its decisions must match the worker's;
a step decided differently fails the run. `--no-cold` skips the pass.

Per call type, `scripts/dev/gateguard-latency.js` runs each hook in a new
Node process per sample, interleaving the hooks in a shuffled order every
round so machine load affects them alike, and reports p50 and p90 with 95%
percentile-bootstrap intervals for the difference from each baseline. A
change counts as faster or slower only when its interval excludes zero. The
fixture is a 20-search turn, a 50-function file, a 406 KiB file and a
`CLAUDE.md`; Node 22 on Linux, 2 cores.

40 fresh processes per call type and hook, interleaved; require() + run() in ms; 95% bootstrap intervals of the working tree minus the baseline.

| Call | working tree p50 / p90 | 4b02f669 p50 / p90 | upstream/main p50 / p90 |
| --- | ---: | ---: | ---: |
| Shell command, first of session | 16.9 / 19.9 | 25.7 / 33.4 | 14.5 / 18.0 |
| Shell command, routine gate passed | 15.6 / 19.7 | 24.3 / 27.0 | 13.8 / 17.4 |
| Edit of a file already checked | 14.1 / 19.2 | 22.9 / 28.8 | 11.6 / 15.3 |
| First edit, code, denied | 25.7 / 32.0 | 37.3 / 44.3 | 12.4 / 13.9 |
| First edit, comment-only pass | 29.5 / 35.2 | 42.7 / 47.9 | 12.5 / 14.5 |
| First edit, CLAUDE.md, denied | 21.4 / 24.4 | 35.1 / 41.8 | 12.3 / 16.0 |
| First edit, 406 KiB file, denied | 27.9 / 34.5 | 59.0 / 67.5 | 12.2 / 16.6 |

| Call | p50 change vs 4b02f669 | p90 change vs 4b02f669 |
| --- | --- | --- |
| Shell command, first of session | [-10.5, -7.8] faster | [-16.0, -6.2] faster |
| Shell command, routine gate passed | [-9.6, -7.7] faster | [-11.5, -5.3] faster |
| Edit of a file already checked | [-10.7, -7.0] faster | [-16.1, -6.5] faster |
| First edit, code, denied | [-13.6, -10.0] faster | [-19.1, -6.5] faster |
| First edit, comment-only pass | [-15.4, -10.9] faster | [-19.7, -4.6] faster |
| First edit, CLAUDE.md, denied | [-16.4, -11.6] faster | [-25.3, -14.4] faster |
| First edit, 406 KiB file, denied | [-32.5, -29.3] faster | [-41.7, -25.9] faster |

| Call | p50 change vs upstream/main | p90 change vs upstream/main |
| --- | --- | --- |
| Shell command, first of session | [2.0, 3.0] slower | [-0.6, 7.4] no measurable change |
| Shell command, routine gate passed | [1.3, 2.2] slower | [-2.1, 4.7] no measurable change |
| Edit of a file already checked | [2.0, 3.0] slower | [-0.6, 6.8] no measurable change |
| First edit, code, denied | [12.2, 14.7] slower | [14.3, 21.5] slower |
| First edit, comment-only pass | [15.5, 17.9] slower | [16.0, 28.6] slower |
| First edit, CLAUDE.md, denied | [8.3, 10.2] slower | [6.0, 11.0] slower |
| First edit, 406 KiB file, denied | [14.5, 16.4] slower | [13.7, 21.3] slower |

Against `4b02f669` every call type is faster at p50 and p90. Against `main`,
shell commands and repeat edits are 1.3 to 3 ms slower at p50 with no
measurable p90 difference; a first touch costs 8 to 18 ms more because it
reads the transcript, parses the turn's searches that name the target, reads
the target file and profiles the change, which `main` does not do. Each hook
call is a new Node process, so the code a call runs is also compiled on that
call, and that compilation is most of the remaining difference. A V8 code
cache written after each run was tried and measured end to end through
`run-with-flags.js`: setting it up and loading the cached code cost about as
much as the compilation it saved.

Each commit of this round was measured the same way (40 samples per call
type and version); no commit is slower at p50 or p90 than the one before it
on any call type:

| Commit | Change in ms, point estimate (95% interval) |
| --- | --- |
| Load modules and parse searches only when needed | every call type faster: p50 -8.4 to -14.1, p90 -9.1 to -14.5 |
| Skip plain character runs when lexing | comment-only pass p50 -3.3 (-5.3 to -2.2); no other measurable change |
| Read the transcript tail through a small module | no measurable change |
| Profile a change only when used, window first | 406 KiB file p50 -19.9 (-21.5 to -18.3), p90 -19.8 (-37.8 to -13.9); `CLAUDE.md` p50 -4.3 (-5.6 to -2.9); no other measurable change |

## Corpus format

One JSON file per scenario in `tests/fixtures/gateguard-scenarios/`:

- `name`, `description`;
- `files` (project-relative path to content), optional `dirs`, `symlinks`
  (link path to target, relative to the link) and `hardlinks` (link path to
  an existing project file, both project-relative), created in a temp project;
- optional `root` (a fixed project path, used for Windows-style paths, where
  nothing is created on disk) and `env` (extra environment variables);
- `steps`, in order. Each step has an `id`, an optional `note`, the
  `transcript` records appended to the session transcript before the call
  (human prompts with `promptId`, assistant `tool_use` records with
  `message.id`, `tool_result` records, compaction boundaries, and the pending
  call's own `tool_use` record), the hook `payload`, and the labels above.

`{{root}}` and `{{transcript}}` in any string are replaced with the temp
project and transcript paths. Transcripts are the same for every hook: a
step's call is assumed to succeed eventually, so the next step's records start
with its `tool_result`.

A scenario with `symlinks` or `hardlinks` is skipped (and reported) where the
links cannot be created, such as Windows without the symlink privilege or a
file system without hard links.

## Limits

- The corpus is synthetic. Sessions were written to resemble real ones, not
  sampled from them, so the denial counts show the direction and size of a
  change, not rates to expect in the field. Opt-in metrics
  (`GATEGUARD_METRICS=1` and `scripts/gateguard-report.js`) measure real
  sessions.
- The labels are the corpus author's judgement, made with the design in mind.
  `redundant` and `relevantQuestions` in particular are opinions: a different
  author could call the README or CHANGELOG edits after a docs-wide search
  redundant, or leave out the data-schema question for
  `c-comment-continuation`.
  Zero redundant denials means the working tree handles the cases this author
  judged redundant, not that it never repeats a question.
- Question relevance is read from denial text. Condensed denials are mapped by
  phrase, and a hedged phrase ("data schemas if any") counts as asked.
- A baseline sees the same transcript as the working tree even where it would
  have denied an earlier call; retries are not modelled, and a denied call's
  retry is assumed to pass.
- The routine shell gate is once per session, so a baseline that spent it on
  a read-only command shows an allow on a later mutating command. That counts
  as a mismatch, not a bypass (`mustDeny` is set only where the baseline's own
  gate should also deny).
- Windows-style paths run lexically on non-Windows hosts; realpath and symlink
  behaviour for them is not exercised.
- Latency is measured in process for `run()` only (no Node start-up), on the
  machine that ran the evaluation.
