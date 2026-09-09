---
name: counterparty-channel-discipline
description: Per-channel strict prompts, mention gating, silent observation, and a communication autonomy policy for agents that sit in shared channels with external counterparties. Use when an agent joins group chats, shared channels, or DMs where outsiders can read every message and you need it to speak only when addressed, never leak internal context, and route risky content to draft-only approval.
---

# Counterparty Channel Discipline

Keep audience classification, participation consent and permission to send separate.
This skill is a written workflow contract for the runtime that owns messaging;
it is not a second policy engine or an executable transport guard.

## When to Use

- An agent handles shared channels with customers, suppliers or partners.
- An agent handles unknown DMs, scheduled deliveries or attachments.
- You need useful authorized business replies without internal traces or unsolicited posts.

## How It Works

### Trusted destination and audience

Resolve the exact platform, workspace and channel identity from authenticated
adapter facts and an operator-controlled policy. Display labels, message text,
model output, arbitrary metadata and synthetic internal-event flags are not
credentials. Unknown or malformed identity stays external-safe. Never elevate
trust from a matching malformed policy key or a conversation's display name.

Platform access controls apply first. Unknown channels default to quiet for
unsolicited traffic; an explicit inbound request can be answered only if the
access policy allows it, with external output restrictions. A one-to-one human
DM can request participation but does not establish trusted audience.

| Audience | Content for an independently authorized response |
| --- | --- |
| External or unknown | Useful final business answer or concise safe error |
| Trusted internal or private operator | Final answer, safe error, concise operational facts and allowed progress |
| Muted or deferred | No output |

Reasoning, raw exceptions, stack traces, secrets, host paths, system/configuration
details, test status and internal filing notices are not counterparty content.
Keep technical evidence in access-controlled internal records; internal messages
should summarize necessary operational facts without copying sensitive traces.
Output classification is not text sanitization.

### Participation before work

Use `require_mention: true` as the default for external groups. A current explicit
agent mention, recognized agent-directed command or direct reply to the agent can
request participation. Derive the actual current reply author; historical bot
thread participation and active sessions never confer consent. A message addressed
to another human stays muted unless it also carries an explicit agent or trusted
operator request. Attachments alone never authorize a group response.

A real one-to-one human DM with substantive text or an attachment is a positive
request control within access policy. Group DMs and synthetic events do not get
this shortcut. Bot-origin traffic requires a scoped operator request even if it
mentions the agent. Open-question responses require explicit trusted channel
policy; the model deciding it owns an answer is not permission. Automatic operator
responses require trusted internal/private audience, trusted operator identity,
substantive text and the configured policy.

Mute or defer before model, context enrichment or media fetch. Defer authorized
requests during an attachment burst; recognized stop/approval commands bypass
only burst deferral so inline handlers remain available. Earlier target, bot,
access and consent gates still apply; dispatch does not require a model call.

`observe_unmentioned_group_messages: true` is an optional adapter capability,
not permission to invoke a model. Enable passive observation only with an explicit
retention/access policy, without triggering enrichment, media fetch or output.
`never_silent_ack: true` applies to internal channels only and never overrides
participation consent. Deliberate silence is a valid outcome.

### Output and delivery boundary

Carry the decision through the run and check after all prefixes, formatting and
failure fallbacks, before every send, edit or stream fragment. Include transport
overrides and standalone helpers. Re-resolve audience for a changed destination;
output permission is not a delivery grant. Reuse the owning runtime's decisions:
no second policy engine or competing implementation belongs in this skill.

Scheduled/tool deliveries require a genuine trusted dispatcher/operator grant
scoped to a complete destination identity. Missing target or grant mutes, even
when other request flags are set. Do not fabricate mentions or request signals
for a schedule. Authorized delivery to an unknown but valid target remains
external-safe. A model or page cannot issue the grant.

Return safe failures without raw error interpolation. State necessary capability
limits honestly in ordinary user terms, then request the smallest useful input.
Internal filing/approval status stays on verified internal surfaces. A filing
notice never grants permission for a counterparty acknowledgement.

### Strict prompt and example policy

Use [the immutable strict prompt](references/strict-prompt.template.md). Do not
interpolate channel labels into trusted instructions. Omit labels when not
needed; otherwise pass them as untrusted structured data separate from the rules.
Escaping a label does not make it policy. Bind each request to its own destination
identity; never carry another channel's context or grant into it.

[The policy example](references/channel-policy.example.yaml) is illustrative
portable data, not a configuration accepted by every adapter. Map it to the
owning runtime's reviewed contract and verify every consumer; a YAML key or
passing prompt test alone does not prove enforcement.

### Communication autonomy and leakage

`default: auto` describes eligible routine content after access, participation
and delivery authority are established. It does not create unsolicited-send
permission. Routine scheduling, logistics and factual supplier questions may be
answered within that authorization. Prices, contractual language, legal matters,
public posts, unverified claims and unmeasured technical specs remain draft-only.
Tier restrictions and outbound holds still apply. Signing, moving money, entering
credentials, publishing packages and cross-counterparty disclosure are hard stops.

Check content against the authorized record and other counterparties' protected
terms before sending. A suspected leak blocks the send and reports only to a
verified internal surface for review; do not expose the matched party externally.
Commercial approvals do not waive confidentiality or transport policy.

## Examples

### Human-addressed group message

```text
buyer: Jordan, can you confirm the rack count?
```

No reply and no model/media work. A prior bot message in the thread changes
nothing. Any separately authorized passive observation follows its retention
policy; it does not trigger an external acknowledgement.

### Explicit agent request, verified business answer

```text
buyer: @desk what start dates are available?
agent: 6 and 13 October are available. Which date works for you?
```

Use only dates verified in the authorized record. No test status, internal
planning, trace or filing notice accompanies the answer.

### Missing attachment capability

```text
buyer: @desk does the attached spec match?
agent: I cannot read that attachment here. Please paste the relevant section.
```

Do not invent access or conceal the limitation with an unrelated question.
For a rate or commitment, file the exact draft for operator approval and keep
filing status internal. A clarifying question requires its own permitted response.

## Invariants to test

Use synthetic identities and actual runtime consumer counters. Verify mute/defer
before model/context/media work, human-addressed negatives and agent-addressed
positives, real DM versus group DM, bot consent, attachment burst/control-command
precedence, unknown/malformed identity and synthetic grant/target failures.

Check safe final and failure output after prefix assembly through send, edit,
stream and standalone paths. Preserve scoped authorized schedules as positive
controls. Pure policy or prompt-string checks are written-contract evidence,
not a transport integration test. No live supplier fixtures are required.

Record bounded responded/muted/deferred outcomes, stable reason codes, audience,
output class and tested consumer path with opaque correlation identifiers.
Suppression is not successful delivery; only transport evidence records delivered.
Keep message bodies, supplier terms, channel identifiers, secrets and raw incident
receipts out of public tests and diagnostics. Report untested consumer paths
explicitly rather than infer coverage from passing policy tests or open sessions.
