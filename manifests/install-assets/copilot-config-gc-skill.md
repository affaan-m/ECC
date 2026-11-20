---
name: config-gc
description: Audit the current GitHub Copilot CLI project's ECC-managed installation for missing files and drift. Use when asked to review configuration health or identify cleanup candidates.
metadata:
  origin: ECC
---

# Audit the Copilot project installation

From the current project root, run this read-only check with the trusted local
`ecc` executable from an installed `ecc-universal` package:

```sh
ecc doctor --target copilot --json
```

For a project-local npm install, use
`node node_modules/ecc-universal/scripts/ecc.js doctor --target copilot --json`.
If the local CLI is unavailable, report that the audit could not run.

Read the JSON even when doctor exits with status 1, which signals findings.
Summarize missing and drifted managed paths using the doctor report. An empty
result means the project has no recorded installation to audit. If the report
shows an invalid install state, report the diagnostic and stop. Describe
ownership only where the recorded install state supports it. Treat other
project files as user-owned unless ownership is established.

Return findings and suggested next steps in the conversation. Keep this audit
read-only. Leave files, install state, settings, and hooks untouched.
