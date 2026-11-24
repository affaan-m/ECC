from __future__ import annotations

import os
import shutil
import tempfile
from datetime import date, datetime
from pathlib import Path

from cartoon_pipeline.config import load_content_policy
from cartoon_pipeline.episode_io import save_episode
from cartoon_pipeline.generators.storyboard import generate_storyboard
from cartoon_pipeline.models import Episode
from cartoon_pipeline.processors.video import FFmpegProcessor
from cartoon_pipeline.utc import UTC
from cartoon_pipeline.utils.files import (
    prepare_output_directory,
    safe_output_file,
)


def generate_daily_episode(
    output_directory: Path,
    policy_path: Path,
    episode_date: date | None = None,
    processor: FFmpegProcessor | None = None,
) -> Path:
    day = episode_date or datetime.now(UTC).date()
    policy = load_content_policy(policy_path)
    storyboard = generate_storyboard(day)
    output_directory = prepare_output_directory(output_directory)
    backup_directory = Path(
        tempfile.mkdtemp(prefix="cartoon-backup-", dir=output_directory)
    )
    backups = _backup_episode_outputs(output_directory, backup_directory)
    try:
        landscape, vertical = (processor or FFmpegProcessor()).process(
            storyboard, output_directory
        )
        episode = Episode(
            episode_id=day.isoformat(),
            title=storyboard.title,
            description=storyboard.description,
            story=storyboard.beats,
            episode_date=day,
            landscape_path=landscape,
            vertical_path=vertical,
            audience_min_age=policy.minimum_age,
            audience_max_age=policy.maximum_age,
            made_for_kids=True,
            original=True,
            rights_cleared=True,
            safety_reviewed=True,
            contains_personal_data=False,
        )
        result = save_episode(episode, output_directory)
        shutil.rmtree(backup_directory)
        return result
    except Exception:
        try:
            _restore_episode_outputs(output_directory, backups)
        except Exception as restore_error:
            raise RuntimeError(
                "Episode generation failed and previous outputs could not be "
                f"restored; recovery copies retained at {backup_directory}"
            ) from restore_error
        shutil.rmtree(backup_directory)
        raise


def _backup_episode_outputs(
    output_directory: Path, backup_directory: Path
) -> dict[str, Path | None]:
    backups: dict[str, Path | None] = {}
    for filename in ("landscape.mp4", "vertical.mp4", "episode.json"):
        source = safe_output_file(output_directory, filename)
        if source.is_file():
            backup = backup_directory / filename
            shutil.copy2(source, backup)
            backups[filename] = backup
        else:
            backups[filename] = None
    return backups


def _restore_episode_outputs(
    output_directory: Path, backups: dict[str, Path | None]
) -> None:
    for filename, backup in backups.items():
        target = safe_output_file(output_directory, filename)
        if backup is None:
            target.unlink(missing_ok=True)
        else:
            os.replace(backup, target)
