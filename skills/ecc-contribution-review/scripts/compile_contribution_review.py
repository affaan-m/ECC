#!/usr/bin/env python3
"""Compile supplied ECC contribution observations into a review packet."""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
from pathlib import Path
from typing import Any

# Resolve the bundled validator from this script, including under -P/-I.
sys.path.insert(0, str(Path(__file__).resolve().parent))

from contribution_review_validation import (
    AUTHORITY_FIELDS,
    is_sha256,
    validate,
)
from contribution_review_validation import (
    RUNNERS as RUNNERS,
)
from contribution_review_validation import (
    safe_repo_path as safe_repo_path,
)


def canonical(value: Any) -> Any:
    """Normalize a value for a deterministic, receipt-independent checksum."""
    if isinstance(value, dict):
        return {
            key: canonical(item)
            for key, item in sorted(value.items())
            if key not in {"artifactId", "semanticChecksum", "returnReceipt"}
        }
    if isinstance(value, list):
        return [canonical(item) for item in value]
    return value


def checksum(value: Any) -> str:
    encoded = json.dumps(
        canonical(value), sort_keys=True, separators=(",", ":"), ensure_ascii=False
    ).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def reject_nonstandard_json_number(value: str) -> None:
    """Reject Python json's non-standard NaN and Infinity extensions."""
    raise ValueError(f"non-standard JSON number: {value}")


def mapping(data: dict[str, Any], field: str) -> dict[str, Any]:
    value = data.get(field, {})
    return value if isinstance(value, dict) else {}


def sequence(data: dict[str, Any], field: str) -> list[Any]:
    value = data.get(field, [])
    return value if isinstance(value, list) else []


def _packet_identity(data: dict[str, Any]) -> dict[str, Any]:
    change_intent = mapping(data, "changeIntent")
    repo_identity = mapping(data, "repoIdentity")
    return {
        "artifactType": "ecc-cross-harness-contribution-review-packet",
        "schemaVersion": "1.0.0",
        "artifactId": "ecc-contribution-review-packet",
        "generatedAt": data.get("observedAt"),
        "subjectRef": data.get("subjectRef"),
        "planeOwnership": {
            "primary": "meta-control",
            "supporting": [
                "observation-and-data",
                "epistemic-and-lineage",
                "state-and-relationship",
                "cognitive-control",
                "viability-and-policy",
            ],
        },
        "observationEnvelopes": [
            {
                "sourcePathRef": "observation-envelope",
                "repoIdentity": repo_identity,
                "changeIntent": change_intent,
                "surfaceContract": mapping(data, "surfaceContract"),
            }
        ],
    }


def _packet_review(
    data: dict[str, Any],
    faults: list[dict[str, Any]],
    contradictions: list[dict[str, Any]],
) -> dict[str, Any]:
    change_intent = mapping(data, "changeIntent")
    checkpoint = mapping(data, "checkpointContract")
    reasons = sorted({issue["code"] for issue in faults + contradictions})
    decision = "reject" if contradictions else "require_review"
    return {
        "authorityEnvelope": {key: False for key in sorted(AUTHORITY_FIELDS)},
        "policyEnvelope": {
            "proposalOnly": True,
            "canonicalFirst": True,
            "generatedRootsExcluded": True,
            "externalEffectsAllowed": False,
            "semanticCommitAllowed": False,
            "importedClaimsIndependentlyVerified": False,
        },
        "controllerDecision": {
            "decision": decision,
            "reasonCodes": reasons
            or ["imported_observations_require_independent_review"],
        },
        "contradictionScan": "computed",
        "contradictions": contradictions,
        "semanticPageFaults": faults,
        "counterevidence": list(change_intent.get("counterevidenceRefs", []))
        if isinstance(change_intent.get("counterevidenceRefs"), list)
        else [],
        "omissions": [
            "The compiler validates supplied claims but does not inspect the repository or referenced evidence.",
            "The compiler does not execute tests, update catalogs, commit, push, or open a pull request.",
            "A capsule file is written only to a new path explicitly supplied by the caller.",
        ],
        "residualUncertainty": list(checkpoint.get("remainingUnknowns", []))
        if isinstance(checkpoint.get("remainingUnknowns"), list)
        else [],
    }


def _packet_payload(
    data: dict[str, Any], decision: str, output_receipt: dict[str, Any]
) -> dict[str, Any]:
    artifacts = sequence(data, "artifactRecords")
    validation = sequence(data, "validationMatrix")
    change_intent = mapping(data, "changeIntent")
    repo_identity = mapping(data, "repoIdentity")
    outcome = "reject" if decision == "reject" else "review_packet_compiled"
    return {
        "domainPayload": {
            "contributionOutcome": outcome,
            "assessmentBasis": "unverified imported claims; internal consistency only",
            "repoClaims": repo_identity,
            "changeClaims": change_intent,
            "surfaceClaims": mapping(data, "surfaceContract"),
            "artifactClaims": artifacts,
            "harnessParityClaims": mapping(data, "harnessParity"),
            "catalogClaims": mapping(data, "catalogContract"),
            "validationClaims": validation,
            "tddClaims": mapping(data, "tddContract"),
            "securityClaims": mapping(data, "securityContract"),
            "budgetClaims": mapping(data, "budgetContract"),
            "commitClaims": mapping(data, "commitContract"),
            "failureProbeCoverage": {
                item.get("failureMode"): item.get("expectedOutcome")
                == item.get("observedOutcome")
                for item in sequence(data, "failureProbes")
                if isinstance(item, dict) and isinstance(item.get("failureMode"), str)
            },
            "runnerProposals": [
                {**item, "executed": False, "requiresExternalAuthorization": True}
                for item in sequence(data, "runnerProposals")
                if isinstance(item, dict)
            ],
            "contributionReceiptProposal": {
                "observationImported": True,
                **output_receipt,
            },
        }
    }


def _packet_evidence(data: dict[str, Any], decision: str) -> dict[str, Any]:
    artifacts = sequence(data, "artifactRecords")
    validation = sequence(data, "validationMatrix")
    repo_identity = mapping(data, "repoIdentity")
    return {
        "unverifiedEvidenceClaims": {
            "verified": False,
            "basis": "imported observation envelope",
            "repoHeadSha256": repo_identity.get("headSha256"),
            "artifactPaths": [
                item.get("path") for item in artifacts if isinstance(item, dict)
            ],
            "artifactSha256": [
                item.get("sha256") for item in artifacts if isinstance(item, dict)
            ],
            "gateIds": [
                item.get("gateId") for item in validation if isinstance(item, dict)
            ],
        },
        "epistemicLedger": [
            {
                "event": "repository_and_change_observation_imported",
                "status": "observed",
            },
            {
                "event": "canonical_surface_parity_catalog_and_tdd_evaluated",
                "status": "computed_from_claims",
            },
            {
                "event": "security_budget_and_commit_contract_evaluated",
                "status": "computed_from_claims",
            },
            {"event": "contribution_review_packet_compiled", "status": decision},
        ],
    }


def _packet_planes(
    data: dict[str, Any],
    decision: str,
    faults: list[dict[str, Any]],
    contradictions: list[dict[str, Any]],
) -> dict[str, Any]:
    artifacts = sequence(data, "artifactRecords")
    validation = sequence(data, "validationMatrix")
    return {
        "pccaPlanes": {
            "observation-and-data": {"artifactCount": len(artifacts)},
            "epistemic-and-lineage": {
                "sha256ShapedArtifactClaims": sum(

                        is_sha256(item.get("sha256"))
                        for item in artifacts
                        if isinstance(item, dict)

                )
            },
            "state-and-relationship": {
                "harnessTargetCount": len(
                    mapping(data, "harnessParity").get("targets", [])
                )
                if isinstance(mapping(data, "harnessParity").get("targets", []), list)
                else 0
            },
            "cognitive-control": {"validationGateCount": len(validation)},
            "meta-control": {"decision": decision},
            "viability-and-policy": {
                "faultCount": len(faults),
                "contradictionCount": len(contradictions),
            },
        }
    }


def _packet_memory(data: dict[str, Any]) -> dict[str, Any]:
    repo_identity = mapping(data, "repoIdentity")
    checkpoint = mapping(data, "checkpointContract")
    return {
        "memoryMetabolism": {
            "checkpointSha256": checkpoint.get("checkpointSha256"),
            "repoHeadSha256": repo_identity.get("headSha256"),
            "revalidateOn": [
                "HEAD drift",
                "policy or manifest change",
                "catalog regeneration",
                "harness adapter change",
                "test or coverage drift",
                "security finding",
                "review feedback",
            ],
            "supersessionRequired": True,
        }
    }


def _output_receipt(capsule_file_written: bool) -> dict[str, Any]:
    return {
        "sourceFilesWritten": False,
        "capsuleFileWritten": capsule_file_written,
        "testsExecuted": False,
        "catalogUpdated": False,
        "commitCreated": False,
        "pushPerformed": False,
        "pullRequestOpened": False,
        "controlStoreWritten": False,
        "canonicalMemoryWritten": False,
        "semanticCommitted": False,
    }


def compile_contract(
    observation: Any, source_path: Path, capsule_file_written: bool = False
) -> dict[str, Any]:
    faults, contradictions = validate(observation)
    data = observation if isinstance(observation, dict) else {}
    decision = "reject" if contradictions else "require_review"
    output_receipt = _output_receipt(capsule_file_written)
    artifact = {
        **_packet_identity(data),
        **_packet_review(data, faults, contradictions),
        **_packet_payload(data, decision, output_receipt),
        **_packet_evidence(data, decision),
        **_packet_planes(data, decision, faults, contradictions),
        **_packet_memory(data),
        "returnReceipt": output_receipt,
    }
    semantic_checksum = checksum(artifact)
    return {
        **artifact,
        "semanticChecksum": semantic_checksum,
        "returnReceipt": {**output_receipt, "semanticChecksum": semantic_checksum},
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("observation", type=Path, help="JSON observation envelope")
    parser.add_argument(
        "--output", type=Path, help="write the generated capsule to this path"
    )
    args = parser.parse_args()
    if args.output is not None and args.observation.resolve() == args.output.resolve():
        print("error: output path must not overwrite the observation envelope", file=sys.stderr)
        return 2
    try:
        observation = json.loads(
            args.observation.read_text(encoding="utf-8"),
            parse_constant=reject_nonstandard_json_number,
        )
    except (OSError, UnicodeError, ValueError, RecursionError) as error:
        print(f"error: cannot read observation JSON: {error}", file=sys.stderr)
        return 2
    capsule_written = args.output is not None
    try:
        packet = compile_contract(
            observation, args.observation, capsule_file_written=capsule_written
        )
        rendered = (
            json.dumps(packet, indent=2, sort_keys=True, ensure_ascii=False) + "\n"
        )
        rendered.encode("utf-8")
    except (UnicodeError, ValueError, RecursionError) as error:
        print(f"error: cannot compile observation JSON: {error}", file=sys.stderr)
        return 2
    if args.output is None:
        print(rendered, end="")
    else:
        try:
            with args.output.open("x", encoding="utf-8") as output_file:
                output_file.write(rendered)
        except FileExistsError:
            print(
                "error: output path already exists; refusing to overwrite",
                file=sys.stderr,
            )
            return 2
        except OSError as error:
            print(f"error: cannot write capsule output: {error}", file=sys.stderr)
            return 2
    return (
        0 if not packet["semanticPageFaults"] and (not packet["contradictions"]) else 2
    )


if __name__ == "__main__":
    raise SystemExit(main())
