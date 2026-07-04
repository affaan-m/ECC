"""Shared provider constants."""

EMPTY_FILTERED_RESPONSE_ERROR = "LLM returned empty or filtered response"
MISSING_OPENAI_COMPAT_API_KEY = "missing-api-key"


def openai_compat_client_api_key(api_key: str) -> str:
    """Return a non-empty SDK key while preserving empty provider config state."""
    return api_key or MISSING_OPENAI_COMPAT_API_KEY
