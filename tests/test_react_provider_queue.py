from __future__ import annotations

import asyncio
import threading
from collections.abc import Callable
from concurrent.futures import Future, ThreadPoolExecutor
from typing import Any, TypeVar

import pytest

from llm.core.types import LLMInput, LLMOutput, Message, Role
from llm.tools import ReActAgent, ToolExecutor

pytestmark = pytest.mark.unit
_Result = TypeVar("_Result")


def _input(label: str) -> LLMInput:
    return LLMInput(messages=[Message(role=Role.USER, content=label)])


async def _run_started(
    agent: ReActAgent, label: str, started: asyncio.Event
) -> LLMOutput:
    started.set()
    return await agent.run(_input(label))


class ObservedPool(ThreadPoolExecutor):
    def __init__(self, loop: asyncio.AbstractEventLoop) -> None:
        super().__init__(max_workers=2)
        self.loop = loop
        self.started: list[asyncio.Event] = []

    def submit(
        self, fn: Callable[..., _Result], /, *args: Any, **kwargs: Any
    ) -> Future[_Result]:
        started = asyncio.Event()
        self.started.append(started)

        def invoke() -> _Result:
            self.loop.call_soon_threadsafe(started.set)
            return fn(*args, **kwargs)

        return super().submit(invoke)


@pytest.mark.parametrize("cancel_waiter", [False, True])
def test_queued_provider_calls_do_not_exhaust_the_worker_pool(
    cancel_waiter: bool,
) -> None:
    async def scenario() -> None:
        loop = asyncio.get_running_loop()
        pool = ObservedPool(loop)
        loop.set_default_executor(pool)
        release = threading.Event()
        first_entered = asyncio.Event()
        waiting = asyncio.Event()
        calls: list[str] = []

        class Provider:
            def generate(self, request: LLMInput) -> LLMOutput:
                label = request.messages[0].content
                calls.append(label)
                if label == "first":
                    loop.call_soon_threadsafe(first_entered.set)
                    if not release.wait(timeout=10):
                        raise AssertionError("test did not release the first provider")
                return LLMOutput(content=label)

        shared = ReActAgent(Provider(), ToolExecutor())
        first = asyncio.create_task(shared.run(_input("first")))
        pending = [first]
        try:
            await asyncio.wait_for(first_entered.wait(), timeout=5)
            queued = asyncio.create_task(_run_started(shared, "queued", waiting))
            pending.append(queued)
            # The nested run reaches its first suspension before this task resumes.
            await asyncio.wait_for(waiting.wait(), timeout=5)
            if len(pool.started) > 1:
                # Exercise an already-running blocked worker on the old design;
                # cancelling before thread entry would hide its pool starvation.
                await asyncio.wait_for(pool.started[1].wait(), timeout=5)
            if cancel_waiter:
                queued.cancel()
                with pytest.raises(asyncio.CancelledError):
                    await queued

            independent = asyncio.create_task(
                ReActAgent(Provider(), ToolExecutor()).run(_input("independent"))
            )
            pending.append(independent)
            assert (
                await asyncio.wait_for(independent, timeout=2)
            ).content == "independent"
            assert not first.done()
            release.set()
            assert (await first).content == "first"
            if not cancel_waiter:
                assert (await queued).content == "queued"
        finally:
            release.set()
            await asyncio.gather(*pending, return_exceptions=True)
            await loop.shutdown_default_executor()
        if cancel_waiter:
            assert "queued" not in calls

    asyncio.run(scenario())


def test_cancelling_a_waiter_does_not_release_its_running_predecessor() -> None:
    async def scenario() -> None:
        loop = asyncio.get_running_loop()
        release = threading.Event()
        first_entered = asyncio.Event()
        third_entered = asyncio.Event()
        calls: list[str] = []

        class Provider:
            def generate(self, request: LLMInput) -> LLMOutput:
                label = request.messages[0].content
                calls.append(label)
                if label == "first":
                    loop.call_soon_threadsafe(first_entered.set)
                    if not release.wait(timeout=5):
                        raise AssertionError("test did not release the first provider")
                else:
                    loop.call_soon_threadsafe(third_entered.set)
                return LLMOutput(content=label)

        agent = ReActAgent(Provider(), ToolExecutor())
        first = asyncio.create_task(agent.run(_input("first")))
        pending = [first]
        try:
            await asyncio.wait_for(first_entered.wait(), timeout=5)
            second_started = asyncio.Event()
            second = asyncio.create_task(
                _run_started(agent, "cancelled", second_started)
            )
            pending.append(second)
            await asyncio.wait_for(second_started.wait(), timeout=5)
            third_started = asyncio.Event()
            third = asyncio.create_task(_run_started(agent, "third", third_started))
            pending.append(third)
            await asyncio.wait_for(third_started.wait(), timeout=5)
            second.cancel()
            with pytest.raises(asyncio.CancelledError):
                await second
            with pytest.raises(TimeoutError):
                await asyncio.wait_for(third_entered.wait(), timeout=0.1)
            release.set()
            assert (await first).content == "first"
            assert (await third).content == "third"
        finally:
            release.set()
            await asyncio.gather(*pending, return_exceptions=True)
            await loop.shutdown_default_executor()
        assert calls == ["first", "third"]

    asyncio.run(scenario())


def test_cancellation_after_a_permit_is_granted_releases_it() -> None:
    async def scenario() -> None:
        loop = asyncio.get_running_loop()
        pool = ObservedPool(loop)
        loop.set_default_executor(pool)
        calls: list[str] = []

        class Provider:
            def generate(self, request: LLMInput) -> LLMOutput:
                label = request.messages[0].content
                calls.append(label)
                return LLMOutput(content=label)

        agent = ReActAgent(Provider(), ToolExecutor())
        started = asyncio.Event()
        first = asyncio.create_task(_run_started(agent, "cancelled", started))
        try:
            # Resume at the first suspension: the free permit has been granted,
            # but wrap_future has not yet resumed the run to submit a worker.
            await started.wait()
            assert pool.started == []
            first.cancel()
            with pytest.raises(asyncio.CancelledError):
                await first
            assert (
                await asyncio.wait_for(agent.run(_input("next")), timeout=5)
            ).content == "next"
        finally:
            first.cancel()
            await asyncio.gather(first, return_exceptions=True)
        assert calls == ["next"]

    asyncio.run(scenario())


def test_executor_submission_failure_releases_the_provider_permit() -> None:
    class RejectOncePool(ObservedPool):
        rejected = False

        def submit(
            self, fn: Callable[..., _Result], /, *args: Any, **kwargs: Any
        ) -> Future[_Result]:
            if not self.rejected:
                self.rejected = True
                raise RuntimeError("test submission rejected")
            return super().submit(fn, *args, **kwargs)

    class Provider:
        def generate(self, request: LLMInput) -> LLMOutput:
            return LLMOutput(content=request.messages[0].content)

    async def scenario() -> None:
        loop = asyncio.get_running_loop()
        loop.set_default_executor(RejectOncePool(loop))
        agent = ReActAgent(Provider(), ToolExecutor())
        with pytest.raises(RuntimeError, match="test submission rejected"):
            await agent.run(_input("rejected"))
        assert (
            await asyncio.wait_for(agent.run(_input("next")), timeout=5)
        ).content == "next"

    asyncio.run(scenario())


def test_shared_provider_queue_works_across_event_loops() -> None:
    first_entered = threading.Event()
    second_entered = threading.Event()
    second_waiting = threading.Event()
    release = threading.Event()

    class Provider:
        # Identity-based gates support both unhashable and non-weakrefable objects.
        __slots__ = ("current_request",)
        __hash__ = None  # type: ignore[assignment]

        def __init__(self) -> None:
            self.current_request = ""

        def generate(self, request: LLMInput) -> LLMOutput:
            self.current_request = request.messages[0].content
            if self.current_request == "first":
                first_entered.set()
                if not release.wait(timeout=10):
                    raise AssertionError("test did not release the first request")
            else:
                second_entered.set()
            return LLMOutput(content=self.current_request)

    provider = Provider()

    async def request(label: str) -> LLMOutput:
        pending = asyncio.create_task(
            ReActAgent(provider, ToolExecutor()).run(_input(label))
        )
        # Run the nested task to its provider await before notifying the test's
        # separate thread that the second event loop is waiting for a permit.
        await asyncio.sleep(0)
        if label == "second":
            second_waiting.set()
        return await pending

    with ThreadPoolExecutor(max_workers=2) as loops:
        first = loops.submit(asyncio.run, request("first"))
        second = None
        try:
            assert first_entered.wait(timeout=5)
            second = loops.submit(asyncio.run, request("second"))
            assert second_waiting.wait(timeout=5)
            assert not second_entered.wait(timeout=0.1)
        finally:
            release.set()
        assert first.result(timeout=5).content == "first"
        assert second is not None
        assert second.result(timeout=5).content == "second"
