from dataclasses import dataclass
from pathlib import Path
from typing import Any

import yaml


class ConfigurationError(ValueError):
    """Raised when a pipeline configuration is missing or malformed."""


@dataclass(frozen=True)
class ContentPolicy:
    minimum_age: int
    maximum_age: int
    hard_maximum_age: int
    tiktok_minimum_audience_age: int
    require_original: bool
    require_rights_clearance: bool
    require_made_for_kids: bool
    reject_personal_data: bool
    human_review_required: bool
    maximum_title_characters: int
    maximum_description_characters: int
    maximum_asset_bytes: int


def load_yaml(path: Path) -> dict[str, Any]:
    try:
        value = yaml.safe_load(path.read_text(encoding="utf-8"))
    except (OSError, yaml.YAMLError) as exc:
        raise ConfigurationError(f"Unable to read configuration: {path.name}") from exc
    if not isinstance(value, dict):
        raise ConfigurationError(f"Configuration must be a mapping: {path.name}")
    return value


def load_content_policy(path: Path) -> ContentPolicy:
    document = load_yaml(path)
    if document.get("version") != 1:
        raise ConfigurationError("Unsupported content policy version")
    try:
        audience = document["audience"]
        restrictions = document["platform_restrictions"]
        content = document["content"]
        result = ContentPolicy(
            minimum_age=_positive_int(audience["minimum_age"], "minimum_age", allow_zero=True),
            maximum_age=_positive_int(audience["maximum_age"], "maximum_age"),
            hard_maximum_age=_positive_int(
                audience["hard_maximum_age"], "hard_maximum_age"
            ),
            tiktok_minimum_audience_age=_positive_int(
                restrictions["tiktok_minimum_audience_age"], "tiktok_minimum_audience_age"
            ),
            require_original=_bool(content["require_original"], "require_original"),
            require_rights_clearance=_bool(
                content["require_rights_clearance"], "require_rights_clearance"
            ),
            require_made_for_kids=_bool(
                content["require_made_for_kids"], "require_made_for_kids"
            ),
            reject_personal_data=_bool(content["reject_personal_data"], "reject_personal_data"),
            human_review_required=_bool(
                content["human_review_required"], "human_review_required"
            ),
            maximum_title_characters=_positive_int(
                content["maximum_title_characters"], "maximum_title_characters"
            ),
            maximum_description_characters=_positive_int(
                content["maximum_description_characters"], "maximum_description_characters"
            ),
            maximum_asset_bytes=_positive_int(
                content["maximum_asset_bytes"], "maximum_asset_bytes"
            ),
        )
    except (KeyError, TypeError) as exc:
        raise ConfigurationError("Content policy has missing or invalid fields") from exc
    if result.minimum_age > result.maximum_age:
        raise ConfigurationError("Audience minimum age cannot exceed maximum age")
    if result.maximum_age > result.hard_maximum_age or result.hard_maximum_age > 15:
        raise ConfigurationError("Audience exceeds the configured under-16 boundary")
    return result


def load_platforms(path: Path) -> dict[str, dict[str, Any]]:
    document = load_yaml(path)
    if document.get("version") != 1:
        raise ConfigurationError("Unsupported platform configuration version")
    platforms = document.get("platforms")
    if not isinstance(platforms, dict):
        raise ConfigurationError("Platform configuration must contain a platforms mapping")
    for name, options in platforms.items():
        if not isinstance(name, str) or not isinstance(options, dict):
            raise ConfigurationError("Each platform must be a named mapping")
        if not isinstance(options.get("enabled"), bool):
            raise ConfigurationError(f"Platform {name} must declare enabled as a boolean")
    return platforms


def _positive_int(value: Any, name: str, allow_zero: bool = False) -> int:
    minimum = 0 if allow_zero else 1
    if isinstance(value, bool) or not isinstance(value, int) or value < minimum:
        raise ConfigurationError(f"{name} must be an integer greater than or equal to {minimum}")
    return value


def _bool(value: Any, name: str) -> bool:
    if not isinstance(value, bool):
        raise ConfigurationError(f"{name} must be a boolean")
    return value
