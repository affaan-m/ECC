# Metrics and Sponsorship Playbook

This file is a practical script for sponsor calls and ecosystem partner reviews.

## What to Track

Use four categories in every update:

1. **Distribution** — npm packages and GitHub App installs
2. **Adoption** — stars, forks, contributors, release cadence
3. **Product surface** — commands/skills/agents and cross-platform support
4. **Reliability** — test pass counts and production bug turnaround

## Pull Live Metrics

### npm downloads

```bash
# Weekly downloads
curl -s https://api.npmjs.org/downloads/point/last-week/ecc-universal
curl -s https://api.npmjs.org/downloads/point/last-week/ecc-agentshield

# Last 30 days
curl -s https://api.npmjs.org/downloads/point/last-month/ecc-universal
curl -s https://api.npmjs.org/downloads/point/last-month/ecc-agentshield
```

### GitHub repository adoption

```bash
gh api repos/affaan-m/ECC \
  --jq '{stars:.stargazers_count,forks:.forks_count,contributors_url:.contributors_url,open_issues:.open_issues_count}'
```

### GitHub traffic (maintainer access required)

```bash
gh api repos/affaan-m/ECC/traffic/views
gh api repos/affaan-m/ECC/traffic/clones
```

### GitHub App installs

GitHub App install count is currently most reliable in the Marketplace/App dashboard.
Use the latest value from:

- [ECC Tools Marketplace](https://github.com/marketplace/ecc-tools)

## What Cannot Be Measured Publicly (Yet)

- Claude plugin install/download counts are not currently exposed via a public API.
- For partner conversations, use npm metrics + GitHub App installs + repo traffic as the proxy bundle.

## Suggested Sponsor Packaging

Use these as starting points in negotiation:

- **Pilot Partner:** `$200/month`
  - Best for first partnership validation and simple monthly sponsor updates.
- **Growth Partner:** `$500/month`
  - Includes roadmap check-ins and implementation feedback loop.
- **Strategic Partner:** `$1,000+/month`
  - Multi-touch collaboration, launch support, and deeper operational alignment.

## 60-Second Talking Track

Use this on calls:

> ECC is now positioned as an agent harness performance system, not a config repo.
> We track adoption through npm distribution, GitHub App installs, and repository growth.
> Claude plugin installs are structurally undercounted publicly, so we use a blended metrics model.
> The project supports Claude Code, Cursor, OpenCode, and Codex app/CLI with production-grade hook reliability and a large passing test suite.

For launch-ready social copy snippets, see [`social-launch-copy.md`](./social-launch-copy.md).
