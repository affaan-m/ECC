# Discussion Response Playbook

This playbook turns GitHub Discussions into the same operating queue as PRs,
issues, Linear work, and release evidence. It is an operator guide, not a
promise that every informational thread needs a public reply.

## Audit Loop

Run these checks before a release, after a major merge batch, and when Linear
ITO-59 is refreshed:

```bash
npm run discussion:audit -- --json
node scripts/platform-audit.js --json
```

The queue is current only when:

- discussion fetch errors are explained or fixed;
- `needsMaintainerTouch` is zero for support-like discussion categories;
- answerable Q&A discussions either have an accepted answer or a clear routing
  note; and
- any product-scope thread is linked to a GitHub issue, Linear issue, roadmap
  row, or explicit deferral.

Informational threads such as announcements, references, show-and-tell, or
maintainer-authored updates can remain visible without becoming response debt.

## Categories

| Category | Route | Required readback |
| --- | --- | --- |
| Product support or install confusion | Reply with the exact command/doc path; mark accepted answer for Q&A when the fix is complete | Discussion URL plus accepted-answer URL when applicable |
| Bug report | Ask for a minimal repro, version, harness, and logs; create or link a GitHub issue when reproducible | Issue URL or deferral reason |
| Feature request | Acknowledge the desired outcome and link the closest roadmap issue; do not imply commitment unless scoped | Linear/GitHub roadmap link |
| Security concern | Move exploit details and secrets to a private channel; keep the public reply short and non-operational | Private escalation note plus public safety reply |
| Release or billing question | Answer from the release URL ledger and publication-readiness gates; do not claim unpublished URLs, billing readiness, or plugin availability | Evidence artifact or blocker link |
| Show-and-tell, reference, or announcement | Leave as informational unless there is a direct question or a product-scope signal | Optional roadmap link if useful |
| Stale or concluded thread | Summarize the current state and link the durable doc/issue; avoid reviving low-signal threads | Closure note or explicit no-action rationale |

## Templates

### Public Support

Thanks for the report. The current supported path is:

```bash
<command>
```

The relevant doc is `<doc path or URL>`. If this does not match your setup,
please reply with the harness, OS, package manager, and the exact error text.

### Maintainer Coordination

I am routing this into `<issue or Linear key>` so it does not get lost in the
discussion queue. The next decision is `<specific decision>`. Until that lands,
the supported workaround is `<workaround or "none">`.

### Stale Or Concluded

This thread looks resolved or superseded by `<doc/issue/release>`. I am leaving
it visible for history, but it is no longer an active support queue item. New
repro details should go to `<issue/discussion path>`.

### Release Announcement

The current release status is `<rc/beta/GA state>`. Live URLs are recorded in
`docs/releases/2.0.0-rc.1/release-url-ledger-2026-05-18.md`. Anything marked
pending there should not be announced as shipped yet.

### Security Escalation

Thanks for flagging this. Please do not post exploit steps, tokens, customer
data, or secret values in the public thread. I am routing this through the
security response path and will keep the public thread limited to safe status
updates.

## Recording Outcomes

For each high-signal discussion, record one of these outcomes:

- replied publicly and accepted answer read back;
- linked to a GitHub issue or Linear issue;
- routed to the security response path;
- classified as informational; or
- explicitly deferred with a reason.

Mirror the summary into ITO-59 when the batch closes, and include the counts in
the next operator dashboard or publication evidence refresh.
