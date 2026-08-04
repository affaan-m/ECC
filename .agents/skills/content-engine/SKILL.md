---
name: content-engine
description: Create platform-native content systems for X, LinkedIn, TikTok, YouTube, newsletters, and repurposed multi-platform campaigns. Use when the user wants social posts, threads, scripts, content calendars, or one source asset adapted cleanly across platforms.
---

# Content Engine

Build platform-native content without flattening the author's real voice into platform slop.

## When to Activate

- writing X posts or threads
- drafting LinkedIn posts or launch updates
- scripting short-form video or YouTube explainers
- repurposing articles, podcasts, demos, docs, or internal notes into public content
- building a launch sequence or ongoing content system around a product, insight, or narrative

## Non-Negotiables

1. Start from source material, not generic post formulas.
2. Adapt the format for the platform, not the persona.
3. One post should carry one actual claim.
4. Specificity beats adjectives.
5. No engagement bait unless the user explicitly asks for it.

## Source-First Workflow

Before drafting, identify the source set:
- published articles
- notes or internal memos
- product demos
- docs or changelogs
- transcripts
- screenshots
- prior posts from the same author

If the user wants a specific voice, build a voice profile from real examples before writing.
Use `brand-voice` as the canonical workflow when voice consistency matters across more than one output.

## Voice Handling

`brand-voice` is the canonical voice layer.

Run it first when:

- there are multiple downstream outputs
- the user explicitly cares about writing style
- the content is launch, outreach, or reputation-sensitive

Reuse the resulting `VOICE PROFILE` here instead of rebuilding a second voice model.
If the user wants Affaan / ECC voice specifically, still treat `brand-voice` as the source of truth and feed it the best live or source-derived material available.

## Hard Bans

Delete and rewrite any of these:
- "In today's rapidly evolving landscape"
- "game-changer", "revolutionary", "cutting-edge"
- "here's why this matters" unless it is followed immediately by something concrete
- ending with a LinkedIn-style question just to farm replies
- forced casualness on LinkedIn
- fake engagement padding that was not present in the source material

## Platform Adaptation Rules

### X

- open with the strongest claim, artifact, or tension
- keep the compression if the source voice is compressed
- if writing a thread, each post must advance the argument
- do not pad with context the audience does not need

### LinkedIn

- expand only enough for people outside the immediate niche to follow
- do not turn it into a fake lesson post unless the source material actually is reflective
- no corporate inspiration cadence
- no praise-stacking, no "journey" filler

### Short Video

- script around the visual sequence and proof points
- first seconds should show the result, problem, or punch
- do not write narration that sounds better on paper than on screen

### YouTube

- show the result or tension early
- organize by argument or progression, not filler sections
- use chaptering only when it helps clarity

### Newsletter

- open with the point, conflict, or artifact
- do not spend the first paragraph warming up
- every section needs to add something new

## Repurposing Flow

1. Pick the anchor asset.
2. Extract 3 to 7 atomic claims or scenes.
3. Rank them by sharpness, novelty, and proof.
4. Assign one strong idea per output.
5. Adapt structure for each platform.
6. Strip platform-shaped filler.
7. Run the quality gate.

## Deliverables

When asked for a campaign, return:
- a short voice profile if voice matching matters
- the core angle
- platform-native drafts
- posting order only if it helps execution
- gaps that must be filled before publishing

## Quality Gate

Before delivering:
- every draft sounds like the intended author, not the platform stereotype
- every draft contains a real claim, proof point, or concrete observation
- no generic hype language remains
- no fake engagement bait remains
- no duplicated copy across platforms unless requested
- any CTA is earned and user-approved

## Related Skills

- `brand-voice` for source-derived voice profiles
- `crosspost` for platform-specific distribution
- `x-api` for sourcing recent posts and publishing approved X output
