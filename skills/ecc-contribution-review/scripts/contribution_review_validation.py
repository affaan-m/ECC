"""Section validators for the skill contribution observation contract."""

from __future__ import annotations

import math
import re
from datetime import datetime
from pathlib import PurePosixPath
from typing import Any

ROLES = {
    "canonical-skill", "install-manifest",
    "agents-mirror", "cursor-mirror",
    "codex-metadata", "unit-test",
}
HARNESSES = {"claude", "codex", "cursor"}
GATES = {
    "strict-skill-frontmatter", "install-manifests",
    "catalog-sync", "command-registry",
    "harness-adapters", "unicode-safety",
    "no-personal-paths", "test-and-coverage",
}
FAILURES = {
    "generated-root-as-canonical", "missing-manifest-entry",
    "harness-content-drift", "catalog-count-drift",
    "stale-command-registry", "missing-red-test",
    "coverage-regression", "secret-in-diff",
    "personal-path-in-diff", "unsafe-hook-permission",
    "breaking-change-unmarked", "commit-before-gates",
}
FAILURE_OUTCOMES: dict[Any, str] = {
    "generated-root-as-canonical": "reject", "missing-manifest-entry": "hold",
    "harness-content-drift": "hold", "catalog-count-drift": "hold",
    "stale-command-registry": "hold", "missing-red-test": "hold",
    "coverage-regression": "hold", "secret-in-diff": "reject",
    "personal-path-in-diff": "reject", "unsafe-hook-permission": "reject",
    "breaking-change-unmarked": "hold", "commit-before-gates": "reject",
}
RUNNERS = {
    "resolve-canonical-surface", "compile-change-plan",
    "run-red-green-refactor", "reconcile-harness-parity",
    "reconcile-catalog-and-manifests", "run-security-and-validation-gates",
    "prepare-commit-proposal",
}
AUTHORITY_FIELDS = {
    "mayWriteSourceFiles", "mayExecuteTests",
    "mayUpdateCatalog",
    "mayCommit",
    "mayPush",
    "mayOpenPullRequest",
    "mayWriteControlStore",
    "mayWriteCanonicalMemory",
    "maySemanticCommit",
}
EFFECT_FIELDS = {
    "sourceFileWriteRequested",
    "testExecutionRequested",
    "catalogWriteRequested",
    "commitRequested",
    "pushRequested",
    "pullRequestRequested",
    "controlStoreWriteRequested",
    "canonicalMemoryWriteRequested",
    "semanticCommitRequested",
}


def is_sha256(value: Any) -> bool:
    return isinstance(value, str) and re.fullmatch(r"[0-9a-f]{64}", value) is not None


def is_finite_number(value: Any) -> bool:
    """Accept finite JSON numbers while excluding booleans."""
    if isinstance(value, bool):
        return False
    if isinstance(value, int):
        return True
    return isinstance(value, float) and math.isfinite(value)


def safe_repo_path(value: Any) -> bool:
    """Accept normalized relative POSIX paths, rejecting home/drive/traversal refs."""
    if not isinstance(value, str) or not value or "\\" in value or "\x00" in value:
        return False
    if value.startswith("~") or re.match(r"^[A-Za-z]:", value):
        return False
    if any(part in {"", ".", ".."} for part in value.split("/")):
        return False
    path = PurePosixPath(value)
    return not path.is_absolute() and path.as_posix() == value


def add_issue(issues: list[dict[str, Any]], code: str, plane: int, detail: str) -> list[dict[str, Any]]:
    if code in {issue["code"] for issue in issues}:
        return list(issues)
    return [*issues, {"code": code, "plane": plane, "detail": detail}]



def _validate_repo(observation: dict[str, Any], faults: list[dict[str, Any]]) -> list[dict[str, Any]]:
    repo = observation["repoIdentity"]
    repo_fields = {
        "rootName", "rootPathRef", "branch", "baseSha256", "headSha256",
        "packageLockSha256", "installModulesSha256", "installProfilesSha256",
        "installComponentsSha256", "catalogScriptSha256", "skillPolicySha256",
        "checkpointSha256",
    }
    if (
        set(repo) != repo_fields
        or repo.get("rootName") != "everything-claude-code"
        or repo.get("rootPathRef") != "active-checkout:everything-claude-code"
        or not isinstance(repo.get("branch"), str)
        or not repo.get("branch")
        or repo.get("branch") in {"main", "master"}
        or any(not is_sha256(repo.get(key)) for key in repo_fields if key.endswith("Sha256"))
        or repo.get("baseSha256") == repo.get("headSha256")
    ):
        faults = add_issue(faults, "repo_identity_failed", 2,
                  "Active ECC root, non-default branch, distinct base/head, manifests, catalog, policy, and checkpoint hashes are required.")
    return faults


def _validate_intent(observation: dict[str, Any], faults: list[dict[str, Any]]) -> list[dict[str, Any]]:
    intent = observation["changeIntent"]
    intent_fields = {
        "changeId", "changeKind", "canonicalSurface", "canonicalPath",
        "legacyCommandShimRequired", "breakingChange", "owner", "scopes",
        "evidenceRefs", "counterevidenceRefs",
    }
    scopes = intent.get("scopes")
    if (
        set(intent) != intent_fields
        or not isinstance(intent.get("changeId"), str)
        or not intent.get("changeId")
        or intent.get("changeKind") != "skill"
        or intent.get("canonicalSurface") != "skills"
        or not safe_repo_path(intent.get("canonicalPath"))
        or not intent.get("canonicalPath", "").startswith("skills/")
        or intent.get("legacyCommandShimRequired") is not False
        or intent.get("breakingChange") is not False
        or intent.get("owner") != "ECC"
        or not isinstance(scopes, list)
        or set(scopes) != {"skills", "tests", "manifests", "cross-harness"}
        or not isinstance(intent.get("evidenceRefs"), list)
        or not intent.get("evidenceRefs")
        or not isinstance(intent.get("counterevidenceRefs"), list)
    ):
        faults = add_issue(faults, "change_intent_failed", 1,
                  "A bounded non-breaking skills-first change with explicit scopes and evidence refs is required.")
    return faults


def _validate_surface(observation: dict[str, Any], faults: list[dict[str, Any]]) -> list[dict[str, Any]]:
    surface = observation["surfaceContract"]
    surface_fields = {
        "canonicalFirst", "generatedRootsExcluded", "curatedSkill",
        "installManifestUpdated", "commandShimAdded", "provenanceRequired",
        "mirrorTargets", "docsUpdateRequired", "evidenceRefs", "counterevidenceRefs",
    }
    mirror_targets = surface.get("mirrorTargets")
    if (
        set(surface) != surface_fields
        or surface.get("canonicalFirst") is not True
        or surface.get("generatedRootsExcluded") is not True
        or surface.get("curatedSkill") is not True
        or surface.get("installManifestUpdated") is not True
        or surface.get("commandShimAdded") is not False
        or surface.get("provenanceRequired") is not False
        or not isinstance(mirror_targets, list)
        or set(mirror_targets) != {"agents", "cursor"}
        or surface.get("docsUpdateRequired") is not True
        or not isinstance(surface.get("evidenceRefs"), list)
        or not surface.get("evidenceRefs")
    ):
        faults = add_issue(faults, "canonical_surface_failed", 6,
                  "Curated skills/ must lead; generated roots must be excluded; manifest, docs, and intentional mirrors are required.")
    return faults


def _validate_artifacts(observation: dict[str, Any], faults: list[dict[str, Any]]) -> list[dict[str, Any]]:
    intent = observation["changeIntent"]
    artifacts = observation["artifactRecords"]
    artifact_fields = {
        "path", "role", "sha256", "exists", "sourceOfTruth", "generated",
        "contentIdentitySha256", "evidenceRefs",
    }
    artifact_paths: list[Any] = []
    artifact_bad = False
    for artifact in artifacts:
        if not isinstance(artifact, dict):
            artifact_bad = True
            continue
        artifact_paths = [*artifact_paths, artifact.get("path")]
        source_of_truth = artifact.get("role") == "canonical-skill"
        if (
            set(artifact) != artifact_fields
            or not safe_repo_path(artifact.get("path"))
            or artifact.get("role") not in ROLES
            or not is_sha256(artifact.get("sha256"))
            or artifact.get("exists") is not True
            or artifact.get("sourceOfTruth") is not source_of_truth
            or artifact.get("generated") is not False
            or not is_sha256(artifact.get("contentIdentitySha256"))
            or not isinstance(artifact.get("evidenceRefs"), list)
            or not artifact.get("evidenceRefs")
        ):
            artifact_bad = True
    canonical_artifacts = [
        item for item in artifacts
        if isinstance(item, dict) and item.get("role") == "canonical-skill"
    ]
    if (
        len(artifacts) != 6
        or {item.get("role") for item in artifacts if isinstance(item, dict)} != ROLES
        or len(artifact_paths) != len(set(artifact_paths))
        or len(canonical_artifacts) != 1
        or canonical_artifacts[0].get("path") != intent.get("canonicalPath")
        or artifact_bad
    ):
        faults = add_issue(faults, "artifact_graph_failed", 2,
                  "Six unique, extant, hash-bound artifacts with one exact canonical source are required.")
    return faults


def _parity_targets_valid(targets: list[Any], canonical_content: Any) -> bool:
    target_fields = {
        "harness", "path", "contentIdentitySha256", "frontmatterAdapted",
        "metadataPresent", "evidenceRefs",
    }
    return not any(
        not isinstance(item, dict)
        or set(item) != target_fields
        or not safe_repo_path(item.get("path"))
        or item.get("contentIdentitySha256") != canonical_content
        or not isinstance(item.get("frontmatterAdapted"), bool)
        or item.get("metadataPresent") is not True
        or not isinstance(item.get("evidenceRefs"), list)
        or not item.get("evidenceRefs")
        for item in targets
    )

def _validate_parity(observation: dict[str, Any], faults: list[dict[str, Any]]) -> list[dict[str, Any]]:
    artifacts = observation["artifactRecords"]
    parity = observation["harnessParity"]
    parity_fields = {
        "canonicalContentSha256", "targets", "parityPassed", "driftIds",
        "evidenceRefs", "counterevidenceRefs",
    }
    targets = parity.get("targets", [])
    canonical_content = parity.get("canonicalContentSha256")
    artifact_by_path = {
        item.get("path"): item
        for item in artifacts
        if isinstance(item, dict)
    }
    expected_roles: dict[Any, str] = {
        "claude": "canonical-skill",
        "codex": "agents-mirror",
        "cursor": "cursor-mirror",
    }
    parity_artifacts_bad = any(
        not isinstance(item, dict)
        or item.get("path") not in artifact_by_path
        or artifact_by_path[item.get("path")].get("role") != expected_roles.get(item.get("harness"))
        or artifact_by_path[item.get("path")].get("contentIdentitySha256")
        != item.get("contentIdentitySha256")
        for item in targets
    ) if isinstance(targets, list) else True
    if (
        set(parity) != parity_fields
        or not is_sha256(canonical_content)
        or not isinstance(targets, list)
        or len(targets) != 3
        or {item.get("harness") for item in targets if isinstance(item, dict)} != HARNESSES
        or not _parity_targets_valid(targets, canonical_content)
        or parity.get("parityPassed") is not True
        or parity.get("driftIds") != []
        or not isinstance(parity.get("evidenceRefs"), list)
        or not parity.get("evidenceRefs")
        or parity_artifacts_bad
    ):
        faults = add_issue(faults, "harness_parity_failed", 3,
                  "Claude, Codex, and Cursor surfaces must retain normalized content identity with explicit adaptations and no drift.")
    return faults


def _validate_catalog(observation: dict[str, Any], faults: list[dict[str, Any]]) -> list[dict[str, Any]]:
    catalog = observation["catalogContract"]
    catalog_fields = {
        "filesystemAgents", "documentedAgents", "filesystemSkills", "documentedSkills",
        "filesystemCommands", "documentedCommands", "installModuleCount",
        "curatedSkillsReferenced", "intentionallyUnshippedSkills", "catalogCheckPassed",
        "commandRegistryCheckPassed", "manifestValidationPassed", "countsReconciled",
        "evidenceRefs", "counterevidenceRefs",
    }
    count_pairs = (
        ("filesystemAgents", "documentedAgents"),
        ("filesystemSkills", "documentedSkills"),
        ("filesystemCommands", "documentedCommands"),
    )
    counts_valid = all(
        isinstance(catalog.get(left), int)
        and not isinstance(catalog.get(left), bool)
        and catalog.get(left) > 0
        and catalog.get(left) == catalog.get(right)
        for left, right in count_pairs
    )
    skills_valid = all(
        isinstance(catalog.get(key), int) and not isinstance(catalog.get(key), bool)
        and catalog.get(key) >= 0
        for key in ("curatedSkillsReferenced", "intentionallyUnshippedSkills", "filesystemSkills")
    )
    if (
        set(catalog) != catalog_fields
        or not counts_valid
        or not isinstance(catalog.get("installModuleCount"), int)
        or isinstance(catalog.get("installModuleCount"), bool)
        or catalog.get("installModuleCount", 0) <= 0
        or not skills_valid
        or catalog.get("curatedSkillsReferenced", 0) + catalog.get("intentionallyUnshippedSkills", 0) != catalog.get("filesystemSkills")
        or any(catalog.get(key) is not True for key in (
            "catalogCheckPassed", "commandRegistryCheckPassed", "manifestValidationPassed", "countsReconciled"
        ))
        or not isinstance(catalog.get("evidenceRefs"), list)
        or not catalog.get("evidenceRefs")
    ):
        faults = add_issue(faults, "catalog_reconciliation_failed", 3,
                  "Filesystem/documented counts, manifest coverage, intentional exceptions, catalog, and registry checks must reconcile.")
    return faults


def _validate_gates(observation: dict[str, Any], faults: list[dict[str, Any]]) -> list[dict[str, Any]]:
    validation = observation["validationMatrix"]
    validation_fields = {"gateId", "commandArgv", "expectedExit", "observedExit", "evidenceRefs"}
    if (
        len(validation) != 8
        or {item.get("gateId") for item in validation if isinstance(item, dict)} != GATES
        or any(
            not isinstance(item, dict)
            or set(item) != validation_fields
            or not isinstance(item.get("commandArgv"), list)
            or not item.get("commandArgv")
            or not all(isinstance(arg, str) and arg for arg in item.get("commandArgv", []))
            or item.get("expectedExit") != 0
            or item.get("observedExit") != 0
            or not isinstance(item.get("evidenceRefs"), list)
            or not item.get("evidenceRefs")
            for item in validation
        )
    ):
        faults = add_issue(faults, "validation_matrix_failed", 5,
                  "Eight exact argv gates must be recorded green with evidence references.")
    return faults


def _validate_tdd(observation: dict[str, Any], faults: list[dict[str, Any]]) -> list[dict[str, Any]]:
    tdd = observation["tddContract"]
    tdd_fields = {
        "redObserved", "failingTestIds", "greenObserved", "refactorObserved",
        "coverageThresholdPercent", "lineCoveragePercent", "functionCoveragePercent",
        "branchCoveragePercent", "statementCoveragePercent", "newBehaviorTestCount",
        "allTestsPass", "evidenceRefs", "counterevidenceRefs",
    }
    coverage_fields = (
        "lineCoveragePercent", "functionCoveragePercent", "branchCoveragePercent",
        "statementCoveragePercent",
    )
    if (
        set(tdd) != tdd_fields
        or any(tdd.get(key) is not True for key in ("redObserved", "greenObserved", "refactorObserved", "allTestsPass"))
        or not isinstance(tdd.get("failingTestIds"), list)
        or not tdd.get("failingTestIds")
        or tdd.get("coverageThresholdPercent") != 80
        or any(not is_finite_number(tdd.get(key)) or not 80 <= tdd.get(key) <= 100 for key in coverage_fields)
        or not isinstance(tdd.get("newBehaviorTestCount"), int)
        or isinstance(tdd.get("newBehaviorTestCount"), bool)
        or tdd.get("newBehaviorTestCount", 0) < 3
        or not isinstance(tdd.get("evidenceRefs"), list)
        or not tdd.get("evidenceRefs")
    ):
        faults = add_issue(faults, "tdd_contract_failed", 4,
                  "Observed RED/GREEN/REFACTOR, named failures, passing behavior tests, and at least 80 percent coverage are required.")
    return faults


def _validate_security(observation: dict[str, Any], faults: list[dict[str, Any]]) -> list[dict[str, Any]]:
    security = observation["securityContract"]
    security_fields = {
        "secretsDetected", "personalPathsDetected", "unsafePermissionsDetected",
        "hookChangesReviewed", "promptInjectionBoundaryReviewed", "supplyChainChangesReviewed",
        "untrustedContentCannotGrantAuthority", "evidenceRefs", "counterevidenceRefs",
    }
    if (
        set(security) != security_fields
        or any(security.get(key) is not False for key in (
            "secretsDetected", "personalPathsDetected", "unsafePermissionsDetected"
        ))
        or any(security.get(key) is not True for key in (
            "hookChangesReviewed", "promptInjectionBoundaryReviewed",
            "supplyChainChangesReviewed", "untrustedContentCannotGrantAuthority"
        ))
        or not isinstance(security.get("evidenceRefs"), list)
        or not security.get("evidenceRefs")
    ):
        faults = add_issue(faults, "security_contract_failed", 6,
                  "Secret, path, permission, hook, prompt-injection, supply-chain, and authority observations are required.")
    return faults


def _validate_budget(observation: dict[str, Any], faults: list[dict[str, Any]]) -> list[dict[str, Any]]:
    budget = observation["budgetContract"]
    budget_fields = {
        "maximumChangedFiles", "observedChangedFiles", "maximumChangedLines",
        "observedChangedLines", "maximumTestRuntimeSeconds", "observedTestRuntimeSeconds",
        "evidenceRefs",
    }
    budget_pairs = (
        ("observedChangedFiles", "maximumChangedFiles"),
        ("observedChangedLines", "maximumChangedLines"),
        ("observedTestRuntimeSeconds", "maximumTestRuntimeSeconds"),
    )
    if (
        set(budget) != budget_fields
        or any(
            not is_finite_number(budget.get(actual))
            or not is_finite_number(budget.get(limit))
            or budget.get(actual) < 0
            or budget.get(actual) > budget.get(limit)
            for actual, limit in budget_pairs
        )
        or not isinstance(budget.get("evidenceRefs"), list)
        or not budget.get("evidenceRefs")
    ):
        faults = add_issue(faults, "change_budget_failed", 6,
                  "Changed-file, changed-line, and test-runtime budgets must be nonnegative and bounded.")
    return faults


def _validate_commit(observation: dict[str, Any], faults: list[dict[str, Any]]) -> list[dict[str, Any]]:
    commit = observation["commitContract"]
    commit_fields = {
        "type", "scope", "subject", "subjectLength", "conventional", "commitCreated",
        "pushPerformed", "pullRequestOpened", "evidenceRefs", "counterevidenceRefs",
    }
    subject = commit.get("subject")
    if (
        set(commit) != commit_fields
        or commit.get("type") not in {"feat", "fix", "refactor", "docs", "test", "chore", "perf", "ci"}
        or commit.get("scope") != "skills"
        or not isinstance(subject, str)
        or not subject
        or commit.get("subjectLength") != len(subject)
        or len(subject) > 72
        or commit.get("conventional") is not True
        or any(commit.get(key) is not False for key in ("commitCreated", "pushPerformed", "pullRequestOpened"))
        or not isinstance(commit.get("evidenceRefs"), list)
        or not commit.get("evidenceRefs")
    ):
        faults = add_issue(faults, "commit_contract_failed", 6,
                  "A concise conventional commit proposal is required; commit, push, and PR effects must remain false.")
    return faults


def _validate_probes(observation: dict[str, Any], faults: list[dict[str, Any]]) -> list[dict[str, Any]]:
    probes = observation["failureProbes"]
    probe_fields = {"probeId", "failureMode", "expectedOutcome", "observedOutcome", "evidenceRefs"}
    if (
        len(probes) != 12
        or {item.get("failureMode") for item in probes if isinstance(item, dict) and isinstance(item.get("failureMode"), str)} != FAILURES
        or len({item.get("probeId") for item in probes if isinstance(item, dict) and isinstance(item.get("probeId"), str)}) != 12
        or any(
            not isinstance(item, dict)
            or set(item) != probe_fields
            or not isinstance(item.get("failureMode"), str)
            or not isinstance(item.get("probeId"), str)
            or item.get("expectedOutcome") != FAILURE_OUTCOMES.get(item.get("failureMode"))
            or item.get("observedOutcome") != item.get("expectedOutcome")
            or not isinstance(item.get("evidenceRefs"), list)
            or not item.get("evidenceRefs")
            for item in probes
        )
    ):
        faults = add_issue(faults, "failure_probe_coverage_failed", 5,
                  "All twelve ECC contribution probes must match expected outcomes and cite evidence.")
    return faults


def _validate_checkpoint(observation: dict[str, Any], faults: list[dict[str, Any]]) -> list[dict[str, Any]]:
    repo = observation["repoIdentity"]
    checkpoint = observation["checkpointContract"]
    checkpoint_fields = {
        "checkpointSha256", "repoHeadSha256", "policySha256", "lastDecisionId",
        "plannedRunnerCount", "statePathRef", "remainingUnknowns",
    }
    if (
        set(checkpoint) != checkpoint_fields
        or checkpoint.get("checkpointSha256") != repo.get("checkpointSha256")
        or checkpoint.get("repoHeadSha256") != repo.get("headSha256")
        or checkpoint.get("policySha256") != repo.get("skillPolicySha256")
        or not checkpoint.get("lastDecisionId")
        or checkpoint.get("plannedRunnerCount") != 7
        or not isinstance(checkpoint.get("statePathRef"), str)
        or not checkpoint.get("statePathRef", "").startswith(".memory-kit/")
        or not isinstance(checkpoint.get("remainingUnknowns"), list)
        or not checkpoint.get("remainingUnknowns")
    ):
        faults = add_issue(faults, "checkpoint_contract_failed", 5,
                  "Exact repository, policy, checkpoint, runner, state, and unknown identities are required.")
    return faults


def _validate_runners(observation: dict[str, Any], faults: list[dict[str, Any]]) -> list[dict[str, Any]]:
    runners = observation["runnerProposals"]
    runner_fields = {"role", "argv"}
    if (
        len(runners) != 7
        or {item.get("role") for item in runners if isinstance(item, dict)} != RUNNERS
        or any(
            not isinstance(item, dict)
            or set(item) != runner_fields
            or not isinstance(item.get("argv"), list)
            or not item.get("argv")
            or not all(isinstance(arg, str) and arg for arg in item.get("argv", []))
            for item in runners
        )
    ):
        faults = add_issue(faults, "runner_proposals_invalid", 5,
                  "Seven typed non-shell argv proposals are required.")
    return faults


def _validate_authority(observation: dict[str, Any], contradictions: list[dict[str, Any]]) -> list[dict[str, Any]]:
    forbidden_claims = (
        ("claimsSourceFilesWrittenByController", "file_write_claim_forbidden"),
        ("claimsTestsExecutedByController", "test_execution_claim_forbidden"),
        ("claimsCatalogUpdatedByController", "catalog_write_claim_forbidden"),
        ("claimsCommitCreated", "commit_claim_forbidden"),
        ("claimsPushPerformed", "push_claim_forbidden"),
        ("claimsPullRequestOpened", "pull_request_claim_forbidden"),
    )
    for field, code in forbidden_claims:
        if observation.get(field) is not False:
            contradictions = add_issue(
                contradictions, code, 2,
                "The compiler cannot claim repository or external effects.",
            )
    requested_effects = observation.get("requestedEffects")
    if not isinstance(requested_effects, dict) or set(requested_effects) != EFFECT_FIELDS or any(
        value is not False for value in requested_effects.values()
    ):
        contradictions = add_issue(
            contradictions, "external_action_requested", 6,
            "Compilation cannot request source, test, catalog, Git, PR, or memory effects.",
        )
    claimed_authority = observation.get("claimedAuthority")
    if not isinstance(claimed_authority, dict) or set(claimed_authority) != AUTHORITY_FIELDS or any(
        value is not False for value in claimed_authority.values()
    ):
        contradictions = add_issue(
            contradictions, "unsafe_generated_authority", 6,
            "Generated authority must remain false.",
        )
    return contradictions


def _valid_timestamp(value: Any) -> bool:
    if not isinstance(value, str) or not re.fullmatch(
        r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)", value
    ):
        return False
    try:
        stamp = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return False
    return stamp.tzinfo is not None and stamp.utcoffset() is not None


def _valid_envelope(observation: Any, faults: list[dict[str, Any]]) -> tuple[bool, list[dict[str, Any]]]:
    required = {
        "schemaVersion", "observedAt", "subjectRef", "repoIdentity", "changeIntent",
        "surfaceContract", "artifactRecords", "harnessParity", "catalogContract",
        "validationMatrix", "tddContract", "securityContract", "budgetContract",
        "commitContract", "failureProbes", "checkpointContract", "runnerProposals",
        "claimsSourceFilesWrittenByController", "claimsTestsExecutedByController",
        "claimsCatalogUpdatedByController", "claimsCommitCreated", "claimsPushPerformed",
        "claimsPullRequestOpened", "requestedEffects", "claimedAuthority",
    }
    if not isinstance(observation, dict) or not required.issubset(observation):
        faults = add_issue(faults, "observation_envelope_incomplete", 1,
                  "Required ECC contribution observations are missing.")
        return False, faults

    if observation.get("schemaVersion") != "1.0.0":
        faults = add_issue(faults, "schema_version_unsupported", 1, "Only schema version 1.0.0 is supported.")
    if not _valid_timestamp(observation.get("observedAt")):
        faults = add_issue(faults, "observed_at_invalid", 1, "An ISO 8601 observation timestamp with a timezone is required.")
    subject = observation.get("subjectRef")
    if not isinstance(subject, str) or not subject.strip():
        faults = add_issue(faults, "subject_ref_invalid", 1, "A nonempty subject reference string is required.")

    map_fields = (
        "repoIdentity", "changeIntent", "surfaceContract", "harnessParity",
        "catalogContract", "tddContract", "securityContract", "budgetContract",
        "commitContract", "checkpointContract", "requestedEffects", "claimedAuthority",
    )
    list_fields = ("artifactRecords", "validationMatrix", "failureProbes", "runnerProposals")
    if any(not isinstance(observation[field], dict) for field in map_fields) or any(
        not isinstance(observation[field], list) for field in list_fields
    ):
        faults = add_issue(faults, "observation_shape_invalid", 1,
                  "Declared maps and arrays must retain their documented shapes.")
        return False, faults
    return True, faults


def validate(observation: Any) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """Retain independent diagnostics even when one untrusted section is malformed."""
    valid_envelope, faults = _valid_envelope(observation, [])
    contradictions = _validate_authority(observation, []) if isinstance(observation, dict) else []
    if not valid_envelope:
        return faults, contradictions
    validators = (
        _validate_repo, _validate_intent, _validate_surface, _validate_artifacts,
        _validate_parity, _validate_catalog, _validate_gates, _validate_tdd,
        _validate_security, _validate_budget, _validate_commit, _validate_probes,
        _validate_checkpoint, _validate_runners,
    )
    for validator in validators:
        try:
            faults = validator(observation, faults)
        except (AttributeError, TypeError, ValueError):
            faults = add_issue(
                faults, "observation_shape_invalid", 1,
                "Observation values must match the documented JSON types.",
            )
    return faults, contradictions
