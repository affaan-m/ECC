"""Claude provider adapter."""

from __future__ import annotations

import os
import re
from typing import Any

from anthropic import Anthropic

from llm.core.interface import (
    AuthenticationError,
    ContextLengthError,
    LLMProvider,
    RateLimitError,
)
from llm.core.types import LLMInput, LLMOutput, ModelInfo, ProviderType, Role, ToolCall

_DEFAULT_MODEL = "claude-sonnet-5-5"
# Family and version of a model ID: "claude-opus-4-8" -> ("opus", 4, 8). A date
# suffix is not a minor version: "claude-sonnet-4-20250514" -> ("sonnet", 4, 0).
_MODEL_VERSION = re.compile(r"claude-([a-z]+)-(\d+)(?:-(\d{1,2}))?(?!\d)")


def _model_version(model: str) -> tuple[str, int, int] | None:
    match = _MODEL_VERSION.search(model)
    if match is None:
        return None
    family, major, minor = match.groups()
    return family, int(major), int(minor or 0)


def _needs_explicit_adaptive_thinking(model: str) -> bool:
    """Opus 4.7/4.8 skip thinking unless asked; Claude 5 models think by default.

    Both accept ``{"type": "adaptive"}``, and neither accepts a thinking budget.
    """
    version = _model_version(model)
    if version is None:
        return False
    family, major, minor = version
    return major >= 5 or (family == "opus" and (major, minor) >= (4, 7))


class ClaudeProvider(LLMProvider):
    provider_type = ProviderType.CLAUDE

    def __init__(
        self,
        api_key: str | None = None,
        base_url: str | None = None,
        default_model: str | None = None,
    ) -> None:
        self.client = Anthropic(api_key=api_key or os.environ.get("ANTHROPIC_API_KEY"), base_url=base_url)
        self.default_model = default_model or _DEFAULT_MODEL
        self._models = [
            ModelInfo(
                name="claude-opus-5-5",
                provider=ProviderType.CLAUDE,
                supports_tools=True,
                supports_vision=True,
                max_tokens=128_000,
                context_window=1_000_000,
            ),
            ModelInfo(
                name="claude-sonnet-5-5",
                provider=ProviderType.CLAUDE,
                supports_tools=True,
                supports_vision=True,
                max_tokens=128_000,
                context_window=1_000_000,
            ),
            ModelInfo(
                name="claude-haiku-5-5",
                provider=ProviderType.CLAUDE,
                supports_tools=True,
                supports_vision=True,
                max_tokens=128_000,
                context_window=1_000_000,
            ),
        ]

    def generate(self, input: LLMInput) -> LLMOutput:
        try:
            model = input.model or self.default_model
            system_parts: list[str] = []
            for message in input.messages:
                if message.role != Role.SYSTEM:
                    continue
                if not isinstance(message.content, str):
                    raise TypeError("System messages must contain text")
                system_parts.append(message.content)
            api_messages = [
                msg.to_dict() for msg in input.messages if msg.role not in (Role.SYSTEM,)
            ]

            params: dict[str, Any] = {
                "model": model,
                "messages": api_messages,
                "max_tokens": input.max_tokens if input.max_tokens else 16000,
            }
            if system_parts:
                params["system"] = [
                    {
                        "type": "text",
                        "text": "\n\n".join(system_parts),
                        "cache_control": {"type": "ephemeral"},
                    }
                ]
            if input.tools:
                params["tools"] = [tool.to_anthropic_tool() for tool in input.tools]
            # No temperature: anthropic 2.x sends API version 2026-10-21, which
            # rejects sampling parameters on every model, and its
            # messages.create() no longer accepts them.
            if _needs_explicit_adaptive_thinking(model):
                params["thinking"] = {"type": "adaptive"}

            response = self.client.messages.create(**params)

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

            return LLMOutput(
                content="".join(text_parts),
                tool_calls=tool_calls or None,
                model=response.model,
                usage={
                    "input_tokens": response.usage.input_tokens,
                    "output_tokens": response.usage.output_tokens,
                    "cache_creation_input_tokens": getattr(
                        response.usage, "cache_creation_input_tokens", 0
                    ),
                    "cache_read_input_tokens": getattr(response.usage, "cache_read_input_tokens", 0),
                },
                stop_reason=response.stop_reason,
            )
        except Exception as e:
            msg = str(e)
            status_code = getattr(e, "status_code", None)
            if status_code == 401:
                raise AuthenticationError(msg, provider=ProviderType.CLAUDE) from e
            if status_code == 429:
                raise RateLimitError(msg, provider=ProviderType.CLAUDE) from e
            if "context" in msg.lower() and "length" in msg.lower():
                raise ContextLengthError(msg, provider=ProviderType.CLAUDE) from e
            raise

    def list_models(self) -> list[ModelInfo]:
        return self._models.copy()

    def validate_config(self) -> bool:
        return bool(self.client.api_key)

    def get_default_model(self) -> str:
        return self.default_model
