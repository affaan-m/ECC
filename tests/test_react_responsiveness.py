from __future__ import annotations

import asyncio
import contextvars
import threading
from collections.abc import Callable
from concurrent.futures import Future, ThreadPoolExecutor
from dataclasses import dataclass, field
from typing import Any

import pytest

from llm.core.interface import LLMError
from llm.core.types import LLMInput, LLMOutput, Message, Role
from llm.tools import ReActAgent, ToolExecutor


def _input() -> LLMInput:
    return LLMInput(messages=[Message(role=Role.USER, content="hello")])


def test_agent_keeps_event_loop_live_during_provider_request() -> None:
    request_id = contextvars.ContextVar("request_id", default="missing")
    release = threading.Event()
    observed: list[str] = []

    async def scenario() -> LLMOutput:
        entered = asyncio.Event()
        loop = asyncio.get_running_loop()

        class WaitingProvider:
            def generate(self, agent_input: LLMInput) -> LLMOutput:
                observed.append(request_id.get())
                loop.call_soon_threadsafe(entered.set)
                if not release.wait(timeout=2):
                    return LLMOutput(content="event loop did not release the request")
                return LLMOutput(content="done")

        request_id.set("request-17")
        agent = ReActAgent(WaitingProvider(), ToolExecutor())
        pending = asyncio.create_task(agent.run(_input()))
        try:
            await asyncio.wait_for(entered.wait(), timeout=5)
            release.set()
            return await asyncio.wait_for(pending, timeout=5)
        finally:
            release.set()

    output = asyncio.run(scenario())
    assert output.content == "done"
    assert observed == ["request-17"]


def test_agent_can_be_cancelled_while_provider_is_waiting() -> None:
    release = threading.Event()

    async def scenario() -> None:
        entered = asyncio.Event()
        loop = asyncio.get_running_loop()

        class WaitingProvider:
            def generate(self, agent_input: LLMInput) -> LLMOutput:
                loop.call_soon_threadsafe(entered.set)
                release.wait(timeout=2)
                return LLMOutput(content="provider finished")

        pending = asyncio.create_task(ReActAgent(WaitingProvider(), ToolExecutor()).run(_input()))
        try:
            await asyncio.wait_for(entered.wait(), timeout=5)
            pending.cancel()
            with pytest.raises(asyncio.CancelledError):
                await asyncio.wait_for(pending, timeout=5)
        finally:
            # Cancelling the await does not abort synchronous provider I/O.
            release.set()

    asyncio.run(scenario())


def test_provider_error_keeps_the_agent_error_contract() -> None:
    class FailingProvider:
        def generate(self, agent_input: LLMInput) -> LLMOutput:
            raise LLMError("upstream unavailable", code="connection_error")

    output = asyncio.run(ReActAgent(FailingProvider(), ToolExecutor()).run(_input()))

    assert output.stop_reason == "provider_error"
    assert output.content == "Provider error: connection_error"


class ObservedExecutor(ThreadPoolExecutor):
    """Signal actual worker entry before testing cancellation of a queued call."""

    def __init__(self, loop: asyncio.AbstractEventLoop) -> None:
        super().__init__(max_workers=2)
        self.loop = loop
        self.started = [asyncio.Event(), asyncio.Event()]
        self.submitted = 0

    def submit(self, fn: Callable[..., Any], /, *args: Any, **kwargs: Any) -> Future[Any]:
        started = self.started[self.submitted]
        self.submitted += 1

        def invoke() -> Any:
            self.loop.call_soon_threadsafe(started.set)
            return fn(*args, **kwargs)

        return super().submit(invoke)


@dataclass
class SharedProvider:
    """An unhashable custom provider with mutable, non-reentrant request state."""

    loop: asyncio.AbstractEventLoop
    fail_first: bool = False
    release: threading.Event = field(default_factory=threading.Event)
    entered: list[asyncio.Event] = field(default_factory=lambda: [asyncio.Event(), asyncio.Event()])
    guard: Any = field(default_factory=threading.Lock)
    calls: int = 0
    active: int = 0
    max_active: int = 0

    def generate(self, agent_input: LLMInput) -> LLMOutput:
        with self.guard:
            index = self.calls
            self.calls += 1
            self.active += 1
            self.max_active = max(self.max_active, self.active)
        self.loop.call_soon_threadsafe(self.entered[index].set)
        try:
            if index == 0:
                if not self.release.wait(timeout=5):
                    raise RuntimeError("Provider release timed out")
                if self.fail_first:
                    raise LLMError("upstream unavailable", code="connection_error")
            return LLMOutput(content=f"response-{index + 1}")
        finally:
            with self.guard:
                self.active -= 1


@pytest.mark.parametrize("first_result", ["success", "cancelled", "error"])
def test_shared_provider_remains_serial_until_the_worker_finishes(first_result: str) -> None:
    async def scenario() -> SharedProvider:
        loop = asyncio.get_running_loop()
        pool = ObservedExecutor(loop)
        loop.set_default_executor(pool)
        provider = SharedProvider(loop, fail_first=first_result == "error")
        first = asyncio.create_task(ReActAgent(provider, ToolExecutor()).run(_input()))
        pending = [first]
        try:
            await asyncio.wait_for(provider.entered[0].wait(), timeout=5)
            if first_result == "cancelled":
                first.cancel()
                with pytest.raises(asyncio.CancelledError):
                    await first

            second = asyncio.create_task(ReActAgent(provider, ToolExecutor()).run(_input()))
            pending.append(second)
            await asyncio.wait_for(pool.started[1].wait(), timeout=5)
            # The second worker has started, while the first generate is still
            # blocked. It must not enter the shared provider, even after cancel.
            with pytest.raises(TimeoutError):
                await asyncio.wait_for(provider.entered[1].wait(), timeout=0.1)
            provider.release.set()
            assert (await asyncio.wait_for(second, timeout=5)).content == "response-2"
            if first_result != "cancelled":
                output = await first
                if first_result == "error":
                    assert output.stop_reason == "provider_error"
                else:
                    assert output.content == "response-1"
            return provider
        finally:
            provider.release.set()
            await asyncio.gather(*pending, return_exceptions=True)

    provider = asyncio.run(scenario())
    assert provider.calls == 2
    assert provider.max_active == 1


def test_cancelling_a_queued_worker_does_not_start_another_provider_request() -> None:
    async def scenario() -> SharedProvider:
        loop = asyncio.get_running_loop()
        pool = ObservedExecutor(loop)
        loop.set_default_executor(pool)
        provider = SharedProvider(loop)
        first = asyncio.create_task(ReActAgent(provider, ToolExecutor()).run(_input()))
        pending = [first]
        try:
            await asyncio.wait_for(provider.entered[0].wait(), timeout=5)
            second = asyncio.create_task(ReActAgent(provider, ToolExecutor()).run(_input()))
            pending.append(second)
            await asyncio.wait_for(pool.started[1].wait(), timeout=5)
            second.cancel()
            with pytest.raises(asyncio.CancelledError):
                await second
            provider.release.set()
            assert (await asyncio.wait_for(first, timeout=5)).content == "response-1"
            return provider
        finally:
            provider.release.set()
            await asyncio.gather(*pending, return_exceptions=True)

    # asyncio.run also joins the executor, so a cancelled but still-running
    # worker cannot call generate after the assertion has already passed.
    provider = asyncio.run(scenario())
    assert provider.calls == 1


def test_distinct_providers_can_make_progress_independently() -> None:
    async def scenario() -> None:
        loop = asyncio.get_running_loop()
        first_provider = SharedProvider(loop)
        second_provider = SharedProvider(loop)
        second_provider.release.set()
        first = asyncio.create_task(ReActAgent(first_provider, ToolExecutor()).run(_input()))
        try:
            await asyncio.wait_for(first_provider.entered[0].wait(), timeout=5)
            second = ReActAgent(second_provider, ToolExecutor()).run(_input())
            assert (await asyncio.wait_for(second, timeout=2)).content == "response-1"
            assert not first.done()
        finally:
            first_provider.release.set()
            await first

    asyncio.run(scenario())
