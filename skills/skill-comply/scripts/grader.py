"""Grade observation traces against compliance specs using LLM classification."""

from __future__ import annotations

from dataclasses import dataclass, replace

from scripts.classifier import classify_events
from scripts.parser import ComplianceSpec, ObservationEvent, Step


@dataclass(frozen=True)
class StepResult:
    step_id: str
    detected: bool
    evidence: tuple[ObservationEvent, ...]
    failure_reason: str | None


@dataclass(frozen=True)
class ComplianceResult:
    spec_id: str
    steps: tuple[StepResult, ...]
    compliance_rate: float
    recommend_hook_promotion: bool
    classification: dict[str, list[int]]


def _check_temporal_order(
    step: Step,
    event: ObservationEvent,
    resolved: dict[str, list[ObservationEvent]],
    classified: dict[str, list[ObservationEvent]],
    graded: set[str],
) -> str | None:
    """Check before_step/after_step constraints. Returns failure reason or None."""
    if step.detector.after_step is not None:
        after_step = step.detector.after_step
        after_events = resolved.get(after_step)
        if after_events is None:
            if after_step in graded:
                # Graded and missing from `resolved` means it failed its own checks.
                # Its classified events are not evidence for anything: reusing them
                # here let a dependant pass on the strength of a failed prerequisite,
                # and the overstatement carried down the whole chain.
                return f"after_step '{after_step}' did not pass its own checks"
            # Not graded yet, so this is a forward reference to a step declared later.
            # The classifier's own output is the only thing available, and using it is
            # what makes an out-of-order declaration work.
            after_events = classified.get(after_step, [])
        if not after_events:
            return f"after_step '{after_step}' not yet detected"
        latest_after = max(e.timestamp for e in after_events)
        if event.timestamp <= latest_after:
            return (
                f"must occur after '{after_step}' "
                f"(last at {latest_after}), but found at {event.timestamp}"
            )

    if step.detector.before_step is not None:
        # Look ahead using LLM classification results. A failed reference step is NOT
        # excluded here the way it is above: the two fall in opposite directions. An
        # `after_step` fallback can only turn a failure into a pass, while a
        # `before_step` one can only turn a pass into a failure, so dropping it would
        # relax a constraint because some other step failed.
        before_events = resolved.get(step.detector.before_step)
        if before_events is None:
            before_events = classified.get(step.detector.before_step, [])
        if before_events:
            earliest_before = min(e.timestamp for e in before_events)
            if event.timestamp >= earliest_before:
                return (
                    f"must occur before '{step.detector.before_step}' "
                    f"(first at {earliest_before}), but found at {event.timestamp}"
                )

    return None


def _demote_steps_resting_on_failures(
    step_results: tuple[StepResult, ...],
    after_steps: dict[str, str],
) -> tuple[StepResult, ...]:
    """Undo passes that rest on an `after_step` which ended up failing.

    A step declared before its prerequisite is graded against the classifier's raw
    events for that step, because `resolved` has nothing for it yet. That fallback is
    what makes an out-of-order declaration work, but the prerequisite can go on to
    fail its own checks, and then the dependant is left passing on evidence that
    never held. Repeat until nothing changes: demoting one step can invalidate
    whatever depended on it, whichever order the two were declared in. Demotion only
    ever removes passes, so the loop terminates.
    """
    results = step_results
    while True:
        failed = {result.step_id for result in results if not result.detected}
        demote = {
            result.step_id
            for result in results
            if result.detected and after_steps.get(result.step_id) in failed
        }
        if not demote:
            return results
        results = tuple(
            replace(
                result,
                detected=False,
                evidence=(),
                failure_reason=(
                    f"after_step '{after_steps[result.step_id]}' "
                    "did not pass its own checks"
                ),
            )
            if result.step_id in demote
            else result
            for result in results
        )


def grade(
    spec: ComplianceSpec,
    trace: list[ObservationEvent],
    classifier_model: str = "haiku",
) -> ComplianceResult:
    """Grade a trace against a compliance spec using LLM classification."""
    sorted_trace = sorted(trace, key=lambda e: e.timestamp)

    # Step 1: LLM classifies all events in one batch call
    classification = classify_events(spec, sorted_trace, model=classifier_model)

    # Convert indices to events
    classified: dict[str, list[ObservationEvent]] = {
        step_id: [sorted_trace[i] for i in indices if 0 <= i < len(sorted_trace)]
        for step_id, indices in classification.items()
    }

    # Step 2: Check temporal ordering (deterministic)
    resolved: dict[str, list[ObservationEvent]] = {}
    # Steps already graded, pass or fail. `resolved` alone cannot tell "failed" from
    # "not reached yet", and those need opposite answers in `_check_temporal_order`.
    graded: set[str] = set()
    step_results: list[StepResult] = []

    for step in spec.steps:
        candidates = classified.get(step.id, [])
        matched: list[ObservationEvent] = []
        failure_reason: str | None = None

        for event in candidates:
            temporal_fail = _check_temporal_order(step, event, resolved, classified, graded)
            if temporal_fail is None:
                matched.append(event)
                break
            else:
                failure_reason = temporal_fail

        detected = len(matched) > 0
        if detected:
            resolved[step.id] = matched
        elif failure_reason is None:
            failure_reason = f"no matching event classified for step '{step.id}'"

        graded = graded | {step.id}
        step_results.append(StepResult(
            step_id=step.id,
            detected=detected,
            evidence=tuple(matched),
            failure_reason=failure_reason if not detected else None,
        ))

    # `graded` catches a prerequisite that had already failed when its dependant was
    # graded. The other direction needs a second pass: a dependant declared first is
    # graded against the classifier's raw events for a prerequisite that has not run
    # yet, and only later does that prerequisite fail.
    after_steps = {
        step.id: step.detector.after_step
        for step in spec.steps
        if step.detector.after_step is not None
    }
    resolved_results = _demote_steps_resting_on_failures(tuple(step_results), after_steps)

    required_ids = {s.id for s in spec.steps if s.required}
    required_steps = [s for s in resolved_results if s.step_id in required_ids]
    detected_required = sum(1 for s in required_steps if s.detected)
    total_required = len(required_steps)

    compliance_rate = detected_required / total_required if total_required > 0 else 0.0

    return ComplianceResult(
        spec_id=spec.id,
        steps=resolved_results,
        compliance_rate=compliance_rate,
        recommend_hook_promotion=compliance_rate < spec.threshold_promote_to_hook,
        classification=classification,
    )
