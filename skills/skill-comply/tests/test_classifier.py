"""Tests for scripts.classifier._parse_classification."""

import json
import subprocess
from unittest.mock import patch

import pytest
from scripts import classifier
from scripts.classifier import _parse_classification
from scripts.grader import grade
from scripts.parser import ComplianceSpec, Detector, ObservationEvent, Step


class TestParseClassification:
    def test_plain_json(self) -> None:
        assert _parse_classification('{"a": [0, 2]}') == {"a": [0, 2]}

    def test_fenced_json(self) -> None:
        assert _parse_classification('```json\n{"a": [1]}\n```') == {"a": [1]}

    @pytest.mark.parametrize("value", ["x", None, True, 1, 1.5, {}])
    def test_non_list_values_raise(self, value: object) -> None:
        with pytest.raises(classifier.ClassifierParseError, match="non-list"):
            _parse_classification(json.dumps({"a": value}))

    def test_mixed_valid_and_non_list_values_raise(self) -> None:
        with pytest.raises(classifier.ClassifierParseError, match="non-list"):
            _parse_classification('{"a": [0], "other": "x"}')

    def test_existing_index_coercion_is_preserved(self) -> None:
        assert _parse_classification('{"a": [0, 2.0, "3"]}') == {"a": [0, 2, 3]}

    @pytest.mark.parametrize("index", [True, False, 2.9, -0.1])
    def test_boolean_and_fractional_indices_raise(self, index: object) -> None:
        with pytest.raises(classifier.ClassifierParseError, match="failed to parse"):
            _parse_classification(json.dumps({"a": [index]}))

    def test_empty_object_is_valid(self) -> None:
        assert _parse_classification("{}") == {}

    def test_garbage_raises(self) -> None:
        with pytest.raises(classifier.ClassifierParseError, match="failed to parse"):
            _parse_classification("sorry, I cannot classify these")

    def test_non_dict_json_raises(self) -> None:
        with pytest.raises(classifier.ClassifierParseError, match="non-dict"):
            _parse_classification("[1, 2, 3]")

    def test_non_integer_indices_raise(self) -> None:
        with pytest.raises(classifier.ClassifierParseError, match="failed to parse"):
            _parse_classification('{"a": ["x"]}')

    @pytest.mark.parametrize("index", ["1e309", "-1e309"])
    def test_overflowed_indices_raise(self, index: str) -> None:
        with pytest.raises(classifier.ClassifierParseError, match="failed to parse"):
            _parse_classification('{"a": [' + index + ']}')

    def test_is_runtime_error(self) -> None:
        assert issubclass(classifier.ClassifierParseError, RuntimeError)


@pytest.mark.parametrize("response", ["not JSON", "[]", '{"a": ["x"]}', '{"a": "x"}', '{"a": [0], "other": null}', '{"a": [1e309]}', '{"a": [-1e309]}', '{"a": [false]}', '{"a": [0.5]}'])
def test_grader_propagates_classifier_parse_failure(response: str) -> None:
    """An invalid successful subprocess response cannot become a zero score."""
    spec = ComplianceSpec(
        id="fixture", name="Fixture", source_rule="fixture", version="1",
        steps=(Step("a", "Read a file", True, Detector("Read a file")),),
        threshold_promote_to_hook=0.6,
    )
    trace = [ObservationEvent("T0000", "tool_complete", "Read", "fixture", "", "")]
    result = subprocess.CompletedProcess(["claude"], 0, stdout=response, stderr="")
    with patch("scripts.classifier.subprocess.run", return_value=result) as execute:
        with pytest.raises(classifier.ClassifierParseError):
            grade(spec, trace)
    execute.assert_called_once()
