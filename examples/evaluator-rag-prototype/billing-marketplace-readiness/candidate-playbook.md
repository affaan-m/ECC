# Billing Marketplace Readiness Playbook

Use this playbook when release copy or roadmap text mentions ECC Tools
billing, Marketplace availability, account recovery, plans, seats,
entitlements, or subscription state.

## Accepted Path

1. Start from `docs/releases/2.0.0-rc.1/publication-readiness.md`.
2. Check the current repo and public listing surfaces:
   - `gh api repos/ECC-Tools/ECC-Tools`
   - `https://github.com/marketplace/ecc-tools`
3. Classify every billing or Marketplace claim as:
   - `verified`
   - `blocked`
   - `remove-before-publication`
4. Keep roadmap acceptance criteria separate from live product claims.
5. Update release copy only after the evidence points to a live URL or command
   result.
6. Leave tag creation, npm publish, plugin submission, marketplace edits,
   subscription changes, and announcement posting approval-gated.

## Rejected Path

Do not say billing is live because a roadmap item exists, a dry run passed, or a
Marketplace URL is known. Roadmap intent and dry-run publication evidence are
not a billing state.

Do not edit plan limits, subscriptions, seats, entitlements, or Marketplace
metadata from the evaluator run. Those are product/operator actions and require
their own approval path.

## Validation Gates

- `rg -n "billing|Billing|Marketplace|marketplace|subscription|seat|entitlement|plan" README.md docs/releases/2.0.0-rc.1 docs/ECC-2.0-GA-ROADMAP.md`
- `gh api repos/ECC-Tools/ECC-Tools`
- Manual live check of `https://github.com/marketplace/ecc-tools`
- `npx --yes markdownlint-cli docs/releases/2.0.0-rc.1/*.md docs/ECC-2.0-GA-ROADMAP.md`
- `git diff --check`

Record the evidence in a maintainer-owned PR before release copy is published.
