import json
from types import SimpleNamespace
from typing import cast

import httpx
import pytest
from anthropic import Anthropic as AnthropicSDK
from openai import OpenAI as OpenAISDK

import llm.providers.minimax as minimax_module
from llm.core.types import (
    LLMInput,
    Message,
    ProviderType,
    Role,
    ToolCall,
    ToolDefinition,
)
from llm.providers.minimax import (
    DEFAULT_MINIMAX_MODEL,
    MINIMAX_ANTHROPIC_BASE_URL,
    MINIMAX_BASE_URL,
    MINIMAX_M2_7_MODEL,
    MiniMaxProvider,
)

pytestmark = pytest.mark.unit


class _OpenAICompletions:
    def __init__(self, response: SimpleNamespace | None = None) -> None:
        self.params = None
        self.response = response

    def create(self, **params: object) -> SimpleNamespace:
        self.params = params
        return self.response or SimpleNamespace(
            choices=[
                SimpleNamespace(
                    message=SimpleNamespace(
                        content="ok",
                        tool_calls=[
                            SimpleNamespace(
                                id="call_1",
                                function=SimpleNamespace(
                                    name="search",
                                    arguments='{"query":"docs"}',
                                ),
                            )
                        ],
                        reasoning_details=[
                            SimpleNamespace(type="reasoning.text", text="plan")
                        ],
                    ),
                    finish_reason="tool_calls",
                )
            ],
            model=params["model"],
            usage=SimpleNamespace(prompt_tokens=1, completion_tokens=2, total_tokens=3),
        )


class _OpenAIClient:
    def __init__(self, response: SimpleNamespace | None = None) -> None:
        self.completions = _OpenAICompletions(response)
        self.chat = SimpleNamespace(completions=self.completions)


class _AnthropicMessages:
    def __init__(self, response: SimpleNamespace | None = None) -> None:
        self.params = None
        self.response = response

    def create(self, **params: object) -> SimpleNamespace:
        self.params = params
        return self.response or SimpleNamespace(
            content=[SimpleNamespace(type="text", text="ok")],
            model=params["model"],
            usage=SimpleNamespace(input_tokens=1, output_tokens=2),
            stop_reason="end_turn",
        )


class _AnthropicClient:
    def __init__(self, response: SimpleNamespace | None = None) -> None:
        self.messages = _AnthropicMessages(response)


def _tool() -> ToolDefinition:
    return ToolDefinition(
        name="search",
        description="Search",
        parameters={"type": "object", "properties": {"query": {"type": "string"}}},
    )


def test_minimax_provider_exposes_both_target_models(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delenv("MINIMAX_API_KEY", raising=False)
    monkeypatch.delenv("MINIMAX_BASE_URL", raising=False)
    monkeypatch.delenv("MINIMAX_MODEL", raising=False)

    provider = MiniMaxProvider()
    models = {model.name: model for model in provider.list_models()}

    assert provider.provider_type == ProviderType.MINIMAX
    assert provider.base_url == MINIMAX_BASE_URL
    assert provider.get_default_model() == DEFAULT_MINIMAX_MODEL
    assert provider.validate_config() is False
    assert provider.supports_vision() is True
    assert models[DEFAULT_MINIMAX_MODEL].context_window == 1_000_000
    assert models[DEFAULT_MINIMAX_MODEL].max_tokens is None
    assert models[DEFAULT_MINIMAX_MODEL].supports_vision is True
    assert models[MINIMAX_M2_7_MODEL].context_window == 204_800
    assert models[MINIMAX_M2_7_MODEL].max_tokens is None
    assert models[MINIMAX_M2_7_MODEL].supports_vision is False


def test_minimax_provider_lists_custom_default_model() -> None:
    provider = MiniMaxProvider(api_key="test", default_model="custom-model")

    assert {model.name for model in provider.list_models()} == {
        DEFAULT_MINIMAX_MODEL,
        MINIMAX_M2_7_MODEL,
        "custom-model",
    }
    assert provider.supports_vision() is False


def test_minimax_provider_uses_openai_chat_completions() -> None:
    provider = MiniMaxProvider(api_key="test", base_url=MINIMAX_BASE_URL)
    client = _OpenAIClient()
    provider.client = client

    output = provider.generate(
        LLMInput(
            messages=[Message(role=Role.USER, content="hi")],
            tools=[_tool()],
            metadata={"thinking": {"type": "disabled"}},
        )
    )

    assert output.content == "ok"
    assert output.usage == {
        "prompt_tokens": 1,
        "completion_tokens": 2,
        "total_tokens": 3,
    }
    assert output.tool_calls == [
        ToolCall(id="call_1", name="search", arguments={"query": "docs"})
    ]
    assert output.metadata == {
        "openai_reasoning_details": [{"type": "reasoning.text", "text": "plan"}]
    }
    assert client.completions.params["extra_body"] == {"thinking": {"type": "disabled"}}
    assert client.completions.params["tools"][0]["type"] == "function"


def test_minimax_provider_uses_anthropic_messages() -> None:
    provider = MiniMaxProvider(api_key="test", base_url=MINIMAX_ANTHROPIC_BASE_URL)
    client = _AnthropicClient(
        SimpleNamespace(
            content=[
                SimpleNamespace(type="thinking", thinking="plan", signature="sig"),
                SimpleNamespace(type="text", text="ok"),
                SimpleNamespace(
                    type="tool_use",
                    id="tool_1",
                    name="search",
                    input={"query": "docs"},
                ),
            ],
            model=DEFAULT_MINIMAX_MODEL,
            usage=SimpleNamespace(input_tokens=1, output_tokens=2),
            stop_reason="tool_use",
        )
    )
    provider.client = client

    output = provider.generate(
        LLMInput(
            messages=[
                Message(role=Role.SYSTEM, content="Be concise."),
                Message(role=Role.USER, content="hi"),
            ],
            max_tokens=128,
            tools=[_tool()],
            metadata={"thinking": {"type": "adaptive"}},
        )
    )

    assert provider.base_url == MINIMAX_ANTHROPIC_BASE_URL
    assert output.content == "ok"
    assert output.tool_calls == [
        ToolCall(id="tool_1", name="search", arguments={"query": "docs"})
    ]
    assert output.metadata == {
        "anthropic_content": [
            {"type": "thinking", "thinking": "plan", "signature": "sig"},
            {"type": "text", "text": "ok"},
            {
                "type": "tool_use",
                "id": "tool_1",
                "name": "search",
                "input": {"query": "docs"},
            },
        ]
    }
    assert output.usage == {
        "input_tokens": 1,
        "output_tokens": 2,
        "cache_creation_input_tokens": 0,
        "cache_read_input_tokens": 0,
    }
    assert client.messages.params["system"] == "Be concise."
    assert client.messages.params["messages"] == [{"role": "user", "content": "hi"}]
    assert client.messages.params["max_tokens"] == 128
    assert client.messages.params["thinking"] == {"type": "adaptive"}
    assert client.messages.params["tools"][0]["input_schema"]["type"] == "object"


def test_minimax_openai_provider_serializes_tool_and_reasoning_history() -> None:
    provider = MiniMaxProvider(api_key="test", base_url=MINIMAX_BASE_URL)
    client = _OpenAIClient()
    provider.client = client

    provider.generate(
        LLMInput(
            messages=[
                Message(role=Role.USER, content="Find the docs."),
                Message(
                    role=Role.ASSISTANT,
                    content="",
                    tool_calls=[
                        ToolCall(
                            id="call_1",
                            name="search",
                            arguments={"query": "docs"},
                        )
                    ],
                    metadata={
                        "openai_reasoning_details": [
                            {"type": "reasoning.text", "text": "plan"}
                        ]
                    },
                ),
                Message(
                    role=Role.TOOL,
                    content="Found.",
                    tool_call_id="call_1",
                ),
            ]
        )
    )

    messages = client.completions.params["messages"]
    assert messages[1]["reasoning_details"] == [
        {"type": "reasoning.text", "text": "plan"}
    ]
    assert messages[1]["tool_calls"][0]["type"] == "function"
    assert json.loads(messages[1]["tool_calls"][0]["function"]["arguments"]) == {
        "query": "docs"
    }
    assert messages[2] == {
        "role": "tool",
        "content": "Found.",
        "tool_call_id": "call_1",
    }


def test_minimax_anthropic_provider_preserves_tool_history_blocks() -> None:
    provider = MiniMaxProvider(api_key="test", base_url=MINIMAX_ANTHROPIC_BASE_URL)
    client = _AnthropicClient()
    provider.client = client
    preserved_content = [
        {"type": "thinking", "thinking": "plan", "signature": "sig"},
        {
            "type": "tool_use",
            "id": "tool_1",
            "name": "search",
            "input": {"query": "docs"},
        },
        {
            "type": "tool_use",
            "id": "tool_2",
            "name": "search",
            "input": {"query": "examples"},
        },
    ]

    provider.generate(
        LLMInput(
            messages=[
                Message(role=Role.USER, content="Find references."),
                Message(
                    role=Role.ASSISTANT,
                    content="",
                    tool_calls=[
                        ToolCall(id="tool_1", name="search", arguments={}),
                        ToolCall(id="tool_2", name="search", arguments={}),
                    ],
                    metadata={"anthropic_content": preserved_content},
                ),
                Message(
                    role=Role.TOOL,
                    content="Found docs.",
                    tool_call_id="tool_1",
                ),
                Message(
                    role=Role.TOOL,
                    content="Found examples.",
                    tool_call_id="tool_2",
                ),
            ]
        )
    )

    assert client.messages.params["messages"] == [
        {"role": "user", "content": "Find references."},
        {"role": "assistant", "content": preserved_content},
        {
            "role": "user",
            "content": [
                {
                    "type": "tool_result",
                    "tool_use_id": "tool_1",
                    "content": "Found docs.",
                },
                {
                    "type": "tool_result",
                    "tool_use_id": "tool_2",
                    "content": "Found examples.",
                },
            ],
        },
    ]


def test_minimax_provider_preserves_structured_multimodal_content() -> None:
    openai_provider = MiniMaxProvider(api_key="test", base_url=MINIMAX_BASE_URL)
    openai_client = _OpenAIClient()
    openai_provider.client = openai_client
    openai_content = [
        {"type": "text", "text": "Describe this clip."},
        {"type": "video_url", "video_url": {"url": "https://example.com/clip.mp4"}},
    ]
    openai_provider.generate(
        LLMInput(messages=[Message(role=Role.USER, content=openai_content)])
    )

    anthropic_provider = MiniMaxProvider(
        api_key="test", base_url=MINIMAX_ANTHROPIC_BASE_URL
    )
    anthropic_client = _AnthropicClient()
    anthropic_provider.client = anthropic_client
    anthropic_content = [
        {"type": "text", "text": "Describe this image."},
        {
            "type": "image",
            "source": {
                "type": "url",
                "url": "https://example.com/image.png",
            },
        },
    ]
    anthropic_provider.generate(
        LLMInput(messages=[Message(role=Role.USER, content=anthropic_content)])
    )

    assert openai_client.completions.params["messages"][0]["content"] == openai_content
    assert anthropic_client.messages.params["messages"][0]["content"] == (
        anthropic_content
    )


def test_minimax_anthropic_provider_rejects_empty_responses() -> None:
    provider = MiniMaxProvider(api_key="test", base_url=MINIMAX_ANTHROPIC_BASE_URL)
    provider.client = _AnthropicClient(
        SimpleNamespace(
            content=[],
            model=DEFAULT_MINIMAX_MODEL,
            usage=SimpleNamespace(input_tokens=1, output_tokens=0),
            stop_reason="end_turn",
        )
    )

    with pytest.raises(ValueError, match="empty or filtered response"):
        provider.generate(LLMInput(messages=[Message(role=Role.USER, content="hi")]))


@pytest.mark.parametrize(
    ("base_url", "expected_host"),
    [
        ("https://api.minimax.io/v1", "api.minimax.io"),
        ("https://api.minimaxi.com/v1", "api.minimaxi.com"),
    ],
)
def test_openai_base_url_yields_one_chat_completions_path(
    monkeypatch: pytest.MonkeyPatch,
    base_url: str,
    expected_host: str,
) -> None:
    requests: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        return httpx.Response(
            200,
            json={
                "id": "chatcmpl_test",
                "object": "chat.completion",
                "created": 0,
                "model": DEFAULT_MINIMAX_MODEL,
                "choices": [
                    {
                        "index": 0,
                        "message": {"role": "assistant", "content": "ok"},
                        "finish_reason": "stop",
                    }
                ],
                "usage": {
                    "prompt_tokens": 1,
                    "completion_tokens": 1,
                    "total_tokens": 2,
                },
            },
        )

    http_client = httpx.Client(transport=httpx.MockTransport(handler))

    def openai_client(**kwargs: object) -> OpenAISDK:
        return OpenAISDK(
            api_key=cast(str, kwargs["api_key"]),
            base_url=cast(str, kwargs["base_url"]),
            http_client=http_client,
        )

    monkeypatch.setattr(minimax_module, "OpenAI", openai_client)
    provider = MiniMaxProvider(api_key="test", base_url=base_url)

    try:
        provider.generate(LLMInput(messages=[Message(role=Role.USER, content="hi")]))
    finally:
        http_client.close()

    assert len(requests) == 1
    assert requests[0].url.host == expected_host
    assert requests[0].url.path == "/v1/chat/completions"
    assert requests[0].url.path.count("/v1/chat/completions") == 1


@pytest.mark.parametrize(
    ("configured_base_url", "expected_host"),
    [
        ("https://api.minimax.io/anthropic", "api.minimax.io"),
        ("https://api.minimaxi.com/anthropic", "api.minimaxi.com"),
    ],
)
def test_anthropic_base_url_yields_one_v1_messages_path(
    monkeypatch: pytest.MonkeyPatch,
    configured_base_url: str,
    expected_host: str,
) -> None:
    requests: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        return httpx.Response(
            200,
            json={
                "id": "msg_test",
                "type": "message",
                "role": "assistant",
                "model": DEFAULT_MINIMAX_MODEL,
                "content": [{"type": "text", "text": "ok"}],
                "stop_reason": "end_turn",
                "stop_sequence": None,
                "usage": {"input_tokens": 1, "output_tokens": 1},
            },
        )

    http_client = httpx.Client(transport=httpx.MockTransport(handler))

    def anthropic_client(**kwargs: object) -> AnthropicSDK:
        return AnthropicSDK(
            api_key=cast(str, kwargs["api_key"]),
            base_url=cast(str, kwargs["base_url"]),
            http_client=http_client,
        )

    monkeypatch.setattr(minimax_module, "Anthropic", anthropic_client)
    provider = MiniMaxProvider(api_key="test", base_url=configured_base_url)

    try:
        provider.generate(LLMInput(messages=[Message(role=Role.USER, content="hi")]))
    finally:
        http_client.close()

    assert len(requests) == 1
    assert requests[0].url.host == expected_host
    assert requests[0].url.path == "/anthropic/v1/messages"
    assert requests[0].url.path.count("/v1/messages") == 1
