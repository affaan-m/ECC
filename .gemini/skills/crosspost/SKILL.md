---
name: crosspost
description: Multi-platform content distribution across X, LinkedIn, Threads, and Bluesky. Adapts content per platform using content-engine patterns. Never posts identical content cross-platform. Use when the user wants to distribute content across social platforms.
origin: ECC
---

# Crosspost

Distribute content across platforms without turning it into the same fake post in four costumes.

## When to Activate

- the user wants to publish the same underlying idea across multiple platforms
- a launch, update, release, or essay needs platform-specific versions
- the user says "crosspost", "post this everywhere", or "adapt this for X and LinkedIn"

## Core Rules

1. Do not publish identical copy across platforms.
2. Preserve the author's voice across platforms.
3. Adapt for constraints, not stereotypes.
4. One post should still be about one thing.
5. Do not invent a CTA, question, or moral if the source did not earn one.

## Workflow

### Step 1: Start with the Primary Version

Pick the strongest source version first:
- the original X post
- the original article
- the launch note
- the thread
- the memo or changelog

Use `content-engine` first if the source still needs voice shaping.

### Step 2: Capture the Voice Fingerprint

Run `brand-voice` first if the source voice is not already captured in the current session.

Reuse the resulting `VOICE PROFILE` directly.
Do not build a second ad hoc voice checklist here unless the user explicitly wants a fresh override for this campaign.

### Step 3: Adapt by Platform Constraint

### X

- keep it compressed
- lead with the sharpest claim or artifact
- use a thread only when a single post would collapse the argument
- avoid hashtags and generic filler

### LinkedIn

- add only the context needed for people outside the niche
- do not turn it into a fake founder-reflection post
- do not add a closing question just because it is LinkedIn
- do not force a polished "professional tone" if the author is naturally sharper

### Threads

- keep it readable and direct
- do not write fake hyper-casual creator copy
- do not paste the LinkedIn version and shorten it

### Bluesky

- keep it concise
- preserve the author's cadence
- do not rely on hashtags or feed-gaming language

## Posting Order

Default:
1. post the strongest native version first
2. adapt for the secondary platforms
3. stagger timing only if the user wants sequencing help

Do not add cross-platform references unless useful. Most of the time, the post should stand on its own.

## Banned Patterns

Delete and rewrite any of these:
- "Excited to share"
- "Here's what I learned"
- "What do you think?"
- "link in bio" unless that is literally true
- generic "professional takeaway" paragraphs that were not in the source

## Output Format

Return:
- the primary platform version
- adapted variants for each requested platform
- a short note on what changed and why
- any publishing constraint the user still needs to resolve

## Quality Gate

Before delivering:
- each version reads like the same author under different constraints
- no platform version feels padded or sanitized
- no copy is duplicated verbatim across platforms
- any extra context added for LinkedIn or newsletter use is actually necessary

## Related Skills

- `brand-voice` for reusable source-derived voice capture
- `content-engine` for voice capture and source shaping
- `x-api` for X publishing workflows
