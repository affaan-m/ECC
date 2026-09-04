"""Core type definitions for LLM abstraction layer."""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import Any


class Role(str, Enum):
    SYSTEM = "system"
    USER = "user"
    ASSISTANT = "assistant"
    TOOL = "tool"


class ProviderType(str, Enum):
    CLAUDE = "claude"
    OPENAI = "openai"
    OLLAMA = "ollama"
    ASTRAFLOW = "astraflow"
    ASTRAFLOW_CN = "astraflow_cn"
    ATLAS = "atlas"


@dataclass(frozen=True)
class Message:
    role: Role
    content: str
    name: str | None = None
    tool_call_id: str | None = None
    tool_calls: list[ToolCall] | None = None

    def to_dict(self) -> dict[str, Any]:
        result: dict[str, Any] = {"role": self.role.value, "content": self.content}
        if self.name:
            result["name"] = self.name
        if self.tool_call_id:
            result["tool_call_id"] = self.tool_call_id
        if self.tool_calls:
            result["tool_calls"] = [
                {"id": tc.id, "function": {"name": tc.name, "arguments": tc.arguments}}
                for tc in self.tool_calls
            ]
        return result


@dataclass(frozen=True)
class ToolDefinition:
    name: str
    description: str
    parameters: dict[str, Any]
    strict: bool = True

    def to_dict(self) -> dict[str, Any]:
        return {
            "name": self.name,
            "description": self.description,
            "parameters": self.parameters,
            "strict": self.strict,
        }

    def to_openai_tool(self) -> dict[str, Any]:
        return {
            "type": "function",
            "function": {
                "name": self.name,
                "description": self.description,
                "parameters": self.parameters,
                "strict": self.strict,
            },
        }

    def to_anthropic_tool(self) -> dict[str, Any]:
        return {
            "name": self.name,
            "description": self.description,
            "input_schema": self.parameters,
        }


@dataclass(frozen=True)
class ToolCall:
    id: str
    name: str
    arguments: dict[str, Any]


@dataclass(frozen=True)
class ToolResult:
    tool_call_id: str
    content: str
    is_error: bool = False


@dataclass(frozen=True)
class LLMInput:
    messages: list[Message]
    model: str | None = None
    temperature: float = 1.0
    max_tokens: int | None = None
    tools: list[ToolDefinition] | None = None
    stream: bool = False
    metadata: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        result: dict[str, Any] = {
            "messages": [msg.to_dict() for msg in self.messages],
            "temperature": self.temperature,
            "stream": self.stream,
        }
        if self.model:
            result["model"] = self.model
        if self.max_tokens is not None:
            result["max_tokens"] = self.max_tokens
        if self.tools:
            result["tools"] = [tool.to_dict() for tool in self.tools]
        return result | self.metadata


@dataclass(frozen=True)
class LLMOutput:
    content: str
    tool_calls: list[ToolCall] | None = None
    model: str | None = None
    usage: dict[str, int] | None = None
    stop_reason: str | None = None
    metadata: dict[str, Any] = field(default_factory=dict)

    @property
    def has_tool_calls(self) -> bool:
        return bool(self.tool_calls)

    def to_dict(self) -> dict[str, Any]:
        result: dict[str, Any] = {"content": self.content}
        if self.tool_calls:
            result["tool_calls"] = [
                {"id": tc.id, "name": tc.name, "arguments": tc.arguments}
                for tc in self.tool_calls
            ]
        if self.model:
            result["model"] = self.model
        if self.usage:
            result["usage"] = self.usage
        if self.stop_reason:
            result["stop_reason"] = self.stop_reason
        return result | self.metadata


@dataclass(frozen=True)
class ModelInfo:
    name: str
    provider: ProviderType
    supports_tools: bool = True
    supports_vision: bool = False
    max_tokens: int | None = None
    context_window: int | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "name": self.name,
            "provider": self.provider.value,
            "supports_tools": self.supports_tools,
            "supports_vision": self.supports_vision,
            "max_tokens": self.max_tokens,
            "context_window": self.context_window,
        }
