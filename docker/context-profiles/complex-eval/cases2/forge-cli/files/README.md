# snippet-cli

A small in-process snippet manager. No external dependencies; Node.js standard
library only.

## Contract

`src/cli.js` is CommonJS and exports `run(argv, state)`:

- `argv`: array of command-line words (already split, no program name).
- `state`: any plain object, created by the caller as `{}`. The CLI keeps its
  data in it and mutates it in place; it survives across calls.
- Returns synchronously: `{ code, stdout, stderr }` — a number and two strings
  (empty string when there is nothing to print). `run` must **never throw**,
  on any input.
- All printed lines end with `\n`.

## Commands (all behavior below is contractual)

1. `add <name> [--tags a,b] <text...>` — creates a snippet from the remaining
   words joined by single spaces. Prints `created <name>`, code 0.
2. Adding an existing name: code 1, stderr `error: snippet '<name>' already exists`,
   state unchanged.
3. `add` with a missing name or missing text: code 2, stderr
   `usage: add <name> [--tags t1,t2] <text...>`.
4. Names must match `^[a-z0-9][a-z0-9-]*$`; otherwise code 2, stderr
   `error: invalid snippet name '<name>'`.
5. `get <name>` — prints the exact text, code 0. Unknown name: code 2, stderr
   `error: no snippet named '<name>'`.
6. `remove <name>` — prints `removed <name>`, code 0. Unknown name: same as `get`.
7. `list` — every snippet name, sorted ascending, one per line. With no
   snippets: prints `no snippets`. Always code 0.
8. `list --tag <t>` — only snippets whose tags include `t`.
9. `search <term>` — case-insensitive substring match over name **and** text;
   prints matching names sorted, one per line; prints `no matches` when empty.
   Code 0.
10. `export` — prints `JSON.stringify` of `{ snippets: { <name>: { text, tags } } }`
    with names sorted and each `tags` array sorted. Code 0.
11. `import <json>` — merges an exported document: names not already present
    are added, existing names are skipped. Prints `imported <N>, skipped <M>`,
    code 0. Malformed JSON: code 1, stderr `error: invalid JSON`, state
    unchanged.
12. No command or an unknown command: code 2, stderr
    `usage: snippet <add|get|list|remove|search|export|import>`.

Run the tests with `npm test`.
