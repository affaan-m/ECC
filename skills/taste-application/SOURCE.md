# Source and verification

Recovered from the user's latest `ecc-taste-skills_1.zip` attachment to the
Claude conversation **Video workflow architecture**. Archive SHA-256:
`5e0dc440df4dcf6b2082a7dd59e1d6e9cc11d10166d4e1a19dc6c96478f4d2c8`.

The archive's `README-MERGE.md` identifies the two standalone skill script
directories as the implementation. This import preserves the measured grade,
reference cadence, median-edge UI crop, scale-to-cover normalization,
alpha-bounded overlay plates and seeded placement logic from that source.
Raw media, signed provider responses and project files are not bundled.

Focused continuation fixes address observed execution failures: script paths
outside the source directory, retained editable shot media, explicit output
FPS, provider tier forwarding, existing-take passthrough, measured zero
background targets, packed PBR textures, Blender slotted actions and exact
Resolve overlay readback. Original and retopologized meshes are retained as
separate assets. Provider calls require explicit live opt-in and ambiguous
submissions are not automatically repeated.

`taste-distillation` retains its own `taste/` helpers so that skill can be
installed independently, as the original bundle intended. The transport copies
are checked for equality by regression tests. ECC owns the reusable `tasteforge` engine, including interview/schema
contracts, workflow planning, asset receipts and the Resolve adapter. The
legacy `taste.resolve` import delegates to that same adapter. `ito-video`
consumes the packaged ECC engine as an example project.

Verification uses `tests/test_taste_*.py` and the dedicated taste workflow CI.
Actual application checks additionally exercised a full textured GLB in
Blender 5.1 and overlay placement in Resolve Studio 21. These are distinct
from the offline test suite and from artistic approval of a finished video.

The metadata-only `tasteforge/fixtures/flashethereal` fixture comes from the earlier `tasteforge (4).zip` archive, SHA-256 `ef06a606d3b528fbd939b05fadc25bf6674073a1e05a01e3aa6b9c9416fd6284`. It includes no source media or `look.cube`; original source media stays outside the package.
