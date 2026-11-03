---
name: ecc-security
description: Review application changes for authorization, input validation, secrets, injection, unsafe file access, and dependency risks.
---

# Security review

Identify the changed trust boundaries and concrete threat paths. Inspect
authorization at resource access, input validation, parameterized queries,
HTML sinks, subprocess arguments, path traversal, SSRF, and secret handling
where relevant. Keep credentials and private payloads out of reports.

Report actionable findings with exploit preconditions, affected code, and a
bounded fix. Use project security checks when available. Do not turn an ordinary
change into an unrelated hardening project or add approval gates beyond the
user's scope and the actual execution permissions.

For web authentication, uploads, API boundaries, or injection examples, read
[application review](references/web-review.md). Adapt controls to the architecture:
cookie-based sessions, bearer tokens, local IPC, and native apps have different boundaries.
