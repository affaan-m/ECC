"""Regression tests for skills/videodb/scripts/ws_listener.py.

`dotenv` and `videodb` are stubbed, so neither package nor a network is needed.
"""
import asyncio
import importlib.util
import sys
import types
from pathlib import Path

SCRIPT = Path(__file__).resolve().parent.parent / "skills" / "videodb" / "scripts" / "ws_listener.py"


class FakeWebSocket:
    def __init__(self, events):
        self.connection_id = "ws-test"
        self._events = events

    async def receive(self):
        for event in self._events:
            yield event


def load_listener(monkeypatch, tmp_path, connections):
    """Import ws_listener with stubs; each connect() serves the next event list."""
    dotenv_calls = []
    dotenv = types.ModuleType("dotenv")
    dotenv.find_dotenv = lambda **kwargs: dotenv_calls.append(("find", kwargs)) or "/project/.env"
    dotenv.load_dotenv = lambda *args, **kwargs: dotenv_calls.append(("load", args)) or True

    remaining = list(connections)

    class Wrapper:
        async def connect(self):
            if not remaining:
                raise AssertionError("listener kept reconnecting after its retry budget")
            return FakeWebSocket(remaining.pop(0))

    class Conn:
        def connect_websocket(self):
            return Wrapper()

    videodb = types.ModuleType("videodb")
    videodb.connect = Conn
    exceptions = types.ModuleType("videodb.exceptions")
    exceptions.AuthenticationError = type("AuthenticationError", (Exception,), {})
    videodb.exceptions = exceptions

    monkeypatch.setitem(sys.modules, "dotenv", dotenv)
    monkeypatch.setitem(sys.modules, "videodb", videodb)
    monkeypatch.setitem(sys.modules, "videodb.exceptions", exceptions)
    monkeypatch.setattr(sys, "argv", [str(SCRIPT), str(tmp_path)])

    spec = importlib.util.spec_from_file_location("ws_listener_under_test", SCRIPT)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)

    sleeps = []

    async def fake_sleep(seconds):
        sleeps.append(seconds)

    monkeypatch.setattr(module.asyncio, "sleep", fake_sleep)
    return module, dotenv_calls, sleeps, remaining


def test_loads_dotenv_found_from_the_working_directory(monkeypatch, tmp_path):
    _, dotenv_calls, _, _ = load_listener(monkeypatch, tmp_path, [])
    assert ("find", {"usecwd": True}) in dotenv_calls
    assert ("load", ("/project/.env",)) in dotenv_calls


def test_eventless_closes_back_off_and_stop(monkeypatch, tmp_path):
    module, _, sleeps, remaining = load_listener(monkeypatch, tmp_path, [[]] * 20)
    asyncio.run(module.listen_with_retry())
    assert len(remaining) == 20 - module.MAX_RETRIES
    assert sleeps == [1, 2, 4, 8, 16, 32, 60, 60, 60]


def test_an_event_resets_the_retry_budget(monkeypatch, tmp_path):
    event = {"channel": "transcript", "data": {"text": "hi"}}
    connections = [[], [event]] + [[]] * 20
    module, _, sleeps, _ = load_listener(monkeypatch, tmp_path, connections)
    asyncio.run(module.listen_with_retry())
    # First close backs off 1s; the event resets backoff, so the next close waits 1s again.
    assert sleeps[:3] == [1, 1, 2]
    assert len(sleeps) == 1 + module.MAX_RETRIES - 1
    assert (tmp_path / "videodb_events.jsonl").read_text().count("transcript") == 1

