# GateGuard change profile notes

Rationale for how GateGuard reads the change itself: which questions a
denial asks and which edits pass as trivial
(`scripts/lib/gateguard-change-profile.js`, `gateguard-code-lexer.js` and
`gateguard-file-context.js`). Code comments point here as
`docs/gateguard/change-profile.md#<anchor>`; keep headings stable, since they
are the anchors. The other decisions are in [design-notes.md](design-notes.md).
## Change profile

`scripts/lib/gateguard-change-profile.js` reads the change the hook already
receives (Edit `old_string`/`new_string`, each MultiEdit entry for the target,
Write `content`) and derives three booleans: `touchesPublicSurface`,
`touchesData` and `trivial`. It is string analysis of those texts and, for
`trivial`, of the current file text the hook passes in (see
[File context](#file-context)): no reads of its own, no `RegExp` built from
input, and every loop is a single linear pass.

The profile only ever removes questions, so anything uncertain yields the
unknown profile (every question asked, never trivial): an unsupported
extension, a non-string side, no entries or more than 64, a side over 64 KiB
(UTF-8), more than 256 KiB in total, or any exception. Supported languages, by
extension: JS/TS (`.js .mjs .cjs .jsx .ts .tsx .mts .cts`), Python
(`.py .pyi`), Go, Rust, Java, Kotlin (`.kt .kts`), C# and C/C++ (`.c .h .cc
.cpp .cxx .hpp .hh .hxx`), and shell scripts: POSIX shells (`.sh .bash .zsh`),
PowerShell (`.ps1 .psm1`) and batch (`.bat .cmd`). Ruby, Makefiles, Swift,
fish, PowerShell data files and everything else are unknown.

## Public surface

A Write always touches the public surface (a new or rewritten module's
surface is all new). For an Edit, any line on either side that declares or
exposes a public name counts, whether it changed or is only context: context
around a public declaration means the edit is inside that symbol.

- JS/TS: a line starting with the word `export`, `public` or `declare`, or
  containing the word `exports` (`module.exports`, `exports.x`). `.d.ts`,
  `.d.mts` and `.d.cts` files are all surface.
- Python: `def`, `async def` or `class` whose name does not start with `_`
  (dunders such as `__init__` are public), any `__all__`, and a column-0
  assignment or annotation of a public name (a module constant or variable
  that importers can read). The first line of a snippet may start mid-line
  (an Edit's `old_string` can begin after the indentation), so there only an
  all-uppercase name counts, the constant convention that function locals
  rarely use. `__init__.py` is all surface.
- Go: `func` (after an optional receiver), `type`, `var` or `const` with a
  capitalised name, a `package` line, and any line that starts with a
  capital letter (exported fields, interface methods, grouped declarations).
- Rust: lines starting with `pub` (any `pub(...)`), `impl`, `trait`,
  `extern`, or an ABI or trait attribute (`#[macro_export`, `#[derive`,
  `#[repr`, `#[no_mangle`, `#[export_name`, and their `#[unsafe(...)]`
  forms).
- POSIX shells: a function definition (`name() {`, `function name`), an
  `export`, or `declare -x`/`typeset -x`, at any indentation. A sourced
  script's functions and exported variables are what other scripts use.
- PowerShell (case-insensitive): lines starting with `function`, `filter`,
  `workflow`, `class`, `enum`, `param` (a script's parameters are its
  interface), `Export-ModuleMember`, `[CmdletBinding` or `$global:`.
- Java, Kotlin, C#, C, C++ and batch files always touch the surface:
  package-private Java, Kotlin's public default, C# partial classes, C linkage
  and batch labels reachable by `call :label` make a lexical answer
  unreliable.

An Edit that changes a function body without its declaration line in the
snippet reads as not touching the surface; the local question still asks for
the call sites that rely on the behaviour.

A member line can be public surface even though its container's declaration
is not in the snippet: a property of an exported interface, a variant of a
public enum, a name in an export list. So, when the hook passes the file text,
the nearest line above the first occurrence that starts at column 0 (skipping
blank lines, comments and decorators; a closing `}`, `]` or `)` there means
the edit is at top level) is read as the enclosing opener:

- JS/TS: `module.exports`/`exports` assigned an object, array or call, and
  `export` (or `export default`) of an interface, enum, type, namespace,
  module, `declare`, `{ ... }` list, or `const`/`let`/`var` that is not a
  function or arrow: every line inside is surface. An exported class: lines
  at the class's member indentation (the first non-blank line after the
  opener) are surface; method bodies are not. An exported `function` or
  `async function` is a body, as before.
- Python: `__all__` makes every line surface; a public `class` makes an
  assignment or annotation of a public name at member indentation (class
  attributes, dataclass fields) surface.
- Rust: a `pub` enum, struct, union, trait or `use` makes lines at member
  indentation surface.

The upward scan stops after 4 MiB in total and then counts as surface. The
opener is found by indentation, not by parsing, so it can over-match (a method
body inside an exported object literal counts), which only keeps the importer
question.

## Data handling

`touchesData` looks at every side (both sides of an Edit) as words: identifiers
are split on non-alphanumerics, `_` and camelCase boundaries and lowercased,
so `validate` and `updated` never match `date`. It is true for a data word
(formats such as `json`, `csv`, `yaml`, `parquet`; serialisation; `schema`;
SQL and database words; date/time words such as `date`, `datetime`,
`timestamp`, `strftime`, `utc`, `chrono`, `zoneinfo`; encodings such as
`base64`, `encoding`, `msgpack`; browser storage and cookies; data-store
clients such as `redis`, `prisma`, `sqlalchemy`; file I/O such as `fs`,
`fopen`, `pathlib`), for `open(`, for adjacent pairs such as `read file`,
`time now`, `time parse`, `system time`,
`write text`, `read to`, and for SQL keyword pairs anywhere in the text
(`select`+`from`, `insert`+`into`, `create`+`table`, ...). Over-matching only
keeps the data question.

Shell scripts also touch data with a file redirection (`>`, `>>`, `>|`, `&>`
or `<` followed by a target other than `/dev/null`, `/dev/stdout`,
`/dev/stderr`, `$null` or `nul`; descriptor duplication such as `2>&1` and
`>&2`, heredocs and process substitution do not count), an HTTP or document
tool (`curl`, `wget`, `jq`, `yq`, `xmllint`, `psql`, `tee`, `iwr`, `irm`),
or a PowerShell file or web cmdlet (`Out-File`, `Get-Content`,
`Set-Content`, `Add-Content`, `Invoke-WebRequest`, `Invoke-RestMethod`,
`*-Clixml`; `Import-Csv` matches `csv`). Redirection is found without
reading quotes, so a `>` inside a string also counts.

## Trivial edits

An Edit is trivial when, for every entry, old and new have the same code once
comments are removed, blank and comment-only lines are dropped, and runs of
whitespace between tokens are folded to one space. Line structure, whitespace
inside strings, and the presence of whitespace between tokens stay code
(`a+b` to `a + b` is not trivial). For Python, leading whitespace of each code
line is code; comment-only lines carry no indentation.

Comments are `//` and non-nesting `/* */` in the C family and `#` in Python;
C preprocessor lines are code. Strings are single-line `"..."` and `'...'`
(Rust: `"..."` only, with `'x'` char literals told apart from lifetimes).
Anything the lexer cannot read with confidence makes the entry non-trivial:

- any multi-line string form: JS/Go backticks, Python/Java/Kotlin/C# triple
  quotes, Rust raw strings (`r"`, `r#"`), C++ raw strings (`R"`), C# verbatim
  and interpolated strings (`@"`, `$"`), Kotlin strings containing `$`, Python
  f-strings, and any string that runs to the end of a line;
- in JS/TS, any `/` outside a comment (division and regex literals cannot be
  told apart), JSX-like `<x`, `</`, `<>`, `<!`, and `-->`;
- a line comment ending in `\` (it continues onto the next line in C and
  Make), the trigraph `??/`, a `/*` inside a block comment, and an
  unterminated block comment or string;
- a code line ending in a line continuation `\` (trailing blanks included):
  a C macro, a Python explicit continuation or a string continued onto the
  next line joins that line, so adding or removing a comment-only line after
  it changes code.

## Directive comments

Some comments are read by the language, the build or a tool, so their text is
code. A directive comment is kept in the compared code verbatim: changing,
adding or removing one makes the entry non-trivial, while an unchanged
directive next to an edited ordinary comment does not.

- A comment whose text starts with `!` (shebangs, Rust inner docs, `/*!`),
  `/` (`///` doc comments and TypeScript triple-slash references), `go:`,
  `export` or `extern` followed by a blank (cgo), or `line` followed by a
  blank (Go line directives), with no blank after the comment marker.
- A comment whose first word, after blanks, `*` and `/`, starts with `@`, `#`,
  `<`, `+`, `!`, `type:` or `requires`, or is `global`, `globals` or
  `exported` followed by a blank
  (JSDoc and TypeScript pragmas, `//# sourceMappingURL`, `// +build`, Python
  type comments, ESLint globals, PowerShell `#Requires`).
- A comment containing a tool or encoding marker such as `lint`, `ts-`,
  `noqa`, `nosec`, `pragma`, `coding:`, `fmt:`, `istanbul`, `prettier-`,
  `webpack`, `__PURE__`, `fallthrough`, `shellcheck`, `suppress`, `sonar`,
  `gitleaks`, `allowlist`, `vim:`, `-*-`, `DO NOT EDIT`, `#compdef` or Go's
  example `// Output:`, or a JSDoc type
  (`@` together with `{`). The list is in `DIRECTIVE_WORDS`; matching is
  case-insensitive and substring-based, so it over-matches prose that happens
  to contain a marker, which only keeps an edit gated.
- Every Rust doc comment (`///`, `//!`, `/**`, `/*!`): doc tests compile and
  run.

Suppression markers (`nosec`, `NOSONAR`, `gitleaks:allow`,
`pragma: allowlist secret`, `eslint-disable`) matter most: removing a finding
from a security scanner is not a comment edit.

## Shell scripts

Shell comments are lexed by their own rules, and the lexer gives up (the entry
is not trivial) wherever a comment could be code:

- POSIX shells: `#` starts a comment only at the start of a line or after a
  space, tab or `;`; after a letter, `$`, `{`, `=` and the like it is a word
  character (`a#b`, `$#`, `${#x}`, `${x#y}`). After `(`, `)`, `|`, `&`, `<` or
  `>` the entry is not trivial (zsh glob flags such as `(#i)`). Single quotes
  are raw and must close on the line; `$'...'` is not trivial; double quotes
  may hold `\` escapes and a `${...}` without quotes, but `$(` inside them,
  any backtick, any `<<` (heredocs, here-strings, shifts), a
  backslash before a line break, and a lone carriage return (bash reads it
  as a word character) make the entry not trivial. Only spaces and tabs
  between words are folded; `\` escapes stay code.
- PowerShell: `#` and `<# ... #>` are comments only at the start of a line or
  after a space, tab or `;`; elsewhere the entry is not trivial. `#Requires`
  and `#!` are [directive comments](#directive-comments), as in every
  language. Here-strings (`@"`, `@'`), typographic
  quotes (PowerShell accepts them as quote marks), `$(` inside a double-quoted
  string, a backtick before a line break, and a nested `<#` are not trivial.
- Batch: only `REM` lines (after optional blanks and `@`, followed by a blank
  or the end of the line) are comments; `::` labels are code, since they
  change the parser's behaviour inside blocks. A `REM` line holding `%`, `^`,
  `&`, `|`, `<`, `>`, `(` or `)`, and any line ending in `^`, are not trivial.
  Code lines are compared exactly: `echo` keeps its spacing.

Write is never trivial. In the hook, a trivial Edit (or a MultiEdit whose
entries for that file are all trivial) of an unchecked code, test or prose
target passes with an `additionalContext` note after prior-search credit and
before sibling collapse and the denial cap. It is not marked checked and does
not touch the denial count or ordinal, so the next change that alters code is
gated as a first touch; `trivial_allows` counts the passes (merged by maximum
like the other counters). The trivial pass never marks the target checked and
never applies to sensitive, hard-linked, instruction or config targets or to
a NotebookEdit, so the next
non-trivial change still meets the full gate.

## File context

A snippet alone cannot show whether a comment-looking line is a comment: it
may sit inside a template literal, a docstring, a raw string or a heredoc
that opens above it, follow a line that continues onto it, or lose its line
break so the next line joins it. So an Edit is trivial only when checked
against the file it applies to.

- The hook reads the current target (never a sensitive or hard-linked one) itself: the path
  is resolved like every other target, opened read-only and non-blocking,
  and used only if `fstat` says it is a regular file of at most 1 MiB; CRLF
  is folded to LF, as the Edit tool does. A missing, unreadable, larger or
  special file (directory, FIFO, device) gives no file text and the edit is
  not trivial. The text is never logged, stored or put in a message.
- Each entry is applied in order, as the tool applies it, to the evolving
  text. `old_string` must be non-empty and occur exactly once, or at least
  once with `replace_all`; otherwise the tool would fail and the entry is not
  trivial. Over 1 MiB of text after an edit, more than 8 MiB of scanning for
  one call, or an edit window over 128 KiB is not trivial. A `new_string`
  holding a `String.prototype.replace` pattern (`$$`, `$&`, `` $` ``, `$'`,
  `$<`, `$` and a digit) is not trivial, in case the tool expands it.
- The edit window runs from the start of the line before the first
  occurrence to the end of the line holding the last occurrence's end
  (through the next line when `old_string` ends in a line break), so a line
  that loses or gains a break is compared joined. The window before and
  after the replacement is compared with the lexer rules above.
- The text before the window must end in plain code: not inside a comment,
  string, template literal (including `${...}`), text block, raw string,
  heredoc or here-string, and not after a line continuation (`\` in C-family,
  Python and POSIX shells, a backtick in PowerShell, `^` in batch). A
  per-language scanner decides; anything it cannot follow makes the edit not
  trivial: a JS `/` after `}` with another `/` or quote later on the line
  (regex or division), JSX in `.js`/`.jsx`/`.tsx` (`.ts`, `.mts` and `.cts`
  allow `<` generics), `<!--` and `-->`, a Python f-string whose
  replacement field holds its own quote, a comment or a line break, C#
  raw strings and interpolation holes with quotes or braces, Kotlin `${`
  inside strings, shell command substitution holding `case`, a heredoc or
  a comment, a heredoc whose terminator never comes, and nesting deeper than
  eight levels.
- Go files that import `"C"` are never trivial: the comment before the import
  is C code.
- The window comparison runs before the prefix scan. Both must pass, so the
  order changes no result, but most first-touch edits change code and fail
  the window comparison, which spares them a scan of everything above the
  edit.

The scanner was checked against real tokenizers over this repository: every
line start it calls plain code in 801 JS files (espree) and 146 Python files
(`tokenize`) is outside strings, templates, regex literals and comments and
not a backslash continuation.

## When a change is profiled

The profile is computed only when its result is used: for classes whose
questions depend on it (code), for Edit and MultiEdit calls on the classes
that can pass as trivial (code, test, prose), and for every call when
decision metrics are on, so the metrics lines keep their profile fields.
Instruction and config targets, and new test or prose files, skip it and the
lexer modules it needs.

## Questions from the change profile

Every question has a stable id, and `questionIdsFor(class, isWrite, profile)`
returns the ids in the order asked, so later measurement can record which
questions were asked without storing text.

| Target | Profile | Question ids |
|---|---|---|
| code Edit/MultiEdit | unknown | `importers`, `public-api`, `data-schema`, `quote-instruction` |
| code Edit/MultiEdit | public surface | `importers`, `public-api`, [`data-schema`], `quote-instruction` |
| code Edit/MultiEdit | no public surface | `local-callers`, [`data-schema`], `quote-instruction` |
| code Write | unknown | `callers`, `no-duplicate`, `data-schema`, `quote-instruction` |
| code Write | known | `callers`, `no-duplicate`, [`data-schema`], `quote-instruction` |
| instruction | any | `loader`, `behaviour-change`, `no-duplicate-instruction`, `quote-instruction` |
| test | any | `under-test`, `existing-tests`, `quote-instruction` |
| prose Write | any | `supersedes`, `linked-from`, `why-new-file`, `quote-instruction` |
| prose Edit | any | `references`, `corrects-or-adds`, `quote-instruction` |
| config | any | `config-reader`, `config-effect`, `no-plaintext-secrets`, `quote-instruction` |

`[data-schema]` is asked only when `touchesData`. With an unknown profile the
code text is byte-identical to the fixed four questions. Sensitive and
hard-linked targets and NotebookEdit calls are never profiled, so they always
get the full code questions. Instruction and
config questions carry no change-dependent item, and the test and prose items
do not depend on what the change touches, so the profile leaves those classes
alone. For a MultiEdit, the denied file's profile covers every entry for that
file (same canonical key); entries for other files do not count.

A condensed code denial names the same ids as a full one, one short phrase per
id (`condensedQuestionPhrase`), so the data and duplicate checks follow the
profile there too. The one exception is an Edit with an unknown profile, which
keeps the original hint byte for byte ("importers/callers, affected API, data
schemas if any"); a Write with an unknown profile, sensitive Writes included,
names `callers`, `no-duplicate` and `data-schema` like its full denial.
