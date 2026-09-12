---
name: agent-security-hardening
description: Security hardening guidance for AI agent frameworks that process untrusted content, invoke tools, write workspace files, manage runtime identifiers, or handle credentials. Use when building or reviewing an agent runtime, autonomous worker, tool gateway, memory service, or multi-tenant agent deployment. Do not use for general web application security or offensive testing.
metadata:
  origin: ECC
---

# Agent Security Hardening

Harden the boundaries where an agent turns untrusted data into filesystem, network, memory, or tool actions. Produce concrete controls and tests for the framework being reviewed; a checklist without enforcement evidence is incomplete.

## Important

- Treat model output, retrieved content, tool output, memory, and cross-agent messages as untrusted input.
- Default external integrations to read-only and grant each write capability separately.
- Validate at the action boundary even when an upstream prompt or schema already validated the value.
- Fail closed before a side effect when identity, destination, ownership, or containment cannot be proven.
- Before a delete, publish, credential rotation, or other irreversible action, the real tool entry point must authorize the authenticated principal for that exact operation and resource scope, then require explicit confirmation or a valid scoped pre-approval. Missing or invalid evidence blocks the action.
- Use hard bounds defined by the governing requirement and stricter values verified from deployment configuration. When neither defines a value, mark it as a required decision and test that the implementation rejects an unbounded configuration; do not invent a plausible value.

## When to Activate

- Building an autonomous agent, tool gateway, memory service, or agent-to-agent protocol
- Reviewing code that maps model output into commands, paths, URLs, credentials, or API mutations
- Isolating tenants, projects, sessions, or workspaces in a long-running agent process
- Hardening temporary files, logs, tool responses, or external-content ingestion

## Hardening Workflow

### 1. Map Trust Boundaries

List every boundary as `source -> parser -> validator -> side effect`. Include direct user input, model output, retrieved documents, memory, environment variables, tool results, and messages from other agents.

For each side effect, record:

- the identity and scope authorizing it;
- the exact validator that runs immediately before it;
- the maximum input and output size;
- the audit evidence produced;
- the recovery path if the operation is interrupted.

This step is complete when every write, command, network mutation, and credential use has one named authorization boundary.

### 2. Validate Identifiers, Environment Values, and URLs

Use an allowlist for identifiers that become filenames, keys, selectors, or command arguments. Agent IDs have the issue-defined hard maximum of 64 characters; deployment configuration may choose a stricter positive limit but cannot raise that boundary:

```python
import re

SAFE_AGENT_ID_CHARS = re.compile(r"^[A-Za-z0-9_][A-Za-z0-9_-]*$")
HARD_MAX_AGENT_ID_LENGTH = 64

def require_agent_id(value: object, *, max_length: int) -> str:
    if (
        isinstance(max_length, bool)
        or not isinstance(max_length, int)
        or not 1 <= max_length <= HARD_MAX_AGENT_ID_LENGTH
    ):
        raise RuntimeError("configured agent ID limit must be between 1 and 64")
    if (
        not isinstance(value, str)
        or len(value) > max_length
        or not SAFE_AGENT_ID_CHARS.fullmatch(value)
    ):
        raise ValueError("invalid agent identifier")
    return value
```

When an identifier becomes a CLI argument, pass it through an argv API and place it after the command's end-of-options marker where supported. Character validation is not a substitute for argument separation.

Reject missing and whitespace-only environment values before constructing a client:

```python
def require_env(name: str, environ: dict[str, str]) -> str:
    value = environ.get(name)
    if value is None or not value.strip():
        raise RuntimeError(f"{name} is required")
    return value
```

Parse URLs, allow only schemes required by the deployment, require a host, reject embedded credentials, and block private-network destinations when the URL is attacker-controlled. For every outbound connection and redirect hop, pin the connection to a validated public address or verify the connected peer address at connection time so DNS rebinding cannot cross the boundary. A credential-bearing request must use HTTPS with certificate verification before credentials are attached. Disable automatic cross-origin credential forwarding; when the scheme or origin changes, strip the credentials and reauthorize the new destination or reject the redirect. Re-run destination, connected-address, and transport validation on every hop.

This step is complete when tests reject empty, oversized, malformed, traversal-shaped, credential-bearing, and unauthorized-destination values before any side effect, and prove that DNS rebinding and cross-origin redirects cannot carry credentials to an unapproved peer.

### 3. Contain Filesystem Access

Reject absolute user-controlled paths and traversal components before joining. Resolve both the workspace and candidate path, then prove containment:

```python
from pathlib import Path

def workspace_path(workspace: Path, requested: str) -> Path:
    relative = Path(requested)
    if relative.is_absolute() or ".." in relative.parts:
        raise ValueError("path must be workspace-relative")

    root = workspace.resolve(strict=True)
    candidate = (root / relative).resolve(strict=False)
    if not candidate.is_relative_to(root):
        raise ValueError("path escapes workspace")
    return candidate
```

Containment checks do not eliminate symlink races. For sensitive writes, open relative to a trusted directory handle where the platform supports it, reject symlink targets, create files exclusively, and verify ownership and permissions after opening.

This step is complete when tests cover sibling-prefix paths, nested `..`, absolute paths, symlink escapes, and a valid nested workspace path.

### 4. Protect Temporary Data and Credentials

- Create sensitive files with owner-only permissions such as `0o600`; create private directories with `0o700`.
- Prefer a user-private runtime directory over a shared temporary directory for credentials or tenant data.
- Create unpredictable names atomically; do not check-then-create.
- Remove temporary data in `finally`, while preserving a redacted error record when cleanup fails.
- Keep secrets out of command arguments, model context, logs, traces, exception text, and tool responses.
- Pass secrets through the platform's secret store or scoped environment injection and rotate exposed credentials.
- Treat zeroization as best effort: mutable byte buffers can be overwritten, but immutable language strings cannot be reliably erased.

This step is complete when file-mode checks, forced-error cleanup tests, and log-capture tests show that secret values never persist outside the approved boundary.

### 5. Bound and Sanitize Tool Output

Read tool output with a byte limit rather than collecting an unbounded stream. Preserve structured fields, remove disallowed control characters, and append an explicit truncation marker with the original byte count. Keep a content hash when later forensic comparison matters.

Do not silently turn malformed output into an empty success value. Return a typed failure that names the producing tool, boundary, and validation reason without echoing sensitive content.

This step is complete when oversized output, invalid encoding, terminal-control sequences, malformed structured data, and a normal response all have deterministic tests.

## Verification Gate

Before calling the framework hardened, verify all of these behaviors through its real entry point:

1. Untrusted instructions remain data and cannot trigger a tool or write.
2. An irreversible action without operation-and-resource authorization plus confirmation or scoped pre-approval leaves no side effect.
3. Cross-tenant and cross-workspace identifiers are rejected at the action boundary.
4. Traversal and symlink escape attempts leave the filesystem unchanged.
5. Forced failures leave no credential-bearing temp files or logs.
6. Oversized or malformed tool output returns an explicit bounded error.

Report the command used, exit status, rejected input, and observed absence of the side effect. Mock-only tests do not prove operating-system permissions, symlink handling, subprocess isolation, or network egress controls.

## Common Issues

### Validation exists only in the prompt

Prompt instructions are advisory. Move the same invariant into deterministic code immediately before the side effect and test a model response that violates it.

### A normalized path still escapes

String prefix checks confuse sibling paths such as `/work/app` and `/work/application`. Resolve paths and use component-aware containment, then test symlinks separately.

### Redaction happens after logging

Redact before values enter the logger, tracer, exception, or model context. Add a capture test using a sentinel secret and assert the sentinel is absent from every emitted channel.

## When NOT to Use

- Use `security-review` for ordinary application authentication, authorization, SQL injection, XSS, CSRF, and API security.
- Use `security-scan` for repository-wide automated vulnerability scanning.
- Use infrastructure-specific guidance for host, container, firewall, or cloud hardening.
- Do not use this skill for penetration testing, exploit development, or unauthorized access.

## Related Skills

- `agent-harness-construction`
- `security-review`
- `security-scan`
