import json
from types import SimpleNamespace
from typing import Any

import anthropic
import httpx
import httpx2
import pytest
from anthropic import Anthropic

from llm.core.types import LLMInput, Message, Role
from llm.providers.claude import ClaudeProvider, _needs_explicit_adaptive_thinking

# The HTTP library the installed SDK builds on: 0.x uses httpx, 1.0 onward
# httpx2. pyproject allows both generations, so the transport must match.
http = httpx2 if int(anthropic.__version__.split(".")[0]) >= 1 else httpx


class FakeMessages:
    def __init__(self, response: SimpleNamespace) -> None:
        self.response = response
        self.last_params: dict[str, Any] = {}

    def create(self, **params: object) -> SimpleNamespace:
        self.last_params = dict(params)
        return self.response


class FakeClient:
    def __init__(self, response: SimpleNamespace) -> None:
        self.messages = FakeMessages(response)
        self.api_key = "test-key"


def make_provider(response: SimpleNamespace) -> ClaudeProvider:
    provider = ClaudeProvider(api_key="test-key")
    provider.client = FakeClient(response)
    return provider


def make_response(content: list[SimpleNamespace], stop_reason: str = "tool_use") -> SimpleNamespace:
    return SimpleNamespace(
        content=content,
        model="claude-test",
        usage=SimpleNamespace(input_tokens=3, output_tokens=5),
        stop_reason=stop_reason,
    )


@pytest.mark.unit
@pytest.mark.parametrize(
    ("default_model", "request_model", "expected_model"),
    [
        (None, None, "claude-sonnet-5-5"),
        (None, "claude-haiku-5-5", "claude-haiku-5-5"),
        ("claude-haiku-5-5", None, "claude-haiku-5-5"),
        ("claude-opus-5-5", None, "claude-opus-5-5"),
        ("claude-haiku-5-5", "claude-opus-5-5", "claude-opus-5-5"),
        ("claude-sonnet-4-6", None, "claude-sonnet-4-6"),
        (None, "claude-opus-4-8", "claude-opus-4-8"),
    ],
)
def test_generate_respects_configured_default_and_request_model(
    default_model: str | None, request_model: str | None, expected_model: str
) -> None:
    provider_options = {"api_key": "test-key"}
    if default_model is not None:
        provider_options["default_model"] = default_model
    provider = ClaudeProvider(**provider_options)
    client = FakeClient(make_response([SimpleNamespace(type="text", text="ok")]))
    provider.client = client
    expected_default = default_model or "claude-sonnet-5-5"

    assert provider.get_default_model() == expected_default

    provider.generate(
        LLMInput(messages=[Message(role=Role.USER, content="Hi")], model=request_model)
    )

    assert client.messages.last_params["model"] == expected_model
    assert provider.get_default_model() == expected_default


def _message_json(model: str) -> dict[str, Any]:
    return {
        "id": "msg_1",
        "type": "message",
        "role": "assistant",
        "model": model,
        "content": [{"type": "text", "text": "ok"}],
        "stop_reason": "end_turn",
        "stop_sequence": None,
        "usage": {"input_tokens": 1, "output_tokens": 1},
    }


@pytest.mark.unit
@pytest.mark.parametrize(
    ("model", "expected_thinking"),
    [
        (None, {"type": "adaptive"}),
        ("claude-opus-5-5", {"type": "adaptive"}),
        ("claude-sonnet-5-5", {"type": "adaptive"}),
        ("claude-haiku-5-5", {"type": "adaptive"}),
        ("claude-opus-4-8", {"type": "adaptive"}),
        ("claude-sonnet-4-6", None),
        ("claude-haiku-4-5", None),
    ],
)
@pytest.mark.parametrize("temperature", [1.0, 0.2])
def test_generate_sends_a_request_the_installed_sdk_accepts(
    model: str | None, expected_thinking: dict[str, str] | None, temperature: float
) -> None:
    # The real SDK, not a fake: anthropic 2.x removed the sampling parameters from
    # messages.create(), so passing temperature raises TypeError before any request.
    requests: list[Any] = []

    def handler(request: Any) -> Any:
        requests.append(request)
        return http.Response(200, json=_message_json(json.loads(request.content)["model"]))

    http_client = http.Client(transport=http.MockTransport(handler))
    provider = ClaudeProvider(api_key="test-key")
    provider.client = Anthropic(api_key="test-key", max_retries=0, http_client=http_client)

    try:
        output = provider.generate(
            LLMInput(
                messages=[Message(role=Role.USER, content="hi")],
                model=model,
                temperature=temperature,
            )
        )
    finally:
        http_client.close()

    assert output.content == "ok"
    assert len(requests) == 1
    body = json.loads(requests[0].content)
    assert body["model"] == (model or "claude-sonnet-5-5")
    assert not {"temperature", "top_p", "top_k"} & body.keys()
    assert body.get("thinking") == expected_thinking
    assert "budget_tokens" not in json.dumps(body)


@pytest.mark.unit
def test_list_models_pins_the_current_lineup() -> None:
    provider = ClaudeProvider(api_key="test-key")

    catalog = {
        model.name: (model.max_tokens, model.context_window, model.supports_tools, model.supports_vision)
        for model in provider.list_models()
    }

    assert catalog == {
        "claude-opus-5-5": (128_000, 1_000_000, True, True),
        "claude-sonnet-5-5": (128_000, 1_000_000, True, True),
        "claude-haiku-5-5": (128_000, 1_000_000, True, True),
    }
    assert provider.get_default_model() in catalog


@pytest.mark.unit
@pytest.mark.parametrize(
    ("model", "expected"),
    [
        ("claude-opus-5-5", True),
        ("claude-sonnet-5-5", True),
        ("claude-haiku-5-5", True),
        ("claude-opus-5", True),
        ("claude-sonnet-5", True),
        ("claude-fable-5-1", True),
        ("claude-opus-4-8", True),
        ("claude-opus-4-7", True),
        ("anthropic.claude-opus-5-5", True),
        ("claude-opus-4-6", False),
        ("claude-sonnet-4-6", False),
        ("claude-haiku-4-5", False),
        ("claude-haiku-4-5-20251001", False),
        ("claude-opus-4-5-20251101", False),
        ("claude-opus-4-20250514", False),
        ("claude-3-5-sonnet-latest", False),
        ("custom-model", False),
    ],
)
def test_explicit_adaptive_thinking_follows_model_version(model: str, expected: bool) -> None:
    assert _needs_explicit_adaptive_thinking(model) is expected


@pytest.mark.unit
def test_generate_collects_text_and_tool_use_blocks() -> None:
    provider = make_provider(
        make_response(
            [
                SimpleNamespace(type="text", text="I will search. "),
                SimpleNamespace(type="tool_use", id="toolu_1", name="search", input={"query": "claude"}),
                SimpleNamespace(type="text", text="Done."),
            ]
        )
    )

    output = provider.generate(LLMInput(messages=[Message(role=Role.USER, content="Search")]))

    assert output.content == "I will search. Done."
    assert output.tool_calls is not None
    assert len(output.tool_calls) == 1
    assert output.tool_calls[0].id == "toolu_1"
    assert output.tool_calls[0].name == "search"
    assert output.tool_calls[0].arguments == {"query": "claude"}


@pytest.mark.unit
def test_generate_collects_multiple_tool_use_blocks() -> None:
    provider = make_provider(
        make_response(
            [
                SimpleNamespace(type="tool_use", id="toolu_1", name="search", input={"query": "claude"}),
                SimpleNamespace(
                    type="tool_use",
                    id="toolu_2",
                    name="read",
                    input=SimpleNamespace(path="README.md"),
                ),
            ]
        )
    )

    output = provider.generate(LLMInput(messages=[Message(role=Role.USER, content="Use tools")]))

    assert output.content == ""
    assert [call.id for call in output.tool_calls or []] == ["toolu_1", "toolu_2"]
    assert (output.tool_calls or [])[1].arguments == {"path": "README.md"}


@pytest.mark.unit
def test_generate_copies_tool_use_dict_arguments() -> None:
    raw_arguments: dict[str, Any] = {"query": "claude"}
    provider = make_provider(
        make_response(
            [SimpleNamespace(type="tool_use", id="toolu_1", name="search", input=raw_arguments)]
        )
    )

    output = provider.generate(LLMInput(messages=[Message(role=Role.USER, content="Use tools")]))
    raw_arguments["query"] = "mutated"

    assert (output.tool_calls or [])[0].arguments == {"query": "claude"}


@pytest.mark.unit
def test_generate_text_only_has_no_tool_calls() -> None:
    provider = make_provider(
        make_response(
            [SimpleNamespace(type="text", text="Hello.")],
            stop_reason="end_turn",
        )
    )

    output = provider.generate(LLMInput(messages=[Message(role=Role.USER, content="Hi")]))

    assert output.content == "Hello."
    assert output.tool_calls is None


@pytest.mark.unit
def test_generate_rejects_structured_system_content() -> None:
    provider = make_provider(make_response([]))

    with pytest.raises(TypeError, match="System messages must contain text"):
        provider.generate(
            LLMInput(
                messages=[
                    Message(
                        role=Role.SYSTEM,
                        content=[{"type": "text", "text": "Rules"}],
                    )
                ]
            )
        )


@pytest.mark.unit
def test_generate_does_not_pass_cache_control_as_top_level_param() -> None:
    # cache_control is a per-content-block field on the Anthropic Messages API,
    # not a top-level parameter. Passing it at the top level raises TypeError
    # in the Anthropic Python SDK (or a 400 from the API).
    provider = make_provider(make_response([SimpleNamespace(type="text", text="ok")]))

    provider.generate(
        LLMInput(
            messages=[
                Message(role=Role.SYSTEM, content="system prompt"),
                Message(role=Role.USER, content="hi"),
            ]
        )
    )

    params = provider.client.messages.last_params
    assert "cache_control" not in params

    # When a system prompt is present, cache_control should ride on the last
    # system content block so ephemeral prompt caching still works.
    system = params.get("system")
    assert isinstance(system, list), "system should be sent as a list of content blocks"
    assert system, "system content-block list should not be empty"
    assert system[-1].get("cache_control") == {"type": "ephemeral"}


@pytest.mark.unit
def test_generate_without_system_does_not_set_system_or_cache_control() -> None:
    provider = make_provider(make_response([SimpleNamespace(type="text", text="ok")]))

    provider.generate(LLMInput(messages=[Message(role=Role.USER, content="hi")]))

    params = provider.client.messages.last_params
    assert "cache_control" not in params
    assert "system" not in params
