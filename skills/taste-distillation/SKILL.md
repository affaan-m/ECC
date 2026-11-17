---
name: taste-distillation
description: Measure a set of reference videos into a reusable style pack - colour grade as a 3D LUT, cut rhythm as a shot-length distribution, hero stills, screen-blend overlay plates, and a text spec for a generative model. Use when the user wants to capture the look of reference footage, build a repeatable look, mint assets from references, or reproduce someone's grade and pacing.
metadata:
  origin: ECC
---

# Taste Distillation

This standalone skill ships its implementation in `scripts/`; use
`taste-application` for the subsequent generated or local-take edit. Keep each
named genre in its own pack. Measurements from Flash Ethereal must not be
silently reused for Fluid Sketch or 3D Cyber Glitch. A measured zero is valid
data; distinguish it from an absent field.

Local dependencies are in `scripts/requirements.txt`. Separately authorized
provider work also needs `scripts/requirements-live.txt`, credentials and
explicit `TASTE_FORGE_ALLOW_LIVE=1`. `--dry-run` does not read credentials or
submit jobs. Never infer that a workflow was saved from a local endpoint name;
use the actual provider-side workflow or request evidence.

Turn reference videos into a **style pack**: a folder of measurements and assets
that later stages consume deterministically.

## When to Activate

- "capture the look of these clips" / "distill the vibe" / "make this repeatable"
- User has reference footage and wants a LUT, a grade, or matching pacing
- Building a library of looks partitioned by genre
- Any request where the answer would otherwise be "describe the style in a prompt"

## The Core Finding

**Prompting cannot deliver a grade. Measurement can.**

Measured on real footage: three paid generations with escalating colour direction
moved midtone a\* from +1.9 → +2.8 → +0.3 against a **+24.9** target, and contrast
never left ~19 against a **34.7** target. Applying a measured pack to the same
footage hit chroma MAE **1.88** and contrast **33.7** in one deterministic pass,
for free.

So the split is: **the model supplies content, motion and lighting structure; the
pack supplies the look.** Colour words in a generation prompt are worse than
useless — they cost money and push the render away from the neutral base the LUT
wants. Say so explicitly in the prompt: *"Colour: none. Render neutral. Grading
is applied afterwards."*

## What a Pack Contains

```
stylepacks/<genre>/
  grade.json      measured colour statistics (see below)
  cadence.json    every detected shot boundary + the derived distribution
  look.cube       33^3 LUT, drag straight into Resolve as a node LUT
  spec.json       VLM description, grounded in the measurements
  grounding.txt   the measured facts fed to the VLM
  stills/         full-res frames from the longest shots (conditioning images)
  plates/         screen-blend overlay elements lifted onto black
  props/          minted GLB meshes
  pack.json       manifest
```

## Running It

```bash
python mint.py --genre <name> --refs a.mov b.mov c.mov     # offline, no API key
python distill.py --genre <name>                            # one VLM call
```

`mint.py` is pure numeric analysis — no network, no key, deterministic, so a pack
can be regenerated rather than backed up.

## The Measurements That Matter

### Chroma by luminance zone, not globally

Colour identity usually lives in **one luminance band**. A global a\*/b\* offset
mathematically cannot represent split-toning. Measure chroma inside zones
(`L* edges [0,15,35,55,75,100]`).

A real signature: violet at L\*25 (a\* +24.9, b\* −17.5), near-neutral at both
ends. Reporting only the darkest and lightest zones calls that "uniform cast" —
**always print the whole curve.**

### Median + MAD, never mean + std

Chroma in real reference sets is strongly right-skewed. On one measured reel the
mean midtone chroma was 36.9 against a median of 17.5, so a mean-based LUT pushed
colour ~3x harder than the material warranted.

### Contrast is std(L\*), not white minus black

The white−black range is ~100 on almost any real footage and discriminates
nothing.

### Background share is a first-class statistic

Record the share of pixels below L\*10. No moment of the distribution can see it:
a clip can hold the right mean, std and chroma while its blacks have been lifted
into grey. This is exactly how a grade once scored MAE 1.88 / contrast 33.7 while
the actual frame was a muddy purple mess.

### Mask the interface before measuring

Screen-recorded references carry static furniture — letterbox bars, a status bar,
a like icon, caption text. All of it lands in the statistics as if it were the
look: black bars inflate shadow weight, a red heart skews a\* toward magenta.
**Temporal variance separates them cleanly** — the footage moves, the interface
does not — so no hand-tuned crop is needed. On real material this keeps ~65% of
pixels.

### Cadence needs an adaptive threshold

The right content-detector threshold is material-dependent: a high-contrast
action reference cuts hard enough for 30, a moody one hides its cuts under it.
Sweep descending thresholds and take the **highest** one that still recovers ≥90%
of the shots the most sensitive setting finds — that biases toward real cuts over
noise. Reject thresholds implying an absurd cut rate (>100/min); continuous
camera moves trip the detector every frame.

Run the whole sweep in **one decode pass** with a shared `StatsManager`. The
naive version re-decodes per threshold, which on 60fps source is the difference
between seconds and minutes.

## Overlay Plates: Assets, Not Screenshots

A still is a whole frame — compositing one just puts a second picture on top.
A **plate** is the reference's graphic vocabulary (flares, streaks, glitch
fragments) lifted onto black so it screen-blends with no keying.

Two traps, both hit on real material:

1. **Absolute thresholds fail.** On a bright reference an `L>55 AND chroma>12`
   selection takes ~90% of frame, and the "plate" is the picture — including a
   recognisable face. Select by **percentile** (~top 3%) and **reject any plate
   covering more than ~22% of frame.**
2. **Rank by separation, not by brightness.** "Share of bright saturated pixels"
   ranks a washed-out frame top and a black frame with one intense flare — the
   actual signature — near the bottom. Score `p99.5(energy) / median(energy)`.

Also mask before scoring: burnt-in typography is bright, saturated and
high-contrast, so an unmasked run yields a perfect plate of someone else's title
card.

## Grounding the VLM

Feed the measurements into the system prompt before asking for a description.
Ungrounded, a VLM will report "no apparent colour grading, neutral" on footage
with a +24.9 a\* cast. Grounded, it describes the cast correctly and infers the
secondary accent independently.

Ban hedging words (`varied`, `mixed`, `dynamic`, `some`, `often`, `neutral`,
`or`) — a model cannot render "varied lighting". **Enforce the ban in code, not
just in the prompt:** it was violated in roughly one run in three. Re-ask
per-field, keep the least-hedged answer after N attempts rather than failing.

Caveat worth stating to the user: once the spec is grounded in the measurements
it is no longer an independent check on them.

## LUT Baking Gotchas

- A LUT can only encode a **per-pixel RGB function**. Anything
  distribution-dependent (histogram matching, percentile anchors) must be reduced
  to a constant *before* baking, or it silently measures the uniform LUT grid
  instead of the footage.
- `cv2.cvtColor(LAB2RGB)` **clamps internally**, so an out-of-gamut test using it
  reports 0%. Convert Lab→linear sRGB by hand; a real measurement was 83.3% OOG.
- Offset chroma transfer, not affine. Affine divides by the source σ and
  overshoots — on real footage it flipped b\* to +11.6 against a −17.5 target.
  Offset took MAE from 6.23 to 2.13.
- Gamut compression cost 3.8x runtime for identical MAE. Make it opt-in.

## Anti-Patterns

| Don't | Why |
|---|---|
| Tune against synthetic test footage | Cost four separate wrong conclusions on one project; real footage overturned every one |
| Trust MAE alone | 1.88 MAE looked like success on a visibly broken frame |
| Use mean/std for chroma | Right-skewed; pushes ~3x too hard |
| Compare only endpoint zones | Both ends are near-neutral by construction |
| Describe the look and stop | The spec is for content and structure; the pack is for colour |

## Handoff

The pack is the interface. Once it exists, use the **taste-application** skill to
generate and assemble against it, or hand `look.cube` to a colourist directly.

## Bundled Code

`scripts/` in this skill is a working implementation, not pseudocode. It has no
project-specific assumptions: point it at any reference videos and it produces a
pack.

```bash
pip install -r scripts/requirements.txt
export FAL_KEY=...            # only needed for the stages that call fal
```

Every network call is stubbed under `TASTE_FORGE_DRY_RUN=1` or `--dry-run`, so
the plan, prompts, track layout and manifest can be inspected without spending.
