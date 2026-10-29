"""Message adapters shared by OpenAI-compatible providers."""

from __future__ import annotations

import json
from typing import TYPE_CHECKING

from llm.core.types import Message, Role, ToolCall

if TYPE_CHECKING:
    from openai.types.chat import (
        ChatCompletionAssistantMessageParam,
        ChatCompletionMessageParam,
        ChatCompletionMessageToolCallParam,
        ChatCompletionSystemMessageParam,
        ChatCompletionToolMessageParam,
        ChatCompletionUserMessageParam,
    )


def _to_openai_tool_call_param(
    tool_call: ToolCall,
) -> ChatCompletionMessageToolCallParam:
    """Convert a domain tool call to the OpenAI request schema."""
    try:
        arguments = json.dumps(tool_call.arguments, allow_nan=False)
    except (TypeError, ValueError) as exc:
        raise ValueError("OpenAI tool call arguments must be valid JSON") from exc

    return {
        "id": tool_call.id,
        "type": "function",
        "function": {
            "name": tool_call.name,
            "arguments": arguments,
        },
    }


def to_openai_message_param(message: Message) -> ChatCompletionMessageParam:
    """Convert a domain message to the OpenAI chat-completions schema."""
    if message.role == Role.SYSTEM:
        system_message: ChatCompletionSystemMessageParam = {
            "role": "system",
            "content": message.content,
        }
        if message.name:
            system_message["name"] = message.name
        return system_message

    if message.role == Role.USER:
        user_message: ChatCompletionUserMessageParam = {
            "role": "user",
            "content": message.content,
        }
        if message.name:
            user_message["name"] = message.name
        return user_message

    if message.role == Role.ASSISTANT:
        assistant_message: ChatCompletionAssistantMessageParam = {
            "role": "assistant",
            "content": message.content,
        }
        if message.name:
            assistant_message["name"] = message.name
        if message.tool_calls:
            assistant_message["tool_calls"] = [
                _to_openai_tool_call_param(tool_call)
                for tool_call in message.tool_calls
            ]
        return assistant_message

    if message.role == Role.TOOL:
        if not message.tool_call_id:
            raise ValueError("OpenAI tool messages require a tool_call_id")
        tool_message: ChatCompletionToolMessageParam = {
            "role": "tool",
            "content": message.content,
            "tool_call_id": message.tool_call_id,
        }
        return tool_message

    raise ValueError(f"Unsupported OpenAI message role: {message.role}")
