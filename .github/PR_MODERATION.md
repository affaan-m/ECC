# PR submission moderation

The PR Burst Guard protects review capacity using creation metadata. It runs on
new and reopened PRs targeting any branch, after this workflow merges. It does not
judge whether a patch is useful. Existing open PRs are not bulk-closed on rollout.

## Policy

| Control | Default | Enforcement |
| --- | --- | --- |
| Burst allowance | Five creations per author in 20 minutes | Close and lock excess PRs |
| Severe burst | More than ten creations in 20 minutes | Attempt account block; alert maintainers |
| Open-PR cap | Ten open PRs per author at any time | Close the newest PRs above the cap with an explanatory comment; no lock, no alert |
| Known denied account | User ID `108231307`, currently `dajiaohuang` | Close and lock its incoming/reopened PR |
| Trusted contributors | Live repository write, maintain, or admin permission | Exempt from the burst guard |
| Notifications | `@affaan-m @haelyra` | One bot-authored issue per author per UTC day, plus one escalation comment |

Edit `pr-burst-policy.json` to change thresholds, notification recipients or
denied numeric IDs, or `maxOpen` to change the open-PR cap.

The open-PR cap is evaluated on the same opened and reopened events, after any
burst closures in that run, against a full paginated list of the repository's
open PRs. The author's oldest `maxOpen` PRs stay open; newer ones are closed with
a bot comment that names the count and the limit. Closing is reversible: once
the author is under the cap, reopening a closed PR passes. A PR the burst guard
already closed and locked in the same run is never touched again by the cap. The
cap does not bulk-close PRs that were already open when it shipped; it applies
as each author opens or reopens their next PR.

Closed and draft PRs count toward burst detection. Counting uses stable author
IDs and paginated REST creation metadata, without the search index. A run checks
historical windows from the triggering PR's creation time through newer API
rows. Queue delays, out-of-order delivery and replaced pending runs cannot hide
a burst already present in that snapshot. Excess PRs are determined in creation
order across all scanned windows, with PR number breaking timestamp ties.
Already closed excess PRs count
but are not mutated again.

Reopening an old ordinary PR does not add a new creation to the burst count.
Reopening a denied author's PR triggers denial even outside the time window.
Actions moderation happens after creation and cannot prevent every CI job from starting. Account
blocks cannot stop someone from using a different GitHub account.

## Activate

1. Merge the reviewed workflow and script into `main`.
2. To enable automatic account blocking, `affaan-m` creates a dedicated
   fine-grained token with the account permission **Block another user: write**.
   Store it as repository Actions secret `PR_MODERATION_BLOCK_TOKEN`. Use GitHub's
   secret UI or `gh secret set PR_MODERATION_BLOCK_TOKEN --repo affaan-m/ECC`
   with its hidden prompt. Do not paste credentials into chat or source files.
3. Verify a genuine subsequent guard run and its job summary. Without the secret,
   closure and alerting still run. A severe burst records blocking as unavailable
   in the alert and fails the job so maintainers see the missing protection.

ECC currently belongs to the personal account `affaan-m`. GitHub account blocking
applies across **all repositories owned by that account**. The script checks the
token's authenticated identity before calling the personal blocking API. A
collaborator's personal block cannot protect this repository. The normal
`GITHUB_TOKEN` cannot perform account blocking. Organization blocking requires
a separate implementation if repository ownership changes.

Closing PRs cannot reset burst counts. Rapid closing and resubmission still
count as creations within the same rolling window.

## Verify without moderating anyone

```sh
node tests/ci/pr-burst-guard.test.js
node tests/ci/pr-burst-guard-workflow.test.js
node scripts/ci/validate-workflow-security.js
```

The workflow test executes the actual CLI against a disposable HTTP fixture.
It verifies close, lock, owner-identity blocking, secret separation, deduplicated
notifications, missing-secret failure and collaborator exemption.

For a live read-only replay, supply `GITHUB_TOKEN` through your secure shell
environment, then run:

```sh
GITHUB_REPOSITORY=affaan-m/ECC node scripts/ci/pr-burst-guard.js --dry-run --pr 3580
```

Expected for the October 14 snapshot: author `jwcastillo`, count `14`, `block:
true`, and nine excess PRs. Dry run never uses the blocking secret or writes to
GitHub. Hosted event delivery and real account blocking require post-merge
verification; the local fixture cannot certify those platform operations.

## Security and recovery

- The privileged event checks out its trusted default-branch SHA and two moderation files.
  It never checks out PR code, installs dependencies, or executes PR text.
- Credentials enter through environment variables. Owner identity verification
  and account blocking receive the owner credential. Repository moderation uses
  `GITHUB_TOKEN`.
- API failures cannot silently become an allowlist exemption. Only collaborator
  lookup `404` means an outsider; other errors fail the run.
- Close or lock failures appear in the alert and fail the job. Block failures
  preserve closure and alerting, then fail the job.
- Repeated runs update the bot-authored alert instead of creating new issues.
  A contributor-created lookalike cannot suppress alerts. Escalation remains
  recorded if a later run has a lower count.
- To roll back, disable **PR Burst Guard** in Actions. Remove its secret if
  abandoning automatic blocking.
- To restore a contributor, the owner removes the account block. Remove any
  denied user ID from the policy, then unlock and reopen selected PRs manually.

## October 15 investigation

Authenticated GitHub GraphQL returned zero `CLOSED_EVENT` or `REOPENED_EVENT`
entries across all 55 `dajiaohuang` PRs that were open at the investigation's start. Their latest update was
October 8. The public timeline therefore supplies no evidence that they reopened
on October 15. Restored visibility after GitHub spam classification is a possible
explanation, but GitHub's private moderation history was unavailable. A block on
a collaborator's personal account would also have a different scope from an
owner block. The owner's actual block state was not available to this session.

The visible newer burst was 14 PRs from `jwcastillo`, #3567 through #3580, between
October 14 at 19:01:37 and 19:07:14 UTC. Volume alone does not establish the quality
of those patches. The maintainer subsequently authorized closing all 55 open
`dajiaohuang` PRs. All closures were verified, and a fresh paginated REST scan
found zero remaining open PRs from numeric user ID `108231307`.

This advances M0 maintenance reliability. Runtime sandbox, Capsule, Fleet,
release publication and shared application installation remain separate work.

## GitHub references

- [Personal account blocking REST endpoints](https://docs.github.com/en/rest/users/blocking)
- [Privileged pull request event security](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#pull_request_target)
