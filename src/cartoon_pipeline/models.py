from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime
from pathlib import Path


@dataclass(frozen=True)
class Episode:
    episode_id: str
    title: str
    description: str
    story: tuple[str, ...]
    episode_date: date
    landscape_path: Path
    vertical_path: Path
    audience_min_age: int
    audience_max_age: int
    made_for_kids: bool
    original: bool
    rights_cleared: bool
    safety_reviewed: bool
    contains_personal_data: bool


@dataclass(frozen=True)
class PublishApproval:
    run_id: str
    approved_at: datetime
    source: str


@dataclass(frozen=True)
class PublishReceipt:
    platform: str
    remote_id: str
    status: str = "published"
    error: str | None = None
