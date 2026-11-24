from datetime import date, datetime
from pathlib import Path

import pytest

from cartoon_pipeline.approval import ApprovalRequiredError
from cartoon_pipeline.config import load_content_policy
from cartoon_pipeline.ledger import PublicationLedger
from cartoon_pipeline.models import Episode, PublishApproval, PublishReceipt
from cartoon_pipeline.pipeline import PublicationPipeline
from cartoon_pipeline.publishers.base import ProviderError
from cartoon_pipeline.utc import UTC


class CountingPublisher:
    platform = "youtube"

    def __init__(self) -> None:
        self.calls = 0

    def publish(self, episode: Episode, approval: PublishApproval) -> PublishReceipt:
        self.calls += 1
        return PublishReceipt(platform=self.platform, remote_id="video-123")


class RetryOncePublisher:
    platform = "youtube"

    def __init__(self) -> None:
        self.calls = 0

    def publish(self, episode: Episode, approval: PublishApproval) -> PublishReceipt:
        self.calls += 1
        if self.calls == 1:
            raise ProviderError("Local asset is not ready", retry_safe=True)
        return PublishReceipt(platform=self.platform, remote_id="video-123")


class UncertainFailurePublisher:
    platform = "youtube"

    def publish(self, episode: Episode, approval: PublishApproval) -> PublishReceipt:
        raise ProviderError("Provider outcome is unknown")


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


def test_pipeline_requires_environment_approval_before_any_publish(
    episode: Episode, tmp_path: Path
) -> None:
    publisher = CountingPublisher()
    pipeline = PublicationPipeline(
        publishers=[publisher],
        ledger=PublicationLedger(tmp_path / "ledger.sqlite3"),
        policy=load_content_policy(Path("config/content_policy.yaml")),
    )

    with pytest.raises(ApprovalRequiredError):
        pipeline.publish(episode, approval=None)

    assert publisher.calls == 0


def test_pipeline_publishes_once_and_skips_duplicate_episode(
    episode: Episode, tmp_path: Path
) -> None:
    publisher = CountingPublisher()
    pipeline = PublicationPipeline(
        publishers=[publisher],
        ledger=PublicationLedger(tmp_path / "ledger.sqlite3"),
        policy=load_content_policy(Path("config/content_policy.yaml")),
    )
    approval = PublishApproval(
        run_id="123456",
        approved_at=datetime(2026, 11, 23, tzinfo=UTC),
        source="github_environment",
    )

    first = pipeline.publish(episode, approval)
    second = pipeline.publish(episode, approval)

    assert first[0].status == "published"
    assert second[0].status == "already_published"
    assert publisher.calls == 1


def test_pipeline_fails_closed_when_previous_attempt_is_unresolved(
    episode: Episode, tmp_path: Path
) -> None:
    ledger = PublicationLedger(tmp_path / "ledger.sqlite3")
    ledger.reserve(episode.episode_id, "youtube")
    pipeline = PublicationPipeline(
        publishers=[CountingPublisher()],
        ledger=ledger,
        policy=load_content_policy(Path("config/content_policy.yaml")),
    )
    approval = PublishApproval(
        run_id="123456",
        approved_at=datetime(2026, 11, 23, tzinfo=UTC),
        source="github_environment",
    )

    with pytest.raises(RuntimeError, match="reconciliation"):
        pipeline.publish(episode, approval)


def test_pipeline_retries_only_explicitly_safe_local_failures(
    episode: Episode, tmp_path: Path
) -> None:
    publisher = RetryOncePublisher()
    pipeline = PublicationPipeline(
        publishers=[publisher],
        ledger=PublicationLedger(tmp_path / "ledger.sqlite3"),
        policy=load_content_policy(Path("config/content_policy.yaml")),
    )
    approval = PublishApproval(
        run_id="123456",
        approved_at=datetime(2026, 11, 23, tzinfo=UTC),
        source="github_environment",
    )

    first = pipeline.publish(episode, approval)
    second = pipeline.publish(episode, approval)

    assert first[0].status == "failed"
    assert second[0].status == "published"
    assert publisher.calls == 2


def test_pipeline_blocks_retry_after_uncertain_provider_failure(
    episode: Episode, tmp_path: Path
) -> None:
    pipeline = PublicationPipeline(
        publishers=[UncertainFailurePublisher()],
        ledger=PublicationLedger(tmp_path / "ledger.sqlite3"),
        policy=load_content_policy(Path("config/content_policy.yaml")),
    )
    approval = PublishApproval(
        run_id="123456",
        approved_at=datetime(2026, 11, 23, tzinfo=UTC),
        source="github_environment",
    )

    assert pipeline.publish(episode, approval)[0].status == "unknown"
    with pytest.raises(RuntimeError, match="reconciliation"):
        pipeline.publish(episode, approval)
