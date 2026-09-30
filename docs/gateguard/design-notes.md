# GateGuard design notes

Rationale for the decisions in the GateGuard fact-forcing gate
(`scripts/hooks/gateguard-fact-force.js` and `scripts/lib/gateguard-*.js`).
Code comments point here as `docs/gateguard/design-notes.md#<anchor>`; keep
headings stable, since they are the anchors. How a change is read (questions
and trivial edits) is in [change-profile.md](change-profile.md).

## Index

- Structure: [Module layout](#module-layout), [Fail to deny](#fail-to-deny).
- Which targets are gated and how strictly:
  [Exempt globs](#exempt-globs), [NotebookEdit](#notebookedit),
  [MultiEdit paths](#multiedit-paths), [Sensitive targets](#sensitive-targets),
  [Hard-linked targets](#hard-linked-targets),
  [Target resolution](#target-resolution), [Target classes](#target-classes),
  [Worktree prefix](#worktree-prefix),
  [Windows name normalization](#windows-name-normalization).
- Right question: [Change profile](change-profile.md#change-profile),
  [Public surface](change-profile.md#public-surface), [Data handling](change-profile.md#data-handling),
  [Shell scripts](change-profile.md#shell-scripts), [File context](change-profile.md#file-context),
  [Questions from the change profile](change-profile.md#questions-from-the-change-profile),
  [Trivial edits](change-profile.md#trivial-edits), [Directive comments](change-profile.md#directive-comments),
  [Closest search that did not count](#closest-search-that-did-not-count).
- Right time, prior-search credit: [Read is not evidence](#read-is-not-evidence),
  [Turn boundaries](#turn-boundaries), [Turn identity](#turn-identity),
  [Tool result pairing](#tool-result-pairing),
  [Same-batch searches](#same-batch-searches),
  [Ambiguous shell is not evidence](#ambiguous-shell-is-not-evidence),
  [Directory changes](#directory-changes),
  [Stdin is not a tree search](#stdin-is-not-a-tree-search),
  [Search scope](#search-scope), [Stem matching](#stem-matching),
  [Test stems](#test-stems), [Search filters](#search-filters),
  [Include filters](#include-filters),
  [Glob matching without RegExp](#glob-matching-without-regexp),
  [Flag parsing](#flag-parsing),
  [PowerShell parameter binding](#powershell-parameter-binding).
- Right time, other allowances: [New-file detection](#new-file-detection),
  [Sibling collapse](#sibling-collapse), [Denial cap](#denial-cap),
  [Read-only first shell command](#read-only-first-shell-command),
  [Idle window](#idle-window), [Subagents](#subagents).
- State and measurement: [State file is untrusted](#state-file-is-untrusted),
  [Metrics](#metrics).

## Module layout

- `scripts/hooks/gateguard-fact-force.js`: the hook. Owns the shell parser
  (`quoteAwareSegments`, `commandBasename`, `SHELL_SEGMENT_SEPARATORS`) that the
  destructive Bash/PowerShell detector uses, the state file I/O, the gate
  messages, and `run()`. It stays one file above the 800-line guideline: the
  destructive detector and the shell parser that the search evidence and the
  read-only shell check are built from must not drift apart, and the gate
  messages share the hook's state and deny helpers. Logic that needs neither
  lives in `scripts/lib/`.
- `scripts/lib/gateguard-target-class.js`: target identity and classification
  for first-touch Edit/Write/MultiEdit/NotebookEdit targets: canonical path
  keys, target classes and their questions, sensitive-target and hard-link
  detection and sibling-collapse eligibility. Stateless; filesystem access is
  limited to worktree `.git` checks, realpath/lstat of the target's parent
  chain, and lstat/stat of the target for its link count.
- `scripts/lib/file-tail.js`: the bounded tail read shared with the
  strategic-compact hook's `transcript-context.js`.
- `scripts/lib/gateguard-turn-scan.js`: one bounded tail read of the Claude Code
  JSONL transcript, walked back to the start of the current turn. Yields the
  turn id, the turn's completed non-error search calls (newest first), their
  batch ids, the turn's shell commands and its `Read` calls (used only to
  explain a denial, never as evidence).
- `scripts/lib/gateguard-search-evidence.js`: decides whether a search in the
  current turn covers a target (prior-search credit). Its shell-dependent part
  is built by `createSearchEvidence()` from the hook's shell parser, so the
  parser the destructive detector relies on is shared, not copied or moved.
- `scripts/lib/gateguard-search-filters.js`: the include and exclusion
  filters of a search (glob, `--include`/`--exclude`, `find` name tests,
  PowerShell `-Filter`/`-Include`/`-Exclude`) and whether they admit a target.
  Pure; used by the search evidence.
- `scripts/lib/gateguard-state.js`: pure helpers for the session-state fields
  (counters, per-class counts, sibling dir gates). Reading and writing the
  state file, and the one-write event helpers built on it, stay in the hook.
- `scripts/lib/gateguard-change-profile.js`: pure analysis of the change text
  of an Edit/Write/MultiEdit into a bounded change profile (see
  [Change profile](change-profile.md#change-profile)). It uses
  `gateguard-code-lexer.js`, which reduces a snippet to its code lines, and
  `gateguard-file-context.js`, which checks that an edit's window of the file
  starts outside any string, comment or heredoc.
- `scripts/lib/gateguard-readonly-shell.js`: decides whether a Bash or
  PowerShell command is allowlisted read-only introspection (see
  [Read-only first shell command](#read-only-first-shell-command)). Built by
  `createReadOnlyShell()` from the hook's `quoteAwareSegments`, like the
  search evidence.
- `scripts/lib/gateguard-metrics.js`: builds, validates and appends the opt-in
  decision metrics lines (see [Metrics](#metrics)). `scripts/gateguard-report.js`
  reads them back.

## Lazy loading

Most hook calls are shell commands and edits of files already checked in the
session; neither needs the target classification beyond the path key, the
transcript scan, the search matcher or the change profile. The hook requires
those modules on first use, so a shell command loads only the shell parser and
the state helpers, as on `main`. Every Node process runs one hook call, so a
module that is loaded is also compiled on that call: the cost of a
first-touch edit follows how much code it runs, not how much the files hold.
`module.exports` lists `run` first because `run-with-flags.js` recognises a
`run()` hook by a lexical match on the export object.

## Fail to deny

Every allowance other than a retry of an already-gated target (prior-search
credit, the trivial-edit pass, sibling collapse, the denial cap, the subagent
bypass, the read-only first shell command) is an exception to the first-touch
or routine denial, so each one falls back to the denial on any doubt: an
unreadable transcript, a parse failure, an unresolvable path, a stat error on
the target, or an exception. The lib
exports that feed those decisions never throw (they catch and return a
fallback that denies, or no scan at all), so an error cannot escape into credit or
sibling logic. Allowances are never an `allow` permission decision: credit,
trivial and sibling passes return `additionalContext`, and the cap pass returns
the input unchanged.

## Read is not evidence

`Read` never earns prior-search credit. Claude Code already requires a Read of
a file before an Edit of it, so crediting Read would switch the Edit gate off.
Only `Glob`, `Grep`, `LS` and shell search commands count.

## Sensitive targets

Secrets, keys, auth/payment code, migrations and CI workflows always draw the
first-touch denial with the full questions: prior-search credit, the change
profile, the trivial-edit pass, sibling collapse and the denial cap do not
apply to them, and the denial says so (its note names the three older
exceptions).

- Basename, extension and segment rules are exact, never substrings.
- `.github/workflows/` is also matched below an ancestor (an unverified
  worktree, or a target outside the project root).
- A target is sensitive on its lexical path or on its real (symlink-resolved)
  location, so `src/tools -> ../auth` cannot launder `src/tools/login.py`.
- A real location that cannot be resolved (dangling symlink, `ENOTDIR`,
  `EACCES`, loops), a non-string path, or any error counts as sensitive.

## Hard-linked targets

A file with more than one hard link can be changed through any of its names,
and the other names may be sensitive (`vendor/token.js` linked to
`src/auth/token.js`), belong to another class, or live outside the project.
Neither the lexical path nor `realpath` reveals them, and finding every name
would mean walking the filesystem. So the allowances trust no name of such a
file: a target whose `lstat` (or, for a symlink, `stat`) reports
`nlink > 1` gets no prior-search credit, change profile, trivial-edit pass,
sibling collapse, denial cap or subagent bypass, exactly as a sensitive target.

- Directories are skipped (their link count counts subdirectories).
- A missing file (`ENOENT`, `ENOTDIR`) is a new file with one name, so a Write
  that creates one keeps its allowances; any other stat error, an unresolvable
  target, or a non-string path counts as hard-linked. The stat is only used for
  this allowance decision; it never turns an allowed retry into a denial.
- A Windows-style path on a POSIX host (or the reverse) has no file to stat and
  is judged by its path alone, as for the real-path checks.
- The denial names the rule ("Hard-linked target: …") rather than calling the
  file sensitive; a target that is both gets the sensitive note. Metrics record
  the reason `hard-linked` (or `subagent-hard-linked`) with `sensitive: false`.
- The check runs at decision time; a link created after the first touch is not
  seen, which is the same limit as for sensitive real paths.

## Exempt globs

`GATEGUARD_EXEMPT_GLOBS` is an operator decision and stays authoritative: an
exempt target passes before the subagent, checked, sensitive and hard-link
rules are consulted, so a glob that covers `src/auth/**` or a hard-linked file
turns its check off. The alternative (sensitive rules overriding exemptions)
would make a documented control silently ineffective for the paths an
operator is most likely to be deliberate about, and would change behaviour
for existing configurations. The precedence is documented in the skill's
order of checks, and the table row warns that exemptions apply to sensitive
and hard-linked targets too.

## NotebookEdit

NotebookEdit writes a `.ipynb` file named by `tool_input.notebook_path` (not
`file_path`), so it is routed to the edit-write gate by adding it to that
entry's matcher only; the other PreToolUse entries are unchanged. The hook
treats it as an Edit of `notebook_path`: the same canonical checked key (an
Edit and a NotebookEdit of one notebook share a first touch), class by path
(`.ipynb` falls through to code; under `tests/` it is a test), and the same
sensitive, hard-link, credit, cap, subagent and exempt rules. A `file_path`
field on the call is ignored. The change profile only understands source text,
not a cell edit, so a NotebookEdit always gets the full questions and is never
a trivial pass. It is never a new-file Write, so it never opens or joins a
sibling gate.

## Target resolution

Relative targets resolve against the tool's `cwd` first, then
`CLAUDE_PROJECT_DIR`, then the process cwd. This deliberately differs from
`GATEGUARD_EXEMPT_GLOBS`, whose globs are project-relative (`CLAUDE_PROJECT_DIR`
first). The canonical checked-state key folds `a.py`, `./a.py` and the absolute
path to one gate; Windows-style paths also fold separators and case.

A target is classified by its project-relative path, so an ancestor such as
`/home/me/tests/proj` never leaks into the class; targets outside the root keep
their absolute path. A Windows-style path has no real location on a POSIX host
(and vice versa), so real-path checks are skipped for it.

## Target classes

The first matching class wins: instruction, test, prose, config, code (the
fallback). Cursor `.mdc` rule files are instructions wherever they live. A
basename starting with `.env` is config unless it has a code extension
(`.env.example.ts` is source). Code targets ask the original four questions,
narrowed by the change profile (see
[Questions from the change profile](change-profile.md#questions-from-the-change-profile)); other
classes get class-specific questions and a class-specific condensed hint.

## Worktree prefix

A `.claude/worktrees/<name>/` prefix is stripped only when that worktree is real
(its `.git` exists). Otherwise the path stays under `.claude`, which is an
instruction directory and blocks sibling collapse.

## Windows name normalization

Windows ignores trailing dots and spaces in a name and treats `name:stream` as
`name`, so segments are normalized the same way before classification:
`CLAUDE.md.` and `CLAUDE.md::$DATA` both name `CLAUDE.md`.

## Turn boundaries

The scan walks the transcript tail backwards to the latest human message or
compaction. Only a user record whose content is a non-empty array of
`tool_result` blocks is a tool result; any other user record is a turn
boundary, which can only shrink the credit window. A compaction summary or
`compact_boundary` record discards the earlier turn and starts a new one. The
tail read is bounded (bytes and lines) to keep the hook fast.

## Turn identity

Claude Code stamps every user record of a turn with the same `promptId`, so it
identifies the turn even after the boundary has scrolled out of the tail
window; without one, the boundary record's `uuid` (or a hash of its line) is
used. When no boundary is found, a clipped window is the current turn only if
its `promptId`s agree; two or more mean an unrecognised turn start, and an
unclipped file has no turn at all.

## Tool result pairing

A search counts only when it completed without error. A tool-use id that occurs
more than once in the window cannot be tied to one result, so it never counts.

## Same-batch searches

Searches in the pending call's own assistant message never count: their results
were not seen when the edit was decided. The batch is located by the pending
`tool_use_id`, or else taken to be the newest assistant message.

## Ambiguous shell is not evidence

Command substitution, process substitution, heredocs and PowerShell backtick
escapes make the searched text ambiguous, so a shell command containing any of
them yields no evidence. Commands over 8192 characters yield none either.

## Directory changes

A `cd` (or its PowerShell equivalents) in any other shell call of the turn
leaves the cwd of every shell search unknown: shell searches then give no
directory evidence, and their relative operands scope nothing. Within one command, a plain literal `cd <dir>` rebases
later relative operands; any other directory change makes them unresolvable.
Operands that are variables, `~`, or relative to an unknown cwd scope nothing.

## Stdin is not a tree search

A search segment that reads stdin (input redirection, a pipe into it, or no
path operand without recursion) searched piped text, not the tree, so it gives
no evidence. A quoted `<` cannot be told from a redirection and is treated as
one. `||` also marks the next segment as piped, which only ever removes
evidence.

## Search scope

Each search offers stem texts, candidate directories, the scope the target must
lie in, and path operands. The target must lie inside the scope. A search whose
operands are all the target itself read the target rather than searched for it,
and gives nothing. A `Glob` without glob characters is a single-file lookup: it
names no directory. A `Glob` with an empty literal prefix and no explicit path
names only the implicit cwd, so it gives no directory credit. Directory
evidence from shell operands must name a directory that exists now.
PowerShell `-Path`/`-LiteralPath` values count as operands but never as
directory evidence.

## Search prefilter

Before any search is parsed, the turn's searches are checked for the target's
stem as plain text, with quotes and backslashes removed so that quoting
cannot split the stem. A search whose input does not contain the stem cannot
credit the target (credit needs the stem as a word in the parsed search), so
it is skipped; when no search passes, the search-evidence modules are not
loaded at all. The hook-side check strips test prefixes and suffixes
(`test_`, `_test`, `.test`, `.spec`) so it never skips a search the full
match would accept. New-file creations, which can also be credited by a
search that names their directory, bypass the prefilter. Parsed evidence is
cached per search, so the credit check and the closest-miss note share one
parse.

## Stem matching

A target's stem (basename without extension) credits it only when it has at
least four characters and is not generic (`index`, `utils`, `config`, ...).
Matching is a word-boundary `indexOf` scan; a `RegExp` is never built from
transcript text.

## Test stems

A test is named after the module it exercises, and a search for that module
(`rg tokenizer src tests`) is the search that finds its tests. So for a target
of the test class, one test affix is stripped before the stem rules apply:
a `.test` or `.spec` suffix, a `test_` prefix on `.py`, and a `_test` suffix
on `.py` and `.go`, the same affixes that make a file a test. The result
still has to be at least four characters, not generic (`index.test.js` gives
`index`, which never credits), a whole word in the search, and in the
search's scope; exclusions that mention the stripped stem cover the target.
Only one affix is stripped, and other classes keep the full stem (a
`tokenizer.test.md` under `skills/` is an instruction file). The full stem
(`tokenizer.test`) still matches as a word, since `.` is a word boundary.

## Search filters

A search that excluded the target never saw it:

- exclusion values, and the flags that introduce them, are never a stem source;
- an exclusion that names the stem, or matches the file or any directory above
  it, blocks credit;
- unreadable exclusion lists (`--exclude-from`, `--ignore-file`,
  `git ls-files -X`) and more than 32 exclusions block credit;
- an exclusion glob past the matching bounds, or malformed, counts as covering
  the target.

find: a negated or pruned name test is an exclusion; a plain `-name`/`-iname` is
an include. `--ignore`/`--hide` exclude names only for `ls` (rg's `--ignore` is
a switch).

## Include filters

Include globs (`--include`, `-g`, `--glob`, `-name`, `tree -P`, PowerShell
`-Filter`/`-Include`, the `Grep` tool's `glob`) that all miss the target stop
its stem from crediting. A basename glob is matched against the target's file
name. A glob with a directory part is matched against the target's path
relative to the search root only for ripgrep and the `Grep` tool, where a
leading `**/` lets it start at any directory; the other tools match names only,
so such a glob admits nothing. An include glob that is malformed, past the
matching bounds, or one of more than 32 filters admits nothing.

## Glob matching without RegExp

Filter globs are matched by dynamic programming over glob tokens, never by a
`RegExp`, so a hostile glob cannot cause regex backtracking. Globs are bounded
to 256 characters and 32 brace alternatives. Bracket classes support members,
ranges, `!`/`^` negation and a leading literal `]`; an unclosed class is
malformed. An unbalanced `{` is literal.

## Flag parsing

Only path operands can scope a search:

- flags that consume a value are skipped with it; single-dash clusters
  (`-rne PAT`) are read letter by letter, and a value flag ends the cluster;
- for grep-family tools, `rg`, `git grep`, `Select-String` and `fd`, the first
  positional is the pattern unless `-e`/`-f` (grep family, `rg`, `git grep`
  only; fd's `-e` is an extension) supplied it;
- fd's `-E/--exclude` takes a value; rg's `-r/--replace` takes a value.

## PowerShell parameter binding

PowerShell binds a parameter by any unambiguous prefix, by `-Name:value`, and by
comma lists across arguments, so `-Exclude` has many spellings. A parameter that
cannot be resolved may be an exclusion in disguise: neither it nor a value it
may carry is a stem source.

## New-file detection

A Write target is new only when `lstat` reports `ENOENT`; any other error counts
as an existing file. Only a new file may earn directory credit or sibling
collapse.

## Sibling collapse

A new file whose directory had a sibling gated moments ago passes with a note
instead of a repeat denial.

- Only code, test and prose targets collapse. Harness and tooling directories
  are dot-directories, so any dot segment blocks collapse, as do 8.3 short names
  (`CLAUDE~1`), which can alias any directory.
- The gate is keyed by the real directory. A symlinked directory must keep the
  class and pass the same screen, and must not be sensitive, so
  `src/tools -> .claude/hooks` never collapses.
- A gate opens for the same turn id; without a turn id on either side, for 120 s.
  The 120 s rule applies only when there is no transcript at all; an unusable
  transcript never collapses.
- A gate stamped in the future, or not created by a denial, is ignored.

## Denial cap

`GATEGUARD_FACT_FORCE_MAX_DENIALS` is validated whole (digits only, a safe
integer), not with `parseInt`: a prefix parse would turn `3oops` into a cap. A
malformed value leaves the gate uncapped and says so once on stderr. Once the
session's denials reach the cap, a first touch passes with the input unchanged
and is counted in `cap_allows`. The cap check reads the state the same write
persists, so a lost concurrent update can add a denial but never passes a
target early. Sensitive and hard-linked targets are never capped.

## State file is untrusted

The session state file can be edited or corrupted, so every field is validated
on read: counters clamp to non-negative integers, maps are null-prototype and
reject `__proto__`, `constructor` and `prototype` keys, and malformed or
old-shape entries are dropped. `dir_gates` maps `<class>\u0000<canonicalDir>` to
`{ turn, at, first, ordinal }` and keeps the 50 newest entries. Concurrent
writers are merged on save (checked keys by union, counts by maximum, gates by
newest `at`). Marking a target checked and recording its event happen in one
state write, so an event is never half-recorded.

## MultiEdit paths

A MultiEdit call names its file once, in `tool_input.file_path`, and its
`edits` entries carry only `old_string`, `new_string` and `replace_all`. An
entry without a `file_path` of its own is gated as the call's `file_path`
(at top level and in subagents), so the call meets the same first-touch,
sensitive-target and trivial-edit rules as an Edit of that file. Entries that
name their own path keep it. Non-object entries are skipped; a non-array
`edits` is treated as empty.

## Closest search that did not count

When an ordinary (not sensitive or hard-linked) first touch is denied and the
turn holds a search (or a
`Read`, or a non-search shell command) that mentions the target but did not
credit it, the denial adds one line naming the closest one, so the agent does
the missing step instead of restating facts:
`Closest search this turn did not count (<tool> <detail>): <why>.` It reuses
the single cached turn scan; no transcript is read again, and nothing is
computed on the credit or allow paths.

A search mentions the target when its stem matches (or, for a generic or short
stem, the bare name of at least three characters appears as a word) or, for a
new-file Write, when it names the target's directory. Reason codes, from
closest to farthest (the closest wins, then the newest):

| Code | Meaning |
|---|---|
| `same-batch` | it would have credited, but was sent in the pending call's own batch |
| `excluded` | an exclusion covers the target, or include globs miss it |
| `out-of-scope` | its path or operands do not contain the target |
| `stdin-only` | a search segment that read piped input or had no tree operand |
| `not-a-search` | a `Read` of the target, or a non-search shell segment naming it |
| `generic-stem` | the target's name is too generic or short to match any search |

`previous-turn` is not reported: the scan stops at the turn boundary, and
reading past it would cost a second, larger scan. Ambiguous shell commands
(substitutions, heredocs, over 8192 characters) give no line. The tool name
comes from a fixed set; the detail is the tool input, sanitized like a path,
whitespace-folded and cut to 60 characters. Sensitive and hard-linked targets
never get the line, since no search could have credited them. In a condensed denial the line
follows the batch warning.

## Read-only first shell command

The routine shell gate asks for the user's request once per session, before
the first Bash or PowerShell command. Sessions usually open with `ls`,
`git status` or a search, which the question adds nothing to, so a command
that is only read-only introspection passes without using the gate up. The
next command that is not read-only still draws the routine denial, so the
question still comes before the first command that can change something.

- Destructive detection runs first and is unchanged; the check sits after it
  and after `GATEGUARD_BASH_ROUTINE_DISABLED`, inside the routine gate, and is
  skipped once the gate is checked. A pass returns the input unchanged,
  never marks the routine gate checked, and adds one to
  `routine_readonly_passes`.
- Character screen, quote-aware: any non-ASCII or control character (other
  than tab), an unterminated quote, or a lone `&` rejects. Bash rejects
  backslashes anywhere, `` ` `` and `$` outside single quotes, and unquoted
  `<`, `>`, `(`, `)`, `{`, `}`, so redirection, here-documents, command,
  process and parameter substitution never pass. PowerShell rejects `` ` ``
  and `$` outside single quotes and unquoted `<`, `>`, `(`, `)`, `{`, `}`,
  `@`, `[`, `]`. Non-ASCII is rejected because PowerShell treats typographic
  quotes as quotes, which the segmenter does not.
- The screened command is split by the hook's quote-aware segmenter on `;`,
  `|`, `&&` and `||`. PowerShell backslashes are doubled first, since they are
  literal there. Every segment must pass.
- Each segment's first word must be an exact allowlisted name with no `=`,
  path separator or glob character, so assignments, wrappers (`env`, `sudo`,
  `sh -c`, `xargs`), paths and unknown programs reject. Bash: `ls`, `pwd`,
  `cat`, `head`, `tail`, `wc`, `grep`, `rg`, `find`, `fd`, `tree`, `git`.
  PowerShell (case-insensitive): `Get-ChildItem`, `Get-Content`,
  `Select-String`, `Get-Location` and their aliases, `rg`, `git`; `--%`
  rejects.
- Options that execute or write reject: `find -exec*`/`-ok*`/`-delete`/
  `-fprint*`/`-fls`, `fd -x`/`-X`/`--exec*` (also inside a short cluster),
  `rg --pre*`/`--hostname-bin`/`--search-zip`/`-z` (`-z` runs decompressors
  found on `PATH`, which older ripgrep on Windows also looked up in the
  working directory), `tree -o`/`-R` (also inside a short cluster).
- `git` takes no global options. The subcommand must be `status`, `log`,
  `diff`, `show`, `ls-files`, `rev-parse` or `branch`, and every option must
  be in that subcommand's allowlist, so `--output` (and its abbreviations),
  `--ext-diff` and `--textconv` reject. `branch` takes no positional
  argument, so it only lists.
- Over 4096 characters, a non-string command, or any exception rejects.

The earlier read-only git allowlist, which runs before destructive detection,
is unchanged.

## Idle window

Session state expires after an idle window. A state key from a real session
id (`session_id`, `CLAUDE_SESSION_ID`, `ECC_SESSION_ID`) or a transcript path
names one conversation, so its window is 8 hours: a break in a long
conversation does not re-ask the checks it already answered. The project
fingerprint fallback (`proj-` keys) can be shared by unrelated sessions in the
same directory, so it keeps 30 minutes.

Module-load pruning removes a state file idle for twice its key's window,
judged by file name: `state-proj-*` uses 30 minutes, any other key 8 hours.
A session id that itself starts with `proj-` gets the short window for both
expiry and pruning, which can only expire state sooner. Temporary files from interrupted writes
are never loaded and always use the short window.

## Subagents

File gates skip subagent calls (a non-empty string `agent_id`, `agentId`,
`parent_tool_use_id` or `parentToolUseId`): the parent was already gated on
the work it delegated, and a subagent writing many files would otherwise draw
one denial per file. Shell gates were never skipped, so a subagent can
already receive a denial, present facts and retry.

Sensitive and hard-linked targets are the exception. A subagent Edit, Write,
NotebookEdit or MultiEdit entry on such a target is denied once per path with
the full denial and its note, unless the parent already gated that path. Prior-search credit, the
change profile, sibling collapse and the denial cap never apply, as at top
level. The subagent's denial marks a separate subagent key, not the file's
key, so a subagent's retry never unlocks the path for the parent, whose own
first touch is still gated. The keys share the parent's state file when the
subagent's call carries the parent's session id. Exempt globs and Claude
settings files are skipped first, as at top level.

## Metrics

Decision metrics exist to show whether the gate asks the right question at the
right time: how often it denies, how often prior-search credit, sibling
collapse, trivial edits and the cap remove a denial, which questions it asks,
and how often a denial followed a search that nearly counted.

- **Opt-in.** Nothing is written unless `GATEGUARD_METRICS` is one of the
  truthy spellings the other GateGuard switches accept. The variable is read
  on every call, so it can be turned on for part of a session.
- **Codes, never content.** A line holds the schema version, time, a 12-hex
  sha256 prefix of the resolved session key (not the key itself), the tool,
  the target class, the decision, a reason code, question ids, the sensitive
  flag and the change-profile flags. Class, reason, question ids and language
  must match a short lowercase code pattern or are written as `null`, so a
  path, command, file content or transcript text cannot reach the file even
  if a caller passed one by mistake. The session digest is one-way but not
  secret: anyone holding the session id can link it to its lines.
- **One write per call.** Decisions are collected while `run()` decides and
  appended in one `appendFileSync` after it returns, including when it throws.
  A MultiEdit call writes one line per distinct file it decided. Lazily
  computed class and sensitivity for passes are only computed when metrics
  are on.
- **Never changes a decision.** Every metrics error (unwritable directory,
  a directory in place of the file, a failed rotation) is ignored, and the
  gate's result is returned unchanged.
- **No symlinks.** The file is checked with `lstat` and opened with
  `O_NOFOLLOW`; a symlink or other non-regular file in its place is left
  alone and nothing is written, so a shared state directory cannot redirect
  the append or the rotation onto another file.
- **Bounded.** When an append would take `metrics.jsonl` past 1 MiB it is
  renamed to `metrics.jsonl.1`, replacing the previous rotation, so the two
  files together stay near 2 MiB. Concurrent hooks may interleave lines or
  lose one rotation's worth of lines; the report skips anything malformed.
- **Shell denials carry no question ids.** The destructive and routine shell
  gates ask fixed questions that have no ids, so their lines have
  `questions: null`, as do all passes.
