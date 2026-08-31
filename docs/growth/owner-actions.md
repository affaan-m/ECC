# Owner actions

Everything in this file needs repository admin rights or access to the
ecc.tools deployment, so it cannot ship in a pull request. Each item states the
gap, the fix, and how to confirm it worked.

Measured on 2026-08-31: 245,042 stars, 37,020 forks, 1,254 watchers, 323
contributors, 16,104 monthly `ecc-universal` downloads.

## 1. Set the repository social preview

**Gap.** `usesCustomOpenGraphImage` is `false`, so every share of the repository
link on X, Slack, Discord, LinkedIn, or Hacker News renders GitHub's generic
auto-card instead of ECC branding. At current share volume this is the largest
free impression loss in the project.

**Fix.** Settings → General → Social preview → Edit → upload
[`assets/social-preview.png`](../../assets/social-preview.png) (1280x640,
generated from the existing hero art).

**Confirm.**

```bash
gh repo view affaan-m/ECC --json usesCustomOpenGraphImage,openGraphImageUrl
```

`usesCustomOpenGraphImage` must be `true`. Then paste the repository URL into a
Slack or Discord message and check the rendered card.

## 2. Refresh the star count in the website metadata

**Gap.** `https://ecc.tools/` ships `210K+ stars` in `<title>`, the meta
description, and both `og:` and `twitter:` descriptions. The real count is above
245,000, so the strongest social-proof number on the site understates itself by
roughly 35,000 and reads as unmaintained.

**Fix.** Point that string at the same source the README badge already uses
(`https://api.ecc.tools/badge/stars`) so it can never go stale again, or set it
to a rounded floor you are willing to leave alone for a quarter.

**Confirm.**

```bash
curl -s https://ecc.tools/ | grep -o 'content="[^"]*stars[^"]*"'
```

## 3. Publish the discovery artifacts on ecc.tools

**Gap.** `sitemap.xml` lists 12 URLs. The repository ships 448 documented
surfaces (286 skills, 68 agents, 94 commands) and `ecc.tools/skills` renders all
of them on one 252 KB page, so `https://ecc.tools/skills/tdd-workflow` returns
404. Every long-tail query ECC could own goes to someone else.

**Fix.** The repository now generates the input for this. See
[discovery-artifacts.md](discovery-artifacts.md) for the page contract.

1. Serve `/llms.txt` from [`llms.txt`](../../llms.txt) and `/llms-full.txt` from
   [`docs/discovery/llms-full.txt`](../discovery/llms-full.txt). `/llms.txt`
   currently 404s.
2. Build one page per entry in
   [`docs/DISCOVERY-INDEX.json`](../DISCOVERY-INDEX.json) at the `url` each entry
   already declares.
3. Merge [`docs/discovery/sitemap-discovery.xml`](../discovery/sitemap-discovery.xml)
   into the published `sitemap.xml`.

**Confirm.**

```bash
curl -s -o /dev/null -w '%{http_code}\n' https://ecc.tools/llms.txt
curl -s -o /dev/null -w '%{http_code}\n' https://ecc.tools/skills/tdd-workflow
curl -s https://ecc.tools/sitemap.xml | grep -c '<loc>'
```

Expect `200`, `200`, and a count above 400.

## 4. Open the contributor on-ramp

**Gap.** The `good first issue` label exists with zero open issues against it,
while 323 people have already contributed and 81 pull requests are open. There
is no scoped entry point for a first-time contributor.

**Fix.** Label 15 to 20 genuinely scoped issues. Anything that needs repo-wide
context does not qualify.

```bash
# What is currently open and unlabelled
gh issue list -R affaan-m/ECC --state open --limit 100 \
  --json number,title,labels

# Tag one
gh issue edit <number> -R affaan-m/ECC --add-label "good first issue"
```

**Confirm.**

```bash
gh issue list -R affaan-m/ECC --label "good first issue" --state open
```

Good candidates from the current tree: adding a missing test for a
`scripts/lib/` module, translating one `docs/<locale>/` page, or adding one
adopter row to [`ADOPTERS.md`](../../ADOPTERS.md).

## 5. Clear the pull request backlog

**Gap.** 81 open pull requests. A contributor whose work sits unreviewed does
not return, and does not recommend the project. This is the loudest feedback
signal the project is currently losing.

**Fix.** One triage pass, oldest first, with every pull request leaving the pass
in one of three states: merged, changes requested, or closed with a reason.

```bash
# Oldest first, with the age that matters
gh pr list -R affaan-m/ECC --state open --limit 100 \
  --json number,title,author,createdAt,isDraft \
  --jq 'sort_by(.createdAt) | .[] | "\(.createdAt[0:10])  #\(.number)  \(.title)"'
```

[CONTRIBUTING.md](../../CONTRIBUTING.md) now states a one-week triage
expectation. Either hold that line or edit the number down to one you can hold;
a published promise that slips is worse than no promise.

## 6. Convert stars into release subscribers

**Gap.** 1,254 watchers against 245,042 stars, which is 0.51 percent. Weekly
releases reach almost nobody who starred.

**Fix.** The README now carries a `Watch → Custom → Releases` call to action
above the fold. Repeat it in the closing section of each release note, where the
readers are people who already care.

**Confirm.** Track `watchers.totalCount` month over month:

```bash
gh repo view affaan-m/ECC --json watchers
```

## 7. Record a 20-second demo

**Gap.** The first screen has a static hero image and no moving proof. The
guides carry the only recorded material and sit several screens down.

**Fix.** Record one terminal capture of `plan → test → review` on a real
repository, export at 1280 wide, and place it directly under the install block
in the README, replacing the `See it run` text link. Keep it under 8 MB so
GitHub renders it inline.

## Tracking

Traffic data needs push access, so it is not visible from a fork. Pull it before
and after this work so the effect is measurable rather than assumed:

```bash
gh api repos/affaan-m/ECC/traffic/views
gh api repos/affaan-m/ECC/traffic/popular/referrers
gh api repos/affaan-m/ECC/traffic/popular/paths
```

Referrers answer the question this whole file is guessing at: which channel is
already working, and therefore which of these items to do first.
