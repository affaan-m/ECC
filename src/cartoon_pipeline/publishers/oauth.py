from __future__ import annotations

import os
from collections.abc import Mapping
from dataclasses import dataclass

import httpx

from cartoon_pipeline.publishers.base import ProviderError, require_json

_TOKEN_URLS = {
    "youtube": "https://oauth2.googleapis.com/token",
    "dailymotion": "https://oauth2.dailymotion.com/v2/token",
    "tiktok": "https://open.tiktokapis.com/v2/oauth/token/",
}


class OAuthError(ProviderError):
    """Raised when an OAuth refresh cannot safely produce an access token."""


@dataclass(frozen=True)
class OAuthCredentials:
    provider: str
    client_id: str
    client_secret: str
    refresh_token: str | None = None


class OAuthTokenProvider:
    def __init__(
        self,
        credentials: OAuthCredentials,
        client: httpx.Client | None = None,
    ) -> None:
        if credentials.provider not in _TOKEN_URLS:
            raise ValueError("Unsupported OAuth provider")
        required = (credentials.client_id, credentials.client_secret)
        if credentials.provider != "dailymotion":
            required += (credentials.refresh_token or "",)
        if not all(value.strip() for value in required):
            raise ValueError("OAuth credentials must not be empty")
        self.credentials = credentials
        self.client = client or httpx.Client(timeout=20)

    @classmethod
    def from_environment(
        cls, provider: str, environ: Mapping[str, str] | None = None
    ) -> OAuthTokenProvider:
        values = os.environ if environ is None else environ
        prefix = provider.upper()
        names = {
            "client_id": f"{prefix}_CLIENT_ID",
            "client_secret": f"{prefix}_CLIENT_SECRET",
        }
        if provider != "dailymotion":
            names["refresh_token"] = f"{prefix}_REFRESH_TOKEN"
        missing = [key for key, name in names.items() if not values.get(name)]
        if missing:
            raise OAuthError(
                f"Missing OAuth environment variables for {provider}: "
                + ", ".join(names[key] for key in missing)
            )
        return cls(
            OAuthCredentials(
                provider=provider,
                client_id=values[names["client_id"]],
                client_secret=values[names["client_secret"]],
                refresh_token=values.get(names.get("refresh_token", "")),
            )
        )

    def get_access_token(self) -> str:
        form = self._refresh_form()
        try:
            response = self.client.post(
                _TOKEN_URLS[self.credentials.provider],
                data=form,
                headers={"Accept": "application/json"},
                timeout=20,
            )
        except httpx.HTTPError as exc:
            raise OAuthError(
                f"{self.credentials.provider} OAuth refresh failed",
                retry_safe=True,
            ) from exc
        try:
            payload = require_json(response, self.credentials.provider)
        except ProviderError as exc:
            raise OAuthError(
                f"{self.credentials.provider} OAuth refresh failed",
                retry_safe=True,
            ) from exc
        access_token = payload.get("access_token")
        if not isinstance(access_token, str) or not access_token.strip():
            raise OAuthError(
                f"{self.credentials.provider} OAuth response lacks an access token",
                retry_safe=True,
            )
        rotated = payload.get("refresh_token")
        if (
            self.credentials.refresh_token
            and isinstance(rotated, str)
            and rotated
            and rotated != self.credentials.refresh_token
        ):
            raise OAuthError(
                f"{self.credentials.provider} rotated its refresh token; "
                "update the configured secret before publishing"
            )
        return access_token

    def _refresh_form(self) -> dict[str, str]:
        values = self.credentials
        if values.provider == "tiktok":
            refresh_token = values.refresh_token
            if not refresh_token:
                raise OAuthError("TikTok refresh token is required")
            return {
                "client_key": values.client_id,
                "client_secret": values.client_secret,
                "grant_type": "refresh_token",
                "refresh_token": refresh_token,
            }
        if values.provider == "dailymotion":
            return {
                "client_id": values.client_id,
                "client_secret": values.client_secret,
                "grant_type": "client_credentials",
                "scope": "video.manage",
            }
        return {
            "client_id": values.client_id,
            "client_secret": values.client_secret,
            "grant_type": "refresh_token",
            "refresh_token": values.refresh_token or "",
        }
