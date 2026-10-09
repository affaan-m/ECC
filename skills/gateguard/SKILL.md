---
name: gateguard
description: "PreToolUse fact-forcing gate that denies the first Edit/Write/Bash (including MultiEdit and NotebookEdit) attempt until the agent presents concrete facts (importers, data schemas, verbatim user instruction), then allows retry; A/B-tested at +2.25 quality points. Use when enabling or configuring the GateGuard hook, exempting paths via env vars, or handling first-touch denials."
metadata:
  origin: community
---

# GateGuard — Fact-Forcing Pre-Action Gate

A PreToolUse hook that forces Claude to investigate before editing. Instead of self-evaluation ("are you sure?"), it demands concrete facts. The act of investigation creates awareness that self-evaluation never did.

## When to Activate

- Working on any codebase where file edits affect multiple modules
- Projects with data files that have specific schemas or date formats
- Teams where AI-generated code must match existing patterns
- Any workflow where Claude tends to guess instead of investigating

## Core Concept

LLM self-evaluation doesn't work. Ask "did you violate any policies?" and the answer is always "no." This is verified experimentally.

But asking "list every file that imports this module" forces the LLM to run Grep and Read. The investigation itself creates context that changes the output.

**Three-stage gate:**

```
1. DENY  — block the first Edit/Write/Bash attempt
2. FORCE — tell the model exactly which facts to gather
3. ALLOW — permit retry after facts are presented
```

No competitor does all three. Most stop at deny.

## Evidence

Two independent A/B tests, identical agents, same task:

| Task | Gated | Ungated | Gap |
| --- | --- | --- | --- |
| Analytics module | 8.0/10 | 6.5/10 | +1.5 |
| Webhook validator | 10.0/10 | 7.0/10 | +3.0 |
| **Average** | **9.0** | **6.75** | **+2.25** |

Both agents produce code that runs and passes tests. The difference is design depth.

## Gate Types

### Edit / MultiEdit Gate (first edit per file)

MultiEdit is handled identically — each file in the batch is gated individually;
entries without their own `file_path` are gated as the call's `file_path`.
NotebookEdit is gated as an Edit of its `notebook_path`: same class, checked
key, credit and cap rules, the full questions (the cell change is not read),
and never a comment-only pass.

The questions depend on the target's class (see
[Questions by target class](#questions-by-target-class)). For **code**
targets the Edit gate asks:

```
Before editing {file_path}, present these facts:

1. List ALL files that import/require this file (search the tree — Glob/Grep, or find/grep via Bash)
2. List the public functions/classes affected by this change
3. If this file reads/writes data files, show field names, structure,
   and date format (use redacted or synthetic values, not raw production data)
4. Quote the user's current instruction verbatim
```

These four are the full set, asked whenever the change cannot be read with
confidence. When it can (see [Questions fit the change](#questions-fit-the-change)),
an edit that touches no public declaration asks instead for the call sites in
the file or its module that rely on the changed behaviour, and item 3 is
dropped when the change handles no data.

### Write Gate (first new file creation)

For **code** targets the Write gate asks:

```
Before creating {file_path}, present these facts:

1. Name the file(s) and line(s) that will call this new file
2. Confirm no existing file serves the same purpose (search the tree — Glob/Grep, or find/grep via Bash)
3. If this file reads/writes data files, show field names, structure,
   and date format (use redacted or synthetic values, not raw production data)
4. Quote the user's current instruction verbatim
```

Item 3 is dropped when the new content handles no data.

### Questions fit the change

For **code** targets the gate reads the change it is about to allow (Edit
`old_string`/`new_string`, every MultiEdit entry for the file, Write
`content`) and decides three things:

- **Public surface:** a line on either side declares or exposes a public name.
  JS/TS: `export`, `exports`, `public`, `declare` (`.d.ts` files always); Python:
  `def`/`class` not starting with `_`, dunders, `__all__`, a module-level public
  assignment such as `BASE_URL = ...` (`__init__.py` always); Go: capitalised
  `func`/`type`/`var`/`const` names, `package`, lines starting with a capital;
  Rust: `pub`, `impl`, `trait`, `extern`, `#[macro_export]`, `#[derive]`,
  `#[repr]`, `#[no_mangle]`; shell: function definitions,
  `export`, `declare -x`; PowerShell: `function`, `filter`, `param`,
  `Export-ModuleMember`, `[CmdletBinding`. A member of an exported container
  counts too, judged from the file: lines inside an exported interface, enum,
  type, object or export list, member declarations of an exported class,
  `__all__` entries, public class attributes and dataclass fields, and members
  of a `pub` enum, struct, trait or `use` list. Java, Kotlin, C#, C, C++ and batch
  files, and every Write, always count as touching it. Touching it keeps questions 1 and 2; otherwise both are
  replaced by "List the call sites in this file or its module that rely on the
  changed behaviour".
- **Data:** words for file I/O, formats (`json`, `csv`, `yaml`, …),
  serialisation, encodings, schemas, SQL, data stores, browser storage, dates
  and clock reads on either side; in shell scripts also
  redirection to a file, `curl`, `wget`, `jq` and PowerShell file and web
  cmdlets. Without them the data
  question is dropped.
- **Trivial:** see [Comment and whitespace-only edits](#comment-and-whitespace-only-edits).

Supported extensions: `.js .mjs .cjs .jsx .ts .tsx .mts .cts .py .pyi .go .rs
.java .kt .kts .cs .c .h .cc .cpp .cxx .hpp .hh .hxx .sh .bash .zsh .ps1 .psm1
.bat .cmd`. Any other extension, a
missing or non-string field, more than 64 MultiEdit entries, a side over
64 KiB, or 256 KiB in total means the full questions, word for word. Sensitive
and hard-linked targets and NotebookEdit calls always get the full questions. Other classes keep their class
questions. Each question has a stable id (`importers`, `public-api`,
`local-callers`, `callers`, `no-duplicate`, `data-schema`,
`quote-instruction`, and one per class question), listed in
`docs/gateguard/change-profile.md`.

### Questions by target class

The code questions carry no signal for a `SKILL.md`, a README, a test, or a
YAML file, so the first-touch gate classifies the target first.

Classification uses the target's path relative to the project root
(`CLAUDE_PROJECT_DIR`, then the payload `cwd`, then the process directory),
so a project that lives under, say, `~/work/tests/` does not turn every file
into a test. A leading `.claude/worktrees/<name>/` is stripped, since a
worktree mirrors the project, but only when
`<root>/.claude/worktrees/<name>/.git` exists; otherwise the path stays under
`.claude`. On Windows-style paths (and any segment containing `::$`), trailing
dots/spaces and a `:stream` suffix are dropped first, so `CLAUDE.md.` and
`CLAUDE.md::$DATA` classify as `CLAUDE.md`. Targets outside the root are
classified by their absolute path. The path is lowercased and `/`-separated,
and the first match wins:

1. **instruction** — basename `CLAUDE.md`, `AGENTS.md`, `AGENT.md`,
   `GEMINI.md`, `SKILL.md`, `copilot-instructions.md`, `.cursorrules`, or
   `.windsurfrules`; any `.mdc` file; a `.md`/`.mdx`/`.txt` file under a
   `.claude`, `agents`, `commands`, `skills`, `rules`, `hooks`, `.cursor`,
   `.codex`, or `.opencode` directory; or a `*instructions*.md` file under
   `.github/`
2. **test** — `*.test.*`, `*.spec.*`, `test_*.py`, `*_test.py`, `*_test.go`,
   or anything under a `tests`, `test`, or `__tests__` directory
3. **prose** — `.md`, `.mdx`, `.txt`, `.rst`, `.adoc`
4. **config** — `.json`, `.jsonc`, `.yaml`, `.yml`, `.toml`, `.ini`, or a
   `.env` / `.env.*` file that does not end in a code extension (`.env.local`
   is config; `.env.example.ts` and `.envrc` are code)
5. **code** — everything else (a `.js` under `hooks/` or `skills/` is code)

Every class ends with "Quote the user's current instruction verbatim", keeps
the batch-sibling warning, and uses the same questions for Edit, MultiEdit,
and Write unless noted. Items marked *(search)* carry the suffix
"(search the tree — Glob/Grep, or find/grep via Bash)".

| Class | Questions |
|---|---|
| instruction | Name the harness/loader that reads this file (Claude Code, Codex, Cursor, OpenCode, …) and when it loads it · Describe what agent behaviour changes as a result · Confirm no existing instruction, skill, or agent file already covers this *(search)* |
| test | Name what behaviour is under test and which module/function it exercises · Name the existing test file(s) covering this module, or confirm none exist *(search)* |
| prose (Write) | Name any existing doc this supersedes or duplicates *(search)* · State where it will be linked or referenced from · Explain why a new file rather than editing an existing one |
| prose (Edit) | List other docs or code that reference the section being changed *(search)* · State what the change corrects or adds |
| config | Name which process/tool reads this file and when · Describe the effect of the change · Confirm no secrets or credentials are being written in plain text |

Condensed denials (after `GATEGUARD_FACT_FORCE_FULL_DENIALS`) carry a
one-line hint for the same class. For code targets the hint names the same
questions as the full denial, one short phrase each; an Edit whose change
cannot be read keeps the fixed hint (importers/callers, affected API, data
schemas if any). Besides the message text, the class only
decides [sibling collapse](#same-turn-sibling-creation-collapse): which files
may collapse, and that a sibling must share the first file's class.

### Destructive Bash Gate (every destructive command)

Triggers on: `rm -rf`, `git reset --hard`, `git push --force`, `drop table`, etc.

```
1. List all files/data this command will modify or delete
2. Write a one-line rollback procedure
3. Quote the user's current instruction verbatim
```

### Routine Bash Gate (once per session)

```
1. The current user request in one sentence
2. What this specific command verifies or produces
```

Read-only introspection does not use this gate up: until it fires, a command
whose every `;`, `|`, `&&` or `||` segment is `ls`, `pwd`, `cat`, `head`,
`tail`, `wc`, `grep`, `rg`, `find`, `fd`, `tree`, or `git status`/`log`/
`diff`/`show`/`ls-files`/`rev-parse`/`branch` with read-only options (in
PowerShell: `Get-ChildItem`, `Get-Content`, `Select-String`, `Get-Location`,
their aliases, `rg`, `git`) passes and is counted in
`routine_readonly_passes`. The first other command is still gated. Any
redirection, `tee`, substitution, backtick, variable, environment
assignment, wrapper (`env`, `sudo`, `xargs`, `sh -c`), unknown command,
`find -exec`/`-delete`, `fd -x`, `rg --pre`/`-z`, `tree -o`, `git` global option or
write/execute option, or PowerShell `$`, `@`, `(`, `{` or `--%` makes the
command ordinary. Destructive detection runs first, unchanged.

Session state expires after 8 idle hours when it is keyed by a session id or
transcript path, and after 30 idle minutes when it falls back to the project
directory.

## Parallel Batches and Partial Application

The first-touch gate evaluates each tool call independently. When several
edits to a file that has not been touched yet are sent in one parallel
batch, the first call is denied and the denial marks the file as checked,
so the sibling edits in that batch are applied. Nothing is rolled back:
the file can end up holding the sibling edits without the denied one.

The denial message names the file and warns that batch siblings may
already have been applied. Treat it literally:

- Send dependent edits to a not-yet-touched file sequentially, not in a
  parallel batch. A definition and its first use, or an import and its
  call site, must not ride in the same batch.
- After a first-touch denial, present the facts, retry the denied edit,
  and re-read the file before building on anything else from the batch.

A batch-wide lock is not possible: hooks see tool calls one at a time, so
the gate cannot know which calls arrived together.

## What Counts as Already Done

A first-touch denial is meant to force investigation. When the transcript
shows the investigation already happened, or the answers would repeat the
previous denial word for word, the gate lets the call through with a note
instead of a denial. Each rule below falls back to the normal denial when
anything is ambiguous.

### Order of checks

For each Edit/Write/NotebookEdit target (and each MultiEdit entry) the gate
decides in this order; the first rule that applies wins:

1. **Exempt** (`GATEGUARD_EXEMPT_GLOBS`, Claude settings files) — allowed.
   Operator exemptions are authoritative: they win over every later rule,
   including the sensitive and hard-link rules, so a glob that covers
   `src/auth/**` or a hard-linked file turns its check off. Exempt only
   paths that may be edited without the check.
2. **Subagent** call — allowed (the parent session was already gated),
   except a [sensitive](#sensitive-targets) or
   [hard-linked](#hard-linked-targets) target: denied once per path
   unless the parent already gated it. A subagent's retry does not unlock
   the path for the parent.
3. **Already checked** this session — allowed.
4. **Sensitive or hard-linked target?** — if so, skip straight to the
   denial (step 9).
5. **Prior-search credit** — allowed with a note.
6. **Comment or whitespace-only Edit** — allowed with a note, not marked
   checked.
7. **Sibling collapse** — allowed with a note.
8. **Denial cap** (`GATEGUARD_FACT_FORCE_MAX_DENIALS`, opt-in) — passes
   through once the session's denials have reached the cap.
9. **Deny** — counted in `fact_force_denials`.

Credit, trivial and sibling allows never consume the denial cap.

### Sensitive targets

Some files are too costly to change without the full check, so prior-search
credit, the comment or whitespace-only pass, the change profile, sibling
collapse, and the denial cap never apply to them: they are
denied on first touch exactly as without these rules, and the denial counts
as usual. The denial carries one extra line: "Sensitive target: prior-search
credit, sibling collapse, and the denial cap do not apply." A target is
sensitive, judged on the same lowercased project-relative path as its class
**and** on its real (symlink-resolved) location, when either matches:

- its file name is `.env`, `.netrc`, or `.pgpass`, starts with `.env.`, ends
  in `.pem`, `.key`, `.p12`, or `.pfx`, or starts with `id_rsa`, `id_ed25519`,
  `id_ecdsa`, `id_dsa`, `credentials`, or `secrets.`;
- any path segment is exactly `auth`, `authn`, `authz`, `security`,
  `secrets`, `payment`, `payments`, `billing`, or `migrations` (whole
  segments only: `src/author.py`, `docs/authoring.md`, and
  `lib/paymentutils.py` are ordinary);
- or it lies under `.github/workflows/`.

The real location is the file's own realpath when it exists, else the
realpath of its nearest existing directory plus the rest of the path, judged
relative to the realpath of the project root, so `src/tools -> ../auth` makes
`src/tools/login.py` sensitive. A real location outside the project is judged
on its absolute path. Any error while deciding (a dangling symlink, a file
where a directory should be, a permission error) counts as sensitive.
Destructive and routine shell gates are unaffected.

### Hard-linked targets

A file with more than one hard link (`nlink > 1`, or a symlink to such a file)
is also reachable under another name, which may be sensitive or in another
class, so the path being edited says little about what changes. It gets the
same treatment as a sensitive target — no prior-search credit, change profile,
comment-only pass, sibling collapse, denial cap, or subagent bypass — and its
denial carries "Hard-linked target: prior-search credit, sibling collapse, and
the denial cap do not apply." instead of the sensitive line (a target that is
both says "Sensitive target"). A stat error other than a missing file counts as
hard-linked; a new file that does not exist yet is not.

### Prior-search credit

An Edit, Write, NotebookEdit, or MultiEdit entry is allowed, with an
`additionalContext` note naming the search, when a qualifying search in the
**current human turn** already covered the file:

- **Qualifying tools:** `Glob`, `Grep`, `LS`, and Bash/PowerShell command
  segments led by `rg`, `grep`, `egrep`, `fgrep`, `git grep`,
  `git ls-files`, `find`, `fd`, `ls`, `tree`, `Get-ChildItem`, `gci`,
  `Select-String`, or `sls`. **`Read` never counts** — Claude Code already
  requires a Read before an Edit, so it proves nothing extra.
- **Current human turn:** the turn starts at the latest real user message or
  at a compaction (a compact-summary record or a `compact_boundary` marker),
  so searches from before a compaction never count. Tool results, meta, and
  sidechain records do not start a turn. Only the transcript tail is read
  (last 256 KiB / 2000 lines); when the turn started before that window, the
  whole window is the current turn, provided every `promptId` in it agrees.
  Two or more `promptId`s there mean a turn started through a record the scan
  does not recognise, so that window gives no credit. A transcript with no
  turn start at all gives no credit.
- **Completed, unambiguous result:** the search needs a `tool_result` in the
  turn that is not an error (`is_error` of `true` or `"true"`, or content
  starting with `<tool_use_error>`). A tool-use id that appears more than once
  never counts.
- **Not the same batch:** searches sent in the gated call's own assistant
  message never count, since their results were not seen when the edit was
  decided. If the payload's `tool_use_id` is missing or not in the
  transcript, the newest assistant message in the turn is excluded instead. A
  search without a message id never counts.
- **Stem match:** the target's stem (basename minus its last extension,
  lowercased, at least 4 characters) must appear as a whole word — bounded by
  non-alphanumeric characters or the ends of the text — in the Glob pattern,
  the Grep pattern or glob, or the shell segment. `payment.py` is credited by
  a search for `payment` or `payment_service`, but not by one for
  `payments`. Exclusions are never a stem source. Generic stems (`index`, `main`, `init`, `__init__`,
  `utils`, `util`, `types`, `readme`, `test`, `tests`, `config`, `mod`,
  `lib`, `setup`, `app`, `spec`, `helpers`, `common`) never match. For a test
  target, one test affix is stripped first (`.test`, `.spec`, and for Python
  and Go `test_` or `_test`), so `rg tokenizer src tests` credits
  `tests/tokenizer.test.js`; `index.test.js` still reduces to the generic
  `index`.
- **Exclusions never credit:** a Grep `glob` is split on top-level commas;
  entries starting with `!` are exclusions. In shell segments, `rg -g`/
  `--glob`/`--iglob` values starting with `!`, `grep --exclude`/
  `--exclude-dir`, `fd -E`/`--exclude`, `ls -I`/`--ignore`/`--hide`,
  `tree -I`, `git ls-files -x`, git `:!x`/`:^x`/`:(exclude)x` pathspecs,
  `find -name`/`-path`/… under `-not` or `!` or followed by `-prune`, and
  PowerShell `-Exclude` are exclusions. If an exclusion covers the target
  (its glob matches the file name or any directory on its path, or it names
  the stem), that search cannot credit the target at all: `rg -g '!widget.py'
  TODO .` never credits `widget.py`, while `rg -g '!*.md' widget .` still
  does. `--exclude-from`, `--ignore-file`, and `git ls-files -X` hide names
  the hook cannot see, so such a segment never credits. File-name globs that
  restrict a search (Grep `glob: '*.py'`, `rg -g '*.py'`, `grep --include`,
  `find -name`, `tree -P`, `-Include`/`-Filter`) must match the target's file
  name for its stem to count.
- **Scope:** `Glob`, `Grep`, and `LS` only credit a target strictly inside the
  directory they searched (their `path`, else the tool `cwd`, plus a Glob
  pattern's literal leading directories). A Glob without glob characters is a
  one-file lookup: it names no directory and credits only files directly in
  its directory, never the looked-up file itself. A search whose path is the target is not a search.
- **Shell segments:** a segment without a path operand counts only when it is
  recursive (`rg`, `git grep`, `git ls-files`, `find`, `fd`, and `tree` by
  default; `grep -r`/`-R`/`--recursive`, `ls -R`, `Get-ChildItem -Recurse`)
  and not fed by a pipe; otherwise it reads stdin, not the tree. A segment
  whose path operands all resolve to the target only reads the target and
  does not count (`ls src/a.py` never credits `src/a.py`). Commands containing
  `$( )`, backticks, `<( )`, `>( )`, or heredocs, or longer than 8192
  characters, never credit.
- **Shell scope:** a shell segment only credits a target equal to or inside
  one of its path operands (resolved against the tool `cwd`; a glob operand
  counts as its literal directory), or inside the `cwd` when it has none:
  `rg payment docs` or `grep -rn payment /usr/share/doc` never credit
  `src/payment.py`. An input redirection before any operand
  (`rg payment < file`) or a `<` inside a word reads stdin and never counts.
  After `cd <dir>` in the same command, relative operands resolve against that
  directory; after any other directory change, or one in another call of the
  turn, only absolute operands count.
- **Directory match (new files only):** a **Write that creates a file that
  does not exist yet** may also match when the search named exactly the
  target's directory: a Glob `path` plus the pattern's literal prefix (a
  pattern that starts with a glob character and has no `path` names no
  directory), a Grep or LS `path`, or a shell path operand. For shell
  operands, the pattern argument of grep-style tools is skipped (unless
  `-e`/`-f`/`--regexp`/`--file`/`-Pattern` supplied the pattern), values of
  value-taking flags (`-g`, `--include`, `-name`, `-Filter`, …) are skipped,
  trailing `/`, `/*`, and `/**` are dropped, `.`, `~`/`$` paths, and globs
  name no directory, and the operand must be an existing directory at the
  time of the check. If any Bash/PowerShell call in the turn changes directory
  (`cd`, `pushd`, `popd`, `chdir`, `Set-Location`, `sl`, `Push-Location`,
  `Pop-Location`), shell directory matching is off for the whole turn; stem
  matching still applies. **Edit, MultiEdit, and a Write that overwrites an
  existing file match by stem only.**
- **Paths:** relative targets and search paths resolve against the tool's
  `cwd`, then `CLAUDE_PROJECT_DIR`, then the process directory. Comparison is
  case-insensitive for Windows paths only. Shell commands are read with bash
  quoting rules, so on Windows an operand credits when spelled `C:/x/src`;
  backslash spellings (`C:\x\src`, quoted or not) and MSYS spellings
  (`/c/x/src`) do not credit and the write is denied as usual.
- **Note, not denial:** the credited file is marked checked and
  `fact_force_credited` is incremented; the denial count and ordinal are not
  touched. MultiEdit credits per entry and denies the first uncredited entry
  as before.
- **Falls back to deny:** a missing, unreadable, or non-file transcript,
  garbage records, or any internal error mean no credit.
- **Closest miss in the denial:** when an ordinary (not sensitive or
  hard-linked) first touch is denied
  and a call in the turn mentioned the file without crediting it, the denial
  adds one line, "Closest search this turn did not count (`<tool>`
  `<detail>`): `<why>`.", naming the closest such call and why it failed: sent
  in the same batch, its filters exclude the file, its search path does not
  contain it, it searched piped input, it was a `Read` or another command
  rather than a search, or the file name is too generic to match. The detail
  is sanitized and cut to 60 characters; no other transcript text is shown.

### Comment and whitespace-only edits

An Edit whose old and new text differ only in comments and whitespace changes
no behaviour, so the first-touch questions carry no signal. Such an Edit (or a
MultiEdit whose entries for that file are all such changes) of a `code`,
`test`, or `prose` target that is not sensitive passes with the note "Comment
or whitespace-only change to `<file>`". The file is **not** marked checked:
the next change to it that alters code meets the normal first-touch gate. The
pass is counted in `trivial_allows` and never touches the denial count.

It applies only to the extensions listed in
[Questions fit the change](#questions-fit-the-change), and only when every
entry reads cleanly:

- comments are `//` and `/* */` (C family), `#` (Python), `#` at the start of
  a word (shell), `#` and `<# #>` (PowerShell), or `REM` lines (batch);
  C preprocessor lines and batch `::` labels are code; directive comments are
  code too (shebangs, encoding cookies, `# type:`, `# noqa`, `# nosec`,
  `// @ts-...`, `eslint-...`, `//go:build`, `// +build`, `//go:embed`, Rust
  doc comments, `#Requires`, `shellcheck`, `NOLINT`, `NOSONAR`, fallthrough
  markers and similar); whitespace inside strings, line breaks between code, and
  the presence of whitespace between tokens are code (`a+b` → `a + b` is not
  trivial);
- Python indentation of code lines is code;
- never trivial: a Write; any multi-line or raw string form (backticks, triple
  quotes, `r"`, `R"`, `@"`, `$"`, f-strings, Kotlin `$`), a string running to
  the end of a line, a line comment or code line ending in `\`, `??/`, a
  nested or unterminated block comment; in JS/TS any `/` outside a comment (regex versus
  division), JSX-like tags, and `-->`; in shell scripts heredocs, backticks,
  `$(` inside double quotes, `$'...'`, line continuations and here-strings
  (see the design notes for the full list);
- config, instruction, sensitive and hard-linked targets, and NotebookEdit
  calls never pass this way.

The edit is also checked against the current file (a regular file of at
most 1 MiB, read by the hook and never stored): `old_string` must be found as
the Edit tool would apply it, the lines around the change must compare equal
as above, and the text before them must end in plain code, not inside a
template literal, docstring, raw string, heredoc or here-string and not after
a line continuation. A missing, unreadable or larger file, or a Go file that
imports `"C"`, never passes this way.

### Same-turn sibling creation collapse

When several new files are created in one directory, the answers for each
would be identical, so only the first is denied:

- Applies to a **Write of a file that does not exist yet** whose class is
  `code`, `test`, or `prose`. Never collapsed: `config` and `instruction`
  files, and any path with a segment starting with `.` (dotfiles and every
  dot-directory: `.claude`, `.github`, `.git`, `.husky`, `.devcontainer`,
  `.githooks`, `.idea`, `.vscode`, …) or an 8.3 short name (`CLAUDE~1`),
  checked on the same project-relative path as the class.
- The directory is also resolved to its **real location** (symlinks
  followed; missing directories are resolved from the nearest existing
  parent). If that differs from the path as written, the real path must be
  inside the project, keep the same class, and pass the same screen, so a
  symlink such as `src/tools -> .claude/hooks` never collapses. Gates are
  keyed by the real directory. Any filesystem error means no collapse.
- After such a Write is denied, later first-touch Writes of new files **of the
  same class in the same directory** are allowed with the note "Sibling of
  `<first>` (gated earlier at denial #`<n>` this session)". A code denial never
  lets a test, README, or config file through.
- The window is the **same human turn**. The turn id is the turn-start
  record's own `promptId`, else its `uuid`, else a hash of that record. When
  the turn started before the transcript tail, the id is the `promptId` that
  every user record in the window agrees on (Claude Code stamps it on the
  prompt and on every tool result of the turn); if they disagree there is no
  turn id. Only when **no transcript path is available at all** does a gate
  recorded without a turn id match for **120 seconds**; a transcript that is
  missing, unreadable, or yields no turn id means no collapse. A turn-scoped
  gate never matches a call without a turn id, and vice versa; a gate stamped
  in the future is ignored.
- Prior-search credit is checked first. **Edits and MultiEdits are never
  collapsed**, and an existing file is never treated as a sibling.

### Canonical path keys

Checked state is keyed on the canonical path: a relative `file_path` resolves
against the tool's `cwd` (where the tool runs), then `CLAUDE_PROJECT_DIR`,
then the process directory, with `/` separators, lowercased on Windows only.
`a.py`, `./a.py`, and the absolute path share one first-touch. State files
written by earlier versions (raw keys) are still honoured.
`GATEGUARD_EXEMPT_GLOBS` keeps its project-relative matching (below).

### In-session counters

The per-session state file (under `GATEGUARD_STATE_DIR`) records these fields.
They record class names only, never paths (except `dir_gates`, which stores
the sanitized first file per directory):

| Field | Meaning |
|---|---|
| `fact_force_credited` | Number of first touches allowed by prior-search credit |
| `denials_by_class` | Denials per target class (`code`, `prose`, `test`, …) |
| `credited_by_class` | Credits per target class |
| `sibling_allows` | Number of Writes allowed by sibling collapse |
| `dir_gates` | Per class and directory, the denial that opened a sibling window (turn, time, first file, ordinal); capped at 50 entries |
| `cap_allows` | Number of first touches passed through by the denial cap (`GATEGUARD_FACT_FORCE_MAX_DENIALS`); these never count as denials |
| `trivial_allows` | Number of comment or whitespace-only edits passed without the first-touch check; these never mark the file checked |
| `routine_readonly_passes` | Number of read-only shell commands passed before the routine shell gate fired; these never mark it checked |

Missing or malformed fields load as empty or zero, so older state files keep
working.

### Compatibility and limits

- **Two new, opt-in environment variables:**
  `GATEGUARD_FACT_FORCE_MAX_DENIALS` (unset means no cap) and
  `GATEGUARD_METRICS` (unset means no metrics). The existing controls are
  unchanged.
- **Nothing previously allowed is now denied**, except a subagent's first
  touch of a sensitive or hard-linked target, and the first NotebookEdit of
  each notebook (NotebookEdit was not gated before). The other rules only
  remove denials, and never return `permissionDecision: "allow"`, so other hooks
  and permission rules still apply.
- **Trust limit:** prior-search credit reads the local transcript file,
  which the agent could in principle write to. The credit verifies observed
  behaviour (a search ran and returned), not intent or how carefully the
  result was read.

## Quick Start

### Option A: Use the ECC hook (zero install)

The hook at `scripts/hooks/gateguard-fact-force.js` is included in this plugin. Enable it via hooks.json.

If GateGuard blocks setup or repair work, start the session with
`ECC_GATEGUARD=off`. For hook-level control, keep using
`ECC_DISABLED_HOOKS` with the GateGuard hook ID.

In long sessions, only the first `GATEGUARD_FACT_FORCE_FULL_DENIALS`
fact-force denials (default 3) emit the full fact block; later
denials are condensed to a single line carrying the denial ordinal, so
near-identical blocks cannot accumulate in the context window and
amplify model repetition loops (#2142). Retrying the same file or
command after presenting facts never re-triggers the gate. That is a
message budget; to stop denying new files after a number of denials, set
the opt-in denial budget `GATEGUARD_FACT_FORCE_MAX_DENIALS` (below).

#### Graduated controls

`ECC_GATEGUARD=off` (or `GATEGUARD_DISABLED=1`) turns the gate off entirely.
The variables in this table do **not** — each narrows one behaviour while the
load-bearing destructive-Bash checks keep running:

| Variable | Default | Effect |
|---|---|---|
| `GATEGUARD_BASH_ROUTINE_DISABLED` | unset (gate on) | Disables the **routine-Bash** gate only. The destructive-Bash gate (`rm -rf`, `git reset --hard`, `drop table`, `dd if=`, …) is unaffected. |
| `GATEGUARD_EXEMPT_GLOBS` | unset (no exemptions) | Comma-separated globs; a matching Edit/Write/MultiEdit/NotebookEdit target skips first-touch fact-forcing, even when it is sensitive or hard-linked. Intended for low-import-value trees (tests, generated artifacts, scratch dirs) where "who imports this / what schema" carries no signal. |
| `GATEGUARD_FACT_FORCE_FULL_DENIALS` | `3` | How many denials emit the full fact block before later ones condense to a single line. `0` condenses from the very first denial. |
| `GATEGUARD_FACT_FORCE_MAX_DENIALS` | unset (no cap) | A **denial budget**: caps how many first-touch Edit/Write/MultiEdit/NotebookEdit denials a session draws. Once that many denials have been issued, further new paths pass through instead of being denied (counted in `cap_allows`, not as denials); `0` passes from the first. Prior-search credit and sibling collapse run first and never use it up, and [sensitive](#sensitive-targets) and [hard-linked](#hard-linked-targets) targets are always denied. Destructive and routine Bash stay gated. The cap is best effort when hooks run concurrently: a lost count update can add a denial, but never lets a new path through early. Opt-in: unset, or any value that is not a whole non-negative integer (surrounding spaces allowed), keeps the deny-every-new-path behaviour; a malformed value is reported once on stderr (`ignoring malformed GATEGUARD_FACT_FORCE_MAX_DENIALS=…; the denial cap is not active.`). Unlike `GATEGUARD_FACT_FORCE_FULL_DENIALS`, a **message budget** that only changes how much text a denial carries, this changes whether the operation is blocked. Condensed denials name this variable. |
| `GATEGUARD_BASH_EXTRA_DESTRUCTIVE` | unset | Extra destructive-command patterns, as regex source, added to the built-in set. A malformed regex is treated as unset (built-ins still apply) and logged once to stderr. |
| `GATEGUARD_STATE_DIR` | `~/.gateguard` | Where per-session gate state is kept. If state cannot be persisted the gate allows the operation rather than looping, and names this variable in the warning. |
| `GATEGUARD_METRICS` | unset (off) | Records one line per Edit/Write/MultiEdit/NotebookEdit/Bash/PowerShell decision in `<GATEGUARD_STATE_DIR>/metrics.jsonl` (see [Decision metrics](#decision-metrics)). Never changes a decision. |

`GATEGUARD_BASH_ROUTINE_DISABLED` and `GATEGUARD_METRICS` accept `1`, `true`,
`on`, `enabled`, `enable`, or `yes` (case- and whitespace-insensitive); any
other value leaves the routine gate on and metrics off.

#### Decision metrics

With `GATEGUARD_METRICS=1`, each gate decision appends one JSON line to
`metrics.jsonl` in the state directory (a MultiEdit call writes one line per
file it decided):

```json
{"v":1,"ts":"2026-09-01T10:02:00.000Z","session":"3f9c0a1b2d4e","tool":"Edit","class":"code","decision":"deny","reason":"near-miss:out-of-scope","questions":["local-callers","quote-instruction"],"sensitive":false,"profile":{"known":true,"language":"js","touchesPublicSurface":false,"touchesData":false,"trivial":false}}
```

| Field | Meaning |
|---|---|
| `v` | Schema version (`1`) |
| `session` | First 12 hex characters of the sha256 of the session key |
| `tool` | `Edit`, `Write`, `MultiEdit`, `NotebookEdit`, `Bash` or `PowerShell` |
| `class` | Target class, or `null` for shell commands |
| `decision` | `deny`, `credit`, `sibling`, `cap`, `trivial`, `pass-checked`, `pass-exempt`, `pass-subagent`, `routine-deny`, `routine-readonly`, `destructive-deny` or `pass` |
| `reason` | Short code: `first-touch`, `sensitive`, `hard-linked`, `near-miss:<code>`, `subagent-sensitive`, `subagent-hard-linked`, `prior-search`, `comment-whitespace`, `same-turn-dir`, `max-denials`, `checked`, `exempt-glob`, `claude-settings`, `no-path`, `subagent`, `readonly-git`, `readonly`, `first-command`, `routine-checked`, `routine-disabled`, `destructive`, `destructive-retry`, `state-error` |
| `questions` | Question ids of a first-touch denial; `null` otherwise |
| `sensitive` | Whether the target is a [sensitive target](#sensitive-targets) |
| `profile` | Change-profile flags when the profile was computed; `null` otherwise |

**Privacy:** lines never contain paths, commands, file content, transcript
text or the session id itself; every text field must be a short lowercase
code or is written as `null`. Metrics errors are ignored. Past 1 MiB the file
is renamed to `metrics.jsonl.1`, replacing the previous one.

Summarise the metrics with:

```bash
node scripts/gateguard-report.js            # GATEGUARD_STATE_DIR or ~/.gateguard
node scripts/gateguard-report.js --dir /path/to/state --json
```

It reads `metrics.jsonl.1` then `metrics.jsonl`, skips malformed lines, and
prints, per session and in total: decisions by type, denials by class and
reason, the share of first-touch denials that followed a near-miss search,
the rates of denial, credit, sibling collapse, cap and trivial edits among
first touches, routine read-only passes, and the most-asked question ids.

#### Turning the gate off completely

| Variable | Effect |
|---|---|
| `ECC_GATEGUARD=off` | Disables GateGuard for the session. Accepts `0`, `false`, `off`, `disabled`, or `disable`. |
| `GATEGUARD_DISABLED=1` | Same effect. Recognises `1` only — the spellings above do **not** apply here. |

For hook-level control, keep using `ECC_DISABLED_HOOKS` with the GateGuard hook ID.

#### Glob semantics for `GATEGUARD_EXEMPT_GLOBS`

Patterns match the entire project-relative target path. The project root is
`CLAUDE_PROJECT_DIR`, falling back to the hook payload's `cwd`, then the hook
process working directory. Relative globs never exempt targets outside that
root. Explicit absolute globs match the entire absolute target path and may
deliberately exempt paths outside the project.

Both patterns and paths use `/` separators and lowercase matching. `*` matches
within a segment, `**` across segments, and `?` one non-separator character.
`**/` includes zero directories, so `**/tests/**` also matches `tests/foo.js`.
Malformed patterns are dropped without granting an exemption.
An exemption applies before every other rule, including the sensitive and
hard-link rules (see [Order of checks](#order-of-checks)).

Since 2.2.1, `services/**` only covers the project's root services tree, and
`*.md` only covers its root Markdown files. Use `**/*.md` for all Markdown
files within the project. Existing unanchored exemptions may need adjustment:

```json
{
  "env": {
    "GATEGUARD_BASH_ROUTINE_DISABLED": "1",
    "GATEGUARD_EXEMPT_GLOBS": "**/tests/**,tests/**,**/*.test.*,**/docs/**,**/dist/**"
  }
}
```

### Option B: Full package with config

```bash
pip install gateguard-ai
gateguard init
```

This adds `.gateguard.yml` for per-project configuration (custom messages, ignore paths, gate toggles).

## Anti-Patterns

- **Don't use self-evaluation instead.** "Are you sure?" always gets "yes." This is experimentally verified.
- **Don't skip the data schema check.** Both A/B test agents assumed ISO-8601 dates when real data used `%Y/%m/%d %H:%M`. Checking data structure (with redacted values) prevents this entire class of bugs.
- **Don't gate every single Bash command.** Routine bash gates once per session. Destructive bash gates every time. This balance avoids slowdown while catching real risks.

## Best Practices

- Let the gate fire naturally. Don't try to pre-answer the gate questions — the investigation itself is what improves quality. A real search for the target before editing is investigation, and is credited (see [What Counts as Already Done](#what-counts-as-already-done)).
- Customize gate messages for your domain. If your project has specific conventions, add them to the gate prompts.
- Use `.gateguard.yml` to ignore paths like `.venv/`, `node_modules/`, `.git/`.

## Related Skills

- `safety-guard` — Runtime safety checks (complementary, not overlapping)
- `code-reviewer` — Post-edit review (GateGuard is pre-edit investigation)
