import pytest

from llm.prompt import (
    TEMPLATES,
    clear_templates,
    deregister_template,
    get_template,
    get_template_or_default,
    register_template,
)


@pytest.fixture(autouse=True)
def restore_template_registry():
    snapshot = dict(TEMPLATES)
    clear_templates()
    yield
    try:
        clear_templates()
    finally:
        TEMPLATES.update(snapshot)


@pytest.mark.unit
def test_register_template_exposes_public_template_mapping():
    register_template("system", "You are helpful.")

    assert get_template("system") == "You are helpful."
    assert get_template_or_default("missing", "fallback") == "fallback"
    assert TEMPLATES["system"] == "You are helpful."


@pytest.mark.unit
def test_templates_mapping_remains_mutable_for_existing_callers():
    TEMPLATES["legacy"] = "Use the existing public mapping."

    assert get_template("legacy") == "Use the existing public mapping."


@pytest.mark.unit
def test_deregister_template_removes_named_template():
    register_template("system", "You are helpful.")

    deregister_template("system")

    assert get_template("system") is None


@pytest.mark.unit
def test_clear_templates_removes_all_registered_templates():
    register_template("system", "You are helpful.")
    register_template("user", "Answer clearly.")

    clear_templates()

    assert TEMPLATES == {}


@pytest.mark.unit
@pytest.mark.parametrize(
    ("name", "template", "error_match"),
    [
        ("", "content", "Template name must be a non-empty string"),
        ("   ", "content", "Template name must be a non-empty string"),
        ("system", "", "Template content must be a non-empty string"),
        ("system", "   ", "Template content must be a non-empty string"),
    ],
)
def test_register_template_rejects_empty_inputs(name, template, error_match):
    with pytest.raises(ValueError, match=error_match):
        register_template(name, template)
