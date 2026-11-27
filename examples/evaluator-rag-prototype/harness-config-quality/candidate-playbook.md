# Harness Config Quality Playbook

Candidate id: `adapter-matrix-backed-drift-check`

Use this playbook when a PR, install change, or setup recommendation touches
MCP, plugins, hooks, commands, agents, rules, install targets, or harness
adapter surfaces.

## Accepted Path

1. Identify the touched harness/config surface.
2. Retrieve the adapter state from
   `docs/architecture/harness-adapter-compliance.md` or
   `scripts/lib/harness-adapter-compliance.js`.
3. Record whether the harness is `Native`, `Adapter-backed`,
   `Instruction-backed`, or `Reference-only`.
4. Name the install/onramp path and verification command from the matrix.
5. Preserve existing user and project config by using merge, dry-run, or
   explicit no-overwrite behavior.
6. Run the relevant validation gate:
   - `npm run harness:adapters -- --check`
   - `npm run harness:audit -- --format json`
   - `node tests/lib/install-targets.test.js`
   - `node tests/opencode-plugin-hooks.test.js`
   - `node tests/docs/mcp-management-docs.test.js`
7. Promote a config recommendation only when the evidence matches the harness
   state and the config preservation behavior is explicit.

## Rejected Path

Do not claim Claude hook parity for Codex, Gemini, Zed, OpenCode, or other
harnesses unless the adapter matrix and tests prove it.

Do not overwrite `settings.json`, MCP configs, plugin manifests, rule files, or
command surfaces without a merge/dry-run path and a rollback note.

Do not toggle live MCP servers, publish plugins, or edit user-level harness
config from the evaluator run.

## Minimum Validation

- `npm run harness:adapters -- --check`
- `npm run harness:audit -- --format json`
- Focused install, plugin, MCP, or hook test for the changed surface
- `git diff --check`
- Markdown lint when docs are touched

Record the adapter state, risk note, validation commands, and config
preservation behavior in the maintainer PR body or handoff.
