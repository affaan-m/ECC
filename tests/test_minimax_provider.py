from types import SimpleNamespace
from typing import cast

import httpx
import pytest
from anthropic import Anthropic as AnthropicSDK
from openai import OpenAI as OpenAISDK

import llm.providers.minimax as minimax_module
from llm.core.types import LLMInput, Message, ProviderType, Role, ToolDefinition
from llm.providers.minimax import (
    DEFAULT_MINIMAX_MODEL,
    MINIMAX_ANTHROPIC_BASE_URL,
    MINIMAX_BASE_URL,
    MINIMAX_M2_7_MODEL,
    MiniMaxProvider,
)


class _OpenAICompletions:
    def __init__(self) -> None:
        self.params = None

    def create(self, **params: object) -> SimpleNamespace:
        self.params = params
        return SimpleNamespace(
            choices=[
                SimpleNamespace(
                    message=SimpleNamespace(content="ok", tool_calls=None),
                    finish_reason="stop",
                )
            ],
            model=params["model"],
            usage=SimpleNamespace(prompt_tokens=1, completion_tokens=2, total_tokens=3),
        )


class _OpenAIClient:
    def __init__(self) -> None:
        self.completions = _OpenAICompletions()
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


def test_minimax_provider_exposes_both_target_models(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.delenv("MINIMAX_API_KEY", raising=False)
    monkeypatch.delenv("MINIMAX_BASE_URL", raising=False)
    monkeypatch.delenv("MINIMAX_MODEL", raising=False)

    provider = MiniMaxProvider()
    models = {model.name: model for model in provider.list_models()}

    assert provider.provider_type == ProviderType.MINIMAX
    assert provider.base_url == MINIMAX_BASE_URL
    assert provider.get_default_model() == DEFAULT_MINIMAX_MODEL
    assert provider.validate_config() is False
    assert models[DEFAULT_MINIMAX_MODEL].context_window == 1_000_000
    assert models[DEFAULT_MINIMAX_MODEL].max_tokens == 524_288
    assert models[DEFAULT_MINIMAX_MODEL].supports_vision is True
    assert models[MINIMAX_M2_7_MODEL].context_window == 204_800
    assert models[MINIMAX_M2_7_MODEL].max_tokens == 204_800
    assert models[MINIMAX_M2_7_MODEL].supports_vision is False


def test_minimax_provider_lists_custom_default_model():
    provider = MiniMaxProvider(api_key="test", default_model="custom-model")

    assert {model.name for model in provider.list_models()} == {
        DEFAULT_MINIMAX_MODEL,
        MINIMAX_M2_7_MODEL,
        "custom-model",
    }


def test_minimax_provider_uses_openai_chat_completions():
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
    assert client.completions.params["extra_body"] == {"thinking": {"type": "disabled"}}
    assert client.completions.params["tools"][0]["type"] == "function"


def test_minimax_provider_uses_anthropic_messages():
    provider = MiniMaxProvider(
        api_key="test", base_url=f"{MINIMAX_ANTHROPIC_BASE_URL}/v1"
    )
    client = _AnthropicClient()
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


def test_minimax_anthropic_provider_rejects_empty_responses():
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
):
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
        ("https://api.minimax.io/anthropic/v1", "api.minimax.io"),
        ("https://api.minimaxi.com/anthropic", "api.minimaxi.com"),
        ("https://api.minimaxi.com/anthropic/v1", "api.minimaxi.com"),
    ],
)
def test_anthropic_base_url_yields_one_v1_messages_path(
    monkeypatch: pytest.MonkeyPatch,
    configured_base_url: str,
    expected_host: str,
):
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
