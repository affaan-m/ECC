---
name: connections-optimizer
description: Reorganize the user's X and LinkedIn network with review-first pruning, add/follow recommendations, and channel-specific warm outreach drafted in the user's real voice. Use when the user wants to clean up following lists, grow toward current priorities, or rebalance a social graph around higher-signal relationships.
origin: ECC
---

# Connections Optimizer

Reorganize the user's network instead of treating outbound as a one-way prospecting list.

This skill handles:

- X following cleanup and expansion
- LinkedIn follow and connection analysis
- review-first prune queues
- add and follow recommendations
- warm-path identification
- Apple Mail, X DM, and LinkedIn draft generation in the user's real voice

## When to Activate

- the user wants to prune their X following
- the user wants to rebalance who they follow or stay connected to
- the user says "clean up my network", "who should I unfollow", "who should I follow", "who should I reconnect with"
- outreach quality depends on network structure, not just cold list generation

## Required Inputs

Collect or infer:

- current priorities and active work
- target roles, industries, geos, or ecosystems
- platform selection: X, LinkedIn, or both
- do-not-touch list
- mode: `light-pass`, `default`, or `aggressive`

If the user does not specify a mode, use `default`.

## Tool Requirements

### Preferred

- `x-api` for X graph inspection and recent activity
- `lead-intelligence` for target discovery and warm-path ranking
- `social-graph-ranker` when the user wants bridge value scored independently of the broader lead workflow
- Exa / deep research for person and company enrichment
- `brand-voice` before drafting outbound

### Fallbacks

- browser control for LinkedIn analysis and drafting
- browser control for X if API coverage is constrained
- Apple Mail or Mail.app drafting via desktop automation when email is the right channel

## Safety Defaults

- default is review-first, never blind auto-pruning
- X: prune only accounts the user follows, never followers
- LinkedIn: treat 1st-degree connection removal as manual-review-first
- do not auto-send DMs, invites, or emails
- emit a ranked action plan and drafts before any apply step

## Platform Rules

### X

- mutuals are stickier than one-way follows
- non-follow-backs can be pruned more aggressively
- heavily inactive or disappeared accounts should surface quickly
- engagement, signal quality, and bridge value matter more than raw follower count

### LinkedIn

- API-first if the user actually has LinkedIn API access
- browser workflow must work when API access is missing
- distinguish outbound follows from accepted 1st-degree connections
- outbound follows can be pruned more freely
- accepted 1st-degree connections should default to review, not auto-remove

## Modes

### `light-pass`

- prune only high-confidence low-value one-way follows
- surface the rest for review
- generate a small add/follow list

### `default`

- balanced prune queue
- balanced keep list
- ranked add/follow queue
- draft warm intros or direct outreach where useful

### `aggressive`

- larger prune queue
- lower tolerance for stale non-follow-backs
- still review-gated before apply

## Scoring Model

Use these positive signals:

- reciprocity
- recent activity
- alignment to current priorities
- network bridge value
- role relevance
- real engagement history
- recent presence and responsiveness

Use these negative signals:

- disappeared or abandoned account
- stale one-way follow
- off-priority topic cluster
- low-value noise
- repeated non-response
- no follow-back when many better replacements exist

Mutuals and real warm-path bridges should be penalized less aggressively than one-way follows.

## Workflow

1. Capture priorities, do-not-touch constraints, and selected platforms.
2. Pull the current following / connection inventory.
3. Score prune candidates with explicit reasons.
4. Score keep candidates with explicit reasons.
5. Use `lead-intelligence` plus research surfaces to rank expansion candidates.
6. Match the right channel:
   - X DM for warm, fast social touch points
   - LinkedIn message for professional graph adjacency
   - Apple Mail draft for higher-context intros or outreach
7. Run `brand-voice` before drafting messages.
8. Return a review pack before any apply step.

## Review Pack Format

```text
CONNECTIONS OPTIMIZER REPORT
============================

Mode:
Platforms:
Priority Set:

Prune Queue
- handle / profile
  reason:
  confidence:
  action:

Review Queue
- handle / profile
  reason:
  risk:

Keep / Protect
- handle / profile
  bridge value:

Add / Follow Targets
- person
  why now:
  warm path:
  preferred channel:

Drafts
- X DM:
- LinkedIn:
- Apple Mail:
```

## Outbound Rules

- Default email path is Apple Mail / Mail.app draft creation.
- Do not send automatically.
- Choose the channel based on warmth, relevance, and context depth.
- Do not force a DM when an email or no outreach is the right move.
- Drafts should sound like the user, not like automated sales copy.

## Related Skills

- `brand-voice` for the reusable voice profile
- `social-graph-ranker` for the standalone bridge-scoring and warm-path math
- `lead-intelligence` for weighted target and warm-path discovery
- `x-api` for X graph access, drafting, and optional apply flows
- `content-engine` when the user also wants public launch content around network moves
