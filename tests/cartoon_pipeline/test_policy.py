from dataclasses import replace
from datetime import date
from pathlib import Path

import pytest

from cartoon_pipeline.config import load_content_policy
from cartoon_pipeline.models import Episode
from cartoon_pipeline.policy import PolicyViolationError, validate_episode


@pytest.fixture
def episode(tmp_path: Path) -> Episode:
    landscape = tmp_path / "landscape.mp4"
    vertical = tmp_path / "vertical.mp4"
    landscape.write_bytes(b"landscape")
    vertical.write_bytes(b"vertical")
    return Episode(
        episode_id="2026-11-23",
        title="The Patient Little Seed",
        description="A gentle story about teamwork and growing a garden.",
        story=("A seed needs help.", "Friends work together.", "A garden grows."),
        episode_date=date(2026, 11, 23),
        landscape_path=landscape,
        vertical_path=vertical,
        audience_min_age=8,
        audience_max_age=15,
        made_for_kids=True,
        original=True,
        rights_cleared=True,
        safety_reviewed=True,
        contains_personal_data=False,
    )


def test_policy_accepts_original_reviewed_child_safe_episode(episode: Episode) -> None:
    policy = load_content_policy(Path("config/content_policy.yaml"))

    validate_episode(episode, policy, "youtube")


@pytest.mark.parametrize(
    ("changes", "message"),
    [
        ({"made_for_kids": False}, "made for kids"),
        ({"original": False}, "original"),
        ({"rights_cleared": False}, "rights"),
        ({"safety_reviewed": False}, "review"),
        ({"contains_personal_data": True}, "personal data"),
    ],
)
def test_policy_rejects_unsafe_episode_metadata(
    episode: Episode, changes: dict[str, object], message: str
) -> None:
    policy = load_content_policy(Path("config/content_policy.yaml"))

    with pytest.raises(PolicyViolationError, match=message):
        validate_episode(replace(episode, **changes), policy, "youtube")


def test_policy_rejects_tiktok_when_audience_includes_under_13(
    episode: Episode,
) -> None:
    policy = load_content_policy(Path("config/content_policy.yaml"))

    with pytest.raises(PolicyViolationError, match="TikTok"):
        validate_episode(episode, policy, "tiktok")
