---
name: taste-application
description: Generate new video against a distilled style pack and cut it into a finished piece - plan takes from the reference's cut rhythm, generate on fal, grade with the pack's measured LUT, cut at the measured cadence, weave in existing footage, composite overlay plates, mint 3D props, and verify the result numerically. Use when the user wants to make a video in a captured style, supplement existing footage, or assemble generated clips into a real edit.
metadata:
  origin: ECC
---

# Taste Application

The second half of the pipeline. **taste-distillation** measures references into
a style pack; this generates against that pack and cuts the result.

## Execution and Delivery Contract

The original implementation ships here in `scripts/`; no separate `ito-video`
checkout is required. Install `scripts/requirements.txt` for local processing.
Install `scripts/requirements-live.txt` only for provider execution. Live
uploads, submissions and downloads require explicit `TASTE_FORGE_ALLOW_LIVE=1`
in addition to credentials; set it only for the user's authorized run.
`--dry-run` remains credential-free and produces labelled placeholders.
An ambiguous provider timeout is not retried as a new paid job. Inspect the
provider request before deciding whether another submission is warranted.

Use existing completed takes without any provider calls:

```bash
python scripts/pipeline.py --genre example --root stylepacks \
  --takes media/take-a.mp4 media/take-b.mp4 --duration 12 --fps 30 \
  --out out/review-v1.mp4
```

`--duration` is a **best-effort cadence target**, not an exact runtime. Complete
shots may produce a shorter or longer edit; the assembler does not duplicate
clips or add padding to meet the target. The output manifest retains actual
`duration` and adds `duration_contract` with requested and actual seconds,
shortfall, overrun, and the `cadence_target` policy. Differences of at least
one output frame are warned explicitly. No exact-duration mode is provided;
when an exact runtime is required, inspect the receipt and revise or reject
the cut before delivery.

The pipeline keeps each run's graded shot files because the editable FCPXML
and EDL reference them. It refuses output collisions and reports timeline
export failures. A completed render is not a saved editor project or creative
approval. Preserve source assets and versioned project checkpoints before
and after live edits; record the saved path and digest separately from the
in-memory timeline receipt.

Clone-ready Fal graphs and their offline input compiler are documented in
`workflows/README.md`. Compile brief and style direction before submission;
do not assume a disconnected schema field affects a model prompt. Validate
current endpoint fields against the actual provider before a paid run.

For Blender, use the full textured source GLB; retopology is a separately
named derivative and never replaces that source. `blender_prop.py` supports
explicit `--width 1920 --height 1080 --fps 30 --receipt receipt.json` and
preserves pack-derived rim lighting and material textures. Saving a scene is
distinct from rendering it; inspect the receipt's state and packed images.

For Resolve overlays, use `taste.resolve.apply_placements` with injected
objects from an explicitly selected, versioned target. Set `source_end_mode`
to the convention verified on that host. Do not assume an inclusive source
end across Resolve versions. The adapter allocates overlapping effects above
preserved tracks and checks every placement immediately and again after all
appends. Composite integers must match the installed API; for the verified
Studio 21 host, Screen is 5, not the historical builder's incorrect 22.
The receipt proves in-memory placement only. Save the project, verify its
checkpoint, then inspect the exact rendered output before reporting delivery.

## When to Activate

- "make a video in this style" / "apply the pack" / "supplement this footage"
- Assembling generated clips into something with real edit rhythm
- Minting 3D props from a look and getting them back into the video
- Verifying that a finished piece actually matches its reference

## Division of Labour

**The model supplies content, motion, framing and lighting structure. The pack
supplies colour and rhythm.** This is measured, not stylistic preference — see
taste-distillation for the numbers. Practical consequences:

- The generation prompt contains **zero colour language**. Add
  *"Colour: none. Render neutral. Grading is applied afterwards."*
- Keep **two separate flags**: `--brief` (what HAPPENS: subject, action, place)
  and `--style-steer` (how it LOOKS). Merging them leaks style words into the
  scene ("teal" becomes a teal object) and subject words into the grade.
- The model responds to **local, checkable rules** far better than global ones.
  "Backgrounds pure black and unlit; subjects blowing toward white" works;
  "extreme contrast" does not.

## Generate TAKES, Not Shots

The obvious reading of "match the cadence" is one generation per shot. It is
economically absurd. A reference averaging 0.78s/shot against an endpoint with a
4-second floor turns a 10s piece into **12 calls, 48 generated seconds for 10
used (21% efficiency)**, and twelve unrelated clips stitched into what should
read as continuous.

Editors roll a longer take and cut inside it. Grouping shots into ~5s takes:
**3 calls, 13 generated seconds, 77% efficiency**, and consecutive shots that
actually belong to each other because they came from the same generation.

Tell the model what shape you want, or it renders a slow locked-off push and six
cuts inside it read as a stutter:

> "Filmed as ONE continuous take with no hard cuts inside it. It will be cut into
> 6 pieces of roughly 0.8s in the edit, so the framing, subject and light must
> keep changing throughout — any 0.8s window has to stand alone as its own shot."

## Cutting Rules

- **Re-encode, never stream-copy.** Stream copy only cuts on keyframes, which at
  0.78s mean shot length rounds every boundary to the nearest GOP — destroying
  the exact thing the pipeline exists to preserve.
- **When supplementing existing footage, use its own shot boundaries.** Slicing a
  base video into contiguous pieces and playing them in order just reassembles
  the original: every "cut" lands mid-shot and is invisible. Measured, a 20-shot
  assembly registered only 12 detected cuts. Detect real boundaries and take
  every Nth so consecutive picks are guaranteed discontinuous. That moved a cut
  measurement from 1.29s to 0.83s against a 0.78s target.
- **Sample shot lengths from the reference's distribution**, not from its mean,
  so the cut inherits rhythm variance instead of flattening to even clips.

## Grading Rules

- **Direct measurement beats a baked LUT** when you have the clip: measure it,
  match its L\* CDF, apply zone chroma. `grade_clip_direct` reached MAE 1.58 and
  contrast 34.0 against 34.7.
- **Anchor, do not CDF-match, when the clip's histogram is unlike the
  reference's.** Forcing a 68%-black generated clip onto a busy reference
  histogram lifted the entire background out of black: background preservation
  fell to 26.0% (CDF) versus 69.0% (anchor), while MAE and contrast both still
  looked excellent. Default to anchored tone.
- **Batch size matters.** Grading 48 frames at once OOM-killed the process;
  6 is safe.

## Recovered fal Platform Behavior

These observations and endpoint examples came from the recovered workflow.
Recheck current endpoint metadata; they are not guarantees about every future
provider version. The bundled graph templates record the separately verified
workflow inputs, including explicit generated-audio control.

These cost real time to discover. Check them before designing a graph.

| Limit | Detail |
|---|---|
| **No 3D renderer at all** | fal has `image-to-3d`, `text-to-3d`, `3d-to-3d` and nothing else. Every `3d-to-3d` endpoint emits another mesh. There is no `3d-to-image`/`3d-to-video` category, so a minted GLB **cannot** re-enter a fal video graph. Render locally, then use `fal-ai/ffmpeg-api/images-to-video`. |
| **compose cannot overlay** | `fal-ai/ffmpeg-api/compose` rejects a second track with *"Multiple video tracks are not supported"* — and it counts an `image` track as a video track. It sequences one video track only. **Composite locally with ffmpeg.** |
| **compose keyframes are milliseconds** | Nothing in the response says so. A run submitted in seconds is accepted and returns a video that is 1000x too short. |
| **extract-frame offers first/middle/last only** | No arbitrary timestamp. Use the three as three distinct conditioning images. |
| **No loops, no string concat in the DAG** | Per-shot fan-out has to be authored node by node, or kept local. |
| **Kling 3.0 has no reference-to-video** | The v3 line is text/image/motion-control only; reference-to-video lives on the `o3` line: `fal-ai/kling-video/o3/pro/reference-to-video`. |
| **Prefixes are not uniform** | `bytedance/*`, `tripo3d/*`, `meshy/*`, `minimax/*`, `openai/*` carry **no** `fal-ai/` prefix. `kling-video`, `veo3.1`, `flux-*`, `hunyuan-3d`, `ffmpeg-api` do. |

### Endpoint picks

| Slot | Best | Value alternative |
|---|---|---|
| reference→video | `bytedance/seedance-2.5/reference-to-video` (~$0.473/s @720p) | `fal-ai/kling-video/o3/pro/reference-to-video` (~$0.112/s) |
| image→3D | `fal-ai/hunyuan-3d/v3.1/pro/image-to-3d` ($0.375, up to 8 views) | `tripo3d/h3.1/image-to-3d` ($0.20) |
| text→3D | `fal-ai/hunyuan-3d/v3.1/pro/text-to-3d` | `tripo3d/h3.1/text-to-3d` |
| retopology | `fal-ai/hunyuan-3d/v3.1/smart-topology` ($0.75) | `tripo3d/tripo/remesh` (~75x cheaper) |
| part split | `fal-ai/hunyuan-3d/v3.1/part` (FBX only) | `tripo3d/tripo/segment` |
| text→image | `fal-ai/nano-banana-pro` ($0.15 flat) | `fal-ai/flux-2-pro` ($0.03/MP) |

Seedance is ~4x Kling o3's price for the same 5 seconds. It earns that on
multi-reference fidelity (up to 50 mixed image/video/audio refs) and does **not**
earn it when conditioning on a single still.

Model IDs and prices drift. Verify against fal.ai/models before promising any of
them.

## The 3D Branch

```bash
python mint3d.py --genre <name> --from-stills 4 --retopo --render
python mint3d.py --genre <name> --prompt "a cracked chrome visor" --render
```

- **Generate a clean plate first; do not lift from reference stills.** The
  endpoint's stated input requirement is simple background, single object,
  object >50% of frame. Reference reels are the opposite of that — collages,
  wide shots, several subjects, burnt-in graphics — and they produce sculpted
  noise. Text → single-object plate → mesh costs ~$0.15 extra and is the
  difference between a usable mesh and a discarded one.
- **Multi-view is named per-angle fields, not a list.** `input_image_url` (front,
  required), then `back_image_url`, `left_image_url`, `right_image_url`,
  `left_front_image_url`, `right_front_image_url`, `top_image_url`,
  `bottom_image_url`. There is no `input_image_urls` and no `multi_view` flag —
  inventing them degrades every mint to single-view while appearing to work. A
  wrong angle label is worse than omitting the view, because the model trusts it.
- **Address the GLB by key, not by position.** The response carries a `thumbnail`
  PNG and a `model_urls` block alongside `model_glb`; taking the first URL works
  only until the keys reorder, and a preview PNG downloads fine — nothing fails
  until Blender refuses to open it.
- **Request PBR maps.** Without them the mesh lights like painted cardboard.
- **Retopologise** if anyone will edit or rig it. Generated meshes are dense and
  chaotic.
- **Render locally to close the loop.** Once a turntable is frames, it is
  footage, and every downstream stage already handles footage — grade it, cut it,
  screen it as an element, or upload it as a conditioning reference. Use Blender
  when a binary is on PATH; keep a dependency-light software rasteriser as the
  default, because a headless GL context is the single most common thing missing
  from a container and a renderer that only works on a workstation is not part of
  a pipeline.

## Verify, Then Believe

Every other stage claims a result. Check it, and check **distribution shape**,
not just moments:

- `background` — share of frame below L\*10 vs the **pack's** figure. Compare to
  the reference, **not** to the source clip: a generated source at 68% black is
  blacker than any reference in a 24–55% band, so "preserve the source's blacks"
  demands the wrong thing and equally excuses a lifted grade.
- `chroma_mae` — per-zone a\*/b\* error, using the **median** (matching how the
  pack's targets were measured; a mean here compares a skew-sensitive statistic
  to a robust one and reports a definition mismatch as an error).
- `contrast` / `black_point` / `white_point`
- `banding` — empty L\* histogram bins *between occupied ones*. Counting total
  empty bins does not work: a legitimately dark clip has empty highlight bins.
- `cadence` — detected mean shot length vs the reference's.

Watch the **units trap**: OpenCV changes Lab convention with dtype. On float32,
L\* is 0–100 and a\*/b\* are signed; on uint8, L\* is 0–255 and a\*/b\* are
biased +128. Mixing them reports chroma errors in the hundreds.

## Full Chain

```bash
python pipeline.py --genre <name> --refs a.mov b.mov \
  --brief "what happens" --duration 12 \
  --base-video existing.mp4 --out out/FINAL.mp4
```

mint → distill → (mint3d) → apply → forge → verify. Stages 1–3 are cached, so
iterating on briefs never re-measures anything. `--dry-run` stubs every network
call: the plan, prompts, track layout and manifest all still get exercised.

## Anti-Patterns

| Don't | Why |
|---|---|
| One generation per shot | 21% efficiency, 12 unrelated clips |
| Put colour in the prompt | Measured not to work; pushes away from the neutral base the LUT wants |
| Stream-copy the cuts | Keyframe-only boundaries destroy sub-second rhythm |
| Cut a base video contiguously | Reassembles the original; every cut invisible |
| Trust compose to overlay | It cannot; it rejects the second track |
| Send seconds to compose | Silently 1000x too short |
| Ship on MAE alone | Add the background-share check |

## Borrowed Footage Carries the Capture App's UI

The single worst defect found in a delivered cut: the finished video shipped
someone else's like button, view counter and comment bubble, because the base
footage was a screen recording and nothing cropped them out.

**`content_mask` does not solve this and its bounding box makes it worse.**
Temporal variance keeps interface chrome, because chrome *animates* - the heart
pulses, the counter ticks - so the mask marks it as moving content. Measured on
three references, the mask bbox kept 100% of the width every time while the
interface sat plainly in the right-hand margin.

The separating signal is the temporal **median**, not the variance. Footage
moves, so the median of many frames averages into mush with almost no edge
energy; chrome sits at fixed coordinates, so its edges survive intact. Sobel
energy on the median frame lights up on chrome and goes quiet on content -
measured, a right-hand column read 0.23 against an interior background of 0.03
on one reference and 0.31 against 0.15 on another.

Two implementation details that cost a cycle each:

- **Trim past the innermost outlier in each outer band, not inward from the
  edge.** Walking in while the current line is hot stops immediately, because
  the outermost lines are letterbox - flat black, zero edge energy - and the
  chrome sits *inside* that at 90-95% of width. The naive version trimmed 1%
  of frame while the like button stayed in shot.
- **Scale to cover, not pad,** when portrait source lands in a landscape cut.
  Padding 9:16 (narrower still after the UI crop) into 16:9 left ~60% of frame
  as black bars, one shot was nearly an empty rectangle, and it poisoned the
  background metric because bars are pure black. Covering loses the sides,
  which is the right trade for centre-framed material.

## Overlay Plates Are Elements, Not Washes

A glow plate is ~4% covered by construction. Composite it at frame size and you
get a small bright dot parked mid-shot - it reads as a sticker, and it was
visible in a delivered cut as an unexplained coloured blob.

- **Tighten each plate to its alpha bounding box first.** That raises coverage
  from ~4% to 15-35% and hands size control to the caller instead of inheriting
  whatever fraction of the source frame the element happened to occupy.
- **Choose wash vs element by coverage.** Diffuse plates (<10% after tightening)
  work stretched full-frame at low opacity; concentrated ones want to be scaled
  to 35-70% of frame width and placed.
- **Vary placement, scale and rotation per shot** from a seeded RNG, so the cut
  stays reproducible but no two stamped shots share a mark. One plate in one
  spot every Nth shot reads as a watermark.
- Resolve element geometry in Python, not in ffmpeg expressions: `pad()` rejects
  a negative offset and cannot pad below its input size, so an oversized or
  off-frame element kills the whole filtergraph.

## Downstream Handoff (Resolve / Blender)

**Always ship an editable timeline beside the mp4.** The flattened video is a
viewing copy and the one thing a colourist cannot work with — every cut is baked
in and the shots are no longer separable. `forge.py` writes FCPXML 1.9 and a
CMX3600 EDL referencing the individual graded shot files, so the piece lands as a
timeline that can be re-cut and re-graded.

Validate the export, do not assume it: check that asset-clip offsets equal the
running sum of prior durations (no gaps), that every `ref` resolves to a declared
asset, that every `media-rep src` exists on disk, and that the total matches the
mp4. A timeline that imports but drifts is worse than one that fails loudly.

Two things that silently destroy the work:

- **Project frame rate must be set before import.** Resolve locks timeline fps on
  first timeline creation and conforms the cadence silently. At a sub-second mean
  shot length that conform is visible.
- **The delivered shots are already graded.** `look.cube` is a *normalising* LUT
  for new material and for matching — applying it to the supplied shots
  double-grades them. Node 1, nothing before it, corrections after.

Ship a handoff doc with the measured targets in it (`scripts/HANDOFF-TEMPLATE.md`
is a filled example): the zone chroma table, the cadence distribution including
**rhythm variance** — an editor who matches the mean but not the variance
produces something that reads completely differently — and an explicit "do not"
list.

For Blender, `scripts/blender_prop.py` derives its lighting from the pack:
black world with transparent film (so renders composite with no keying), key plus
rim (a key alone lets the silhouette die against black), rim colour converted
from the pack's peak-chroma zone via Lab→linear sRGB so the prop picks up the
same cast the footage is graded to. **View transform Standard, not AgX/Filmic,
and no grading in Blender** — AgX applies its own tone curve before the LUT ever
sees the pixels, and grading twice compounds.

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
