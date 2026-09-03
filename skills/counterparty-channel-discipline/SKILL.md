---
name: counterparty-channel-discipline
description: Per-channel strict prompts, mention gating, silent observation, and a communication autonomy policy for agents that sit in shared channels with external counterparties. Use when an agent joins group chats, shared channels, or DMs where outsiders can read every message and you need it to speak only when addressed, never leak internal context, and route risky content to draft-only approval.
---

# Counterparty Channel Discipline

An agent in a shared channel is speaking for the company. Every message is
counterparty-visible. This skill defines how to classify channels, when the
agent may speak, what it may never say, and which content goes to an operator
before it is sent.

## When to Use

- The agent is added to a group chat or shared channel that includes
  customers, suppliers, investors, or partners.
- The agent handles DMs from unknown or partially known parties.
- You have seen an agent answer a message it was not asked, mention internal
  tooling in front of a counterparty, or quote one counterparty's terms to
  another.
- You need a written policy for what the agent sends on its own and what it
  drafts for approval.

## How It Works

### Channel classes

| Class | Who can read | Agent behaviour |
| --- | --- | --- |
| Internal ops | Only the team | Full context, tool talk allowed, economics discussed here. Default reply target for anything internal. |
| Counterparty-visible | Team plus outsiders | Strict prompt. Speak only when addressed or when you own a direct answer. No internal references. |
| Quiet | Anyone | Observe only. Never post unless an operator instructs it for that channel. |

Assign every channel to a class in configuration. Unknown channels default to
quiet.

### Mention gating and silent observation

- `require_mention: true` on every counterparty-visible group. The agent
  responds only when a message matches a mention pattern: its handle, a reply
  to one of its messages, or its name in plain text.
- `observe_unmentioned_group_messages: true`. Unmentioned messages are read
  into context so the agent knows the thread, but they never trigger a reply.
- `group_policy: allowlist` and `dm_policy: allowlist`. Groups and DMs not on
  the allowlist are quiet channels.
- `allow_bots: mentions`. Other bots can address the agent by mention; their
  unmentioned traffic is ignored.
- `never_silent_ack: true` in internal channels only. In counterparty
  channels an interim acknowledgement is noise, so it is off there.

Configuration shape: [references/channel-policy.example.yaml](references/channel-policy.example.yaml).

### Strict prompt for counterparty-visible channels

Each counterparty-visible channel gets its own system prompt built from one
template with the channel name filled in. The rules, in priority order:

1. Speak only when addressed (mention, reply, or name) or when you own a
   direct answer the group needs. Otherwise observe.
2. Never mention internal tools, sessions, production changes, config, or
   capabilities.
3. Never say you cannot see or search something. Ask one concise clarifying
   question instead.
4. No interim acknowledgements when you can answer directly. When you have
   nothing material, stay silent.
5. Short plain professional sentences. No emojis. No em dashes.
6. Quote only verified facts, inventory, and prices from the record.
7. Deal economics and internal discussion happen in the internal ops channel,
   never here.
8. Never reveal one counterparty's identity, terms, or pricing to another.
9. Anything that makes or changes a commitment is filed for operator approval
   (see the operator-approval-loop skill), not sent.

Template: [references/strict-prompt.template.md](references/strict-prompt.template.md).

### Communication autonomy policy

Default is auto: the agent sends routine traffic without asking. The policy
lists exceptions about risk, not permission.

| Bucket | Meaning | Examples |
| --- | --- | --- |
| auto | Send without asking | Scheduling, logistics, holding replies, apologies for delay, asking a supplier for information we lack, relationship maintenance with no commercial ask, chasing something owed, internal coordination |
| draft_only by tier | Operator reads first because a wrong send is expensive | Tier-1 investors, tier-1 clients with executed contracts |
| draft_only by content class | Operator reads first regardless of recipient | Prices or rates, contractual language that could read as acceptance, legal or due-diligence threads, public posts, unverified claims, technical specs not measured by us |
| frozen | No outbound at all, inbound may be answered only if listed | A closing round, a standing cold-outreach hold, simulation or test channels |
| never | Hard stop, not an approval gate | Signing contracts or e-signature envelopes, moving money, entering passwords or one-time codes, publishing packages, revealing one party's pricing to another |

Write the policy as data, not prose in a prompt, so monitors and the approval
tool can enforce it mechanically.

### Cross-channel leakage checks

Before any send in a counterparty channel, check the draft against the other
counterparties' names, terms, and prices held in the ledger. A match blocks
the send and files it for approval with the match named.

## Examples

### A group message not addressed to the agent

```text
[#acme-shared] buyer: can someone confirm the rack count for phase 2?
```

The agent reads it (observation), does not reply, and if the answer is owed
by the team it files an inbound obligation in the internal ops channel:
`Open obligation: #acme-shared asks for phase 2 rack count. Owner needed.`

### Addressed, answer known and verified

```text
[#acme-shared] buyer: @desk what start dates do you have open in October?
agent: 6, 13 and 20 October are open. Which works for you?
```

No acknowledgement first, no "let me check", no tool mention.

### Addressed, answer requires a commitment

The buyer asks for a rate. Rates are a draft-only content class. The agent
says nothing in the shared channel beyond a single clarifying question if one
is needed, files a draft with the proposed rate for operator approval, and
posts the filing notice in the internal ops channel.

### Cannot see the referenced document

```text
buyer: see the attached spec sheet, does it match?
agent: Which revision of the spec sheet should I compare against, the one dated 12 August?
```

Not: "I can't open attachments."

## Invariants to test

- An unmentioned group message never produces an outbound message.
- A draft containing another counterparty's name or terms is blocked.
- Content matching a draft-only class is filed, not sent, even in auto mode.
- The strict prompt for each channel contains the channel name and all nine
  rules; a prompt generated for one channel is never reused for another.
