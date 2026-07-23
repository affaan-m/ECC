"""Prompt builder for normalizing prompts across providers."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from llm.core.types import LLMInput, Message, Role, ToolDefinition
from llm.providers.claude import ClaudeProvider
from llm.providers.openai import OpenAIProvider
from llm.providers.ollama import OllamaProvider


@dataclass
class PromptConfig:
    system_template: str | None = None
    user_template: str | None = None
    include_tools_in_system: bool = True
    tool_format: str = "native"


class PromptBuilder:
    def __init__(
        self,
        config: PromptConfig | None = None,
        *,
        system_template: str | None = None,
        user_template: str | None = None,
        include_tools_in_system: bool | None = None,
        tool_format: str | None = None,
    ) -> None:
        if config is not None and any(
            value is not None
            for value in (system_template, user_template, include_tools_in_system, tool_format)
        ):
            raise ValueError("Pass either config or PromptBuilder keyword options, not both")

        if config is None:
            overrides = {
                "system_template": system_template,
                "user_template": user_template,
                "include_tools_in_system": include_tools_in_system,
                "tool_format": tool_format,
            }
            config = PromptConfig(**{key: value for key, value in overrides.items() if value is not None})

        self.config = config

    def build(self, messages: list[Message], tools: list[ToolDefinition] | None = None) -> list[Message]:
        if not messages:
            return []

        result: list[Message] = []
        system_parts: list[str] = []

        if self.config.system_template:
            system_parts.append(self.config.system_template)

        if tools and self.config.include_tools_in_system:
            tools_desc = self._format_tools(tools)
            system_parts.append(f"\n\n## Available Tools\n{tools_desc}")

        if messages[0].role == Role.SYSTEM:
            system_parts.insert(0, messages[0].content)
            result.insert(0, Message(role=Role.SYSTEM, content="\n\n".join(system_parts)))
            result.extend(messages[1:])
        else:
            if system_parts:
                result.insert(0, Message(role=Role.SYSTEM, content="\n\n".join(system_parts)))
            result.extend(messages)

        return result

    def _format_tools(self, tools: list[ToolDefinition]) -> str:
        lines = []
        for tool in tools:
            lines.append(f"### {tool.name}")
            lines.append(tool.description)
            if tool.parameters:
                lines.append("Parameters:")
                lines.append(self._format_parameters(tool.parameters))
        return "\n".join(lines)

    def _format_parameters(self, params: dict[str, Any]) -> str:
        if "properties" not in params:
            return str(params)
        lines = []
        required = params.get("required", [])
        for name, spec in params["properties"].items():
            prop_type = spec.get("type", "any")
            desc = spec.get("description", "")
            required_mark = "(required)" if name in required else "(optional)"
            lines.append(f"  - {name}: {prop_type} {required_mark} - {desc}")
        return "\n".join(lines) if lines else str(params)


_PROVIDER_TEMPLATE_MAP: dict[str, dict[str, Any]] = {
    "claude": {
        "include_tools_in_system": False,
        "tool_format": "anthropic",
    },
    "openai": {
        "include_tools_in_system": False,
        "tool_format": "openai",
    },
    "ollama": {
        "include_tools_in_system": True,
        "tool_format": "text",
    },
}


def get_provider_builder(provider_name: str) -> PromptBuilder:
    config_dict = _PROVIDER_TEMPLATE_MAP.get(provider_name.lower(), {})
    config = PromptConfig(**config_dict)
    return PromptBuilder(config)


def adapt_messages_for_provider(
    messages: list[Message],
    provider: str,
    tools: list[ToolDefinition] | None = None,
) -> list[Message]:
    builder = get_provider_builder(provider)
    return builder.build(messages, tools)
