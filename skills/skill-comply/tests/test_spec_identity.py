"""Specification identities must be unambiguous before grading starts."""

from __future__ import annotations

import subprocess
from pathlib import Path
from typing import Any

import pytest
import yaml
from scripts import grader, spec_generator
from scripts.parser import ComplianceSpec, ObservationEvent, parse_spec


def _step(step_id: object, **references: object) -> dict[str, Any]:
    return {
        "id": step_id,
        "description": "A required action",
        "required": True,
        "detector": {"description": "Look for the action", **references},
    }


def _document(*steps: dict[str, Any]) -> str:
    return yaml.safe_dump(
        {
            "id": "identity",
            "name": "Identity",
            "source_rule": "Local test",
            "version": "1",
            "steps": list(steps),
            "scoring": {"threshold_promote_to_hook": 0.6},
        }
    )


def _write_spec(tmp_path: Path, *steps: dict[str, Any]) -> Path:
    path = tmp_path / "spec.yaml"
    path.write_text(_document(*steps), encoding="utf-8")
    return path


@pytest.mark.unit
@pytest.mark.parametrize("step_id", ["", " \t", None, 1, True, [], {}])
def test_step_id_must_be_a_nonempty_string(tmp_path: Path, step_id: object) -> None:
    path = _write_spec(tmp_path, _step(step_id))
    with pytest.raises(ValueError, match="id must be a non-empty string"):
        parse_spec(path)


@pytest.mark.unit
@pytest.mark.parametrize("step_id", ["write_test", "检查"])
def test_step_ids_must_be_unique(tmp_path: Path, step_id: str) -> None:
    path = _write_spec(tmp_path, _step(step_id), _step(step_id))
    with pytest.raises(ValueError, match="Duplicate step id"):
        parse_spec(path)


@pytest.mark.unit
@pytest.mark.parametrize("constraint", ["after_step", "before_step"])
@pytest.mark.parametrize("reference", ["missing", "", " ", 1, True, [], {}])
def test_temporal_reference_must_name_a_declared_step(
    tmp_path: Path,
    constraint: str,
    reference: object,
) -> None:
    path = _write_spec(
        tmp_path, _step("first", **{constraint: reference}), _step("second")
    )
    with pytest.raises(
        ValueError, match=rf"{constraint} must reference a declared step id"
    ):
        parse_spec(path)


@pytest.mark.unit
@pytest.mark.parametrize("reverse", [False, True])
def test_forward_and_backward_references_preserve_declaration_order(
    tmp_path: Path,
    reverse: bool,
) -> None:
    steps = [_step("first", before_step="second"), _step("second", after_step="first")]
    if reverse:
        steps.reverse()
    spec = parse_spec(_write_spec(tmp_path, *steps))
    assert [step.id for step in spec.steps] == [step["id"] for step in steps]
    assert {step.id: step.detector.after_step for step in spec.steps} == {
        "first": None,
        "second": "first",
    }
    assert {step.id: step.detector.before_step for step in spec.steps} == {
        "first": "second",
        "second": None,
    }


@pytest.mark.unit
def test_null_references_and_distinct_ids_are_preserved(tmp_path: Path) -> None:
    spec = parse_spec(
        _write_spec(
            tmp_path,
            _step("check", after_step=None, before_step=None),
            _step("Check"),
            _step("检查"),
        )
    )
    assert [step.id for step in spec.steps] == ["check", "Check", "检查"]
    assert all(step.detector.before_step is None for step in spec.steps)
    assert all(step.detector.after_step is None for step in spec.steps)


def _mock_generation(
    monkeypatch: pytest.MonkeyPatch,
    responses: list[str],
) -> list[str]:
    prompts: list[str] = []

    def generate(args: list[str], **kwargs: Any) -> subprocess.CompletedProcess[str]:
        assert args == ["claude", "-p", "--model", "haiku", "--output-format", "text"]
        prompts.append(kwargs["input"])
        return subprocess.CompletedProcess(args, 0, responses[len(prompts) - 1], "")

    monkeypatch.setattr(spec_generator.subprocess, "run", generate)
    return prompts


@pytest.mark.unit
@pytest.mark.parametrize("invalid_kind", ["duplicate", "dangling"])
def test_generation_repairs_identity_before_it_can_inflate_the_score(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    invalid_kind: str,
) -> None:
    skill = tmp_path / "SKILL.md"
    skill.write_text("Write a test before the implementation.", encoding="utf-8")
    if invalid_kind == "duplicate":
        test_step = {**_step("write_test"), "description": "Write a regression test"}
        impl_step = {**_step("write_impl"), "description": "Implement the feature"}
        invalid = _document(test_step, {**impl_step, "id": "write_test"})
        corrected = _document(test_step, impl_step)
        classification = {"write_test": [0], "write_impl": []}
        expected_error = "Duplicate step id"
    else:
        invalid = _document(
            _step("write_test", before_step="typo"), _step("write_impl")
        )
        corrected = _document(
            _step("write_test", before_step="write_impl"), _step("write_impl")
        )
        classification = {"write_test": [1], "write_impl": [0]}
        expected_error = "before_step must reference a declared step id"
    prompts = _mock_generation(monkeypatch, [invalid, corrected])
    monkeypatch.setattr(
        grader, "classify_events", lambda *args, **kwargs: classification
    )

    spec = spec_generator.generate_spec(skill, max_retries=1)
    trace = [
        ObservationEvent(
            "T0000", "tool_complete", "Write", "local", "first action", "done"
        ),
        ObservationEvent(
            "T0001", "tool_complete", "Write", "local", "second action", "done"
        ),
    ]
    result = grader.grade(spec, trace)

    # The ambiguous original specifications both report 100% for this evidence.
    assert result.compliance_rate == 0.5
    assert result.recommend_hook_promotion
    assert len(prompts) == 2
    assert expected_error in prompts[1]


@pytest.mark.unit
@pytest.mark.parametrize("max_retries", [0, 2])
def test_invalid_identity_retries_remain_bounded_and_clean_up_temp_files(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    max_retries: int,
) -> None:
    skill = tmp_path / "SKILL.md"
    skill.write_text("Perform two different actions.", encoding="utf-8")
    invalid = _document(_step("repeated"), _step("repeated"))
    prompts = _mock_generation(monkeypatch, [invalid] * (max_retries + 1))
    created: list[Path] = []
    real_parse = spec_generator.parse_spec

    def record_path(path: Path) -> ComplianceSpec:
        created.append(path)
        return real_parse(path)

    monkeypatch.setattr(spec_generator, "parse_spec", record_path)
    with pytest.raises(ValueError, match="Duplicate step id"):
        spec_generator.generate_spec(skill, max_retries=max_retries)

    assert len(prompts) == max_retries + 1
    assert len(created) == max_retries + 1
    assert all(not path.exists() for path in created)


@pytest.mark.unit
def test_valid_fixture_does_not_retry(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    skill = tmp_path / "SKILL.md"
    skill.write_text("Follow the TDD workflow.", encoding="utf-8")
    fixture = Path(__file__).parent.parent / "fixtures" / "tdd_spec.yaml"
    prompts = _mock_generation(monkeypatch, [fixture.read_text(encoding="utf-8")])
    assert spec_generator.generate_spec(skill) == parse_spec(fixture)
    assert len(prompts) == 1
