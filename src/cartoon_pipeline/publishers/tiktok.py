from __future__ import annotations

import time
from dataclasses import dataclass
from datetime import datetime, timedelta
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
from cartoon_pipeline.utc import UTC

_API = "https://open.tiktokapis.com/v2"
_MIB = 1024 * 1024
_MIN_CHUNK_BYTES = 5 * _MIB
_MAX_CHUNK_BYTES = 64 * _MIB


@dataclass(frozen=True)
class TikTokConsent:
    episode_id: str
    consent_id: str
    privacy_level: str
    confirmed_at: datetime

    def __post_init__(self) -> None:
        if not self.episode_id.strip():
            raise ValueError("A TikTok consent episode is required")
        if not self.consent_id.strip():
            raise ValueError("A TikTok consent reference is required")
        if self.privacy_level not in {
            "PUBLIC_TO_EVERYONE",
            "MUTUAL_FOLLOW_FRIENDS",
            "FOLLOWER_OF_CREATOR",
            "SELF_ONLY",
        }:
            raise ValueError("Unsupported TikTok privacy level")
        if self.confirmed_at.tzinfo is None:
            raise ValueError("TikTok consent timestamp must include a timezone")
        self._validate_recent()

    def validate_for_episode(self, episode_id: str) -> None:
        if self.episode_id != episode_id:
            raise ValueError("TikTok consent must be bound to this episode")
        self._validate_recent()

    def _validate_recent(self) -> None:
        age = datetime.now(UTC) - self.confirmed_at.astimezone(UTC)
        if age < timedelta(0) or age > timedelta(minutes=15):
            raise ValueError("TikTok consent must be recent")


class TikTokPublisher:
    platform = "tiktok"

    def __init__(
        self,
        token_provider: AccessTokenProvider,
        client: httpx.Client | None = None,
        poll_attempts: int = 3,
        poll_interval_seconds: float = 2,
        chunk_size: int = _MAX_CHUNK_BYTES,
        sleep=time.sleep,
    ) -> None:
        if poll_attempts < 1:
            raise ValueError("TikTok polling must allow at least one attempt")
        if chunk_size < _MIN_CHUNK_BYTES or chunk_size > _MAX_CHUNK_BYTES:
            raise ValueError("TikTok chunk size must be between 5 MiB and 64 MiB")
        self.token_provider = token_provider
        self.client = client or httpx.Client(timeout=120)
        self.poll_attempts = poll_attempts
        self.poll_interval_seconds = poll_interval_seconds
        self.chunk_size = chunk_size
        self.sleep = sleep

    def publish(
        self,
        episode: Episode,
        approval: PublishApproval,
        consent: TikTokConsent | None = None,
    ) -> PublishReceipt:
        if consent is None:
            raise ProviderError(
                "TikTok direct posting requires per-episode creator consent"
            )
        _validate_consent(consent, episode.episode_id)
        video, size = open_video_asset(episode.vertical_path, "TikTok")
        with video:
            chunk_size, chunk_count = self._chunk_plan(size)
            token = self.token_provider.get_access_token()
            headers = {
                "Authorization": f"Bearer {token}",
                "Content-Type": "application/json; charset=UTF-8",
            }
            creator = self._creator_info(headers)
            options = creator.get("privacy_level_options")
            if not isinstance(options, list) or consent.privacy_level not in options:
                raise ProviderError(
                    "TikTok consent privacy setting is no longer available",
                    retry_safe=True,
                )
            _validate_consent(consent, episode.episode_id)
            initialized = self._initialize_post(
                headers, episode, consent, size, chunk_size, chunk_count
            )
            publish_id = _required_string(initialized, "publish_id")
            upload_url = _required_string(initialized, "upload_url")
            validate_https_url(upload_url, ("tiktokapis.com",))
            self._upload_chunks(
                upload_url, video, size, chunk_size, chunk_count
            )
        return self._poll_status(headers, publish_id)

    def _creator_info(self, headers: dict[str, str]) -> dict:
        response = provider_request(
            lambda: self.client.post(
                f"{_API}/post/publish/creator_info/query/",
                headers=headers,
                json={},
                timeout=30,
            ),
            "TikTok",
        )
        payload = require_json(response, "TikTok")
        _require_api_success(payload)
        return _required_mapping(payload, "data")

    def _initialize_post(
        self,
        headers: dict[str, str],
        episode: Episode,
        consent: TikTokConsent,
        size: int,
        chunk_size: int,
        chunk_count: int,
    ) -> dict:
        request = {
            "post_info": {
                "title": episode.title,
                "privacy_level": consent.privacy_level,
                "disable_comment": True,
                "disable_duet": True,
                "disable_stitch": True,
                "brand_content_toggle": False,
                "brand_organic_toggle": False,
                "is_aigc": False,
            },
            "source_info": {
                "source": "FILE_UPLOAD",
                "video_size": size,
                "chunk_size": chunk_size,
                "total_chunk_count": chunk_count,
            },
        }
        response = provider_request(
            lambda: self.client.post(
                f"{_API}/post/publish/video/init/",
                headers=headers,
                json=request,
                timeout=30,
            ),
            "TikTok",
        )
        payload = require_json(response, "TikTok")
        _require_api_success(payload)
        return _required_mapping(payload, "data")

    def _upload_chunks(
        self,
        upload_url: str,
        video: BinaryIO,
        size: int,
        chunk_size: int,
        chunk_count: int,
    ) -> None:
        first_byte = 0
        for chunk_index in range(chunk_count):
            final_chunk = chunk_index == chunk_count - 1
            chunk_length = size - first_byte if final_chunk else chunk_size
            try:
                chunk = video.read(chunk_length)
            except OSError as exc:
                raise ProviderError(
                    "TikTok video asset could not be read",
                    retry_safe=first_byte == 0,
                ) from exc
            if len(chunk) != chunk_length:
                raise ProviderError(
                    "TikTok video asset ended during upload",
                    retry_safe=first_byte == 0,
                )
            last_byte = first_byte + len(chunk) - 1
            response = provider_request(
                lambda: self.client.put(
                    upload_url,
                    headers={
                        "Content-Type": "video/mp4",
                        "Content-Length": str(len(chunk)),
                        "Content-Range": f"bytes {first_byte}-{last_byte}/{size}",
                    },
                    content=chunk,
                    timeout=120,
                ),
                "TikTok",
            )
            expected = 201 if final_chunk else 206
            if response.status_code != expected:
                raise ProviderError(
                    f"TikTok chunk upload failed with HTTP {response.status_code}"
                )
            first_byte = last_byte + 1
        if first_byte != size:
            raise ProviderError("TikTok upload chunks did not cover the full video")

    def _poll_status(self, headers: dict[str, str], publish_id: str) -> PublishReceipt:
        for attempt in range(self.poll_attempts):
            response = provider_request(
                lambda: self.client.post(
                    f"{_API}/post/publish/status/fetch/",
                    headers=headers,
                    json={"publish_id": publish_id},
                    timeout=30,
                ),
                "TikTok",
            )
            payload = require_json(response, "TikTok")
            _require_api_success(payload)
            data = _required_mapping(payload, "data")
            status = data.get("status")
            if status == "PUBLISH_COMPLETE":
                return PublishReceipt(
                    platform=self.platform,
                    remote_id=publish_id,
                    status="published",
                )
            if status == "FAILED":
                raise ProviderError("TikTok rejected the publication")
            if attempt + 1 < self.poll_attempts:
                self.sleep(self.poll_interval_seconds)
        return PublishReceipt(
            platform=self.platform,
            remote_id=publish_id,
            status="submitted",
        )

    def _chunk_plan(self, size: int) -> tuple[int, int]:
        if size <= 0:
            raise ProviderError("TikTok video asset is empty", retry_safe=True)
        if size <= self.chunk_size:
            return size, 1
        if size <= _MAX_CHUNK_BYTES:
            chunk_count = size // self.chunk_size
            if chunk_count >= 2:
                return self.chunk_size, chunk_count
            return size, 1
        chunk_size: int | None = None
        chunk_count = 0
        candidate = min(_MAX_CHUNK_BYTES, max(_MIN_CHUNK_BYTES, (size + 1) // 2))
        while candidate >= _MIN_CHUNK_BYTES:
            candidate_count = size // candidate
            remainder = size - (candidate_count * candidate)
            if candidate_count >= 2 and (
                remainder == 0 or remainder >= _MIN_CHUNK_BYTES
            ):
                if remainder <= 128 * _MIB:
                    chunk_size = candidate
                    chunk_count = candidate_count
                    break
            candidate = max(_MIN_CHUNK_BYTES, candidate - _MIB)
        if chunk_size is None:
            raise ProviderError(
                "TikTok video cannot be divided into valid chunks", retry_safe=True
            )
        if chunk_count > 1000:
            raise ProviderError(
                "TikTok video exceeds the upload chunk limit", retry_safe=True
            )
        return chunk_size, chunk_count


def _required_string(payload: dict, key: str) -> str:
    value = payload.get(key)
    if not isinstance(value, str) or not value:
        raise ProviderError(f"TikTok returned an invalid {key}")
    return value


def _required_mapping(payload: dict, key: str) -> dict:
    value = payload.get(key)
    if not isinstance(value, dict):
        raise ProviderError(f"TikTok returned an invalid {key}")
    return value


def _require_api_success(payload: dict) -> None:
    error = payload.get("error")
    if not isinstance(error, dict) or error.get("code") != "ok":
        raise ProviderError("TikTok rejected the API request")


def _validate_consent(consent: TikTokConsent, episode_id: str) -> None:
    try:
        consent.validate_for_episode(episode_id)
    except ValueError as exc:
        raise ProviderError(str(exc)) from exc
