"""Tool executor for handling tool calls from LLM responses."""

from __future__ import annotations

import asyncio
import contextvars
import inspect
import logging
import threading
from collections import deque
from collections.abc import Callable
from concurrent.futures import Future
from typing import Any
from weakref import WeakValueDictionary

from llm.core.interface import LLMError
from llm.core.types import (
    LLMInput,
    LLMOutput,
    Message,
    Role,
    ToolCall,
    ToolDefinition,
    ToolResult,
)

logger = logging.getLogger(__name__)

# Model-facing failure text. Raw exception details (credentials, local paths,
# request data, upstream responses) must never reach the model; diagnostics go
# to trusted logs only.
GENERIC_TOOL_FAILURE = "Error executing {name}: tool failed"


def _generic_failure(tool_call: ToolCall) -> ToolResult:
    return ToolResult(
        tool_call_id=tool_call.id,
        content=GENERIC_TOOL_FAILURE.format(name=tool_call.name),
        is_error=True,
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
            if inspect.isawaitable(result):
                logger.warning(
                    "Async tool '%s' called via sync execute(); use execute_async()",
                    tool_call.name,
                )
                if inspect.iscoroutine(result):
                    result.close()
                return ToolResult(
                    tool_call_id=tool_call.id,
                    content=GENERIC_TOOL_FAILURE.format(name=tool_call.name),
                    is_error=True,
                )
            content = result if isinstance(result, str) else str(result)
            return ToolResult(tool_call_id=tool_call.id, content=content)
        except Exception:
            logger.exception("Tool '%s' failed", tool_call.name)
            return _generic_failure(tool_call)

    async def execute_async(self, tool_call: ToolCall) -> ToolResult:
        func = self.registry.get(tool_call.name)
        if not func:
            return ToolResult(
                tool_call_id=tool_call.id,
                content=f"Error: Tool '{tool_call.name}' not found",
                is_error=True,
            )

        try:
            result = func(**tool_call.arguments)
            if inspect.isawaitable(result):
                result = await result
            content = result if isinstance(result, str) else str(result)
            return ToolResult(tool_call_id=tool_call.id, content=content)
        except Exception:
            logger.exception("Tool '%s' failed", tool_call.name)
            return _generic_failure(tool_call)

    def execute_all(self, tool_calls: list[ToolCall]) -> list[ToolResult]:
        return [self.execute(tc) for tc in tool_calls]

    async def execute_all_async(self, tool_calls: list[ToolCall]) -> list[ToolResult]:
        results: list[ToolResult] = []
        for tc in tool_calls:
            results.append(await self.execute_async(tc))
        return results


class _ProviderGate:
    def __init__(self, provider: Any) -> None:
        self.provider = provider
        self.lock = threading.Lock()
        self.pending: deque[Future[None]] = deque()

    def enqueue(self) -> Future[None]:
        ticket: Future[None] = Future()
        with self.lock:
            self.pending.append(ticket)
            if len(self.pending) == 1:
                ticket.set_result(None)
        return ticket

    def release(self, ticket: Future[None]) -> None:
        with self.lock:
            was_first = self.pending[0] is ticket
            self.pending.remove(ticket)
            if not ticket.done():
                ticket.cancel()
            if was_first and self.pending:
                self.pending[0].set_result(None)


# Identity keys support unhashable/custom providers without modifying their
# objects. Workers retain their gate (and provider) until generate finishes;
# weak values release unused gates instead of keeping providers alive forever.
_provider_gates: WeakValueDictionary[int, _ProviderGate] = WeakValueDictionary()
_provider_gates_lock = threading.Lock()


async def _generate_serially(provider: Any, input: LLMInput) -> LLMOutput:
    with _provider_gates_lock:
        gate = _provider_gates.get(id(provider))
        if gate is None:
            gate = _ProviderGate(provider)
            _provider_gates[id(provider)] = gate

    ticket = gate.enqueue()
    request_lock = threading.Lock()
    cancelled = False
    started = False

    def generate() -> LLMOutput:
        nonlocal started
        with request_lock:
            if cancelled:
                raise asyncio.CancelledError
            started = True
        try:
            output: LLMOutput = gate.provider.generate(input)
            return output
        finally:
            # Only the actual worker may release a request that has started.
            gate.release(ticket)

    def consume_exception(completed: asyncio.Future[LLMOutput]) -> None:
        # A cancelled caller may no longer be awaiting a provider failure.
        if not completed.cancelled():
            completed.exception()

    try:
        # Cross-loop futures queue callers without occupying executor threads.
        await asyncio.shield(asyncio.wrap_future(ticket))
        worker: asyncio.Future[LLMOutput] = asyncio.get_running_loop().run_in_executor(
            None, contextvars.copy_context().run, generate
        )
        worker.add_done_callback(consume_exception)
        return await asyncio.shield(worker)
    finally:
        with request_lock:
            cancelled = True
            if not started:
                # An executor can discard a submitted job during shutdown. Return
                # its permit now; a late worker must not generate or release again.
                gate.release(ticket)


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

            try:
                output = await _generate_serially(self.provider, input_copy)
            except LLMError as e:
                logger.warning(
                    "Provider failed during agent run: %s", e.code or type(e).__name__
                )
                return LLMOutput(
                    content=f"Provider error: {e.code or type(e).__name__}",
                    stop_reason="provider_error",
                )

            if not output.has_tool_calls:
                return output

            messages.append(
                Message(
                    role=Role.ASSISTANT,
                    content=output.content or "",
                    tool_calls=output.tool_calls,
                )
            )

            results = await self.executor.execute_all_async(output.tool_calls or [])

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
