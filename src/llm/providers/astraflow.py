"""Astraflow/UModelVerse OpenAI-compatible provider adapters."""

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

ASTRAFLOW_BASE_URL = "https://api.umodelverse.ai/v1"
ASTRAFLOW_CN_BASE_URL = "https://api.modelverse.cn/v1"
DEFAULT_ASTRAFLOW_MODEL = "gpt-4o-mini"


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


class _AstraflowBaseProvider(LLMProvider):
    provider_type: ProviderType
    api_key_env: str
    base_url_env: str
    model_env: str
    fallback_model_env: str | None = None
    default_base_url: str
    default_model = DEFAULT_ASTRAFLOW_MODEL

    def __init__(
        self,
        api_key: str | None = None,
        base_url: str | None = None,
        default_model: str | None = None,
    ) -> None:
        self.api_key = api_key or os.environ.get(self.api_key_env) or ""
        self.base_url = base_url or os.environ.get(self.base_url_env, self.default_base_url)
        env_model = os.environ.get(self.model_env)
        fallback_model = os.environ.get(self.fallback_model_env) if self.fallback_model_env else None
        self.default_model = default_model or env_model or fallback_model or DEFAULT_ASTRAFLOW_MODEL
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
            if llm_input.max_tokens is not None:
                params["max_tokens"] = llm_input.max_tokens
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


class AstraflowProvider(_AstraflowBaseProvider):
    """UModelVerse global endpoint using OpenAI-compatible chat completions."""

    provider_type = ProviderType.ASTRAFLOW
    api_key_env = "ASTRAFLOW_API_KEY"
    base_url_env = "ASTRAFLOW_BASE_URL"
    model_env = "ASTRAFLOW_MODEL"
    default_base_url = ASTRAFLOW_BASE_URL


class AstraflowCNProvider(_AstraflowBaseProvider):
    """UModelVerse China endpoint using OpenAI-compatible chat completions."""

    provider_type = ProviderType.ASTRAFLOW_CN
    api_key_env = "ASTRAFLOW_CN_API_KEY"
    base_url_env = "ASTRAFLOW_CN_BASE_URL"
    model_env = "ASTRAFLOW_CN_MODEL"
    fallback_model_env = "ASTRAFLOW_MODEL"
    default_base_url = ASTRAFLOW_CN_BASE_URL
