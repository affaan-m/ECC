from __future__ import annotations

import os
import stat
from collections.abc import Callable
from pathlib import Path
from typing import BinaryIO, Protocol
from urllib.parse import urlsplit

import httpx


class ProviderError(RuntimeError):
    """A provider operation failed; messages intentionally exclude response bodies."""

    def __init__(self, message: str, *, retry_safe: bool = False) -> None:
        super().__init__(message)
        self.retry_safe = retry_safe


class AccessTokenProvider(Protocol):
    def get_access_token(self) -> str: ...


def require_success(response: httpx.Response, provider: str) -> None:
    if not 200 <= response.status_code < 300:
        raise ProviderError(f"{provider} request failed with HTTP {response.status_code}")


def require_json(response: httpx.Response, provider: str) -> dict:
    require_success(response, provider)
    try:
        value = response.json()
    except ValueError as exc:
        raise ProviderError(f"{provider} returned invalid JSON") from exc
    if not isinstance(value, dict):
        raise ProviderError(f"{provider} returned an invalid response")
    return value


def validate_https_url(url: str, allowed_host_suffixes: tuple[str, ...]) -> None:
    parts = urlsplit(url)
    hostname = (parts.hostname or "").lower()
    if (
        parts.scheme != "https"
        or not hostname
        or parts.username is not None
        or parts.password is not None
        or (parts.port is not None and parts.port != 443)
        or not any(
            hostname == suffix.lstrip(".")
            or hostname.endswith(suffix if suffix.startswith(".") else f".{suffix}")
            for suffix in allowed_host_suffixes
        )
    ):
        raise ProviderError("Provider returned an unsafe upload URL")


def provider_request(
    request: Callable[[], httpx.Response], provider: str
) -> httpx.Response:
    try:
        return request()
    except (httpx.HTTPError, OSError) as exc:
        raise ProviderError(f"{provider} network request failed") from exc


def open_video_asset(path: Path, provider: str) -> tuple[BinaryIO, int]:
    if path.is_symlink():
        raise ProviderError(
            f"{provider} video asset must not be a symlink", retry_safe=True
        )
    flags = os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0)
    try:
        descriptor = os.open(path, flags)
    except OSError as exc:
        raise ProviderError(
            f"{provider} video asset could not be opened", retry_safe=True
        ) from exc
    try:
        video = os.fdopen(descriptor, "rb")
    except OSError as exc:
        os.close(descriptor)
        raise ProviderError(
            f"{provider} video asset could not be opened", retry_safe=True
        ) from exc
    try:
        metadata = os.fstat(video.fileno())
    except OSError as exc:
        video.close()
        raise ProviderError(
            f"{provider} video asset could not be inspected", retry_safe=True
        ) from exc
    if not stat.S_ISREG(metadata.st_mode) or metadata.st_size <= 0:
        video.close()
        raise ProviderError(
            f"{provider} video asset is not a non-empty regular file",
            retry_safe=True,
        )
    return video, metadata.st_size
