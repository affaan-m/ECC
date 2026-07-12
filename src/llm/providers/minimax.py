"""MiniMax OpenAI- and Anthropic-compatible provider adapter."""

from __future__ import annotations

import json
import os
from typing import Any
from urllib.parse import urlsplit

from anthropic import Anthropic
from openai import OpenAI

from llm.core.interface import (
    AuthenticationError,
    ContextLengthError,
    LLMProvider,
    RateLimitError,
)
from llm.core.types import LLMInput, LLMOutput, ModelInfo, ProviderType, Role, ToolCall
from llm.providers.constants import EMPTY_FILTERED_RESPONSE_ERROR

MINIMAX_BASE_URL = "https://api.minimax.io/v1"
MINIMAX_ANTHROPIC_BASE_URL = "https://api.minimax.io/anthropic"
DEFAULT_MINIMAX_MODEL = "MiniMax-M3"
MINIMAX_M2_7_MODEL = "MiniMax-M2.7"
DEFAULT_MINIMAX_ANTHROPIC_MAX_TOKENS = 16_000


def _uses_anthropic_messages(base_url: str) -> bool:
    path = urlsplit(base_url).path.rstrip("/")
    return path.endswith("/anthropic")


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


class MiniMaxProvider(LLMProvider):
    """MiniMax endpoint using OpenAI chat completions or Anthropic messages."""

    provider_type = ProviderType.MINIMAX
    api_key_env = "MINIMAX_API_KEY"
    base_url_env = "MINIMAX_BASE_URL"
    model_env = "MINIMAX_MODEL"
    default_base_url = MINIMAX_BASE_URL

    def __init__(
        self,
        api_key: str | None = None,
        base_url: str | None = None,
        default_model: str | None = None,
    ) -> None:
        self.api_key = api_key or os.environ.get(self.api_key_env) or ""
        configured_base_url = base_url or os.environ.get(
            self.base_url_env, self.default_base_url
        )
        self._uses_anthropic = _uses_anthropic_messages(configured_base_url)
        self.base_url = configured_base_url
        self.default_model = (
            default_model or os.environ.get(self.model_env) or DEFAULT_MINIMAX_MODEL
        )
        self.client: Any
        if self._uses_anthropic:
            self.client = Anthropic(api_key=self.api_key, base_url=self.base_url)
        else:
            self.client = OpenAI(
                api_key=self.api_key,
                base_url=self.base_url,
                _enforce_credentials=False,
            )
        self._models = [
            ModelInfo(
                name=DEFAULT_MINIMAX_MODEL,
                provider=self.provider_type,
                supports_tools=True,
                supports_vision=True,
                max_tokens=524_288,
                context_window=1_000_000,
            ),
            ModelInfo(
                name=MINIMAX_M2_7_MODEL,
                provider=self.provider_type,
                supports_tools=True,
                supports_vision=False,
                max_tokens=204_800,
                context_window=204_800,
            ),
        ]
        if self.default_model not in {model.name for model in self._models}:
            self._models.append(
                ModelInfo(
                    name=self.default_model,
                    provider=self.provider_type,
                    supports_tools=True,
                )
            )

    def generate(self, llm_input: LLMInput) -> LLMOutput:
        try:
            if self._uses_anthropic:
                return self._generate_anthropic(llm_input)
            return self._generate_openai(llm_input)
        except Exception as e:
            msg = str(e)
            if "401" in msg or "authentication" in msg.lower():
                raise AuthenticationError(msg, provider=self.provider_type) from e
            if "429" in msg or "rate_limit" in msg.lower():
                raise RateLimitError(msg, provider=self.provider_type) from e
            if "context" in msg.lower() and "length" in msg.lower():
                raise ContextLengthError(msg, provider=self.provider_type) from e
            raise

    def _generate_openai(self, llm_input: LLMInput) -> LLMOutput:
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

        extra_body = {
            key: llm_input.metadata[key]
            for key in ("thinking", "reasoning_split", "service_tier")
            if key in llm_input.metadata
        }
        if extra_body:
            params["extra_body"] = extra_body

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

    def _generate_anthropic(self, llm_input: LLMInput) -> LLMOutput:
        system_parts = [
            msg.content for msg in llm_input.messages if msg.role == Role.SYSTEM
        ]
        params: dict[str, Any] = {
            "model": llm_input.model or self.default_model,
            "messages": [
                msg.to_dict() for msg in llm_input.messages if msg.role != Role.SYSTEM
            ],
            "max_tokens": (
                llm_input.max_tokens
                if llm_input.max_tokens is not None
                else DEFAULT_MINIMAX_ANTHROPIC_MAX_TOKENS
            ),
        }
        if system_parts:
            params["system"] = "\n\n".join(system_parts)
        if llm_input.temperature != 1.0:
            params["temperature"] = llm_input.temperature
        if llm_input.tools:
            params["tools"] = [tool.to_anthropic_tool() for tool in llm_input.tools]
        for key in ("thinking", "service_tier"):
            if key in llm_input.metadata:
                params[key] = llm_input.metadata[key]

        response = self.client.messages.create(**params)
        if not response.content:
            raise ValueError(EMPTY_FILTERED_RESPONSE_ERROR)
        text_parts: list[str] = []
        tool_calls: list[ToolCall] = []
        for block in response.content or []:
            block_type = getattr(block, "type", None)
            if block_type == "text":
                text = getattr(block, "text", "")
                if text:
                    text_parts.append(text)
            elif block_type == "tool_use":
                raw_arguments = getattr(block, "input", {})
                arguments = (
                    raw_arguments.copy()
                    if isinstance(raw_arguments, dict)
                    else getattr(raw_arguments, "__dict__", {}).copy()
                )
                tool_calls.append(
                    ToolCall(
                        id=getattr(block, "id", ""),
                        name=getattr(block, "name", ""),
                        arguments=arguments,
                    )
                )

        usage = None
        if response.usage:
            usage = {
                "input_tokens": response.usage.input_tokens,
                "output_tokens": response.usage.output_tokens,
                "cache_creation_input_tokens": getattr(
                    response.usage,
                    "cache_creation_input_tokens",
                    0,
                ),
                "cache_read_input_tokens": getattr(
                    response.usage,
                    "cache_read_input_tokens",
                    0,
                ),
            }

        return LLMOutput(
            content="".join(text_parts),
            tool_calls=tool_calls or None,
            model=response.model,
            usage=usage,
            stop_reason=response.stop_reason,
        )

    def list_models(self) -> list[ModelInfo]:
        return self._models.copy()

    def validate_config(self) -> bool:
        return bool(self.api_key)

    def get_default_model(self) -> str:
        return self.default_model
