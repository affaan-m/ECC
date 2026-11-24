import httpx
import pytest

from cartoon_pipeline.publishers.oauth import (
    OAuthCredentials,
    OAuthError,
    OAuthTokenProvider,
)


def test_oauth_refresh_uses_provider_endpoint_and_returns_access_token() -> None:
    requests: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        return httpx.Response(200, json={"access_token": "temporary-token"})

    client = httpx.Client(transport=httpx.MockTransport(handler))
    provider = OAuthTokenProvider(
        OAuthCredentials("youtube", "client-id", "client-secret", "refresh-token"),
        client=client,
    )

    assert provider.get_access_token() == "temporary-token"
    assert requests[0].url.host == "oauth2.googleapis.com"
    assert b"refresh_token=refresh-token" in requests[0].content


def test_oauth_rotation_fails_closed_instead_of_losing_new_refresh_secret() -> None:
    client = httpx.Client(
        transport=httpx.MockTransport(
            lambda request: httpx.Response(
                200,
                json={
                    "access_token": "temporary-token",
                    "refresh_token": "rotated-refresh-token",
                },
            )
        )
    )
    provider = OAuthTokenProvider(
        OAuthCredentials("tiktok", "client-id", "client-secret", "old-refresh-token"),
        client=client,
    )

    with pytest.raises(OAuthError, match="rotated its refresh token") as error:
        provider.get_access_token()

    assert error.value.retry_safe is False


def test_oauth_network_failure_is_safe_to_retry_before_upload() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("connection unavailable", request=request)

    client = httpx.Client(transport=httpx.MockTransport(handler))
    provider = OAuthTokenProvider(
        OAuthCredentials("youtube", "client-id", "client-secret", "refresh-token"),
        client=client,
    )

    with pytest.raises(OAuthError) as error:
        provider.get_access_token()

    assert error.value.retry_safe is True


def test_oauth_credentials_are_read_from_environment_names_only() -> None:
    provider = OAuthTokenProvider.from_environment(
        "dailymotion",
        {
            "DAILYMOTION_CLIENT_ID": "id",
            "DAILYMOTION_CLIENT_SECRET": "secret",
            "DAILYMOTION_REFRESH_TOKEN": "refresh",
        },
    )

    assert provider.credentials.provider == "dailymotion"
