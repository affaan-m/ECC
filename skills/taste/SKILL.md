---
name: taste
description: A creative-direction (taste) layer for music videos and short-form edits in the angelcore / cloud-trance / hyperpop visual family. Distills a named-genre aesthetic vocabulary, a mood + color + light system, and a beat-synced editing grammar, then chains ECC's video skills (video-editing, fal-ai-media, remotion-video-creation, motion-*, content-engine) into one production pipeline. Use when the work is not just making a video function but making it feel intentional, when building a music video, a fancam/edit, a moodboard-driven reel, or when choosing a coherent visual direction for AI-generated b-roll.
origin: ECC
---

# Taste

Most AI video advice stops at *how to render frames*. This skill is the layer above
that: **what the frames should look like, in what order, cut to what rhythm, so the
result reads as one intentional thing instead of a pile of generations.**

It encodes a specific taste — the **angelcore / cloud-trance / hyperpop** family
(Bladee "Silver Surfer"-era ethereal trance crossed with heavy angelcore) — distilled
from a corpus of saved Reels and a tour through a ~70-entry visual-genre library. It
is opinionated on purpose. Taste is a point of view, not a menu.

> The companion file `references/genre-taxonomy.md` holds the full named-genre catalog.
> This file is the actionable layer: mood, grammar, pipeline, and a beat-mapped shot plan.

## When to Activate

- Building a **music video**, lyric video, fancam, or visualizer.
- Making a short-form **edit / reel** where the *feel* matters more than the information.
- Driving **AI b-roll generation** (fal.ai, Veo, Kling, etc.) and the prompts need a
  coherent direction instead of one-off vibes.
- Assembling a **moodboard** or choosing a visual genre before any rendering.
- The user says "taste", "make it feel like X", "give it a direction", "angelcore",
  "cloud trance", "hyperpop edit", "Bladee", "dreamcore", or names a saved reference.
- The current edit works but reads as flat, generic, AI-slop, or stylistically incoherent.

This skill sits **on top of** `video-editing` (the mechanics) and `remotion-video-creation`
(the renderer). Use those for *how*. Use this for *what and why*.

## Core Thesis

1. **Taste is the last layer, and it must be decided first.** `video-editing` correctly
   says taste is the final human pass. The trap: if you only decide taste at the end, every
   generation and cut upstream was a guess. Pick the direction *before* the first prompt,
   then let it constrain everything.
2. **Coherence beats novelty.** One look executed across 30 shots beats 30 looks. A named
   genre (below) is a constraint that buys coherence for free.
3. **Cut to the song, not to the footage.** In a music video the timeline is the waveform.
   Every hard cut lands on a beat or a transient. Frame math is in the pipeline section.
4. **Generate selectively, edit ruthlessly.** AI makes b-roll that does not exist; it does
   not make taste. You still throw away 80%.

## The Aesthetic Vocabulary (distilled)

The reference corpus tours a large library of *named* visual genres. The full list lives in
`references/genre-taxonomy.md`. The useful move is not memorizing 70 names — it is seeing
that **a genre name is a complete prompt-and-grade preset.** When you pick one, you inherit
its palette, texture, lighting, and subject matter as a unit.

The genres cluster into families. Pick a **primary** family and at most **one accent**:

| Family | Genres in it | Reads as |
|--------|-------------|----------|
| **Ethereal / divine** | spiritualism, glacial folk, beacons, zen core, fairy tale | weightless, holy, glowing, soft |
| **Hyperpop / Y2K-cyber** | cyberdelia, acid house, acid nora, neo aggressano, new liquid | glossy, chrome, neon, kawaii-cyber |
| **Dark / occult** | dark academia, smoke nostalgia, communist core, abstract tech | high-contrast, ominous, grain |
| **Retro / print** | retro surfers, art deco, adventure pulp, classic advertising, magazine collage, bumper stickers | flat, graphic, halftone, nostalgic |
| **Organic / textural** | microbiology core, weaving patterns, fruitage retro, cozy blanket, pacific punk wave | tactile, macro, woven, wet |
| **Systemic / data** | numbers, mazes, code web, heatmap, pixel, 8-bit | gridded, generative, schematic |

**For the current project**, the primary is **Ethereal / divine** with a **Hyperpop / Y2K-cyber**
accent — i.e. holy light and crystalline bloom, punctuated by chrome and neon. That pairing
*is* the angelcore × cloud-trance brief.

## The Mood System — angelcore × cloud-trance

Distilled directly from the strongest reference reels. This is the concrete grade.

### Palette
- **Base:** near-black void (#05060a) and bone white (#f4f1ea). Most frames are one or the other.
- **Divine accent:** molten gold / ember orange (#ffb24d → #ff7a18) — the *one warm light* in the dark.
- **Crystalline accent:** iridescent violet→cyan→magenta bokeh (#8a6bff, #4fc3ff, #ff6ad5) — the
  hyperpop bloom, used in bright frames.
- **Danger accent (sparingly):** a single glowing red (#ff2a2a) on monochrome — for one or two
  shock cuts only.
- **Hyperpop subject:** candy pink hair / chrome / glossy white against blue sky.

Rule: **one accent per shot.** Gold lives in dark frames; iridescence lives in light frames;
never both in one shot.

### Light & texture
- Darkness pierced by a single warm source (ember bloom, divine shaft). High contrast, deep blacks.
- Crystalline / glitter bokeh, lens flares, bloom, light leaks — *heavenly*, not dirty.
- Film grain + subtle chromatic aberration on the dark frames; clean gloss on the bright frames.
- Macro detail on negative space: a hero object centered on black (key, eye, gear, petal, water).
- Subjects: winged figures, clouds, halos, angels, crystalline structures, candy-cyber portraits.

### Motion
- Slow, floating, weightless camera (drift, slow push, slow orbit) — *cloud* trance.
- Bursts of speed only at the drop. Otherwise everything breathes.
- Particles rising (embers, dust, glitter) — upward motion = ascension.

## The Editing Grammar (distilled)

From the reference edits, the techniques that recur and define the style:

1. **Beat-locked hard cuts.** No dissolves in the verse/drop. Cut on the kick. The eye should
   feel the BPM.
2. **Hero-on-black macro inserts.** A single sharp object centered in black negative space,
   held for 1–2 beats, then cut. Rhythmic montage of these = the cloud-trance signature.
3. **Bloom / explosion reveal.** A white or ember bloom that blows out the frame on a transient,
   then resolves into the next shot. The "divine flash" transition.
4. **Color-pop on monochrome.** Run a passage in B&W, then a single colored element (red eye,
   gold flame, pink hair) punches through on the downbeat.
5. **Speed-ramp into the drop.** Ramp footage from slow to fast across the last bar before the
   drop, hard-cut to tempo on the one.
6. **Caption keyword highlight (for talking-head / lyric sections only).** All-caps, one or two
   words highlighted in the accent color, synced to the vocal. Use for lyric video, not for the
   pure visualizer.
7. **Reaction PiP (for explainer/edit-commentary only).** Picture-in-picture talking head over
   b-roll. Out of scope for the music video itself; documented because the corpus uses it heavily.

**Do-nots:** crossfade transitions in tempo sections; more than one accent color per shot; a
shot held past its musical phrase; readable on-screen UI chrome (crop it out); mixed aspect
ratios in one timeline.

## The Pipeline — mixing the ECC video skills

This skill is the conductor. Each ECC skill is an instrument. Do not skip layers.

```
0. TASTE (this skill)        decide genre + mood + grammar BEFORE anything renders
1. STRUCTURE (video-editing) map the song: timestamps for intro/verse/drop/bridge/outro
2. GENERATE (fal-ai-media)   make b-roll per genre prompt-presets; throw away 80%
3. CUT (video-editing/FFmpeg) beat-cut + reframe to 9:16; assemble selects on the grid
4. COMPOSE (remotion-video-creation) overlays, blooms, lyric text, beat-synced sequencing
5. MOTION (motion-* skills)  easing curves, light-leak/particle motion, transition timing
6. AUDIO (fal-ai-media)      transition risers/impacts to sell the cuts (track itself is in Ableton)
7. POLISH                    grade to the palette above, final pacing pass, export
8. DISTRIBUTE (content-engine) platform-native versions + caption/cover
```

| Step | ECC skill to load | What it does here |
|------|-------------------|-------------------|
| Structure & cut | `video-editing` | FFmpeg cut/concat/reframe, EDL, scene/silence detection |
| Generate b-roll | `fal-ai-media` | image/video models per genre preset |
| Compose & overlay | `remotion-video-creation` | beat-synced `<Sequence>`s, text, blooms, masks |
| Motion timing | `motion-foundations`, `motion-patterns`, `motion-advanced`, `motion-ui` | easing, springs, light/particle motion |
| Server-side video | `videodb` | smart reframe, indexing if footage is large |
| Distribution | `content-engine` | per-platform cuts, covers, captions |
| Voice/lyric VO | `video-editing` (ElevenLabs section) | only if a spoken layer is needed |

## Beat Math (lock cuts to the song)

The current track is **138 BPM, B minor**. Constants:

- `seconds_per_beat = 60 / 138 = 0.43478s`
- `frames_per_beat   = fps × 0.43478`  →  **24fps: 10.43**, **30fps: 13.04**, **60fps: 26.09**
- `1 bar (4 beats)   = 1.7391s`  →  30fps: **52.17 frames**
- `8-bar phrase      = 13.913s`  →  the loop length from the track

In Remotion, snap every `from={}` to a beat:
```ts
const FPS = 30;
const BPM = 138;
const beat = (n: number) => Math.round(n * (60 / BPM) * FPS); // beat(n) → frame
// cut on beats 0,4,8,... :  <Sequence from={beat(0)} durationInFrames={beat(4)}> ...
```

## Beat-Mapped Shot Plan (this music video)

The song arrangement (from the project's own notes) is
**Intro → Verse → Drop → Bridge → Drop → Outro (~2:05)**. Map taste to each section:

| Section | Genre/mood lean | Grammar | Shot ideas |
|---------|-----------------|---------|------------|
| **Intro** | Ethereal/divine, near-black | slow push, no cuts | ember bloom in the void; a single shaft of gold; dust rising |
| **Verse** | Dark + macro hero-on-black | hard cuts every 2 beats | key, eye, gear, water drop, petal — rhythmic macro montage |
| **Drop** | Hyperpop bloom + crystalline | speed-ramp in, cut on the one, fast | candy-pink figure, chrome, iridescent bokeh, winged ascension |
| **Bridge** | Spiritualism, weightless | one long held shot, color-pop | clouds + halo; single red accent punches once |
| **Drop 2** | as Drop, intensify | add divine-flash blooms on transients | wings open, glitter burst, light leaks maxed |
| **Outro** | Glacial folk, cold calm | slow fade to black | crystalline structure dissolving; ember dies out |

## fal.ai Prompt Presets (per mood)

Use with `fal-ai-media`. Each preset is the genre rendered to the project palette. Append
`9:16, vertical, cinematic, film grain, volumetric light, no text, no watermark` to all.

- **Divine void:** "a single molten-gold ember bloom rising in an infinite near-black void,
  deep shadow, one warm light source, weightless dust particles, holy, high contrast"
- **Macro hero:** "extreme macro of an antique brass key / a human eye / interlocking gears,
  centered on pure black negative space, razor-sharp detail, single rim light"
- **Crystalline bloom:** "iridescent violet-cyan-magenta crystalline bokeh, glittering light
  refraction, dreamy lens flares, heavenly glow, soft focus, hyperpop angelcore"
- **Candy-cyber portrait:** "candy-pink-haired figure, glossy chrome accents, bright blue sky,
  Y2K hyperpop, clean gloss, saturated, kawaii-cyber"
- **Winged ascension:** "a winged figure ascending into clouds, halo of light, bone-white and
  gold, volumetric god-rays, ethereal, religious iconography, soft"
- **Cold outro:** "pale crystalline ice structure slowly dissolving, glacial folk, cold blue
  and bone white, minimal, calm, fading to black"

Generate 6–10 per preset, keep 2–3. For motion, animate stills with an image-to-video model
or generate short clips directly; keep camera moves slow per the Motion rules.

## FFmpeg Recipes (cut + reframe)

```bash
# Reframe any landscape/raw clip to 9:16 (center crop)
ffmpeg -i in.mp4 -vf "crop=ih*9/16:ih,scale=1080:1920" v.mp4

# Beat-cut a clip to exactly N beats at 138 BPM (e.g. 2 beats = 0.8696s)
ffmpeg -i in.mp4 -t 0.8696 -c copy beat2.mp4

# Concatenate beat-selects into the verse montage
for f in selects/*.mp4; do echo "file '$f'"; done > concat.txt
ffmpeg -f concat -safe 0 -i concat.txt -c copy verse.mp4

# Strip UI chrome / status bar from a screen-recorded reference (crop top+bottom)
ffmpeg -i reel.mp4 -vf "crop=iw:ih-300:0:150" clean.mp4
```

## Remotion Composition Skeleton (beat-synced)

```tsx
import { AbsoluteFill, Sequence, Video, Img, useCurrentFrame, interpolate } from "remotion";

const FPS = 30, BPM = 138;
const beat = (n: number) => Math.round(n * (60 / BPM) * FPS);

const Bloom: React.FC = () => {
  const f = useCurrentFrame();
  const o = interpolate(f, [0, 3, 12], [0, 1, 0], { extrapolateRight: "clamp" }); // divine flash on a transient
  return <AbsoluteFill style={{ background: "radial-gradient(#fff,#ffb24d)", opacity: o, mixBlendMode: "screen" }} />;
};

export const AngelcoreMV: React.FC = () => (
  <AbsoluteFill style={{ background: "#05060a" }}>
    {/* Verse: macro hero-on-black, hard cut every 2 beats */}
    <Sequence from={beat(0)} durationInFrames={beat(2)}><Video src="/selects/key.mp4" /></Sequence>
    <Sequence from={beat(2)} durationInFrames={beat(2)}><Video src="/selects/eye.mp4" /></Sequence>
    <Sequence from={beat(4)} durationInFrames={beat(2)}><Video src="/selects/gear.mp4" /></Sequence>
    {/* Drop: crystalline bloom + flash on the one */}
    <Sequence from={beat(8)} durationInFrames={beat(16)}><Video src="/selects/crystalline.mp4" /></Sequence>
    <Sequence from={beat(8)} durationInFrames={beat(1)}><Bloom /></Sequence>
  </AbsoluteFill>
);
```
Render: `npx remotion render src/index.ts AngelcoreMV out.mp4`. See `remotion-video-creation`
for project setup, audio track binding, and render flags.

## Key Principles

1. **Decide the genre before the first generation.** Pick one primary family + one accent.
2. **One accent color per shot.** Gold in the dark, iridescence in the light, red once.
3. **Every hard cut lands on a beat.** Use the beat math; no transitions in tempo sections.
4. **Hero-on-black macro is the signature move.** Master it; it carries the verses.
5. **Generate 10, keep 2.** Coherence comes from rejection, not from prompting harder.
6. **Crop the chrome.** No status bars, captions, or UI in the final frame.
7. **Taste is decided first and judged last.** Set the direction, then defend it on every cut.

## Related Skills

- `video-editing` — the mechanical pipeline (FFmpeg, reframe, EDL, polish) this sits on top of
- `remotion-video-creation` — programmable beat-synced composition and rendering
- `fal-ai-media` — generate the b-roll, transition SFX, and risers
- `motion-foundations`, `motion-patterns`, `motion-advanced`, `motion-ui` — easing and motion timing
- `videodb` — server-side smart reframe and indexing for large footage
- `content-engine` — platform-native distribution, covers, captions
- `frontend-design-direction` — the same "decide a direction first" discipline, for UI
