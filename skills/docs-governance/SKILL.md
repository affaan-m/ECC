---
name: docs-governance
description: System-level documentation governance workflow coordinating architecture decision records, contract boundaries, TEST-ID evidence tracking, and phase-close synchronization. Use when establishing or auditing end-to-end documentation governance across a multi-phase repository.
metadata:
  origin: ECC
---

# Documentation Governance Workflow

Coordinate ECC's documentation and evidence skills into a closed lifecycle loop:

1. **Constitution & Domain Vocabulary** -> invoke `architecture-decision-records` and `living-docs-governance`
2. **Pre-Change Blast Radius & Contracts** -> invoke `contract-first` before API or schema edits
3. **Evidence & Regression Ledger** -> link requirement/defect IDs to executable tests via `ai-regression-testing`
4. **Phase-Close Synchronization** -> verify internal links, ADR indexes, and TEST-ID references deterministically before semantic review
