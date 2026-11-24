from pathlib import Path

import pytest

from cartoon_pipeline.config import (
    ConfigurationError,
    load_content_policy,
    load_platforms,
    load_yaml,
)


def test_load_yaml_rejects_non_mapping_and_invalid_syntax(tmp_path: Path) -> None:
    scalar = tmp_path / "scalar.yaml"
    scalar.write_text("- item\n", encoding="utf-8")
    malformed = tmp_path / "malformed.yaml"
    malformed.write_text("key: [", encoding="utf-8")

    with pytest.raises(ConfigurationError, match="mapping"):
        load_yaml(scalar)
    with pytest.raises(ConfigurationError, match="read configuration"):
        load_yaml(malformed)


def test_content_policy_rejects_unsupported_version(tmp_path: Path) -> None:
    path = tmp_path / "policy.yaml"
    path.write_text("version: 2\n", encoding="utf-8")

    with pytest.raises(ConfigurationError, match="version"):
        load_content_policy(path)


def test_content_policy_rejects_invalid_audience_bounds(tmp_path: Path) -> None:
    path = tmp_path / "policy.yaml"
    path.write_text(
        """
version: 1
audience: {minimum_age: 15, maximum_age: 8, hard_maximum_age: 15}
platform_restrictions: {tiktok_minimum_audience_age: 13}
content:
  require_original: true
  require_rights_clearance: true
  require_made_for_kids: true
  reject_personal_data: true
  human_review_required: true
  maximum_title_characters: 100
  maximum_description_characters: 5000
  maximum_asset_bytes: 1000
""",
        encoding="utf-8",
    )

    with pytest.raises(ConfigurationError, match="cannot exceed"):
        load_content_policy(path)


def test_load_platforms_requires_boolean_enabled_flag(tmp_path: Path) -> None:
    path = tmp_path / "platforms.yaml"
    path.write_text(
        "version: 1\nplatforms:\n  youtube:\n    enabled: maybe\n",
        encoding="utf-8",
    )

    with pytest.raises(ConfigurationError, match="boolean"):
        load_platforms(path)


def test_load_platforms_rejects_non_mapping(tmp_path: Path) -> None:
    path = tmp_path / "platforms.yaml"
    path.write_text("version: 1\nplatforms: []\n", encoding="utf-8")

    with pytest.raises(ConfigurationError, match="mapping"):
        load_platforms(path)
