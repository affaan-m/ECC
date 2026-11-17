# Issue submission moderation

The Issue Submission Guard protects maintainer triage capacity. It runs after a
new Issue opens or a closed Issue reopens. It examines creation metadata only,
without reading or executing Issue titles or bodies. It does not judge the value
of a report. Existing open Issues stay open when this policy ships.

| Control | Default | Enforcement |
| --- | --- | --- |
| Burst allowance | Five Issue creations per author in 20 minutes | Close and lock later Issues; alert maintainers |
| Severe burst | More than ten creations in 20 minutes | Attempt owner account block; alert maintainers |
| Open-Issue cap | Ten open Issues per author | Close new excess or reopened Issues with an explanation; no lock |
| Trusted contributors | Repository write, maintain, or admin permission | Exempt from burst moderation, but subject to the open cap |

Change `.github/issue-submission-policy.json` to adjust thresholds and alert
recipients. Pull requests are excluded from every Issue count. The PR guard uses
its own policy. The Issue guard skips its own bot-authored alert Issues.

The open cap acts only on newly opened or reopened Issues. If an author already
has more than ten open Issues when this ships, those older Issues stay open. A
delayed opened run can also close newer excess Issues visible in its API snapshot.
Reopening an old Issue consumes a slot, so it closes again when the author is
above the cap. Closing is reversible after the author reduces their open count.

Closed Issues still count toward the rolling burst window. The guard checks
newer creation windows when a run is delayed, and serializes each author's
events. GitHub's Actions queue can hold at most 100 pending runs for one
concurrency group. A longer backlog can leave individual events unchecked.
Moderation happens after creation, so it cannot prevent every downstream
notification or workflow from starting.

The optional `PR_MODERATION_BLOCK_TOKEN` must authenticate as the personal
repository owner and have **Block another user: write** permission. Without it,
Issue closure and alerting still run; a severe burst fails the Actions job and
records that blocking was unavailable. A personal account block affects all
repositories owned by that account. The default `GITHUB_TOKEN` performs Issue
moderation only. If ownership moves to an organization, owner blocking needs
a separate implementation.

The privileged workflow checks out the trusted default-branch SHA and only the
policy plus two scripts. It does not check out contributor code or install
dependencies. API failures fail the run; only a collaborator lookup `404`
means the author is an outsider. A bot-authored daily alert ledger prevents
contributor text from suppressing notifications.

## Verify

```sh
node tests/ci/issue-submission-guard.test.js
node tests/ci/issue-submission-guard-workflow.test.js
node scripts/ci/validate-workflow-security.js
```

The workflow test runs the actual CLI against a disposable HTTP fixture. After
deployment, inspect a real **Issue Submission Guard** run and its job summary.
For a live read-only replay, supply `GITHUB_TOKEN` securely and run:

```sh
GITHUB_REPOSITORY=affaan-m/ECC node scripts/ci/issue-submission-guard.js --dry-run --issue <NUMBER>
```

The dry run reads GitHub but does not close, lock, comment, alert, or block.
To roll back, disable **Issue Submission Guard** in Actions. To restore an
Issue, unlock and reopen it after adjusting policy or resolving the author's
open count. The repository owner must remove any account block separately.

This advances ECC 2.2 maintenance reliability. It does not change runtime
sandboxing, ExecutionCapsule contracts, Fleet, or release publication.
