# Cross-Harness Semantic Verb System (#2389)

Portable skills can express harness-agnostic capabilities using ten canonical semantic verbs plus an optional `requires` YAML frontmatter list:

| Semantic Verb | Claude Code Example | Codex / Shell Equivalent |
| --- | --- | --- |
| `{read}` | `Read` / `Grep` | file read / `rg` |
| `{write}` | `Write` | file creation |
| `{edit}` | `Edit` | patch / diff apply |
| `{run}` | `Bash` | shell command |
| `{search}` | `Glob` / `Grep` | filesystem / symbol search |
| `{validate}` | `npm test` / lint | test & lint runner |
| `{browse}` | Playwright / DevTools MCP | headless browser |
| `{ask}` | User prompt / question tool | interactive confirmation |
| `{delegate}` | `Task` / subagent | spawned worker |
| `{store}` | Memory / state file | session state write |

Existing skills without `requires` continue to work unchanged.
