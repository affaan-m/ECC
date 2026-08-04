from types import SimpleNamespace

from llm.core.types import LLMInput, Message, ProviderType, Role, ToolDefinition, ToolCall
from llm.providers.astraflow import ASTRAFLOW_BASE_URL, ASTRAFLOW_CN_BASE_URL, AstraflowCNProvider, AstraflowProvider


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
        "model": "gpt-4o-mini",
        "usage": SimpleNamespace(prompt_tokens=1, completion_tokens=2, total_tokens=3),
    }
    defaults.update(overrides)
    return SimpleNamespace(**defaults)


def test_astraflow_provider_defaults_to_global_umodelverse_endpoint(monkeypatch):
    monkeypatch.delenv("ASTRAFLOW_API_KEY", raising=False)
    monkeypatch.delenv("ASTRAFLOW_BASE_URL", raising=False)
    monkeypatch.delenv("ASTRAFLOW_MODEL", raising=False)

    provider = AstraflowProvider()

    assert provider.provider_type == ProviderType.ASTRAFLOW
    assert provider.base_url == ASTRAFLOW_BASE_URL
    assert provider.get_default_model() == "gpt-4o-mini"
    assert provider.validate_config() is False


def test_astraflow_cn_provider_uses_cn_endpoint_and_model_fallback(monkeypatch):
    monkeypatch.setenv("ASTRAFLOW_API_KEY", "global-key")
    monkeypatch.setenv("ASTRAFLOW_MODEL", "deepseek-ai/DeepSeek-V3-0324")
    monkeypatch.setenv("ASTRAFLOW_CN_API_KEY", "cn-key")
    monkeypatch.delenv("ASTRAFLOW_CN_MODEL", raising=False)
    monkeypatch.delenv("ASTRAFLOW_CN_BASE_URL", raising=False)

    provider = AstraflowCNProvider()

    assert provider.provider_type == ProviderType.ASTRAFLOW_CN
    assert provider.base_url == ASTRAFLOW_CN_BASE_URL
    assert provider.get_default_model() == "deepseek-ai/DeepSeek-V3-0324"
    assert provider.validate_config() is True


def test_astraflow_provider_generates_openai_compatible_chat_completion():
    provider = AstraflowProvider(api_key="test", default_model="deepseek-ai/DeepSeek-V3-0324")
    client = _Client(_response(model="deepseek-ai/DeepSeek-V3-0324"))
    provider.client = client

    output = provider.generate(
        LLMInput(
            messages=[Message(role=Role.USER, content="hi")],
            max_tokens=128,
            tools=[_tool()],
        )
    )

    assert output.content == "ok"
    assert output.model == "deepseek-ai/DeepSeek-V3-0324"
    assert output.usage == {"prompt_tokens": 1, "completion_tokens": 2, "total_tokens": 3}
    assert client.completions.params["model"] == "deepseek-ai/DeepSeek-V3-0324"
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


def test_astraflow_provider_forwards_non_default_temperature():
    provider = AstraflowProvider(api_key="test")
    client = _Client(_response())
    provider.client = client

    provider.generate(LLMInput(messages=[Message(role=Role.USER, content="hi")], temperature=0.2))

    assert client.completions.params["temperature"] == 0.2


def test_astraflow_provider_parses_tool_calls():
    provider = AstraflowProvider(api_key="test")
    tool_call = SimpleNamespace(
        id="call_1",
        function=SimpleNamespace(name="search", arguments='{"query":"ucloud"}'),
    )
    message = SimpleNamespace(content="", tool_calls=[tool_call])
    client = _Client(_response(choices=[SimpleNamespace(message=message, finish_reason="tool_calls")], usage=None))
    provider.client = client

    output = provider.generate(LLMInput(messages=[Message(role=Role.USER, content="hi")]))

    assert output.tool_calls == [ToolCall(id="call_1", name="search", arguments={"query": "ucloud"})]
    assert output.usage is None


def test_astraflow_provider_preserves_malformed_tool_arguments():
    provider = AstraflowProvider(api_key="test")
    tool_call = SimpleNamespace(
        id="call_1",
        function=SimpleNamespace(name="search", arguments="{not-json"),
    )
    message = SimpleNamespace(content="", tool_calls=[tool_call])
    client = _Client(_response(choices=[SimpleNamespace(message=message, finish_reason="tool_calls")]))
    provider.client = client

    output = provider.generate(LLMInput(messages=[Message(role=Role.USER, content="hi")]))

    assert output.tool_calls == [ToolCall(id="call_1", name="search", arguments={"raw": "{not-json"})]
