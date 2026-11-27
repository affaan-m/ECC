"""Tests for parser module — JSONL trace and YAML spec parsing."""

from pathlib import Path

import pytest

from scripts.parser import (
    ComplianceSpec,
    Detector,
    ObservationEvent,
    Step,
    parse_spec,
    parse_trace,
)

FIXTURES = Path(__file__).parent.parent / "fixtures"


class TestParseTrace:
    def test_parses_compliant_trace(self) -> None:
        events = parse_trace(FIXTURES / "compliant_trace.jsonl")
        assert len(events) == 5
        assert all(isinstance(e, ObservationEvent) for e in events)

    def test_events_sorted_by_timestamp(self) -> None:
        events = parse_trace(FIXTURES / "compliant_trace.jsonl")
        timestamps = [e.timestamp for e in events]
        assert timestamps == sorted(timestamps)

    def test_event_fields(self) -> None:
        events = parse_trace(FIXTURES / "compliant_trace.jsonl")
        first = events[0]
        assert first.tool == "Write"
        assert first.session == "sess-001"
        assert "test_fib.py" in first.input
        assert first.output == "File created"

    def test_parses_noncompliant_trace(self) -> None:
        events = parse_trace(FIXTURES / "noncompliant_trace.jsonl")
        assert len(events) == 3
        assert "src/fib.py" in events[0].input

    def test_empty_file_returns_empty_list(self, tmp_path: Path) -> None:
        empty = tmp_path / "empty.jsonl"
        empty.write_text("")
        events = parse_trace(empty)
        assert events == []

    def test_nonexistent_file_raises(self) -> None:
        with pytest.raises(FileNotFoundError):
            parse_trace(Path("/nonexistent/trace.jsonl"))


class TestParseSpec:
    def test_parses_tdd_spec(self) -> None:
        spec = parse_spec(FIXTURES / "tdd_spec.yaml")
        assert isinstance(spec, ComplianceSpec)
        assert spec.id == "tdd-workflow"
        assert len(spec.steps) == 5

    def test_step_fields(self) -> None:
        spec = parse_spec(FIXTURES / "tdd_spec.yaml")
        first = spec.steps[0]
        assert isinstance(first, Step)
        assert first.id == "write_test"
        assert first.required is True
        assert isinstance(first.detector, Detector)
        assert "test file" in first.detector.description
        assert first.detector.before_step == "write_impl"

    def test_optional_detector_fields(self) -> None:
        spec = parse_spec(FIXTURES / "tdd_spec.yaml")
        write_test = spec.steps[0]
        assert write_test.detector.after_step is None

        run_test_red = spec.steps[1]
        assert run_test_red.detector.after_step == "write_test"
        assert run_test_red.detector.before_step == "write_impl"

    def test_scoring_threshold(self) -> None:
        spec = parse_spec(FIXTURES / "tdd_spec.yaml")
        assert spec.threshold_promote_to_hook == 0.6

    def test_required_vs_optional_steps(self) -> None:
        spec = parse_spec(FIXTURES / "tdd_spec.yaml")
        required = [s for s in spec.steps if s.required]
        optional = [s for s in spec.steps if not s.required]
        assert len(required) == 4
        assert len(optional) == 1
        assert optional[0].id == "refactor"
