"""Claude provider adapter."""

from __future__ import annotations

import os
from typing import Any

from anthropic import Anthropic

from llm.core.interface import (
    AuthenticationError,
    ContextLengthError,
    LLMProvider,
    RateLimitError,
)
from llm.core.types import LLMInput, LLMOutput, ModelInfo, ProviderType, Role, ToolCall

_DEFAULT_MODEL = "claude-sonnet-4-6"
_OPUS_ADAPTIVE_ONLY_PREFIXES = ("claude-opus-4-7", "claude-opus-4-8")


def _strip_tool_use(message: dict[str, Any], tool_use_id: str) -> dict[str, Any]:
    """Return a copy of *message* with the tool_use block whose id matches
    *tool_use_id* removed from its content list.

    Called when an orphan tool_result (whose tool_use is no longer
    immediately preceding it) is dropped, so the request still has no
    unanswered tool_use on the wire — the Anthropic API requires every
    tool_use to have a matching tool_result in the immediately following
    user turn.
    """
    content = message.get("content")
    if not isinstance(content, list):
        return message
    filtered = [
        block
        for block in content
        if not (isinstance(block, dict) and block.get("type") == "tool_use" and block.get("id") == tool_use_id)
    ]
    if len(filtered) == len(content):
        return message
    return {**message, "content": filtered}


def _uses_adaptive_thinking_only(model: str) -> bool:
    return any(model.startswith(prefix) for prefix in _OPUS_ADAPTIVE_ONLY_PREFIXES)


class ClaudeProvider(LLMProvider):
    provider_type = ProviderType.CLAUDE

    def __init__(self, api_key: str | None = None, base_url: str | None = None) -> None:
        self.client = Anthropic(api_key=api_key or os.environ.get("ANTHROPIC_API_KEY"), base_url=base_url)
        self._models = [
            ModelInfo(
                name="claude-opus-4-8",
                provider=ProviderType.CLAUDE,
                supports_tools=True,
                supports_vision=True,
                max_tokens=64000,
                context_window=1_000_000,
            ),
            ModelInfo(
                name="claude-sonnet-4-6",
                provider=ProviderType.CLAUDE,
                supports_tools=True,
                supports_vision=True,
                max_tokens=64000,
                context_window=1_000_000,
            ),
            ModelInfo(
                name="claude-haiku-4-5",
                provider=ProviderType.CLAUDE,
                supports_tools=True,
                supports_vision=True,
                max_tokens=16000,
                context_window=200_000,
            ),
        ]


    def generate(self, input: LLMInput) -> LLMOutput:
        try:
            model = input.model or _DEFAULT_MODEL
            system_parts = [msg.content for msg in input.messages if msg.role == Role.SYSTEM]
            api_messages: list[dict[str, Any]] = []
            # The Anthropic Messages API requires `tool_result` blocks in the
            # user turn *immediately* following the matching assistant
            # `tool_use` turn. Once a different user/assistant message has
            # been emitted between the two, any later `tool_result` becomes
            # an orphan that the API rejects with a 400. Track the ids of
            # tool_use blocks whose immediate-after-tool_result window is
            # still open, and consume an id as soon as a matching tool_result
            # is processed.
            pending_tool_use_ids: set[str] = set()
            # Index of the most recent assistant turn that emitted one or
            # more tool_use blocks. When an orphan tool_result is dropped we
            # must also remove the matching tool_use from this turn —
            # leaving an unanswered tool_use on the wire also 400s.
            last_assistant_message_idx: int | None = None
            for message in input.messages:
                if message.role == Role.SYSTEM:
                    continue
                if message.role == Role.ASSISTANT and message.tool_calls:
                    # A new assistant turn closes any prior window and opens
                    # a new one for the tool_use blocks emitted here.
                    pending_tool_use_ids = {
                        tc.id for tc in message.tool_calls if tc.id
                    }
                    last_assistant_message_idx = None  # reset until we append
                elif message.role != Role.TOOL:
                    # Any non-TOOL message (USER text, plain ASSISTANT
                    # reply, ...) closes the immediate-after-tool_use
                    # window for every pending id.
                    pending_tool_use_ids.clear()
                serialized = message.to_anthropic_dict()
                if serialized is None:
                    # Orphan tool message (no tool_call_id) — already noted
                    # at serialization time; skip it here too.
                    continue
                if message.role == Role.TOOL and message.tool_call_id:
                    if message.tool_call_id not in pending_tool_use_ids:
                        # tool_result whose matching tool_use is no longer
                        # immediately before this message (e.g. a user text
                        # turn was interleaved). Drop the tool_result AND
                        # the unanswered tool_use it would have replied to
                        # — otherwise the API rejects the request because
                        # every tool_use must have a matching tool_result
                        # in the immediately following user turn.
                        orphan_id = message.tool_call_id
                        pending_tool_use_ids.discard(orphan_id)
                        if last_assistant_message_idx is not None:
                            api_messages[last_assistant_message_idx] = _strip_tool_use(
                                api_messages[last_assistant_message_idx], orphan_id
                            )
                        continue
                    pending_tool_use_ids.discard(message.tool_call_id)
                merges_with_previous = (
                    message.role == Role.TOOL
                    and bool(api_messages)
                    and api_messages[-1]["role"] == Role.USER.value
                    and isinstance(api_messages[-1]["content"], list)
                )
                appended_idx = len(api_messages) if not merges_with_previous else None
                if merges_with_previous:
                    previous = api_messages[-1]
                    api_messages[-1] = {
                        **previous,
                        "content": [*previous["content"], *serialized["content"]],
                    }
                else:
                    api_messages.append(serialized)
                if appended_idx is not None and message.role == Role.ASSISTANT and message.tool_calls:
                    last_assistant_message_idx = appended_idx

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
            if not _uses_adaptive_thinking_only(model):
                params["temperature"] = input.temperature
            if _uses_adaptive_thinking_only(model):
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
            if "401" in msg or "authentication" in msg.lower():
                raise AuthenticationError(msg, provider=ProviderType.CLAUDE) from e
            if "429" in msg or "rate_limit" in msg.lower():
                raise RateLimitError(msg, provider=ProviderType.CLAUDE) from e
            if "context" in msg.lower() and "length" in msg.lower():
                raise ContextLengthError(msg, provider=ProviderType.CLAUDE) from e
            raise

    def list_models(self) -> list[ModelInfo]:
        return self._models.copy()

    def validate_config(self) -> bool:
        return bool(self.client.api_key)

    def get_default_model(self) -> str:
        return _DEFAULT_MODEL
