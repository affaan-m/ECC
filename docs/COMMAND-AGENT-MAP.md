# Command Agent Map

This map records the command surface after the selective upstream port. Paths use the fork's nested language-specific layout.

| Command | Primary agent or skill | Notes |
|---------|------------------------|-------|
| `/plan` | `agents/common/planner.md` | General implementation planning |
| `/code-review` | `agents/node/node-code-reviewer.md` | General code review command |
| `/python-review` | `agents/python/python-reviewer.md` | Python review with local `uv`, `ruff`, and `ty` guidance |
| `/fastapi-review` | `agents/python/fastapi-reviewer.md`, `skills/python/fastapi-patterns/` | FastAPI-specific review |
| `/rust-build` | `agents/rust/rust-build-resolver.md` | Rust build and borrow-checker repair |
| `/rust-review` | `agents/rust/rust-reviewer.md` | Rust code review |
| `/rust-test` | self-contained command doc | Rust TDD and coverage workflow |
| `/node-tdd` | `skills/node/node-tdd-workflow/` | Existing Node TDD flow |
| `/verify` | common verification docs (`commands/common/verify.md`) | Existing verification flow |

## Direct-Use Agents

| Agent | Path | Use |
|-------|------|-----|
| TypeScript reviewer | `agents/typescript/typescript-reviewer.md` | Invoke directly for TypeScript or JavaScript reviews |
| FastAPI reviewer | `agents/python/fastapi-reviewer.md` | Invoke directly for focused FastAPI applications |
| Rust reviewer | `agents/rust/rust-reviewer.md` | Invoke directly for Rust reviews |

## Refactoring Rule

When importing upstream command docs, replace flat references such as `agents/rust-reviewer.md` and `skills/python-patterns/` with nested references such as `agents/rust/rust-reviewer.md` and `skills/python/python-patterns/`.
