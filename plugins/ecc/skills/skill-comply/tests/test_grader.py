"""Tests for grader module — compliance scoring with LLM classification."""

from pathlib import Path
from unittest.mock import patch

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
    def test_after_step_can_reference_later_declared_spec_step(self, mock_cls) -> None:
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
