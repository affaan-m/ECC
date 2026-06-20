---
description: Validate epic readiness, dependencies, and coordination policy.
---

# /epic-validate

Validate a single epic issue before publishing or review handoff.

```bash
node scripts/github-coordination.js validate <issue-number> --repo <owner/repo>
```

What this checks:

1. Coordination state exists and is parseable.
2. Validation state is satisfied by policy.
3. Declared dependencies are closed.
4. The epic is ready for the next workflow stage.

Compatibility aliases:

- `/quality-gate`
