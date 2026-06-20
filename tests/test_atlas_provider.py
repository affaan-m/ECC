from types import SimpleNamespace

from llm.core.types import LLMInput, Message, ProviderType, Role, ToolCall, ToolDefinition
from llm.providers.atlas import ATLAS_BASE_URL, DEFAULT_ATLAS_MAX_TOKENS, DEFAULT_ATLAS_MODEL, AtlasProvider


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
        "model": DEFAULT_ATLAS_MODEL,
        "usage": SimpleNamespace(prompt_tokens=1, completion_tokens=2, total_tokens=3),
    }
    defaults.update(overrides)
    return SimpleNamespace(**defaults)


def test_atlas_provider_defaults_to_atlas_cloud_endpoint(monkeypatch):
    monkeypatch.delenv("ATLAS_API_KEY", raising=False)
    monkeypatch.delenv("ATLASCLOUD_API_KEY", raising=False)
    monkeypatch.delenv("ATLAS_BASE_URL", raising=False)
    monkeypatch.delenv("ATLAS_MODEL", raising=False)

    provider = AtlasProvider()

    assert provider.provider_type == ProviderType.ATLAS
    assert provider.base_url == ATLAS_BASE_URL
    assert provider.get_default_model() == DEFAULT_ATLAS_MODEL
    assert provider.validate_config() is False


def test_atlas_provider_reads_env_overrides(monkeypatch):
    monkeypatch.setenv("ATLAS_API_KEY", "atlas-key")
    monkeypatch.setenv("ATLAS_MODEL", "deepseek-ai/deepseek-v3.2")

    provider = AtlasProvider()

    assert provider.get_default_model() == "deepseek-ai/deepseek-v3.2"
    assert provider.validate_config() is True


def test_atlas_provider_accepts_atlascloud_api_key_fallback(monkeypatch):
    monkeypatch.delenv("ATLAS_API_KEY", raising=False)
    monkeypatch.setenv("ATLASCLOUD_API_KEY", "atlascloud-key")

    provider = AtlasProvider()

    assert provider.api_key == "atlascloud-key"
    assert provider.validate_config() is True


def test_atlas_provider_generates_openai_compatible_chat_completion():
    provider = AtlasProvider(api_key="test", default_model=DEFAULT_ATLAS_MODEL)
    client = _Client(_response(model=DEFAULT_ATLAS_MODEL))
    provider.client = client

    output = provider.generate(
        LLMInput(
            messages=[Message(role=Role.USER, content="hi")],
            max_tokens=1024,
            tools=[_tool()],
        )
    )

    assert output.content == "ok"
    assert output.model == DEFAULT_ATLAS_MODEL
    assert output.usage == {"prompt_tokens": 1, "completion_tokens": 2, "total_tokens": 3}
    assert client.completions.params["model"] == DEFAULT_ATLAS_MODEL
    assert client.completions.params["max_tokens"] == 1024
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


def test_atlas_provider_floors_max_tokens_for_reasoning_models():
    provider = AtlasProvider(api_key="test")
    client = _Client(_response())
    provider.client = client

    # No max_tokens supplied -> floored to the reasoning default.
    provider.generate(LLMInput(messages=[Message(role=Role.USER, content="hi")]))
    assert client.completions.params["max_tokens"] == DEFAULT_ATLAS_MAX_TOKENS

    # Too-small max_tokens is also raised to the floor.
    provider.generate(LLMInput(messages=[Message(role=Role.USER, content="hi")], max_tokens=16))
    assert client.completions.params["max_tokens"] == DEFAULT_ATLAS_MAX_TOKENS


def test_atlas_provider_forwards_non_default_temperature():
    provider = AtlasProvider(api_key="test")
    client = _Client(_response())
    provider.client = client

    provider.generate(LLMInput(messages=[Message(role=Role.USER, content="hi")], temperature=0.2))

    assert client.completions.params["temperature"] == 0.2


def test_atlas_provider_parses_tool_calls():
    provider = AtlasProvider(api_key="test")
    tool_call = SimpleNamespace(
        id="call_1",
        function=SimpleNamespace(name="search", arguments='{"query":"atlas"}'),
    )
    message = SimpleNamespace(content="", tool_calls=[tool_call])
    client = _Client(_response(choices=[SimpleNamespace(message=message, finish_reason="tool_calls")], usage=None))
    provider.client = client

    output = provider.generate(LLMInput(messages=[Message(role=Role.USER, content="hi")]))

    assert output.tool_calls == [ToolCall(id="call_1", name="search", arguments={"query": "atlas"})]
    assert output.usage is None


def test_atlas_provider_preserves_malformed_tool_arguments():
    provider = AtlasProvider(api_key="test")
    tool_call = SimpleNamespace(
        id="call_1",
        function=SimpleNamespace(name="search", arguments="{not-json"),
    )
    message = SimpleNamespace(content="", tool_calls=[tool_call])
    client = _Client(_response(choices=[SimpleNamespace(message=message, finish_reason="tool_calls")]))
    provider.client = client

    output = provider.generate(LLMInput(messages=[Message(role=Role.USER, content="hi")]))

    assert output.tool_calls == [ToolCall(id="call_1", name="search", arguments={"raw": "{not-json"})]
