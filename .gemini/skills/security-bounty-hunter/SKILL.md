---
name: security-bounty-hunter
description: Hunt for exploitable, bounty-worthy security issues in repositories. Focuses on remotely reachable vulnerabilities that qualify for real reports instead of noisy local-only findings.
origin: ECC direct-port adaptation
version: "1.0.0"
---

# Security Bounty Hunter

Use this when the goal is practical vulnerability discovery for responsible disclosure or bounty submission, not a broad best-practices review.

## When to Use

- Scanning a repository for exploitable vulnerabilities
- Preparing a Huntr, HackerOne, or similar bounty submission
- Triage where the question is "does this actually pay?" rather than "is this theoretically unsafe?"

## How It Works

Bias toward remotely reachable, user-controlled attack paths and throw away patterns that platforms routinely reject as informative or out of scope.

## In-Scope Patterns

These are the kinds of issues that consistently matter:

| Pattern | CWE | Typical impact |
| --- | --- | --- |
| SSRF through user-controlled URLs | CWE-918 | internal network access, cloud metadata theft |
| Auth bypass in middleware or API guards | CWE-287 | unauthorized account or data access |
| Remote deserialization or upload-to-RCE paths | CWE-502 | code execution |
| SQL injection in reachable endpoints | CWE-89 | data exfiltration, auth bypass, data destruction |
| Command injection in request handlers | CWE-78 | code execution |
| Path traversal in file-serving paths | CWE-22 | arbitrary file read or write |
| Auto-triggered XSS | CWE-79 | session theft, admin compromise |

## Skip These

These are usually low-signal or out of bounty scope unless the program says otherwise:

- Local-only `pickle.loads`, `torch.load`, or equivalent with no remote path
- `eval()` or `exec()` in CLI-only tooling
- `shell=True` on fully hardcoded commands
- Missing security headers by themselves
- Generic rate-limiting complaints without exploit impact
- Self-XSS requiring the victim to paste code manually
- CI/CD injection that is not part of the target program scope
- Demo, example, or test-only code

## Workflow

1. Check scope first: program rules, SECURITY.md, disclosure channel, and exclusions.
2. Find real entrypoints: HTTP handlers, uploads, background jobs, webhooks, parsers, and integration endpoints.
3. Run static tooling where it helps, but treat it as triage input only.
4. Read the real code path end to end.
5. Prove user control reaches a meaningful sink.
6. Confirm exploitability and impact with the smallest safe PoC possible.
7. Check for duplicates before drafting a report.

## Example Triage Loop

```bash
semgrep --config=auto --severity=ERROR --severity=WARNING --json
```

Then manually filter:

- drop tests, demos, fixtures, vendored code
- drop local-only or non-reachable paths
- keep only findings with a clear network or user-controlled route

## Report Structure

```markdown
## Description
[What the vulnerability is and why it matters]

## Vulnerable Code
[File path, line range, and a small snippet]

## Proof of Concept
[Minimal working request or script]

## Impact
[What the attacker can achieve]

## Affected Version
[Version, commit, or deployment target tested]
```

## Quality Gate

Before submitting:

- The code path is reachable from a real user or network boundary
- The input is genuinely user-controlled
- The sink is meaningful and exploitable
- The PoC works
- The issue is not already covered by an advisory, CVE, or open ticket
- The target is actually in scope for the bounty program
