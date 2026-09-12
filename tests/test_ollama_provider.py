import json

import pytest

from llm.core.interface import AuthenticationError
from llm.core.types import LLMInput, Message, Role, ToolCall
from llm.providers.ollama import OllamaProvider


class _Response:
    def __init__(self, payload):
        self._payload = payload

    def read(self):
        return json.dumps(self._payload).encode("utf-8")

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False


def _run_generate(monkeypatch, payload):
    provider = OllamaProvider(base_url="http://localhost:11434", default_model="llama3.2")
    monkeypatch.setattr("urllib.request.urlopen", lambda req, timeout=60: _Response(payload))
    return provider.generate(LLMInput(messages=[Message(role=Role.USER, content="hi")]))


def test_ollama_provider_parses_string_tool_arguments(monkeypatch):
    payload = {"message": {"content": "", "tool_calls": [{"id": "1", "function": {"name": "search", "arguments": '{"q":"x"}'}}]}, "done_reason": "stop"}
    output = _run_generate(monkeypatch, payload)
    assert output.tool_calls == [ToolCall(id="1", name="search", arguments={"q": "x"})]


def test_ollama_provider_parses_dict_tool_arguments(monkeypatch):
    payload = {"message": {"content": "", "tool_calls": [{"id": "1", "function": {"name": "search", "arguments": {"q": "x"}}}]}, "done_reason": "stop"}
    output = _run_generate(monkeypatch, payload)
    assert output.tool_calls == [ToolCall(id="1", name="search", arguments={"q": "x"})]


def test_ollama_provider_preserves_malformed_tool_arguments(monkeypatch):
    payload = {"message": {"content": "", "tool_calls": [{"id": "1", "function": {"name": "search", "arguments": "{bad"}}]}, "done_reason": "stop"}
    output = _run_generate(monkeypatch, payload)
    assert output.tool_calls == [ToolCall(id="1", name="search", arguments={"raw": "{bad"})]


def test_ollama_connection_error_is_not_authentication_error(monkeypatch):
    provider = OllamaProvider(base_url="http://localhost:11434", default_model="llama3.2")

    def _boom(req, timeout=60):
        raise ConnectionError("connection refused")

    monkeypatch.setattr("urllib.request.urlopen", _boom)
    with pytest.raises(ConnectionError):
        provider.generate(LLMInput(messages=[Message(role=Role.USER, content="hi")]))


def test_ollama_auth_error_maps_to_authentication_error(monkeypatch):
    provider = OllamaProvider(base_url="http://localhost:11434", default_model="llama3.2")

    def _boom(req, timeout=60):
        raise Exception("401 unauthorized")

    monkeypatch.setattr("urllib.request.urlopen", _boom)
    with pytest.raises(AuthenticationError):
        provider.generate(LLMInput(messages=[Message(role=Role.USER, content="hi")]))
