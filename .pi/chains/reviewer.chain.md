---
name: reviewer
description: Review the code changes securely using a parallel scout-and-review approach.
chain:
  - parallel:
      - agent: code-reviewer
        task: 'Review {task} for general code quality, immutability, and architecture.'
        output: docs/implementation/code-review.md
      - agent: security-reviewer
        task: 'Review {task} for hardcoded secrets, injection vulns, and auth issues.'
        output: docs/implementation/security-review.md
  - agent: tdd-guide
    task: 'Synthesize findings from {previous} and update tests if required based on the review.'
---

# Reviewer Chain

1. Parallels a `code-reviewer` and a `security-reviewer`.
2. Gathers the output into a synthesis step handled by the `tdd-guide`.
