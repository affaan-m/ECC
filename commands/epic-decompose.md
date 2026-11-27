---
description: Break an epic into task children without creating task branches.
---

# /epic-decompose

Reconcile the task breakdown for one epic issue.

```bash
node scripts/github-coordination.js decompose <issue-number> --repo <owner/repo>
```

What this does:

1. Reads the epic issue body for task checklists and dependency references.
2. Stores the decomposition in the coordination block.
3. Leaves task branches out of the workflow.
4. Appends a concise audit comment.

Compatibility aliases:

- `/plan`
- `/prp-plan`
