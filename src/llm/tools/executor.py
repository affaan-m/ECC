"""Tool executor for handling tool calls from LLM responses."""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

from llm.core.types import (
    LLMInput,
    LLMOutput,
    Message,
    Role,
    ToolCall,
    ToolDefinition,
    ToolResult,
)

ToolFunc = Callable[..., Any]


class ToolRegistry:
    def __init__(self) -> None:
        self._tools: dict[str, ToolFunc] = {}
        self._definitions: dict[str, ToolDefinition] = {}

    def register(self, definition: ToolDefinition, func: ToolFunc) -> None:
        self._tools[definition.name] = func
        self._definitions[definition.name] = definition

    def get(self, name: str) -> ToolFunc | None:
        return self._tools.get(name)

    def get_definition(self, name: str) -> ToolDefinition | None:
        return self._definitions.get(name)

    def list_tools(self) -> list[ToolDefinition]:
        return list(self._definitions.values())

    def has(self, name: str) -> bool:
        return name in self._tools


class ToolExecutor:
    def __init__(self, registry: ToolRegistry | None = None) -> None:
        self.registry = registry or ToolRegistry()

    def execute(self, tool_call: ToolCall) -> ToolResult:
        func = self.registry.get(tool_call.name)
        if not func:
            return ToolResult(
                tool_call_id=tool_call.id,
                content=f"Error: Tool '{tool_call.name}' not found",
                is_error=True,
            )

        try:
            result = func(**tool_call.arguments)
            content = result if isinstance(result, str) else str(result)
            return ToolResult(tool_call_id=tool_call.id, content=content)
        except Exception as e:
            return ToolResult(
                tool_call_id=tool_call.id,
                content=f"Error executing {tool_call.name}: {e}",
                is_error=True,
            )

    def execute_all(self, tool_calls: list[ToolCall]) -> list[ToolResult]:
        return [self.execute(tc) for tc in tool_calls]


class ReActAgent:
    def __init__(
        self,
        provider: Any,
        executor: ToolExecutor,
        max_iterations: int = 10,
    ) -> None:
        self.provider = provider
        self.executor = executor
        self.max_iterations = max_iterations

    async def run(self, input: LLMInput) -> LLMOutput:
        messages = list(input.messages)
        tools = input.tools or []

        for _ in range(self.max_iterations):
            input_copy = LLMInput(
                messages=messages,
                model=input.model,
                temperature=input.temperature,
                max_tokens=input.max_tokens,
                tools=tools,
            )

            output: LLMOutput = self.provider.generate(input_copy)

            if not output.has_tool_calls:
                return output

            messages.append(
                Message(
                    role=Role.ASSISTANT,
                    content=output.content or "",
                    tool_calls=output.tool_calls,
                )
            )

            results = self.executor.execute_all(output.tool_calls or [])

            for result in results:
                messages.append(
                    Message(
                        role=Role.TOOL,
                        content=result.content,
                        tool_call_id=result.tool_call_id,
                    )
                )

        return LLMOutput(
            content="Max iterations reached",
            stop_reason="max_iterations",
        )
