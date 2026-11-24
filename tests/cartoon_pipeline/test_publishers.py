import json
from datetime import date, datetime
from pathlib import Path

import httpx
import pytest

from cartoon_pipeline.models import Episode, PublishApproval
from cartoon_pipeline.publishers.base import ProviderError
from cartoon_pipeline.publishers.dailymotion import DailymotionPublisher
from cartoon_pipeline.publishers.tiktok import TikTokConsent, TikTokPublisher
from cartoon_pipeline.publishers.youtube import YouTubePublisher
from cartoon_pipeline.utc import UTC


class StaticToken:
    def get_access_token(self) -> str:
        return "mock-access-token"


def make_episode(tmp_path: Path) -> Episode:
    landscape = tmp_path / "landscape.mp4"
    vertical = tmp_path / "vertical.mp4"
    landscape.write_bytes(b"not-a-real-video")
    vertical.write_bytes(b"not-a-real-video")
    return Episode(
        episode_id="2026-11-23",
        title="The Patient Little Seed",
        description="A gentle story about teamwork and growing a garden.",
        story=("A seed needs help.", "Friends work together.", "A garden grows."),
        episode_date=date(2026, 11, 23),
        landscape_path=landscape,
        vertical_path=vertical,
        audience_min_age=13,
        audience_max_age=15,
        made_for_kids=True,
        original=True,
        rights_cleared=True,
        safety_reviewed=True,
        contains_personal_data=False,
    )


def make_approval() -> PublishApproval:
    return PublishApproval(
        run_id="123456",
        approved_at=datetime(2026, 11, 23, tzinfo=UTC),
        source="github_environment",
    )


def test_youtube_upload_sets_made_for_kids_and_private_by_default(
    tmp_path: Path,
) -> None:
    requests: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        if request.method == "POST":
            return httpx.Response(
                200,
                headers={
                    "Location": (
                        "https://www.googleapis.com/upload/youtube/v3/videos"
                        "?uploadType=resumable&upload_id=opaque"
                    )
                },
            )
        return httpx.Response(200, json={"id": "yt-video-1"})

    client = httpx.Client(transport=httpx.MockTransport(handler))
    publisher = YouTubePublisher(StaticToken(), client=client)

    receipt = publisher.publish(make_episode(tmp_path), make_approval())
    metadata = json.loads(requests[0].content)

    assert receipt.remote_id == "yt-video-1"
    assert metadata["status"]["selfDeclaredMadeForKids"] is True
    assert metadata["status"]["privacyStatus"] == "private"
    assert requests[0].headers["authorization"] == "Bearer mock-access-token"
    assert requests[1].method == "PUT"


def test_youtube_errors_do_not_echo_provider_body_or_access_token(
    tmp_path: Path,
) -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(403, text="mock-access-token must not be logged")

    client = httpx.Client(transport=httpx.MockTransport(handler))
    publisher = YouTubePublisher(StaticToken(), client=client)

    with pytest.raises(ProviderError) as error:
        publisher.publish(make_episode(tmp_path), make_approval())

    assert "mock-access-token" not in str(error.value)
    assert "must not be logged" not in str(error.value)


def test_youtube_missing_asset_fails_before_any_provider_request(
    tmp_path: Path,
) -> None:
    requests: list[httpx.Request] = []
    client = httpx.Client(
        transport=httpx.MockTransport(
            lambda request: (requests.append(request), httpx.Response(200))[1]
        )
    )
    episode = make_episode(tmp_path)
    episode.landscape_path.unlink()
    publisher = YouTubePublisher(StaticToken(), client=client)

    with pytest.raises(ProviderError) as error:
        publisher.publish(episode, make_approval())

    assert error.value.retry_safe is True
    assert requests == []


def test_youtube_symlink_asset_fails_before_any_provider_request(
    tmp_path: Path,
) -> None:
    requests: list[httpx.Request] = []
    client = httpx.Client(
        transport=httpx.MockTransport(
            lambda request: (requests.append(request), httpx.Response(200))[1]
        )
    )
    episode = make_episode(tmp_path)
    target = tmp_path / "target.mp4"
    target.write_bytes(b"not-a-real-video")
    episode.landscape_path.unlink()
    episode.landscape_path.symlink_to(target)
    publisher = YouTubePublisher(StaticToken(), client=client)

    with pytest.raises(ProviderError, match="symlink") as error:
        publisher.publish(episode, make_approval())

    assert error.value.retry_safe is True
    assert requests == []


def test_dailymotion_upload_marks_content_for_children_and_uses_private_visibility(
    tmp_path: Path,
) -> None:
    requests: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        if request.url.path.endswith("upload_sessions"):
            return httpx.Response(
                201,
                json={
                    "upload_url": "https://upload-eu.dailymotion.com/upload?id=1",
                    "progress_url": "https://upload-eu.dailymotion.com/progress?id=1",
                },
            )
        if request.url.host == "upload-eu.dailymotion.com":
            return httpx.Response(
                200,
                json={"url": "https://upload-eu.dailymotion.com/files/video-1"},
            )
        return httpx.Response(201, json={"id": "dm-video-1"})

    client = httpx.Client(transport=httpx.MockTransport(handler))
    publisher = DailymotionPublisher(
        StaticToken(), profile_id="partner-profile", client=client
    )

    receipt = publisher.publish(make_episode(tmp_path), make_approval())
    metadata = json.loads(requests[-1].content)

    assert receipt.remote_id == "dm-video-1"
    assert metadata["is_for_kids"] is True
    assert metadata["visibility"] == "private"
    assert metadata["category"] == "kids"


def test_tiktok_does_not_post_without_per_episode_creator_consent(
    tmp_path: Path,
) -> None:
    requests: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        return httpx.Response(200, json={})

    client = httpx.Client(transport=httpx.MockTransport(handler))
    publisher = TikTokPublisher(StaticToken(), client=client)

    with pytest.raises(ProviderError, match="consent"):
        publisher.publish(make_episode(tmp_path), make_approval(), consent=None)

    assert requests == []


def test_tiktok_consent_requires_recent_explicit_confirmation() -> None:
    with pytest.raises(ValueError, match="recent"):
        TikTokConsent(
            consent_id="consent-1",
            privacy_level="PUBLIC_TO_EVERYONE",
            confirmed_at=datetime(2020, 1, 1, tzinfo=UTC),
        )


def test_tiktok_posts_only_after_creator_info_and_uploads_without_bearer_token(
    tmp_path: Path,
) -> None:
    requests: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        if request.url.path.endswith("creator_info/query/"):
            return httpx.Response(
                200,
                json={
                    "data": {"privacy_level_options": ["PUBLIC_TO_EVERYONE"]},
                    "error": {"code": "ok"},
                },
            )
        if request.url.path.endswith("video/init/"):
            return httpx.Response(
                200,
                json={
                    "data": {
                        "publish_id": "publish-1",
                        "upload_url": "https://open-upload.tiktokapis.com/upload?token=secret",
                    },
                    "error": {"code": "ok"},
                },
            )
        if request.method == "PUT":
            return httpx.Response(201)
        return httpx.Response(
            200,
            json={
                "data": {"status": "PUBLISH_COMPLETE"},
                "error": {"code": "ok"},
            },
        )

    client = httpx.Client(transport=httpx.MockTransport(handler))
    publisher = TikTokPublisher(
        StaticToken(),
        client=client,
        poll_attempts=1,
    )
    consent = TikTokConsent(
        consent_id="consent-episode-1",
        privacy_level="PUBLIC_TO_EVERYONE",
        confirmed_at=datetime.now(UTC),
    )

    receipt = publisher.publish(make_episode(tmp_path), make_approval(), consent)

    assert receipt.remote_id == "publish-1"
    upload_request = next(request for request in requests if request.method == "PUT")
    assert "authorization" not in upload_request.headers
    assert upload_request.headers["content-range"].startswith("bytes 0-")
