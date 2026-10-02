# ECC reusable TasteForge engine

Install with `python3 -m pip install ./skills/taste-application/scripts` from an ECC checkout or extracted npm package. The Python distribution is `ecc-tasteforge`; the CLI remains `python3 -m tasteforge`. Ito-video consumes this package as an example project.

## Repeatable taste-driven video workflow

A stdlib-only Python package (no numpy/opencv/network dependencies) that
canonicalizes the recovered TasteForge flow into maintained, testable
tooling. Provider integrations (Fal) are optional adapters that **fail
closed**; every command here runs offline and deterministically. See
the skill's `SOURCE.md` for recovered-source lineage.

## Install

Requires Python 3.9 or newer. Install the `ecc-tasteforge` distribution from
ECC as shown above, then run the CLI from any directory. Core commands have
no third-party runtime dependencies. Optional media helpers use FFmpeg and
the libraries listed in the skill instructions.

## CLI

```bash
python3 -m tasteforge provenance                     # recovered-source lineage as JSON
python3 -m tasteforge inspect <pack-dir>             # validate + summarize a style pack
python3 -m tasteforge validate <pack-dir>            # exit 0 valid / 1 invalid
python3 -m tasteforge interview --answers a.json --genre NAME [--out profile.json]
python3 -m tasteforge distill --profile profile.json [--pack <pack-dir>] [--out spec.json]
python3 -m tasteforge apply --pack <pack-dir> --media media.json [--duration 20] [--out report.json]
python3 -m tasteforge apply --pack <pack-dir> --media selects.json --duration 20 --fps 30 --no-repeat --out report.json
python3 -m tasteforge export --events events.json [--out-dir out] [--fps 24] [--title cut]
python3 -m tasteforge multimodal --config workflow.json --out-dir out/multimodal
```

`--live` on `distill`/`apply` is refused (exit 2): provider generation
requires explicit separately authorized execution outside this package.

Input shapes:

- answers: `{"<question-id>": "<free text>", ...}` — ids are listed by
  `tasteforge.interview.QUESTIONS` (palette, grain, lighting, focal_length,
  camera_motion, subject_framing, grade_description, mood_adjectives, avoid,
  brief).
- media/events: `{"clips": [{"path": "...", "duration": 6.2, "name": "..."}]}`.

Outputs:

- `interview` → taste profile (schema `TASTE_PROFILE_SCHEMA`)
- `distill` → style spec (schema `SPEC_SCHEMA`, always `dry_run: true`,
  `provider: "none"`) with measured grounding embedded when a pack is given
- `apply` → application report (schema `APPLICATION_REPORT_SCHEMA`; provider
  enum-locked to `"none"`) with planned shots and frame-exact timeline events
- `export` → CMX3600 `<title>.edl` + FCPXML 1.9 `<title>.fcpxml` with
  rational, frame-quantised times (NTSC-safe)
- `multimodal` → distinct numbered genre specs, separate image/video/3D-asset
  request manifests, a seeded aperiodic Resolve effect recipe, and a receipt
  that binds every emitted artifact by relative path, byte size, SHA-256,
  genre, modality, `provider_execution: false`, and exact reference/time
  provenance. It requires local `ffprobe` and `ffmpeg` for measured media
  features and never submits a request.

### Real-footage application

Use `--no-repeat` when each source must appear at most once. Strict mode uses
normalized source paths in manifest order, requires enough unique reviewed
clips for the cadence plan, and rejects selected sources shorter than their
assigned shots. It fills the target in output frames or fails. This mode does
not yet support separate in/out ranges from the same recording. Without the
flag, legacy round-robin selection remains available and can repeat sources.

Set `--fps` explicitly for the output sequence. It overrides the reference
pack's cadence frame rate. TasteForge plans cuts; it does not rank footage by
visual quality, apply grades or overlays, detect subjects, or import Resolve
projects. A multimodal subject-anchor descriptor is a tracking requirement,
not a completed track.

To export an application report, adapt its events to the export CLI's input
shape and keep the same output frame rate:

```bash
python3 - <<'PY'
import json
from pathlib import Path
report = json.loads(Path("report.json").read_text())
Path("events.json").write_text(json.dumps({"clips": report["timeline_events"]}))
PY
python3 -m tasteforge export --events events.json --fps 30 --out-dir out --title review-cut
```

Verify event count, total frames, source uniqueness, and media linkage before
NLE import. The exported timeline is an editable cut plan, not a rendered or
creatively approved video.

The multimodal JSON contract has `schema_version`, `run_id`, integer `seed`,
optional `evidence_files`, and `genres`. Each genre has a distinct `number`,
`slug`, `label`, local `references`, and non-empty `signature` lists for
`materials`, `motion`, `composition`, and `avoid`. Relative input paths resolve
from the config file's directory. Run output through `validate_bundle`; missing
modalities, genericized genres, periodic schedules, unanchored CV effects,
unsafe placement, unbound/tampered artifacts, or any provider-execution flag
fail closed.

## Offline fixture

`tasteforge/fixtures/flashethereal/` is recovered pack metadata
(`pack.json`, `grade.json`, `cadence.json`, `spec.json`, `grounding.txt`,
`flashethereal-cut.edl`), byte-identical
to the latest recovered generation. It exercises the full offline path with
no provider and no media.

```bash
python3 -m tasteforge inspect tasteforge/fixtures/flashethereal
```

## Library

```python
from tasteforge import pack, interview, distill, apply, export, provenance, schema

sp = pack.load("tasteforge/fixtures/flashethereal")
report = apply.apply_local(sp, [{"path": "a.mov", "duration": 5.0}])
edl, fcpxml = export.write_timeline(report["timeline_events"], out_dir="out")
```

## Completed assets and editor placement

`tasteforge.assets.ingest_assets(config_path, out_receipt)` records already
local image, video and GLB assets without uploading or generating them.
`validate_assets(receipt_path)` rechecks their bytes and lineage. Entries use
`id`, `modality`, `path` and `origin`: `local_passthrough`, `external_result`,
or `recovered_unverified`. An external result requires supplied provider
identifiers and a local evidence file. This verifies the supplied evidence,
not remote provider state. Optional `bundle_dir` binds each asset's
`request_id` to the validated multimodal plan; genre fields are derived from
that match instead of accepted as arbitrary claims.

`tasteforge.resolve.allocate_placements` validates local overlay assets and
allocates overlapping intervals above preserved video tracks.
`apply_placements` takes injected Resolve timeline and media-pool objects;
it does not connect to Resolve, save a project or render. Call it only after
selecting and verifying a distinct versioned target and saving a checkpoint:

```python
from tasteforge.resolve import apply_placements

receipt = apply_placements(
    target_timeline, media_pool, events,
    source_timeline="previous-cut", fps=30, base_track_count=16,
    source_end_mode="exclusive",  # verified host convention, never assumed
)
```

Each event supplies `id`, `asset`, `record_frame`, `frames`, `opacity` and an
explicit numeric `composite`. Optional `requires_alpha` checks decoded pixel
format. The adapter verifies immediate and final geometry, paths, properties,
track membership and base/audio preservation. A mismatch raises and may leave
partial edits in the new target; discard/restore that target instead of
retrying blindly. Its receipt proves in-memory placement only. Save and verify
the editor checkpoint separately before rendering or reporting delivery.

## Preserve an existing edit with an application bundle

From `skills/taste-application/scripts/`, compile a **local proposal**:

```bash
python3 workflow_graphs.py --kind apply-bundle --config /private/work/request.json --out /private/work/new-bundle.json
```

The request retains `source_video`, `brief`, and `style_steer`, and adds an
`integration` object. The existing `--kind apply` still produces exactly
`source_video` and `compiled_prompt`. The bundle embeds that unchanged payload;
it is not itself a fal request or an EDL/FCPXML input. No upload, download,
provider execution, media probing, grading, rendering or editor mutation occurs.

For preservation without any hosted source, use the same CLI with a request
containing **only** `{"local_only": true, "integration": {...}}`. This mode
does not compile or prepare a provider request: the bundle has
`local_only: true`, `provider_input: null`, `compiled_input_sha256: null`,
`provider_input_status: not_prepared_local_only` and
`insert_policy: none_preserve_baseline`. Candidates and inserts must be empty.
Do not supply `source_video`, `provider_input`, `compiled_prompt`, provider
brief/style fields, or a dummy URL. Local evidence and protected-stack checks
still run in full; this bundle cannot be submitted to fal.

The request's `local_only` flag must be an exact JSON boolean; omission defaults
to false. With false/omitted, the original provider-input compilation still
requires a real HTTPS source and its output shape remains unchanged. Existing
normal bundles therefore have no `local_only` field. Revalidation rejects
changed flags, mixed provider input or mode fields, and added candidates/inserts.
At the API level use `build_application_bundle(integration, None, local_only=True)`;
normal calls retain their existing two positional arguments.

`integration` requires:

| Field | Contract |
|---|---|
| `baseline` | `project_file`, `snapshot_file`, `project_name`, `timeline_name`, `fps`, `timeline_range` |
| `source` | `media`, `track`, `clip_index`, `media_frames`, `fps`, `source_range`, `timeline_range` |
| `audio` | One source-shaped binding for **every** original audio clip, retaining its complete placement and trim |
| `protected_intervals` | Nonempty list of `{range: [start, end], reason: text}` |

File records are `{path, bytes, sha256}`: canonical absolute path, positive
integer byte count, lowercase SHA-256 of resident regular bytes. Paths and
parents must not be symlinks. Requests and JSON evidence are limited to 8 MiB;
duplicate JSON keys and nonfinite values fail. Missing/offloaded files fail
without hydration. Use a private output directory outside any public repository;
bundles contain local paths, prompts and hosted media URLs. Existing output
files are never overwritten.

FPS is a reduced `{numerator, denominator}` pair of positive exact integers.
Every range is half-open in integer frames; booleans and decimal frame counts
are invalid. Audio source offsets/capacity are expressed at the timeline FPS,
not in audio samples. Bindings must match the snapshot path, track/index and
trim geometry exactly; source subsets must retain the same time mapping.

The native snapshot contains `project`, `timeline`,
`settings.timelineFrameRate`, and `timeline_readback: {video1: [...], audio1: [...]}`.
Each clip supplies `name`, `path`, `start`, `end`, `left_offset`, `right_offset`,
`enabled` and `properties`. Preserve all original entries, including disabled
clips; native generators may have `path: null` but cannot serve as a file-bound
source/audio reference. Native FPS must agree; Resolve labels `23.976`, `29.97`
and `59.94` map explicitly to the corresponding `/1001` rates. Other native
FPS labels must be short decimal/rational forms, never exponent notation.
Capture each timeline while active; do not rewrite state using inactive reads.

Optional `candidates`, `inserts` and `historical_receipts` default to empty.
The result uses `preserve_native_timeline`, derives the full protected stack,
and proposes zero inserts by default. Pending/rejected candidates cannot be
inserted. A resolved candidate requires local `media`, `media_frames`, `fps`,
unique `id`, `origin: provider_generated`, `relationship: generated_variation`,
`review_status`, source/input hashes, and a hash-bound `generation_receipt`.
That receipt names `request_id`, `source_url`, `source_sha256`,
`candidate_sha256` and `compiled_input_sha256`. Unresolved historical URLs may
remain in separate local historical receipts; they never become candidates.

An insert supplies `candidate_id`, `candidate_range`, `timeline_range`,
`retime: none` and an `approval_file`. The approval must state `status: approved`
and match candidate/source/input hashes, both ranges, and `edit_context_sha256`
from a zero-insert bundle. This context hashes the complete baseline, source,
audio and protection configuration, preventing approval reuse on another edit
or timebase. Only after actual review should that approval evidence be supplied.
The insert policy permits a new video track and preserves baseline audio;
overlaps with protected intervals or other inserts, mismatched FPS, and retiming
are rejected. Original clips are never removed or rewritten by this module.

API: `tasteforge.integration.build_application_bundle(integration, compiled_input)`
returns an independent object; `validate_application_bundle(bundle)` rereads and
checks its evidence. Revalidate immediately before any separately implemented
editor operation. These checks prove local bytes and supplied metadata only:
they do not authenticate a reviewer, prove remote upload identity, probe actual
media timing, prove the snapshot was honestly captured, or establish visual
approval. Source/candidate timing must already have been independently measured.
The synthetic cases in `tests/test_integration.py` are executable format examples.

## Tests, lint, types

```bash
python3 -m unittest discover -s skills/taste-application/tests -v   # full suite (offline, deterministic)
ruff check skills/taste-application/scripts/tasteforge                # lint (pip install ruff)
mypy skills/taste-application/scripts/tasteforge                            # types (pip install mypy)
python3 -m compileall -q skills/taste-application/scripts/tasteforge        # syntax check
```

## Boundaries

- No network calls, no credentials, no provider account access — ever.
- A local Fal reference never means a provider workflow was saved; see
  `provenance.provider_reference()`.
- Raw recovered sources (videos, LUTs, stills, meshes) stay out of Git; the
  fixture is metadata-only and documented in the skill's `SOURCE.md`.

## Reusable media adapters

Install optional dependencies with `python3 -m pip install './skills/taste-application/scripts[media]'`,
`[capcut]`, or `[manim]` as needed. FFmpeg/ffprobe are external executables.

- `python3 -m tasteforge.media.stills INPUT OUTPUT --duration 4 --fps 30` animates a still with configurable canvas and normalized crop endpoints through the Python API.
- `python3 -m tasteforge.media.glitch --help` exposes seeded local drift, feedback, mosh and pixel-sort effects. Pixel-sort randomness is disabled for repeatability.
- `python3 -m tasteforge.media.capcut --help` creates a new named draft from local clips. Existing drafts cannot be overwritten; choose a fresh name. Native editor readback and save verification remain separate application checks.
- `tasteforge.media.manim_geo` supplies reusable geometry scenes. Use Manim's render options for frame rate, canvas and output; project subclasses may set the seed and labels.

Still and glitch outputs reject collisions unless `--overwrite` is explicit;
rendering uses a temporary output so a failed process preserves the existing
file. Crop rectangles are fitted to the output aspect ratio using both width
and height. The Ito example wrappers retain its scene choices and file names.
