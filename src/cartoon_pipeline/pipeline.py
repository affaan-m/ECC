from __future__ import annotations

from collections.abc import Sequence
from typing import Protocol

from cartoon_pipeline.approval import ApprovalRequiredError
from cartoon_pipeline.config import ContentPolicy
from cartoon_pipeline.ledger import PublicationLedger
from cartoon_pipeline.models import Episode, PublishApproval, PublishReceipt
from cartoon_pipeline.policy import validate_episode
from cartoon_pipeline.publishers.base import ProviderError


class Publisher(Protocol):
    platform: str

    def publish(self, episode: Episode, approval: PublishApproval) -> PublishReceipt: ...


class PublicationPipeline:
    def __init__(
        self,
        publishers: Sequence[Publisher],
        ledger: PublicationLedger,
        policy: ContentPolicy,
    ) -> None:
        self.publishers = tuple(publishers)
        self.ledger = ledger
        self.policy = policy

    def publish(
        self, episode: Episode, approval: PublishApproval | None
    ) -> list[PublishReceipt]:
        if approval is None or approval.source != "github_environment":
            raise ApprovalRequiredError(
                "Publishing requires protected-environment human approval"
            )
        for publisher in self.publishers:
            validate_episode(episode, self.policy, publisher.platform)

        receipts: list[PublishReceipt] = []
        for publisher in self.publishers:
            reservation = self.ledger.reserve(episode.episode_id, publisher.platform)
            if reservation == "already_published":
                receipts.append(
                    PublishReceipt(
                        platform=publisher.platform,
                        remote_id="",
                        status="already_published",
                    )
                )
                continue
            try:
                receipt = publisher.publish(episode, approval)
            except ProviderError as exc:
                if exc.retry_safe:
                    self.ledger.mark_retryable_failure(
                        episode.episode_id, publisher.platform
                    )
                receipts.append(
                    PublishReceipt(
                        platform=publisher.platform,
                        remote_id="",
                        status="failed" if exc.retry_safe else "unknown",
                        error=str(exc),
                    )
                )
                continue
            self.ledger.complete(
                episode.episode_id,
                publisher.platform,
                receipt.remote_id,
                receipt.status,
            )
            receipts.append(receipt)
        return receipts
