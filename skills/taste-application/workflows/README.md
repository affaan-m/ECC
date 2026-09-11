# Offline Fal workflow clones

These importable templates were derived from the September 7, 2026 exports of the existing application, distillation and prop workflows. Account identifiers, sharing state, timestamps and example/default inputs are excluded. They do not change the live originals. Import them as new workflows, then verify the imported input schema and endpoint contracts before any authorized paid run.

- `taste-apply.json` uses first/middle/last frames from **your own content** as generation references. Its required `compiled_prompt` binds the content brief and taste steering to every generator. Merge output is explicitly 30 fps. This generates a reinterpretation from still references; it does not preserve the original footage or its motion.
- `taste-apply-motion.json` is an optional generated reinterpretation variant. Each generator also receives `video_urls: ["$input.source_video"]` as a motion reference, using the list field verified in the live Seedance UI/export. It keeps the same compiled input contract, 30 fps merge and disabled generated audio. Using a motion reference still generates new footage; it is not passthrough. Import it separately and confirm the run budget before submission.
- `taste-distill.json` requires three reference URLs and supplied measured grounding for the actual reference set. It retains middle-frame extraction and vision analysis, removes inherited Flash Ethereal measurements and the raw collage-to-mesh branch. Three still frames cannot measure cadence or motion; those measurements must come from local frame/video analysis.
- `taste-prop3d.json` retains the separate plate-to-PBR-mesh workflow. Supply a clean isolated prop description with plate rules. Preserve the full textured GLB when passing it to Blender; a reduced geometry proxy is not evidence that materials survived.

For actual existing-footage passthrough and editorial application, use the local pipeline `--takes` path and `forge.py`; these graph variants are generation paths.

All templates have blank required inputs. Endpoint/model IDs and output paths are preserved from the observed exports, including Seedance reference-to-video and Gemini 2.5 Flash. Their inclusion is **not** evidence of current availability or a successful provider run. Validate live schemas before submission. `generate_audio: false` explicitly disables generated audio on all three application generators. This field was verified in the September 7 live Seedance 2.5 UI export. `audio_urls: []` separately supplies no reference audio. Verify the resulting media streams during delivery checks.

## Compile application inputs locally

Create a private configuration JSON outside the repository:

```json
{
  "source_video": "https://example.org/your-own-content.mp4",
  "brief": "Describe the content and action",
  "style_steer": "Describe measured structure, lighting, framing and motion"
}
```

```sh
python3 skills/taste-application/scripts/workflow_graphs.py \
  --kind apply --config /absolute/private/apply-config.json \
  --out /absolute/private/apply-input.json
```

The output object contains `source_video` and `compiled_prompt` and works with either application template; the optional motion variant needs no additional compiler option. The compiler separates WHAT, HOW and mandatory GRADE sections. Rendering stays neutral so the measured grade can be applied once downstream. There are no unsupported graph string-concatenation expressions.

## Compile distillation inputs locally

```json
{
  "genre": "Your actual reference genre",
  "references": [
    "https://example.org/reference-a.mp4",
    "https://example.org/reference-b.mp4",
    "https://example.org/reference-c.mp4"
  ],
  "measured_grounding": "Supply results and provenance from actual local analysis. Do not copy another reference set's measurements."
}
```

Use the same command with `--kind distill`. Its output object contains `reference_1`, `reference_2`, `reference_3`, and `measured_grounding` for the corresponding template. The compiler requires nonempty genre and grounding, adds no numerical measurements, performs no network calls and refuses to overwrite an output file. It cannot establish whether supplied measurements are truthful; retain the referenced analysis report for review.

`validate_graph` checks input consumption, output node references, dependency wiring and cycles. It does not validate provider-specific model schemas or make a live submission. Local compiled inputs may contain private media URLs and should not be committed.
