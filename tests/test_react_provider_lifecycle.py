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


def test_rejected_submission_releases_an_existing_provider_waiter() -> None:
    class RejectOncePool(ThreadPoolExecutor):
        rejected = False

        def submit(
            self, fn: Callable[..., _Result], /, *args: Any, **kwargs: Any
        ) -> Future[_Result]:
            if not self.rejected:
                self.rejected = True
                raise RuntimeError("Executor rejected submission")
            return super().submit(fn, *args, **kwargs)

    async def scenario() -> None:
        loop = asyncio.get_running_loop()
        loop.set_default_executor(RejectOncePool(max_workers=2))
        calls: list[str] = []

        class Provider:
            def generate(self, request: LLMInput) -> LLMOutput:
                calls.append(request.messages[0].content)
                return LLMOutput(content=request.messages[0].content)

        agent = ReActAgent(Provider(), ToolExecutor())
        first = asyncio.create_task(agent.run(_input("rejected")))
        # Both tasks reach their permit await before the first submits. The
        # second retains the same gate, so a leaked permit cannot be hidden by
        # a new weak-registry entry on a later, otherwise unrelated request.
        second = asyncio.create_task(agent.run(_input("following")))
        results = await asyncio.wait_for(
            asyncio.gather(first, second, return_exceptions=True), timeout=5
        )
        assert isinstance(results[0], RuntimeError)
        assert str(results[0]) == "Executor rejected submission"
        assert isinstance(results[1], LLMOutput)
        assert results[1].content == "following"
        assert calls == ["following"]

    asyncio.run(scenario())


@pytest.mark.parametrize("cancel_source", ["caller", "executor_shutdown"])
def test_cancelled_executor_queued_request_releases_its_provider_permit(
    cancel_source: str,
) -> None:
    class ObservedPool(ThreadPoolExecutor):
        def __init__(self) -> None:
            super().__init__(max_workers=1)
            self.submissions = 0
            self.second_submission = asyncio.Event()

        def submit(
            self, fn: Callable[..., _Result], /, *args: Any, **kwargs: Any
        ) -> Future[_Result]:
            self.submissions += 1
            if self.submissions == 2:
                self.second_submission.set()
            return super().submit(fn, *args, **kwargs)

    async def scenario() -> None:
        loop = asyncio.get_running_loop()
        pool = ObservedPool()
        loop.set_default_executor(pool)
        release_pool = threading.Event()
        blocker_started = asyncio.Event()
        following_started = asyncio.Event()
        calls: list[str] = []

        def occupy_worker() -> None:
            loop.call_soon_threadsafe(blocker_started.set)
            if not release_pool.wait(timeout=5):
                raise RuntimeError("Test did not release the executor")

        class Provider:
            def generate(self, request: LLMInput) -> LLMOutput:
                calls.append(request.messages[0].content)
                return LLMOutput(content=request.messages[0].content)

        agent = ReActAgent(Provider(), ToolExecutor())

        async def following_request() -> LLMOutput:
            following_started.set()
            return await agent.run(_input("following"))

        blocker = loop.run_in_executor(None, occupy_worker)
        await asyncio.wait_for(blocker_started.wait(), timeout=5)
        cancelled = asyncio.create_task(agent.run(_input("cancelled")))
        pending = [cancelled]
        try:
            await asyncio.wait_for(pool.second_submission.wait(), timeout=5)
            following = asyncio.create_task(following_request())
            pending.append(following)
            await asyncio.wait_for(following_started.wait(), timeout=5)
            if cancel_source == "caller":
                cancelled.cancel()
            else:
                pool.shutdown(wait=False, cancel_futures=True)
            loop.set_default_executor(ThreadPoolExecutor(max_workers=1))
            with pytest.raises(asyncio.CancelledError):
                await cancelled
            # The replacement executor is available while the old one's worker
            # is still occupied. A discarded job must not retain its permit.
            assert (await asyncio.wait_for(following, timeout=1)).content == "following"
            assert not release_pool.is_set()
            assert calls == ["following"]
        finally:
            release_pool.set()
            await blocker
            await asyncio.gather(*pending, return_exceptions=True)
            pool.shutdown(wait=True)

    asyncio.run(scenario())


def test_cancelled_call_releases_provider_after_its_event_loop_has_closed() -> None:
    release = threading.Event()
    entered = [threading.Event(), threading.Event()]
    guard = threading.Lock()
    calls = active = max_active = 0
    first_loop: Future[tuple[asyncio.AbstractEventLoop, asyncio.Task[LLMOutput]]] = Future()
    first_closed = threading.Event()
    second_waiting = threading.Event()
    outcomes: list[Future[LLMOutput | None]] = [Future(), Future()]

    class Provider:
        def generate(self, request: LLMInput) -> LLMOutput:
            nonlocal calls, active, max_active
            with guard:
                index = calls
                calls += 1
                active += 1
                max_active = max(max_active, active)
            entered[index].set()
            try:
                if index == 0 and not release.wait(timeout=5):
                    raise RuntimeError("Test did not release the provider")
                return LLMOutput(content=request.messages[0].content)
            finally:
                with guard:
                    active -= 1

    provider = Provider()

    def run_loop(index: int) -> None:
        loop = asyncio.new_event_loop()
        pool = ThreadPoolExecutor(max_workers=2)
        loop.set_default_executor(pool)

        async def run_agent() -> LLMOutput:
            if index == 1:
                second_waiting.set()
            return await ReActAgent(provider, ToolExecutor()).run(_input(f"request-{index}"))

        task = loop.create_task(run_agent())
        if index == 0:
            first_loop.set_result((loop, task))
        try:
            outcomes[index].set_result(loop.run_until_complete(task))
        except asyncio.CancelledError:
            outcomes[index].set_result(None)
        except BaseException as error:
            outcomes[index].set_exception(error)
        finally:
            loop.close()
            if index == 0:
                first_closed.set()
            pool.shutdown(wait=True)

    threads = [threading.Thread(target=run_loop, args=(index,), daemon=True) for index in range(2)]
    threads[0].start()
    try:
        assert entered[0].wait(timeout=5)
        loop, task = first_loop.result(timeout=5)
        loop.call_soon_threadsafe(task.cancel)
        assert first_closed.wait(timeout=5)
        threads[1].start()
        assert second_waiting.wait(timeout=5)
        assert not entered[1].wait(timeout=0.1)
    finally:
        release.set()
        for thread in threads:
            if thread.ident is not None:
                thread.join(timeout=5)
                assert not thread.is_alive()
    assert outcomes[0].result(timeout=5) is None
    second = outcomes[1].result(timeout=5)
    assert second is not None and second.content == "request-1"
    assert calls == 2
    assert max_active == 1


def test_discarding_a_queued_worker_after_its_loop_closes_keeps_waiters_live() -> None:
    release_pool = threading.Event()
    submitted = threading.Event()
    closed = threading.Event()
    first_loop: Future[tuple[asyncio.AbstractEventLoop, asyncio.Task[LLMOutput]]] = Future()
    first_outcome: Future[None] = Future()
    calls: list[str] = []

    class ObservedPool(ThreadPoolExecutor):
        submissions = 0
        queued: Future[Any] | None = None

        def submit(
            self, fn: Callable[..., _Result], /, *args: Any, **kwargs: Any
        ) -> Future[_Result]:
            future = super().submit(fn, *args, **kwargs)
            self.submissions += 1
            if self.submissions == 2:
                self.queued = future
                submitted.set()
            return future

    class Provider:
        def generate(self, request: LLMInput) -> LLMOutput:
            calls.append(request.messages[0].content)
            return LLMOutput(content=request.messages[0].content)

    provider = Provider()
    pool = ObservedPool(max_workers=1)

    def run_first_loop() -> None:
        loop = asyncio.new_event_loop()
        loop.set_default_executor(pool)
        loop.run_in_executor(None, release_pool.wait, 5)
        task = loop.create_task(ReActAgent(provider, ToolExecutor()).run(_input("cancelled")))
        first_loop.set_result((loop, task))
        try:
            loop.run_until_complete(task)
            first_outcome.set_exception(AssertionError("First request was not cancelled"))
        except asyncio.CancelledError:
            first_outcome.set_result(None)
        except BaseException as error:
            first_outcome.set_exception(error)
        finally:
            loop.close()
            closed.set()

    thread = threading.Thread(target=run_first_loop, daemon=True)
    following_loop = asyncio.new_event_loop()
    following = following_loop.create_task(
        ReActAgent(provider, ToolExecutor()).run(_input("following"))
    )
    thread.start()
    try:
        assert submitted.wait(timeout=5)
        # Park an existing follower in another loop before cancelling the first
        # caller. Its loop resumes only after the old loop and executor close.
        following_loop.run_until_complete(asyncio.sleep(0))
        assert not following.done()
        loop, task = first_loop.result(timeout=5)
        loop.call_soon_threadsafe(task.cancel)
        assert closed.wait(timeout=5)
        pool.shutdown(wait=False, cancel_futures=True)
        assert pool.queued is not None and pool.queued.cancelled()
        result = following_loop.run_until_complete(asyncio.wait_for(following, timeout=1))
        assert result.content == "following"
        assert calls == ["following"]
        assert not release_pool.is_set()
        first_outcome.result(timeout=5)
    finally:
        release_pool.set()
        thread.join(timeout=5)
        assert not thread.is_alive()
        following.cancel()
        following_loop.run_until_complete(asyncio.gather(following, return_exceptions=True))
        following_loop.run_until_complete(following_loop.shutdown_default_executor())
        following_loop.close()
        pool.shutdown(wait=True)
