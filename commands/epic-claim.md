---
description: Claim an epic issue, stamp coordination state, and sync local ownership.
---

# /epic-claim

Claim one epic issue as the source of truth for a unit of work.

Use the coordination script:

```bash
node scripts/github-coordination.js claim <issue-number> --repo <owner/repo> --actor <login>
```

What this does:

1. Loads the issue body and coordination block.
2. Marks the epic as claimed in GitHub issue state.
3. Updates labels and the local SQLite cache.
4. Appends an audit comment for the claim.

Compatibility aliases:

- `/orch-add-feature`
- `/orch-change-feature`
- `/prp-implement`
