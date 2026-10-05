"""Tests for grader module — compliance scoring with LLM classification."""

from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

from scripts.grader import ComplianceResult, StepResult, grade
from scripts.parser import ComplianceSpec, Detector, ObservationEvent, Step, parse_spec, parse_trace

FIXTURES = Path(__file__).parent.parent / "fixtures"


@pytest.fixture
def tdd_spec():
    return parse_spec(FIXTURES / "tdd_spec.yaml")


@pytest.fixture
def compliant_trace():
    return parse_trace(FIXTURES / "compliant_trace.jsonl")


@pytest.fixture
def noncompliant_trace():
    return parse_trace(FIXTURES / "noncompliant_trace.jsonl")


def _mock_compliant_classification(spec, trace, model="haiku"):  # noqa: ARG001
    """Simulate LLM correctly classifying a compliant trace."""
    return {
        "write_test": [0],
        "run_test_red": [1],
        "write_impl": [2],
        "run_test_green": [3],
        "refactor": [4],
    }


def _mock_noncompliant_classification(spec, trace, model="haiku"):
    """Simulate LLM classifying a noncompliant trace (impl before test)."""
    return {
        "write_impl": [0],    # src/fib.py written first
        "write_test": [1],    # test written second
        "run_test_green": [2],  # only a passing test run
    }


def _mock_empty_classification(spec, trace, model="haiku"):
    return {}


class TestGradeCompliant:
    @patch("scripts.grader.classify_events", side_effect=_mock_compliant_classification)
    def test_returns_compliance_result(self, mock_cls, tdd_spec, compliant_trace) -> None:
        result = grade(tdd_spec, compliant_trace)
        assert isinstance(result, ComplianceResult)

    @patch("scripts.grader.classify_events", side_effect=_mock_compliant_classification)
    def test_full_compliance(self, mock_cls, tdd_spec, compliant_trace) -> None:
        result = grade(tdd_spec, compliant_trace)
        assert result.compliance_rate == 1.0

    @patch("scripts.grader.classify_events", side_effect=_mock_compliant_classification)
    def test_all_required_steps_detected(self, mock_cls, tdd_spec, compliant_trace) -> None:
        result = grade(tdd_spec, compliant_trace)
        required_results = [s for s in result.steps if s.step_id in
                           ("write_test", "run_test_red", "write_impl", "run_test_green")]
        assert all(s.detected for s in required_results)

    @patch("scripts.grader.classify_events", side_effect=_mock_compliant_classification)
    def test_optional_step_detected(self, mock_cls, tdd_spec, compliant_trace) -> None:
        result = grade(tdd_spec, compliant_trace)
        refactor = next(s for s in result.steps if s.step_id == "refactor")
        assert refactor.detected is True

    @patch("scripts.grader.classify_events", side_effect=_mock_compliant_classification)
    def test_no_hook_promotion_recommended(self, mock_cls, tdd_spec, compliant_trace) -> None:
        result = grade(tdd_spec, compliant_trace)
        assert result.recommend_hook_promotion is False

    @patch("scripts.grader.classify_events", side_effect=_mock_compliant_classification)
    def test_step_evidence_not_empty(self, mock_cls, tdd_spec, compliant_trace) -> None:
        result = grade(tdd_spec, compliant_trace)
        for step in result.steps:
            if step.detected:
                assert len(step.evidence) > 0


class TestGradeNoncompliant:
    @patch("scripts.grader.classify_events", side_effect=_mock_noncompliant_classification)
    def test_low_compliance(self, mock_cls, tdd_spec, noncompliant_trace) -> None:
        result = grade(tdd_spec, noncompliant_trace)
        assert result.compliance_rate < 1.0

    @patch("scripts.grader.classify_events", side_effect=_mock_noncompliant_classification)
    def test_write_test_fails_ordering(self, mock_cls, tdd_spec, noncompliant_trace) -> None:
        """write_test has before_step=write_impl, but test is written AFTER impl."""
        result = grade(tdd_spec, noncompliant_trace)
        write_test = next(s for s in result.steps if s.step_id == "write_test")
        assert write_test.detected is False

    @patch("scripts.grader.classify_events", side_effect=_mock_noncompliant_classification)
    def test_run_test_red_not_detected(self, mock_cls, tdd_spec, noncompliant_trace) -> None:
        result = grade(tdd_spec, noncompliant_trace)
        run_red = next(s for s in result.steps if s.step_id == "run_test_red")
        assert run_red.detected is False

    @patch("scripts.grader.classify_events", side_effect=_mock_noncompliant_classification)
    def test_hook_promotion_recommended(self, mock_cls, tdd_spec, noncompliant_trace) -> None:
        result = grade(tdd_spec, noncompliant_trace)
        assert result.recommend_hook_promotion is True

    @patch("scripts.grader.classify_events", side_effect=_mock_noncompliant_classification)
    def test_failure_reasons_present(self, mock_cls, tdd_spec, noncompliant_trace) -> None:
        result = grade(tdd_spec, noncompliant_trace)
        failed_steps = [s for s in result.steps if not s.detected and s.step_id != "refactor"]
        for step in failed_steps:
            assert step.failure_reason is not None


class TestGradeEdgeCases:
    @patch("scripts.grader.classify_events", side_effect=_mock_empty_classification)
    def test_empty_trace(self, mock_cls, tdd_spec) -> None:
        result = grade(tdd_spec, [])
        assert result.compliance_rate == 0.0
        assert result.recommend_hook_promotion is True

    @patch("scripts.grader.classify_events", side_effect=_mock_compliant_classification)
    def test_compliance_rate_is_ratio_of_required_only(self, mock_cls, tdd_spec, compliant_trace) -> None:
        result = grade(tdd_spec, compliant_trace)
        assert result.compliance_rate == 1.0

    @patch("scripts.grader.classify_events", side_effect=_mock_compliant_classification)
    def test_spec_id_in_result(self, mock_cls, tdd_spec, compliant_trace) -> None:
        result = grade(tdd_spec, compliant_trace)
        assert result.spec_id == "tdd-workflow"

    @patch("scripts.grader.classify_events")
    def test_after_step_can_reference_later_declared_spec_step(self, mock_cls: MagicMock) -> None:
        spec = ComplianceSpec(
            id="out-of-order-after-step",
            name="Out of order after_step",
            source_rule="rules/common/testing.md",
            version="1.0",
            steps=(
                Step(
                    id="step_a",
                    description="Occurs after step_b even though it is declared first",
                    required=True,
                    detector=Detector(
                        description="Event A",
                        after_step="step_b",
                    ),
                ),
                Step(
                    id="step_b",
                    description="Reference step declared later",
                    required=True,
                    detector=Detector(
                        description="Event B",
                    ),
                ),
            ),
            threshold_promote_to_hook=0.5,
        )
        trace = [
            ObservationEvent(
                timestamp="2026-03-20T10:00:01Z",
                event="tool_complete",
                tool="Write",
                session="sess-order",
                input='{"file_path":"src/b.py"}',
                output="step b",
            ),
            ObservationEvent(
                timestamp="2026-03-20T10:00:02Z",
                event="tool_complete",
                tool="Write",
                session="sess-order",
                input='{"file_path":"src/a.py"}',
                output="step a",
            ),
        ]
        mock_cls.return_value = {
            "step_a": [1],
            "step_b": [0],
        }

        result = grade(spec, trace)

        step_a = next(step for step in result.steps if step.step_id == "step_a")
        step_b = next(step for step in result.steps if step.step_id == "step_b")
        assert step_a.detected is True
        assert step_a.failure_reason is None
        assert step_b.detected is True
        assert result.compliance_rate == 1.0

    @patch("scripts.grader.classify_events")
    def test_after_step_does_not_reuse_a_step_that_failed_its_own_constraint(
        self, mock_cls: MagicMock
    ) -> None:
        """A step that failed may not supply evidence to a step that depends on it (#3108).

        `resolved` only receives a step once it passes, so a dependant fell back to the
        raw classifier output and could pass on an event belonging to a failed parent.
        The fallback exists for forward references, which the case above covers; a
        parent that has already been graded and failed is a different thing.
        """
        spec = ComplianceSpec(
            id="failed-parent-evidence",
            name="Failed parent evidence",
            source_rule="rules/common/testing.md",
            version="1.0",
            steps=(
                Step(
                    id="C",
                    description="Reference step with no constraint of its own",
                    required=True,
                    detector=Detector(description="Event C"),
                ),
                Step(
                    id="A",
                    description="Must occur before C, and does not",
                    required=True,
                    detector=Detector(description="Event A", before_step="C"),
                ),
                Step(
                    id="B",
                    description="Depends on A",
                    required=True,
                    detector=Detector(description="Event B", after_step="A"),
                ),
            ),
            threshold_promote_to_hook=0.5,
        )
        trace = [
            ObservationEvent(
                timestamp=f"2026-03-20T10:00:0{index}Z",
                event="tool_complete",
                tool="Write",
                session="sess-evidence",
                input=f'{{"file_path":"src/{name}.py"}}',
                output=f"step {name}",
            )
            for index, name in enumerate(("c", "a", "b"))
        ]
        mock_cls.return_value = {"C": [0], "A": [1], "B": [2]}

        result = grade(spec, trace)

        detected = {step.step_id: step.detected for step in result.steps}
        assert detected["C"] is True
        assert detected["A"] is False
        assert detected["B"] is False
        assert result.compliance_rate == pytest.approx(1 / 3)
        step_b = next(step for step in result.steps if step.step_id == "B")
        assert "A" in (step_b.failure_reason or "")

    @patch("scripts.grader.classify_events")
    def test_a_failed_prerequisite_does_not_carry_a_chain_of_passes(
        self, mock_cls: MagicMock
    ) -> None:
        """The overstatement compounds: B on A, C on B, D on C (#3108).

        Each link used to pass on the classifier's raw output for the link above it, so
        one failed prerequisite could leave a four-step workflow reading 3/4 compliant.
        """
        steps = (
            Step(
                id="Z",
                description="Reference step with no constraint of its own",
                required=True,
                detector=Detector(description="Event Z"),
            ),
            Step(
                id="A",
                description="Must occur before Z, and does not",
                required=True,
                detector=Detector(description="Event A", before_step="Z"),
            ),
            *(
                Step(
                    id=later,
                    description=f"Depends on {earlier}",
                    required=True,
                    detector=Detector(description=f"Event {later}", after_step=earlier),
                )
                for earlier, later in (("A", "B"), ("B", "C"), ("C", "D"))
            ),
        )
        spec = ComplianceSpec(
            id="failed-prerequisite-chain",
            name="Failed prerequisite chain",
            source_rule="rules/common/testing.md",
            version="1.0",
            steps=steps,
            threshold_promote_to_hook=0.5,
        )
        names = ("z", "a", "b", "c", "d")
        trace = [
            ObservationEvent(
                timestamp=f"2026-03-20T10:00:0{index}Z",
                event="tool_complete",
                tool="Write",
                session="sess-chain",
                input=f'{{"file_path":"src/{name}.py"}}',
                output=f"step {name}",
            )
            for index, name in enumerate(names)
        ]
        mock_cls.return_value = {"Z": [0], "A": [1], "B": [2], "C": [3], "D": [4]}

        result = grade(spec, trace)

        detected = {step.step_id: step.detected for step in result.steps}
        assert detected == {"Z": True, "A": False, "B": False, "C": False, "D": False}
        assert result.compliance_rate == pytest.approx(1 / 5)

    @patch("scripts.grader.classify_events")
    def test_forward_reference_is_revoked_when_the_prerequisite_later_fails(
        self, mock_cls: MagicMock
    ) -> None:
        """The mirror image of the case above, raised in review of #3109.

        `graded` only catches a prerequisite that had already failed. A step declared
        *before* its prerequisite is graded against the classifier's raw events for a
        step that has not run yet — the fallback that makes an out-of-order
        declaration work — and nothing revisited it once that step failed.
        """
        spec = ComplianceSpec(
            id="forward-reference-revoked",
            name="Forward reference revoked",
            source_rule="rules/common/testing.md",
            version="1.0",
            steps=(
                Step(
                    id="Z",
                    description="Reference step with no constraint of its own",
                    required=True,
                    detector=Detector(description="Event Z"),
                ),
                Step(
                    id="B",
                    description="Depends on A, which is declared after it",
                    required=True,
                    detector=Detector(description="Event B", after_step="A"),
                ),
                Step(
                    id="A",
                    description="Must occur before Z, and does not",
                    required=True,
                    detector=Detector(description="Event A", before_step="Z"),
                ),
            ),
            threshold_promote_to_hook=0.5,
        )
        trace = [
            ObservationEvent(
                timestamp=f"2026-03-20T10:00:0{index}Z",
                event="tool_complete",
                tool="Write",
                session="sess-forward",
                input=f'{{"file_path":"src/{name}.py"}}',
                output=f"step {name}",
            )
            for index, name in enumerate(("z", "a", "b"))
        ]
        mock_cls.return_value = {"Z": [0], "A": [1], "B": [2]}

        result = grade(spec, trace)

        detected = {step.step_id: step.detected for step in result.steps}
        assert detected == {"Z": True, "A": False, "B": False}
        assert result.compliance_rate == pytest.approx(1 / 3)
        step_b = next(step for step in result.steps if step.step_id == "B")
        assert step_b.evidence == ()
        assert "A" in (step_b.failure_reason or "")

    @patch("scripts.grader.classify_events")
    def test_revocation_reaches_a_step_that_referenced_the_dependant_backwards(
        self, mock_cls: MagicMock
    ) -> None:
        """One demotion invalidates the next, in either declaration order.

        C is declared after B and passes on `resolved`, the ordinary backward
        reference — B was still detected at the time. B is the forward-reference case
        above and comes down with A, so C has to follow, which takes a second pass.
        """
        spec = ComplianceSpec(
            id="revocation-propagates",
            name="Revocation propagates",
            source_rule="rules/common/testing.md",
            version="1.0",
            steps=(
                Step(
                    id="Z",
                    description="Reference step with no constraint of its own",
                    required=True,
                    detector=Detector(description="Event Z"),
                ),
                Step(
                    id="B",
                    description="Depends on A, which is declared after it",
                    required=True,
                    detector=Detector(description="Event B", after_step="A"),
                ),
                Step(
                    id="A",
                    description="Must occur before Z, and does not",
                    required=True,
                    detector=Detector(description="Event A", before_step="Z"),
                ),
                Step(
                    id="C",
                    description="Depends on B, which is declared before it",
                    required=True,
                    detector=Detector(description="Event C", after_step="B"),
                ),
            ),
            threshold_promote_to_hook=0.5,
        )
        trace = [
            ObservationEvent(
                timestamp=f"2026-03-20T10:00:0{index}Z",
                event="tool_complete",
                tool="Write",
                session="sess-propagate",
                input=f'{{"file_path":"src/{name}.py"}}',
                output=f"step {name}",
            )
            for index, name in enumerate(("z", "a", "b", "c"))
        ]
        mock_cls.return_value = {"Z": [0], "A": [1], "B": [2], "C": [3]}

        result = grade(spec, trace)

        detected = {step.step_id: step.detected for step in result.steps}
        assert detected == {"Z": True, "A": False, "B": False, "C": False}
        assert result.compliance_rate == pytest.approx(1 / 4)
        step_c = next(step for step in result.steps if step.step_id == "C")
        assert "B" in (step_c.failure_reason or "")
