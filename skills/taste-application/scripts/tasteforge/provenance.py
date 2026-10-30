"""Exact provenance of the recovered TasteForge sources, as data.

Rules encoded here:

* The canonical recovered source is a read-only directory; raw media, LUTs,
  stills, meshes, and caches stay OUT of Git.
* A provider workflow (e.g. a Fal queue/workflow) may only ever be *referenced*.
  The existence of a local reference never means a provider-side workflow was
  saved, persisted, or is authorized to run.
* The Claude cloud session that produced the flow is identified from local
  metadata; its full transcript is NOT available locally, and nothing in this
  package may claim otherwise.
"""

from __future__ import annotations

from typing import Any

CANONICAL_SOURCE_PATH = "recovered/tasteforge-flow-20260818"
COPY_VERIFICATION_SHA256 = (
    "dbb3fcd05dc08ab06739b26e5f313fbe14303d93d9d7b7938b7aa5981306e888"
)
CLAUDE_SESSION_ID = "redacted-local-session"

_GENERATIONS: list[dict[str, str]] = [
    {
        "archive": "tasteforge.zip",
        "sha256": "a504480ce1963370f47ac7fc338c97f561fa762c0bb60218c88c667b8b215c9c",
        "status": "prior",
        "delta": (
            "generation 0: initial recovered pipeline - mint/distill/apply/"
            "resolve_ingest stages, taste package (pack, frames, grade, "
            "cadence, falapi, timeline), single-reference flashethereal pack "
            "with LUT, grade, cadence, 9 stills"
        ),
    },
    {
        "archive": "tasteforge (1).zip",
        "sha256": "ef7ff52da211e63ab538818f36b22ddc736b4cecaf4f31c98bd7e9205c109a99",
        "status": "prior",
        "delta": (
            "generation 1: added grounding.txt (measured-ground-truth VLM "
            "preamble), adaptive threshold sweep + shared-stats decode in "
            "cadence, content masking / outlier rejection in frames and "
            "grade; references grew to 3 (14 stills)"
        ),
    },
    {
        "archive": "tasteforge (2).zip",
        "sha256": "0d227f27750805ecf88d29bf00a7f1d6605b287c5750a05fe3f3ea84fe2c3534",
        "status": "prior",
        "delta": (
            "generation 2: distill gains strict-JSON retry, spec validation "
            "and repair; apply gains takes planning (plan_takes) and prompt "
            "refinements; first prop mesh (GLB) minted"
        ),
    },
    {
        "archive": "tasteforge (3).zip",
        "sha256": "2f3a10d95c3c9c02da390a2f1cb9f21499b88de2650e813f66cabe9346a41875",
        "status": "prior",
        "delta": (
            "generation 3: regenerated EDL/FCPXML cut outputs from the "
            "distilled cadence; grade.py fixes in LUT baking"
        ),
    },
    {
        "archive": "tasteforge (4).zip",
        "sha256": "ef06a606d3b528fbd939b05fadc25bf6674073a1e05a01e3aa6b9c9416fd6284",
        "status": "latest",
        "delta": (
            "generation 4 (canonicalized here): grade.py adds "
            "_post_tone_anchor so a baked 3D LUT reconstructs source "
            "luminance quantiles from the stored CDF instead of stretching a "
            "uniform lattice; pack.json/spec.json/look.cube regenerated"
        ),
    },
]


class SavedWorkflowClaimError(RuntimeError):
    """A record claimed provider-side workflow state that cannot exist here."""


def lineage_report() -> dict[str, Any]:
    """Full, deterministic lineage of the recovered TasteForge implementation."""
    return {
        "canonical_source": {
            "path": CANONICAL_SOURCE_PATH,
            "read_only": True,
            "copy_verification_sha256": COPY_VERIFICATION_SHA256,
            "note": (
                "same-filesystem relocation of the cross-device AirDrop copy; "
                "per-file sha256 manifest verified at copy time"
            ),
        },
        "generations": [dict(g) for g in _GENERATIONS],
        "claude_session": {
            "id": CLAUDE_SESSION_ID,
            "transcript_available": False,
            "selection_evidence_local": True,
            "note": (
                "local session metadata proves this is the selected "
                "video/taste-flow session; the full transcript is not "
                "available locally, so behavior is inferred from version "
                "deltas, source, tests, manifests, and outputs - never "
                "invented"
            ),
        },
        "fixture": {
            "path": "tasteforge/fixtures/flashethereal",
            "contents": [
                "pack.json", "grade.json", "cadence.json", "spec.json",
                "grounding.txt", "flashethereal-cut.edl",
            ],
            "note": (
                "byte-identical metadata files selected from generation 4; "
                "look.cube (970KB LUT), stills, GLB props, plates, caches, "
                "and .DS_Store deliberately excluded"
            ),
        },
    }


def provider_reference(provider: str) -> dict[str, Any]:
    """A pointer to a provider-side workflow. Never state, never authority.

    Constructed so that no field can be misread as \"a Fal workflow was
    saved\": the record is explicitly ``reference_only`` and denies both
    persisted provider state and execution authority.
    """
    return {
        "kind": "provider-workflow-reference",
        "provider": provider,
        "reference_only": True,
        "persisted_workflow_state": False,
        "authorizes_execution": False,
    }


def assert_no_saved_provider_workflow(records: list[dict[str, Any]]) -> None:
    """Raise if any record claims persisted provider workflow state."""
    for record in records:
        if record.get("persisted_workflow_state"):
            raise SavedWorkflowClaimError(
                f"record for provider {record.get('provider')!r} claims saved "
                "workflow state; a local reference is never a saved provider "
                "workflow"
            )
