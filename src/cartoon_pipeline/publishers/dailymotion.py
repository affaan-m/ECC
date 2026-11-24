from __future__ import annotations

import re
from typing import BinaryIO

import httpx

from cartoon_pipeline.models import Episode, PublishApproval, PublishReceipt
from cartoon_pipeline.publishers.base import (
    AccessTokenProvider,
    ProviderError,
    open_video_asset,
    provider_request,
    require_json,
    validate_https_url,
)


class DailymotionPublisher:
    platform = "dailymotion"
    _API = "https://api.dailymotion.com/v2"

    def __init__(
        self,
        token_provider: AccessTokenProvider,
        profile_id: str,
        client: httpx.Client | None = None,
        visibility: str = "private",
        category: str = "kids",
    ) -> None:
        if not re.fullmatch(r"[A-Za-z0-9_-]{1,128}", profile_id):
            raise ValueError("Invalid Dailymotion profile identifier")
        if visibility not in {"private", "public"}:
            raise ValueError("Unsupported Dailymotion visibility")
        self.token_provider = token_provider
        self.profile_id = profile_id
        self.client = client or httpx.Client(timeout=120)
        self.visibility = visibility
        self.category = category

    def publish(self, episode: Episode, approval: PublishApproval) -> PublishReceipt:
        asset, size = open_video_asset(episode.landscape_path, "Dailymotion")
        with asset:
            token = self.token_provider.get_access_token()
            headers = {"Authorization": f"Bearer {token}"}
            session = require_json(
                provider_request(
                    lambda: self.client.post(
                        f"{self._API}/files/upload_sessions",
                        headers=headers,
                        timeout=30,
                    ),
                    "Dailymotion",
                ),
                "Dailymotion",
            )
            upload_url = _required_string(session, "upload_url", "Dailymotion")
            validate_https_url(upload_url, ("dailymotion.com",))
            uploaded = self._upload_file(
                upload_url, asset, episode.landscape_path.name
            )
            file_url = _required_string(uploaded, "url", "Dailymotion")
            validate_https_url(file_url, ("dailymotion.com",))
            video = require_json(
                provider_request(
                    lambda: self.client.post(
                        f"{self._API}/profiles/{self.profile_id}/videos",
                        headers={**headers, "Content-Type": "application/json"},
                        json={
                            "title": episode.title,
                            "category": self.category,
                            "visibility": self.visibility,
                            "is_for_kids": True,
                            "source": {"file_url": file_url},
                        },
                        timeout=30,
                    ),
                    "Dailymotion",
                ),
                "Dailymotion",
            )
        video_id = _required_string(video, "video_id", "Dailymotion")
        return PublishReceipt(platform=self.platform, remote_id=video_id)

    def _upload_file(
        self, upload_url: str, video: BinaryIO, filename: str
    ) -> dict:
        response = provider_request(
            lambda: self.client.post(
                upload_url,
                files={"file": (filename, video, "video/mp4")},
                timeout=120,
            ),
            "Dailymotion",
        )
        return require_json(response, "Dailymotion")


def _required_string(payload: dict, key: str, provider: str) -> str:
    value = payload.get(key)
    if not isinstance(value, str) or not value:
        raise ProviderError(f"{provider} returned an invalid {key}")
    return value
