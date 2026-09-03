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
from llm.core.types import (
    LLMInput,
    LLMOutput,
    Message,
    ModelInfo,
    ProviderType,
    Role,
    ToolCall,
)
from llm.providers.constants import EMPTY_FILTERED_RESPONSE_ERROR

JSONValue = None | bool | int | float | str | list["JSONValue"] | dict[str, "JSONValue"]

MINIMAX_BASE_URL = "https://api.minimax.io/v1"
MINIMAX_ANTHROPIC_BASE_URL = "https://api.minimax.io/anthropic"
MINIMAX_M2_7_MODEL = "MiniMax-M2.7"
DEFAULT_MINIMAX_MODEL = MINIMAX_M2_7_MODEL
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


def _serialize_provider_value(value: object) -> JSONValue:
    if value is None or isinstance(value, str | int | float | bool):
        return value
    if isinstance(value, dict):
        return {key: _serialize_provider_value(item) for key, item in value.items()}
    if isinstance(value, list | tuple):
        return [_serialize_provider_value(item) for item in value]

    model_dump = getattr(value, "model_dump", None)
    if callable(model_dump):
        return _serialize_provider_value(model_dump(mode="json", exclude_none=True))
    if hasattr(value, "__dict__"):
        return {
            key: _serialize_provider_value(item)
            for key, item in vars(value).items()
            if not key.startswith("_") and item is not None
        }
    raise TypeError(f"Unsupported provider value type: {type(value).__name__}")


def _openai_message(message: Message) -> dict[str, Any]:
    result: dict[str, Any] = {
        "role": message.role.value,
        "content": message.content,
    }
    if message.name:
        result["name"] = message.name
    if message.tool_call_id:
        result["tool_call_id"] = message.tool_call_id
    if message.tool_calls:
        result["tool_calls"] = [
            {
                "id": tool_call.id,
                "type": "function",
                "function": {
                    "name": tool_call.name,
                    "arguments": json.dumps(tool_call.arguments),
                },
            }
            for tool_call in message.tool_calls
        ]

    reasoning_details = message.metadata.get("openai_reasoning_details")
    if reasoning_details:
        result["reasoning_details"] = reasoning_details
    return result


def _anthropic_content_blocks(content: object) -> list[dict[str, Any]]:
    if isinstance(content, str):
        return [] if not content else [{"type": "text", "text": content}]
    if isinstance(content, list):
        return [dict(block) for block in content]
    raise TypeError("Anthropic message content must be text or content blocks")


def _anthropic_message(message: Message) -> dict[str, Any]:
    if message.role == Role.TOOL:
        if not message.tool_call_id:
            raise ValueError("Anthropic tool result messages require tool_call_id")
        return {
            "role": "user",
            "content": [
                {
                    "type": "tool_result",
                    "tool_use_id": message.tool_call_id,
                    "content": message.content,
                }
            ],
        }

    if message.role == Role.ASSISTANT:
        preserved_content = message.metadata.get("anthropic_content")
        content = (
            [dict(block) for block in preserved_content]
            if isinstance(preserved_content, list)
            else _anthropic_content_blocks(message.content)
        )
        if not preserved_content and message.tool_calls:
            content.extend(
                {
                    "type": "tool_use",
                    "id": tool_call.id,
                    "name": tool_call.name,
                    "input": tool_call.arguments,
                }
                for tool_call in message.tool_calls
            )
        return {"role": "assistant", "content": content}

    return {"role": message.role.value, "content": message.content}


def _anthropic_messages(messages: list[Message]) -> list[dict[str, Any]]:
    result: list[dict[str, Any]] = []
    for message in messages:
        if message.role == Role.SYSTEM:
            continue
        converted = _anthropic_message(message)
        if result and result[-1]["role"] == converted["role"]:
            result[-1]["content"] = _anthropic_content_blocks(
                result[-1]["content"]
            ) + _anthropic_content_blocks(converted["content"])
        else:
            result.append(converted)
    return result


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
                supports_vision=False,
                context_window=204_800,
            ),
        ]

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
            "messages": [_openai_message(msg) for msg in llm_input.messages],
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

        metadata: dict[str, Any] = {}
        reasoning_details = getattr(choice.message, "reasoning_details", None)
        if reasoning_details:
            metadata["openai_reasoning_details"] = _serialize_provider_value(
                reasoning_details
            )

        return LLMOutput(
            content=choice.message.content or "",
            tool_calls=tool_calls,
            model=response.model,
            usage=usage,
            stop_reason=choice.finish_reason,
            metadata=metadata,
        )

    def _generate_anthropic(self, llm_input: LLMInput) -> LLMOutput:
        system_parts: list[str] = []
        for message in llm_input.messages:
            if message.role != Role.SYSTEM:
                continue
            if not isinstance(message.content, str):
                raise TypeError("Anthropic system messages must contain text")
            system_parts.append(message.content)
        params: dict[str, Any] = {
            "model": llm_input.model or self.default_model,
            "messages": _anthropic_messages(llm_input.messages),
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
        preserved_content = _serialize_provider_value(response.content)
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
            metadata={"anthropic_content": preserved_content},
        )

    def list_models(self) -> list[ModelInfo]:
        return self._models.copy()

    def validate_config(self) -> bool:
        return bool(self.api_key)

    def supports_vision(self) -> bool:
        return any(
            model.name == self.default_model and model.supports_vision
            for model in self._models
        )

    def get_default_model(self) -> str:
        return self.default_model
