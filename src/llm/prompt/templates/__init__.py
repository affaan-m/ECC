"""Provider-specific prompt template helpers."""

from __future__ import annotations

_TEMPLATE_REGISTRY: dict[str, str] = {}
TEMPLATES = _TEMPLATE_REGISTRY


def _validate_template_input(name: str, template: str | None = None) -> None:
    """Validate template registry inputs before mutating the registry."""
    if not isinstance(name, str) or not name.strip():
        raise ValueError("Template name must be a non-empty string")
    if template is not None and (not isinstance(template, str) or not template.strip()):
        raise ValueError("Template content must be a non-empty string")


def register_template(name: str, template: str) -> None:
    """Register or replace a named prompt template."""
    _validate_template_input(name, template)
    _TEMPLATE_REGISTRY[name] = template


def deregister_template(name: str) -> None:
    """Remove a named prompt template if it is registered."""
    _validate_template_input(name)
    _TEMPLATE_REGISTRY.pop(name, None)


def clear_templates() -> None:
    """Remove all registered prompt templates."""
    _TEMPLATE_REGISTRY.clear()


def get_template(name: str) -> str | None:
    """Return a named prompt template when one is registered."""
    return _TEMPLATE_REGISTRY.get(name)


def get_template_or_default(name: str, default: str = "") -> str:
    """Return a named prompt template or a caller-provided default."""
    return _TEMPLATE_REGISTRY.get(name, default)
