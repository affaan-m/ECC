# Selective Copilot MCP configuration

P07 implementation provides an opt-in stdio and authless remote adapter. No installation hook
runs it. Native Windows/Copilot behavior remains **native-unverified**.

From the ECC checkout, supply an explicit absolute configuration path. For
example, replace `/project/.mcp.json` with the actual project path:

```text
node scripts/copilot-mcp.js preview --config /project/.mcp.json --select context7
node scripts/copilot-mcp.js apply --config /project/.mcp.json --select context7
node scripts/copilot-mcp.js doctor --config /project/.mcp.json
node scripts/copilot-mcp.js doctor --config /project/.mcp.json --probe context7 --timeout 3000
node scripts/copilot-mcp.js rollback --config /project/.mcp.json
```

`preview` writes nothing. `apply` recomputes a preview and explicitly adds the
selected servers. `NAME:ALIAS` changes the configuration name. Use `--tools TOOL1,TOOL2` to select the same reviewed tools for each selected
server, or use the module API for per-server lists. Without that option the
CLI writes an empty list; review tools before enabling them. Tool availability never grants approval.
Built-in GitHub aliases are skipped. Literal catalog environment values are
replaced by `${VARIABLE}` references; provide values through the operator's
launch environment. Remote `http`, `streamable-http` (normalized to `http`)
and legacy `sse` configuration entries are supported. Remote URLs must use HTTPS
or literal loopback HTTP; credentials, query strings, fragments, placeholders
and nonempty headers are rejected pending a verified authentication adapter.
Unsupported server metadata is rejected. Credential flags (including
placeholders) and recognized secret patterns in executable arguments are
rejected; use environment references instead. Arbitrary opaque secrets cannot
be detected universally, so review command and argument values before apply. Such selections produce
an error requiring an explicit adapter; they are not reported installed.

The current documented Copilot contract includes project `.mcp.json` and
`.github/mcp.json`, plus a user MCP configuration. Project loading depends on
folder trust; precedence and custom configuration directories depend on the CLI
version. No location or scope is guessed by ECC. Confirm the selected path
against your actual CLI version. Bare project maps and VS Code `servers` format
must be migrated explicitly to `mcpServers` before this adapter manages them.

Configuration and ownership are read with limits. An exclusive writer lock,
atomic replacement and preview digests protect against stale cooperative writes.
Unknown user properties and unselected servers survive. Same-name user servers
are collisions even if their content happens to match. Ownership is stored as
entry hashes in `<config>.ecc-managed.json`; no environment values are copied
there. Rollback removes only matching owned entries and preserves user changes.
A crash between config/state replacement can leave an unowned entry; report and
reconcile that collision explicitly. Never delete a stale lock without checking
that its writer has stopped. Symlink and hardlink configuration paths are refused.
External editors do not participate in the ECC lock; inspect the resulting diff.

Doctor without `--probe` reads configuration only. An explicit probe starts the
selected executable with argv and a minimal environment plus configured variable
references. The catalog command and arguments must be reviewed as executable
operator configuration. It sends exactly one MCP initialize request, makes zero
tool calls and never reconnects or retries. Output is bounded and discarded;
missing environment variables, invalid responses, exit, timeout and output limit
are distinct statuses. Only the direct child is killed; use a supervised server
that does not daemonize. HTTP probes send one initialize request using protocol 2025-03-26 and accept
bounded JSON or SSE responses. They stop at the matching response, enforce a
deadline and reject invalid UTF-8. Redirects, authentication, retry and tool
calls are never performed. Legacy SSE probing is explicitly unsupported.
External service authentication and descendant process supervision are not
certified. A successful fixture handshake does not certify an external service.

Fixture tests: `node tests/lib/copilot-mcp.test.js`,
`node tests/lib/copilot-mcp-remote.test.js` and
`node tests/lib/copilot-mcp-http-security.test.js`.
An isolated Copilot 1.0.105 user configuration readback accepted the generated
HTTP entry with an empty tools list. This does not certify project trust,
precedence, network connectivity or authenticated execution. Source packaging and shared
installer integration are separate gates; these commands run from this checkout.

Official contracts consulted on 3 November 2026:

- [Adding MCP servers](https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/add-mcp-servers)
- [CLI MCP configuration reference](https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-command-reference#mcp-server-configuration)

Documentation inspection establishes a schema reference, not a tested minimum
CLI version. Native evidence must record version, OS, SHA, path and trust mode.
