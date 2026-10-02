import asyncio
import json
import urllib.request
from io import BytesIO
from types import SimpleNamespace
from typing import Any

import pytest

from llm.core.types import LLMInput, Message, Role, ToolDefinition
from llm.providers.claude import ClaudeProvider
from llm.providers.constants import EMPTY_FILTERED_RESPONSE_ERROR
from llm.providers.ollama import OllamaProvider
from llm.providers.openai import OpenAIProvider
from llm.tools import ReActAgent, ToolExecutor, ToolRegistry


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


class _FakeOllama:
    """Serves /api/show and replays queued /api/chat replies, recording requests."""

    def __init__(
        self,
        monkeypatch: pytest.MonkeyPatch,
        replies: list[dict[str, Any]],
        capabilities: list[str] | None = None,
    ) -> None:
        self.replies = list(replies)
        self.capabilities = capabilities
        self.chats: list[dict[str, Any]] = []
        self.shows: list[str] = []
        monkeypatch.setattr(urllib.request, "urlopen", self.urlopen)

    def urlopen(self, request: urllib.request.Request, timeout: float) -> BytesIO:
        body = json.loads(request.data)
        if request.full_url.endswith("/api/show"):
            self.shows.append(body["model"])
            if self.capabilities is None:
                raise OSError("connection refused")
            return BytesIO(json.dumps({"capabilities": self.capabilities}).encode())
        self.chats.append(body)
        return BytesIO(json.dumps(self.replies.pop(0)).encode())


def _ollama_tool_calls(*calls: tuple[str, dict[str, Any]]) -> dict[str, Any]:
    return {
        "message": {
            "content": "",
            "tool_calls": [{"function": {"name": name, "arguments": args}} for name, args in calls],
        },
        "done_reason": "stop",
    }


def _ollama_answer(text: str) -> dict[str, Any]:
    return {"message": {"content": text}, "done_reason": "stop"}


def _lookup_tool() -> ToolDefinition:
    return ToolDefinition(
        name="lookup",
        description="Look up a city",
        parameters={"type": "object", "properties": {"city": {"type": "string"}}},
    )


def test_ollama_provider_serializes_tools_and_parses_tool_calls(monkeypatch: pytest.MonkeyPatch) -> None:
    server = _FakeOllama(
        monkeypatch, [_ollama_tool_calls(("search", {"query": "ollama"}))], capabilities=["completion", "tools"]
    )
    provider = OllamaProvider(base_url="http://localhost:11434", default_model="qwen3")

    output = provider.generate(LLMInput(messages=[Message(role=Role.USER, content="hi")], tools=[_tool()]))

    assert server.shows == ["qwen3"]
    assert server.chats[0]["tools"] == [
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
    assert output.has_tool_calls
    assert output.tool_calls[0].name == "search"
    assert output.tool_calls[0].arguments == {"query": "ollama"}
    assert output.tool_calls[0].id


@pytest.mark.parametrize(
    ("model", "capabilities", "expect_tools", "expect_shows"),
    [
        ("llama3.2", None, True, []),
        ("codellama", None, False, []),
        ("qwen3", ["completion", "tools"], True, ["qwen3"]),
        ("gemma3", ["completion", "vision"], False, ["gemma3"]),
        ("unknown", None, False, ["unknown", "unknown"]),
    ],
)
def test_ollama_provider_sends_tools_only_to_models_that_declare_them(
    monkeypatch: pytest.MonkeyPatch,
    model: str,
    capabilities: list[str] | None,
    expect_tools: bool,
    expect_shows: list[str],
) -> None:
    server = _FakeOllama(monkeypatch, [_ollama_answer("ok"), _ollama_answer("ok")], capabilities=capabilities)
    provider = OllamaProvider(default_model=model)
    request = LLMInput(messages=[Message(role=Role.USER, content="hi")], tools=[_tool()])

    provider.generate(request)
    provider.generate(request)

    assert all(("tools" in chat) is expect_tools for chat in server.chats)
    # An answered capability lookup is cached per model; a failed one is retried.
    assert server.shows == expect_shows


def test_ollama_provider_retries_capability_lookup_after_a_failure(monkeypatch: pytest.MonkeyPatch) -> None:
    server = _FakeOllama(monkeypatch, [_ollama_answer("ok"), _ollama_answer("ok"), _ollama_answer("ok")])
    provider = OllamaProvider(default_model="qwen3")
    request = LLMInput(messages=[Message(role=Role.USER, content="hi")], tools=[_tool()])

    provider.generate(request)
    server.capabilities = ["completion", "tools"]
    provider.generate(request)
    provider.generate(request)

    assert ["tools" in chat for chat in server.chats] == [False, True, True]
    assert server.shows == ["qwen3", "qwen3"]


def test_ollama_react_agent_correlates_multiple_calls_without_ids(monkeypatch: pytest.MonkeyPatch) -> None:
    server = _FakeOllama(
        monkeypatch,
        [
            _ollama_tool_calls(("lookup", {"city": "Hefei"}), ("search", {"query": "weather"})),
            _ollama_answer("Hefei is sunny."),
        ],
        capabilities=["completion", "tools"],
    )
    registry = ToolRegistry()
    registry.register(_lookup_tool(), lambda city: f"city={city}")
    registry.register(_tool(), lambda query: f"query={query}")
    agent = ReActAgent(OllamaProvider(default_model="qwen3"), ToolExecutor(registry))

    output = asyncio.run(
        agent.run(
            LLMInput(
                messages=[Message(role=Role.USER, content="Weather in Hefei?")],
                tools=[_lookup_tool(), _tool()],
            )
        )
    )

    assert output.content == "Hefei is sunny."
    follow_up = server.chats[1]
    assert "tools" in follow_up
    assistant, first, second = follow_up["messages"][1:]
    ids = [call["id"] for call in assistant["tool_calls"]]
    assert all(ids) and len(set(ids)) == 2
    assert [call["function"]["name"] for call in assistant["tool_calls"]] == ["lookup", "search"]
    assert first == {"role": "tool", "content": "city=Hefei", "tool_call_id": ids[0], "tool_name": "lookup"}
    assert second == {"role": "tool", "content": "query=weather", "tool_call_id": ids[1], "tool_name": "search"}


def test_ollama_react_agent_reports_unknown_tool_under_its_own_name(monkeypatch: pytest.MonkeyPatch) -> None:
    server = _FakeOllama(
        monkeypatch,
        [_ollama_tool_calls(("missing", {}), ("search", {"query": "x"})), _ollama_answer("done")],
        capabilities=["completion", "tools"],
    )
    registry = ToolRegistry()
    registry.register(_tool(), lambda query: f"query={query}")
    agent = ReActAgent(OllamaProvider(default_model="qwen3"), ToolExecutor(registry))

    asyncio.run(agent.run(LLMInput(messages=[Message(role=Role.USER, content="go")], tools=[_tool()])))

    results = server.chats[1]["messages"][2:]
    assert [(r["tool_name"], r["content"]) for r in results] == [
        ("missing", "Error: Tool 'missing' not found"),
        ("search", "query=x"),
    ]


def test_ollama_react_agent_without_tool_support_answers_directly(monkeypatch: pytest.MonkeyPatch) -> None:
    server = _FakeOllama(monkeypatch, [_ollama_answer("I cannot call tools.")])
    agent = ReActAgent(OllamaProvider(default_model="codellama"), ToolExecutor())

    output = asyncio.run(agent.run(LLMInput(messages=[Message(role=Role.USER, content="hi")], tools=[_tool()])))

    assert output.content == "I cannot call tools."
    assert "tools" not in server.chats[0]
    assert server.shows == []


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
