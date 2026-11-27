# flashethereal — handoff to Resolve and Blender

Everything below is measured from your three reference clips, not chosen. Where
a number appears, it came out of `mint.py` and is reproducible by re-running it.

---

## 1. What you have been given

| File | What it is |
|---|---|
| `FINAL_v3.mp4` | Viewing copy. 33 shots, 14.12s, 1280x720 @ 24fps. **Do not grade this** — every cut is baked in. Passes all 7 verification checks. |
| `FINAL_v3.fcpxml` | The same 33 cuts as a real timeline. **This is the working file.** |
| `FINAL_v3.edl` | Same timeline, CMX3600, for anything that will not take FCPXML. |
| `out/forge_work/` | The individual graded shot files the timeline points at. **Deleting this breaks the timeline** even though the mp4 still plays. |
| `stylepacks/flashethereal/look.cube` | 33³ node LUT. Validated: 35,937 rows, in gamut, monotonic neutral axis. |
| `stylepacks/flashethereal/plates/` | Screen-blend overlay elements on black. No keying needed. |
| `stylepacks/flashethereal/stills/` | Full-res frames from the longest shots. |

## 2. DaVinci Resolve

### Import

```
File > Import > Timeline > Pre-Conformed EDL / FCPXML  →  FINAL_v3.fcpxml
```

It lands as 24 clips at 1280x720 / 24fps, contiguous, no gaps — verified: total
timeline length 14.542s matches the mp4 to the millisecond, 0 dangling asset
references, all 24 media files present.

Set the project to **24 fps before importing.** Resolve locks timeline frame
rate on first timeline creation and will silently conform the cadence if the
project is at 23.976 or 30. At a 0.66s mean shot length that conform is visible.

### The LUT, and where it goes

`look.cube` is a **normalising** LUT: it takes neutral footage to the reference's
grade. It is not a creative look on top of a grade.

Node order on the clip:

```
[1] look.cube          ← 3D LUT, node 1, nothing before it
[2] your adjustments   ← exposure/balance corrections, after
[3] creative           ← anything you want on top
```

Put it in `~/Library/Application Support/Blackmagic Design/DaVinci Resolve/LUT/`
(macOS) or `%APPDATA%\Blackmagic Design\DaVinci Resolve\Support\LUT\` (Windows),
then right-click node 1 → 3D LUT → flashethereal.

**The shots in `forge_work/` are already graded.** The LUT is there for new
material you cut in, and for matching. If you apply it to the supplied shots you
will double-grade them.

### What the grade is

| | Measured |
|---|---|
| Contrast (std L\*) | **34.55** |
| Black point (1st pct) | **0.00** |
| White point (99th pct) | **99.66** |
| Background (share below L\*10) | **26.3%** |
| Grain sigma | 0.0071 |

Chroma by luminance zone — this is the whole identity, and it lives in the
**lower midtones**, not globally:

| Zone | a\* | b\* | chroma |
|---|---|---|---|
| L\*≈7.5 | −0.22 | −0.41 | 0.5 — neutral |
| **L\*≈25** | **+19.75** | **−14.20** | **24.3 — violet/orchid, the signature** |
| L\*≈45 | +18.16 | −6.75 | 19.4 |
| L\*≈65 | +2.03 | −4.22 | 4.7 |
| L\*≈87.5 | +1.16 | −1.08 | 1.6 — neutral |

Near-neutral at both ends, violet through the shadows and low mids. If you pull
a global tint you will destroy this — the ends are supposed to stay clean.

Accent in the palette: `#2938e7` electric blue, which is a separate accent, not
part of the cast.

### The cut

| | Reference | Delivered cut |
|---|---|---|
| Shots | 77 | 33 |
| Mean shot | 0.78s | 0.74s (5% off) |
| Median shot | 0.47s | — |
| p25 / p75 | 0.33s / 0.75s | — |
| Cuts/min | 77 | 81 |
| Rhythm variance (std/mean) | 1.06 | — |

Variance of 1.06 means this is **not metronomic** — long holds punctuated by
very fast runs. If you retime, keep the variance; evenly spaced cuts at the same
average will read completely differently.

The delivered cut runs 5% faster than the reference, which is inside tolerance.

**The borrowed shots are UI-cropped.** The references are screen recordings with
a like button, a view counter and a comment bubble baked into the pixels; an
earlier cut shipped all of it. The crop is detected per clip (74% wide x 85%
tall on this one) from edge energy in the temporal median, and the result is
scaled to cover rather than padded, so there are no black bars.

### Overlay plates

`plates/*/glow_*.png` and `streak_*.png` are elements lifted onto black, sized
so they cover 2–12% of frame. Composite mode **Screen** (or Add) — they are
premultiplied against black, so the blacks drop out with no keying and no matte.
They are used in the delivered cut every 3rd shot at 0.30 base opacity, each
one tightened to its own content and placed at a varied scale, position and
rotation. That variation is deliberate: one plate in one spot every Nth shot
reads as a watermark, which is how the first cut looked.

`plates/r0/grain.png` is the reference's measured grain at sigma 0.0071. Use
**Overlay** blend, not Screen. Generated footage is conspicuously clean and a
clean image graded toward a grainy reference still does not read as the
reference.

---

## 3. Blender

```bash
blender -b --python blender_prop.py -- \
    --pack stylepacks/flashethereal \
    --mesh stylepacks/flashethereal/props/<prop>.glb \
    --out out/prop.blend --render out/prop_frames
```

Drop `-b` to keep the UI open and keep working in the scene.

The script derives its lighting from the pack rather than guessing:

- **World is black, film transparent.** The references are 26% pure black; a
  grey world would light the prop from all directions and kill the silhouette.
  Transparent film means the render composites straight over footage.
- **Key + rim, no fill.** With a key alone the silhouette dies against black
  wherever the surface turns away.
- **Rim colour is the pack's signature zone**, Lab→linear sRGB — for this pack
  `(0.392, 0.236, 0.401)`, the same violet the footage is graded to. The prop
  picks up the cast instead of you matching it by eye.
- **View transform is Standard, not AgX/Filmic**, and there is no grading in
  Blender. `look.cube` is the single source of truth; AgX would apply its own
  tone curve before the LUT ever saw the pixels, and grading twice compounds.

### The prop that ships with this pack

`props/helmet.glb` is real: 300,000 faces, 168,217 verts, one geometry, full PBR
material set (baseColor + metallicRoughness + normal). Minted live. Also in the
folder: `helmet_plate.png` (the generated reference image it was built from) and
`helmet_preview.png`. `props/_dryrun_placeholders/` holds the old stub files —
they are text, not meshes, and can be deleted.

`turntables/helmet.mp4` is a 72-frame / 3s turntable rendered locally, and
`out/helmet_graded_cut.mp4` is that turntable graded with the pack and cut at
the reference cadence — chroma MAE **1.21**, contrast 23.21 → **31.83**. That is
the whole point of the 3D branch: once a prop is a turntable it is ordinary
footage and every downstream stage already handles it.

To mint another (~$0.68), **use the two-step path**:

```bash
python mint3d.py --genre flashethereal --plate \
    --prompt "a cracked chrome visor" --render
```

`--plate` generates a clean single-object image first and meshes *that*. The
endpoint's own guidance is "simple background, single object, object >50% of
frame" — the pack's stills are glitch collages with several subjects, which is
close to the worst possible input, so lifting a prop straight from them yields
sculpted noise. The extra $0.15 is the difference between a usable mesh and a
discarded one.

Multi-view is the other big lever, and it is **named per-angle fields**
(`back_image_url`, `left_front_image_url`, …) — not a list. A wrong angle label
is worse than omitting the view, because the model trusts it.

**fal cannot render a mesh.** Its 3D category only consumes 2D and emits 3D, or
consumes 3D and emits 3D — there is no `3d-to-image` or `3d-to-video` endpoint at
all. That is why rendering happens here or in `taste/render3d.py`, and it is not
an oversight to route around.

---

## 4. Things that will bite you

| Don't | Why |
|---|---|
| Grade the delivered shots again | They are already graded; the LUT is for new material |
| Apply a global tint | The signature is zone-local; both ends are meant to stay neutral |
| Import at 23.976 or 30 fps | Resolve conforms silently and the cadence goes with it |
| Delete `out/forge_work/` | The timeline references those files by absolute path |
| Space the cuts evenly | Variance 1.06 is the rhythm; the average alone is not |
| Screen the grain plate | Grain wants Overlay; Screen lifts the blacks you just protected |
| Trust the mp4 as a master | It is a viewing copy with every cut baked in |
