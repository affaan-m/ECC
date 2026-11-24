from __future__ import annotations

import json
from datetime import date
from pathlib import Path
from typing import Any

from cartoon_pipeline.models import Episode
from cartoon_pipeline.utils.files import (
    atomic_write_text,
    prepare_output_directory,
    safe_output_file,
)


def save_episode(episode: Episode, output_directory: Path) -> Path:
    output_directory = prepare_output_directory(output_directory)
    landscape = _asset_path(output_directory, episode.landscape_path.name)
    vertical = _asset_path(output_directory, episode.vertical_path.name)
    if landscape != episode.landscape_path.resolve() or vertical != episode.vertical_path.resolve():
        raise ValueError("Episode assets must be inside the output directory")
    manifest = {
        "episode_id": episode.episode_id,
        "title": episode.title,
        "description": episode.description,
        "story": list(episode.story),
        "episode_date": episode.episode_date.isoformat(),
        "landscape_path": episode.landscape_path.name,
        "vertical_path": episode.vertical_path.name,
        "audience_min_age": episode.audience_min_age,
        "audience_max_age": episode.audience_max_age,
        "made_for_kids": episode.made_for_kids,
        "original": episode.original,
        "rights_cleared": episode.rights_cleared,
        "safety_reviewed": episode.safety_reviewed,
        "contains_personal_data": episode.contains_personal_data,
    }
    destination = safe_output_file(output_directory, "episode.json")
    atomic_write_text(
        destination,
        json.dumps(manifest, ensure_ascii=True, indent=2) + "\n",
    )
    return destination


def load_episode(path: Path) -> Episode:
    if path.is_symlink():
        raise ValueError("Episode manifest must not be a symlink")
    try:
        manifest_path = path.resolve(strict=True)
        manifest: Any = json.loads(manifest_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise ValueError("Episode manifest is missing or invalid") from exc
    if not isinstance(manifest, dict):
        raise ValueError("Episode manifest must be an object")
    root = manifest_path.parent
    landscape = _asset_path(root, manifest.get("landscape_path"))
    vertical = _asset_path(root, manifest.get("vertical_path"))
    try:
        return Episode(
            episode_id=_string(manifest, "episode_id"),
            title=_string(manifest, "title"),
            description=_string(manifest, "description"),
            story=tuple(_string_list(manifest, "story")),
            episode_date=date.fromisoformat(_string(manifest, "episode_date")),
            landscape_path=landscape,
            vertical_path=vertical,
            audience_min_age=_integer(manifest, "audience_min_age"),
            audience_max_age=_integer(manifest, "audience_max_age"),
            made_for_kids=_boolean(manifest, "made_for_kids"),
            original=_boolean(manifest, "original"),
            rights_cleared=_boolean(manifest, "rights_cleared"),
            safety_reviewed=_boolean(manifest, "safety_reviewed"),
            contains_personal_data=_boolean(manifest, "contains_personal_data"),
        )
    except (KeyError, TypeError, ValueError) as exc:
        raise ValueError("Episode manifest has missing or invalid fields") from exc


def _asset_path(root: Path, value: Any) -> Path:
    if not isinstance(value, str) or not value:
        raise ValueError("Episode asset path is invalid")
    candidate = root / value
    if candidate.is_symlink():
        raise ValueError("Episode asset must not be a symlink")
    path = candidate.resolve()
    if not path.is_relative_to(root):
        raise ValueError("Episode asset path escapes its manifest directory")
    return path


def _string(payload: dict, key: str) -> str:
    value = payload[key]
    if not isinstance(value, str) or not value:
        raise ValueError(f"{key} must be a non-empty string")
    return value


def _string_list(payload: dict, key: str) -> list[str]:
    value = payload[key]
    if not isinstance(value, list) or not all(
        isinstance(item, str) and item for item in value
    ):
        raise ValueError(f"{key} must be a list of non-empty strings")
    return value


def _integer(payload: dict, key: str) -> int:
    value = payload[key]
    if isinstance(value, bool) or not isinstance(value, int):
        raise ValueError(f"{key} must be an integer")
    return value


def _boolean(payload: dict, key: str) -> bool:
    value = payload[key]
    if not isinstance(value, bool):
        raise ValueError(f"{key} must be a boolean")
    return value
