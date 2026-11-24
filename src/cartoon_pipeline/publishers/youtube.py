from __future__ import annotations

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


class YouTubePublisher:
    platform = "youtube"
    _INIT_URL = "https://www.googleapis.com/upload/youtube/v3/videos"

    def __init__(
        self,
        token_provider: AccessTokenProvider,
        client: httpx.Client | None = None,
        privacy_status: str = "private",
        category_id: str = "1",
    ) -> None:
        if privacy_status not in {"private", "unlisted", "public"}:
            raise ValueError("Unsupported YouTube privacy status")
        self.token_provider = token_provider
        self.client = client or httpx.Client(timeout=120)
        self.privacy_status = privacy_status
        self.category_id = category_id

    def publish(self, episode: Episode, approval: PublishApproval) -> PublishReceipt:
        video, size = open_video_asset(episode.landscape_path, "YouTube")
        with video:
            token = self.token_provider.get_access_token()
            metadata = {
                "snippet": {
                    "title": episode.title,
                    "description": episode.description,
                    "categoryId": self.category_id,
                    "tags": ["kids", "cartoon", "original"],
                },
                "status": {
                    "privacyStatus": self.privacy_status,
                    "selfDeclaredMadeForKids": True,
                },
            }
            headers = {
                "Authorization": f"Bearer {token}",
                "Content-Type": "application/json; charset=UTF-8",
                "X-Upload-Content-Type": "video/mp4",
                "X-Upload-Content-Length": str(size),
            }
            response = provider_request(
                lambda: self.client.post(
                    self._INIT_URL,
                    params={"uploadType": "resumable", "part": "snippet,status"},
                    headers=headers,
                    json=metadata,
                    timeout=30,
                ),
                "YouTube",
            )
            if not 200 <= response.status_code < 300:
                raise ProviderError(
                    f"YouTube upload initialization failed with HTTP {response.status_code}"
                )
            upload_url = response.headers.get("location")
            if not upload_url:
                raise ProviderError("YouTube did not return a resumable upload URL")
            validate_https_url(upload_url, ("www.googleapis.com",))
            uploaded = self._upload_file(upload_url, video, size, token)
        video_id = uploaded.get("id")
        if not isinstance(video_id, str) or not video_id:
            raise ProviderError("YouTube returned an invalid video identifier")
        return PublishReceipt(platform=self.platform, remote_id=video_id)

    def _upload_file(
        self, upload_url: str, video: BinaryIO, size: int, token: str
    ) -> dict:
        response = provider_request(
            lambda: self.client.put(
                upload_url,
                headers={
                    "Authorization": f"Bearer {token}",
                    "Content-Type": "video/mp4",
                    "Content-Length": str(size),
                },
                content=video,
                timeout=120,
            ),
            "YouTube",
        )
        return require_json(response, "YouTube")
