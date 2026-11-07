from types import SimpleNamespace

from llm.core.types import (
    LLMInput,
    Message,
    ProviderType,
    Role,
    ToolCall,
    ToolDefinition,
)
from llm.providers.orcarouter import (
    DEFAULT_ORCAROUTER_MODEL,
    ORCAROUTER_BASE_URL,
    OrcaRouterProvider,
)


def _tool() -> ToolDefinition:
    return ToolDefinition(
        name="search",
        description="Search",
        parameters={"type": "object", "properties": {"query": {"type": "string"}}},
    )


class _Completions:
    def __init__(self, response: SimpleNamespace) -> None:
        self.params = None
        self.response = response

    def create(self, **params):
        self.params = params
        return self.response


class _Client:
    def __init__(self, response: SimpleNamespace) -> None:
        self.completions = _Completions(response)
        self.chat = SimpleNamespace(completions=self.completions)


def _response(**overrides) -> SimpleNamespace:
    message = SimpleNamespace(content="ok", tool_calls=None)
    choice = SimpleNamespace(message=message, finish_reason="stop")
    defaults = {
        "choices": [choice],
        "model": "orcarouter/auto",
        "usage": SimpleNamespace(prompt_tokens=1, completion_tokens=2, total_tokens=3),
    }
    defaults.update(overrides)
    return SimpleNamespace(**defaults)


def test_orcarouter_provider_defaults_to_orcarouter_endpoint(monkeypatch):
    monkeypatch.delenv("ORCAROUTER_API_KEY", raising=False)
    monkeypatch.delenv("ORCAROUTER_BASE_URL", raising=False)
    monkeypatch.delenv("ORCAROUTER_MODEL", raising=False)

    provider = OrcaRouterProvider()

    assert provider.provider_type == ProviderType.ORCAROUTER
    assert provider.base_url == ORCAROUTER_BASE_URL
    assert provider.get_default_model() == DEFAULT_ORCAROUTER_MODEL
    assert provider.validate_config() is False


def test_orcarouter_provider_reads_env_config(monkeypatch):
    monkeypatch.setenv("ORCAROUTER_API_KEY", "sk-orca-test")
    monkeypatch.setenv("ORCAROUTER_MODEL", "openai/gpt-4o-mini")
    monkeypatch.delenv("ORCAROUTER_BASE_URL", raising=False)

    provider = OrcaRouterProvider()

    assert provider.provider_type == ProviderType.ORCAROUTER
    assert provider.base_url == ORCAROUTER_BASE_URL
    assert provider.get_default_model() == "openai/gpt-4o-mini"
    assert provider.validate_config() is True


def test_orcarouter_provider_generates_openai_compatible_chat_completion():
    provider = OrcaRouterProvider(api_key="test", default_model="openai/gpt-4o-mini")
    client = _Client(_response(model="openai/gpt-4o-mini"))
    provider.client = client

    output = provider.generate(
        LLMInput(
            messages=[Message(role=Role.USER, content="hi")],
            max_tokens=128,
            tools=[_tool()],
        )
    )

    assert output.content == "ok"
    assert output.model == "openai/gpt-4o-mini"
    assert output.usage == {"prompt_tokens": 1, "completion_tokens": 2, "total_tokens": 3}
    assert client.completions.params["model"] == "openai/gpt-4o-mini"
    assert client.completions.params["max_tokens"] == 128
    assert "temperature" not in client.completions.params
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


def test_orcarouter_provider_forwards_non_default_temperature():
    provider = OrcaRouterProvider(api_key="test")
    client = _Client(_response())
    provider.client = client

    provider.generate(LLMInput(messages=[Message(role=Role.USER, content="hi")], temperature=0.2))

    assert client.completions.params["temperature"] == 0.2


def test_orcarouter_provider_parses_tool_calls():
    provider = OrcaRouterProvider(api_key="test")
    tool_call = SimpleNamespace(
        id="call_1",
        function=SimpleNamespace(name="search", arguments='{"query":"orcarouter"}'),
    )
    message = SimpleNamespace(content="", tool_calls=[tool_call])
    client = _Client(_response(choices=[SimpleNamespace(message=message, finish_reason="tool_calls")], usage=None))
    provider.client = client

    output = provider.generate(LLMInput(messages=[Message(role=Role.USER, content="hi")]))

    assert output.tool_calls == [ToolCall(id="call_1", name="search", arguments={"query": "orcarouter"})]
    assert output.usage is None


def test_orcarouter_provider_preserves_malformed_tool_arguments():
    provider = OrcaRouterProvider(api_key="test")
    tool_call = SimpleNamespace(
        id="call_1",
        function=SimpleNamespace(name="search", arguments="{not-json"),
    )
    message = SimpleNamespace(content="", tool_calls=[tool_call])
    client = _Client(_response(choices=[SimpleNamespace(message=message, finish_reason="tool_calls")]))
    provider.client = client

    output = provider.generate(LLMInput(messages=[Message(role=Role.USER, content="hi")]))

    assert output.tool_calls == [ToolCall(id="call_1", name="search", arguments={"raw": "{not-json"})]
