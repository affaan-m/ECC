"""Atlas Cloud OpenAI-compatible provider adapter."""

from __future__ import annotations

import json
import os
from typing import Any

from openai import OpenAI

from llm.core.interface import (
    AuthenticationError,
    ContextLengthError,
    LLMProvider,
    RateLimitError,
)
from llm.core.types import LLMInput, LLMOutput, ModelInfo, ProviderType, ToolCall
from llm.providers.constants import EMPTY_FILTERED_RESPONSE_ERROR

ATLAS_BASE_URL = "https://api.atlascloud.ai/v1"
DEFAULT_ATLAS_MODEL = "deepseek-ai/deepseek-v4-pro"
# Reasoning models need enough headroom for their thinking budget plus the answer.
DEFAULT_ATLAS_MAX_TOKENS = 512


def _parse_tool_arguments(raw_arguments: str | None) -> dict[str, Any]:
    if not raw_arguments:
        return {}

    try:
        arguments = json.loads(raw_arguments)
    except json.JSONDecodeError:
        return {"raw": raw_arguments}

    if isinstance(arguments, dict):
        return arguments
    return {"value": arguments}


class AtlasProvider(LLMProvider):
    """Atlas Cloud endpoint using OpenAI-compatible chat completions.

    Atlas Cloud (https://atlascloud.ai) exposes 300+ hosted models behind a
    single OpenAI-compatible API, so it reuses the same chat-completions flow as
    the other OpenAI-compatible adapters in this package.
    """

    provider_type = ProviderType.ATLAS
    # ``.env.example`` documents ATLAS_API_KEY; ATLASCLOUD_API_KEY is the name used
    # by the Atlas Cloud SDK/skill, so accept either for convenience.
    api_key_env = "ATLAS_API_KEY"
    fallback_api_key_env = "ATLASCLOUD_API_KEY"
    base_url_env = "ATLAS_BASE_URL"
    model_env = "ATLAS_MODEL"
    default_base_url = ATLAS_BASE_URL

    def __init__(
        self,
        api_key: str | None = None,
        base_url: str | None = None,
        default_model: str | None = None,
    ) -> None:
        self.api_key = (
            api_key
            or os.environ.get(self.api_key_env)
            or os.environ.get(self.fallback_api_key_env)
            or ""
        )
        self.base_url = base_url or os.environ.get(self.base_url_env, self.default_base_url)
        env_model = os.environ.get(self.model_env)
        self.default_model = default_model or env_model or DEFAULT_ATLAS_MODEL
        self.client = OpenAI(api_key=self.api_key, base_url=self.base_url, _enforce_credentials=False)
        self._models = [
            ModelInfo(
                name=self.default_model,
                provider=self.provider_type,
                supports_tools=True,
                supports_vision=False,
            )
        ]

    def generate(self, llm_input: LLMInput) -> LLMOutput:
        try:
            params: dict[str, Any] = {
                "model": llm_input.model or self.default_model,
                "messages": [msg.to_dict() for msg in llm_input.messages],
            }
            if llm_input.temperature != 1.0:
                params["temperature"] = llm_input.temperature
            # Atlas reasoning models spend tokens on a thinking budget before the
            # answer, so floor max_tokens to avoid truncated/empty completions.
            max_tokens = llm_input.max_tokens
            if max_tokens is None or max_tokens < DEFAULT_ATLAS_MAX_TOKENS:
                max_tokens = DEFAULT_ATLAS_MAX_TOKENS
            params["max_tokens"] = max_tokens
            if llm_input.tools:
                params["tools"] = [tool.to_openai_tool() for tool in llm_input.tools]

            response = self.client.chat.completions.create(**params)
            if not response.choices or response.choices[0].message is None:
                raise ValueError(EMPTY_FILTERED_RESPONSE_ERROR)
            choice = response.choices[0]

            tool_calls = None
            if choice.message.tool_calls:
                tool_calls = [
                    ToolCall(
                        id=tc.id or "",
                        name=tc.function.name,
                        arguments=_parse_tool_arguments(tc.function.arguments),
                    )
                    for tc in choice.message.tool_calls
                ]

            usage = None
            if response.usage:
                usage = {
                    "prompt_tokens": response.usage.prompt_tokens,
                    "completion_tokens": response.usage.completion_tokens,
                    "total_tokens": response.usage.total_tokens,
                }

            return LLMOutput(
                content=choice.message.content or "",
                tool_calls=tool_calls,
                model=response.model,
                usage=usage,
                stop_reason=choice.finish_reason,
            )
        except Exception as e:
            msg = str(e)
            if "401" in msg or "authentication" in msg.lower():
                raise AuthenticationError(msg, provider=self.provider_type) from e
            if "429" in msg or "rate_limit" in msg.lower():
                raise RateLimitError(msg, provider=self.provider_type) from e
            if "context" in msg.lower() and "length" in msg.lower():
                raise ContextLengthError(msg, provider=self.provider_type) from e
            raise

    def list_models(self) -> list[ModelInfo]:
        return self._models.copy()

    def validate_config(self) -> bool:
        return bool(self.api_key)

    def get_default_model(self) -> str:
        return self.default_model
