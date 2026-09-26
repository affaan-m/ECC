import json
import urllib.request
from io import BytesIO
from types import SimpleNamespace

import pytest

from llm.core.types import LLMInput, Message, Role, ToolDefinition
from llm.providers.claude import ClaudeProvider
from llm.providers.constants import EMPTY_FILTERED_RESPONSE_ERROR
from llm.providers.ollama import OllamaProvider
from llm.providers.openai import OpenAIProvider


def _tool() -> ToolDefinition:
    return ToolDefinition(
        name="search",
        description="Search",
        parameters={"type": "object", "properties": {"query": {"type": "string"}}},
    )


class _OpenAICompletions:
    def __init__(self, response: SimpleNamespace | None = None) -> None:
        self.params = None
        self.response = response

    def create(self, **params):
        self.params = params
        if self.response:
            return self.response
        return _openai_response(model=params["model"])


class _OpenAIClient:
    def __init__(self, response: SimpleNamespace | None = None) -> None:
        self.completions = _OpenAICompletions(response=response)
        self.chat = SimpleNamespace(completions=self.completions)


class _AnthropicMessages:
    def __init__(self) -> None:
        self.params = None

    def create(self, **params):
        self.params = params
        return SimpleNamespace(
            content=[SimpleNamespace(text="ok", type="text")],
            model=params["model"],
            usage=SimpleNamespace(input_tokens=1, output_tokens=1),
            stop_reason="end_turn",
        )


class _AnthropicClient:
    def __init__(self) -> None:
        self.messages = _AnthropicMessages()
        self.api_key = "test"


def _openai_response(**overrides) -> SimpleNamespace:
    defaults = {
        "choices": [SimpleNamespace(message=SimpleNamespace(content="ok", tool_calls=None), finish_reason="stop")],
        "model": "gpt-4o-mini",
        "usage": SimpleNamespace(prompt_tokens=1, completion_tokens=1, total_tokens=2),
    }
    defaults.update(overrides)
    return SimpleNamespace(**defaults)


def test_openai_provider_serializes_tools_for_chat_completions():
    provider = OpenAIProvider(api_key="test")
    client = _OpenAIClient()
    provider.client = client

    provider.generate(LLMInput(messages=[Message(role=Role.USER, content="hi")], tools=[_tool()]))

    assert client.completions.params["tools"] == [
        {
            "type": "function",
            "function": {
                "name": "search",
                "description": "Search",
                "parameters": {"type": "object", "properties": {"query": {"type": "string"}}},
                "strict": True,
            },
        }
    ]


def test_openai_provider_can_be_constructed_without_credentials(monkeypatch):
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)

    provider = OpenAIProvider()

    assert provider.validate_config() is False


def test_openai_provider_rejects_empty_or_filtered_responses():
    provider = OpenAIProvider(api_key="test")

    for response in [
        _openai_response(choices=[]),
        _openai_response(choices=[SimpleNamespace(message=None, finish_reason="content_filter")]),
    ]:
        provider.client = _OpenAIClient(response=response)
        with pytest.raises(ValueError, match=EMPTY_FILTERED_RESPONSE_ERROR):
            provider.generate(LLMInput(messages=[Message(role=Role.USER, content="hi")]))


def test_openai_provider_allows_missing_usage():
    provider = OpenAIProvider(api_key="test")
    provider.client = _OpenAIClient(response=_openai_response(usage=None))

    output = provider.generate(LLMInput(messages=[Message(role=Role.USER, content="hi")]))

    assert output.content == "ok"
    assert output.usage is None


@pytest.mark.parametrize(
    ("max_tokens", "temperature", "expected_options"),
    [
        (128, 1.0, {"num_predict": 128}),
        (128, 0.2, {"temperature": 0.2, "num_predict": 128}),
        (128, 0.0, {"temperature": 0.0, "num_predict": 128}),
        (0, 1.0, {"num_predict": 0}),
        (None, 1.0, {}),
        (None, 0.2, {"temperature": 0.2}),
    ],
)
def test_ollama_provider_serializes_generation_options(
    monkeypatch, max_tokens, temperature, expected_options
):
    requests = []

    def fake_urlopen(request, timeout):
        requests.append((request, timeout))
        return BytesIO(b'{"message": {"content": "ok"}, "done_reason": "stop"}')

    monkeypatch.setattr(urllib.request, "urlopen", fake_urlopen)
    provider = OllamaProvider(base_url="http://localhost:11434", default_model="llama3.2")

    output = provider.generate(
        LLMInput(
            messages=[Message(role=Role.USER, content="hi")],
            max_tokens=max_tokens,
            temperature=temperature,
        )
    )

    assert len(requests) == 1
    request, timeout = requests[0]
    expected_payload = {
        "model": "llama3.2",
        "messages": [{"role": "user", "content": "hi"}],
        "stream": False,
    }
    if expected_options:
        expected_payload["options"] = expected_options
    assert json.loads(request.data) == expected_payload
    assert request.full_url == "http://localhost:11434/api/chat"
    assert request.get_method() == "POST"
    assert request.get_header("Content-type") == "application/json"
    assert timeout == 60
    assert output.content == "ok"
    assert output.model == "llama3.2"
    assert output.stop_reason == "stop"


def test_claude_provider_serializes_tools_for_messages_api():
    provider = ClaudeProvider(api_key="test")
    client = _AnthropicClient()
    provider.client = client

    provider.generate(LLMInput(messages=[Message(role=Role.USER, content="hi")], tools=[_tool()]))

    assert client.messages.params["tools"] == [
        {
            "name": "search",
            "description": "Search",
            "input_schema": {"type": "object", "properties": {"query": {"type": "string"}}},
        }
    ]
