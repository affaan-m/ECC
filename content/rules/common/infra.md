# Infrastructure & Design

Applies to infrastructure work: architecture documents, cloud and
on-prem system design, and IaC.

## Design Principles

- Prefer managed services; run components yourself only with an
  explicit justification (cost, compliance, capability gap).
- Document failure scenarios alongside every component: what breaks,
  the blast radius, and the recovery path.
- Do not add components the requirements don't call for — YAGNI
  applies to architecture as much as to code.
- Follow the global Design Decisions guideline: at least two options
  with trade-offs, and unverified figures (prices, quotas, SLAs)
  marked "needs verification".

## IaC (Terraform)

- Split configuration into modules; no hardcoded values — use
  variables and locals with the project's pinned Terraform version.
- Comment each resource with why it exists, not what it does.
- Quality gate: `terraform fmt -check`, `terraform validate`, and
  `tflint` must pass before commit.
