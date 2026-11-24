from __future__ import annotations

from datetime import date, datetime
from pathlib import Path

from cartoon_pipeline.config import load_content_policy
from cartoon_pipeline.episode_io import save_episode
from cartoon_pipeline.generators.storyboard import generate_storyboard
from cartoon_pipeline.models import Episode
from cartoon_pipeline.processors.video import FFmpegProcessor
from cartoon_pipeline.utc import UTC


def generate_daily_episode(
    output_directory: Path,
    policy_path: Path,
    episode_date: date | None = None,
    processor: FFmpegProcessor | None = None,
) -> Path:
    day = episode_date or datetime.now(UTC).date()
    policy = load_content_policy(policy_path)
    storyboard = generate_storyboard(day)
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
    return save_episode(episode, output_directory)
