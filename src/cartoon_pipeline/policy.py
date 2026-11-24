import re
import stat
from pathlib import Path

from cartoon_pipeline.config import ContentPolicy
from cartoon_pipeline.models import Episode


class PolicyViolationError(ValueError):
    """Raised when an episode does not satisfy the publishing safety policy."""


_CONTACT_OR_LINK = re.compile(
    r"(?:https?://|www\.|[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}|\b\d{3}[- .]?\d{3}[- .]?\d{4}\b)",
    re.IGNORECASE,
)


def validate_episode(episode: Episode, policy: ContentPolicy, platform: str) -> None:
    if episode.audience_min_age < policy.minimum_age:
        raise PolicyViolationError(
            "Audience includes viewers below the configured minimum age"
        )
    if episode.audience_min_age > episode.audience_max_age:
        raise PolicyViolationError("Audience age range is invalid")
    if episode.audience_max_age > policy.hard_maximum_age or episode.audience_max_age >= 16:
        raise PolicyViolationError("Audience must remain under age 16")
    if policy.require_made_for_kids and not episode.made_for_kids:
        raise PolicyViolationError("Episode must be declared made for kids")
    if policy.require_original and not episode.original:
        raise PolicyViolationError("Episode must be original")
    if policy.require_rights_clearance and not episode.rights_cleared:
        raise PolicyViolationError("Episode rights must be cleared")
    if policy.reject_personal_data and episode.contains_personal_data:
        raise PolicyViolationError("Episode contains personal data")
    if policy.human_review_required and not episode.safety_reviewed:
        raise PolicyViolationError("Episode safety review is required")
    if not episode.title.strip() or len(episode.title) > policy.maximum_title_characters:
        raise PolicyViolationError("Episode title is empty or too long")
    if len(episode.description) > policy.maximum_description_characters:
        raise PolicyViolationError("Episode description is too long")
    if _CONTACT_OR_LINK.search(f"{episode.title}\n{episode.description}"):
        raise PolicyViolationError(
            "Episode metadata must not contain contact details or links"
        )
    if len(episode.story) != 3 or any(not item.strip() for item in episode.story):
        raise PolicyViolationError("Episode must contain three complete story beats")
    if not _is_episode_identifier(episode.episode_id, episode.episode_date.isoformat()):
        raise PolicyViolationError("Episode identifier must match its UTC episode date")
    _validate_asset(episode.landscape_path, policy.maximum_asset_bytes, "landscape")
    _validate_asset(episode.vertical_path, policy.maximum_asset_bytes, "vertical")
    if platform == "tiktok" and episode.audience_min_age < policy.tiktok_minimum_audience_age:
        raise PolicyViolationError(
            "TikTok distribution is blocked when the audience includes viewers under 13"
        )
    if platform not in {"youtube", "dailymotion", "tiktok"}:
        raise PolicyViolationError(f"Unsupported publishing platform: {platform}")


def _is_episode_identifier(value: str, expected: str) -> bool:
    return value == expected


def _validate_asset(path: Path, maximum_bytes: int, kind: str) -> None:
    try:
        asset = path.stat()
    except OSError as exc:
        raise PolicyViolationError(f"The {kind} video asset is unavailable") from exc
    if not stat.S_ISREG(asset.st_mode):
        raise PolicyViolationError(f"The {kind} video asset must be a regular file")
    if asset.st_size <= 0 or asset.st_size > maximum_bytes:
        raise PolicyViolationError(f"The {kind} video asset has an invalid size")
