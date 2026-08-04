import pytest
from llm.core.types import (
    LLMInput,
    LLMOutput,
    Message,
    ModelInfo,
    ProviderType,
    Role,
    ToolCall,
    ToolDefinition,
    ToolResult,
)


class TestRole:
    def test_role_values(self):
        assert Role.SYSTEM.value == "system"
        assert Role.USER.value == "user"
        assert Role.ASSISTANT.value == "assistant"
        assert Role.TOOL.value == "tool"


class TestProviderType:
    def test_provider_values(self):
        assert ProviderType.CLAUDE.value == "claude"
        assert ProviderType.OPENAI.value == "openai"
        assert ProviderType.OLLAMA.value == "ollama"
        assert ProviderType.ASTRAFLOW.value == "astraflow"
        assert ProviderType.ASTRAFLOW_CN.value == "astraflow_cn"


class TestMessage:
    def test_create_message(self):
        msg = Message(role=Role.USER, content="Hello")
        assert msg.role == Role.USER
        assert msg.content == "Hello"
        assert msg.name is None
        assert msg.tool_call_id is None

    def test_message_to_dict(self):
        msg = Message(role=Role.USER, content="Hello", name="test")
        result = msg.to_dict()
        assert result["role"] == "user"
        assert result["content"] == "Hello"
        assert result["name"] == "test"


class TestToolDefinition:
    def test_create_tool(self):
        tool = ToolDefinition(
            name="search",
            description="Search the web",
            parameters={"type": "object", "properties": {}},
        )
        assert tool.name == "search"
        assert tool.strict is True

    def test_tool_to_dict(self):
        tool = ToolDefinition(
            name="search",
            description="Search",
            parameters={"type": "object"},
        )
        result = tool.to_dict()
        assert result["name"] == "search"
        assert result["strict"] is True

    def test_tool_to_openai_tool(self):
        tool = ToolDefinition(
            name="search",
            description="Search",
            parameters={"type": "object"},
            strict=False,
        )

        assert tool.to_openai_tool() == {
            "type": "function",
            "function": {
                "name": "search",
                "description": "Search",
                "parameters": {"type": "object"},
                "strict": False,
            },
        }

    def test_tool_to_anthropic_tool(self):
        tool = ToolDefinition(
            name="search",
            description="Search",
            parameters={"type": "object"},
        )

        assert tool.to_anthropic_tool() == {
            "name": "search",
            "description": "Search",
            "input_schema": {"type": "object"},
        }


class TestToolCall:
    def test_create_tool_call(self):
        tc = ToolCall(id="1", name="search", arguments={"query": "test"})
        assert tc.id == "1"
        assert tc.name == "search"
        assert tc.arguments == {"query": "test"}


class TestToolResult:
    def test_create_tool_result(self):
        result = ToolResult(tool_call_id="1", content="result")
        assert result.tool_call_id == "1"
        assert result.is_error is False


class TestLLMInput:
    def test_create_input(self):
        messages = [Message(role=Role.USER, content="Hello")]
        input_obj = LLMInput(messages=messages, temperature=0.7)
        assert len(input_obj.messages) == 1
        assert input_obj.temperature == 0.7

    def test_input_to_dict(self):
        messages = [Message(role=Role.USER, content="Hello")]
        input_obj = LLMInput(messages=messages)
        result = input_obj.to_dict()
        assert "messages" in result
        assert result["temperature"] == 1.0


class TestLLMOutput:
    def test_create_output(self):
        output = LLMOutput(content="Hello!")
        assert output.content == "Hello!"
        assert output.has_tool_calls is False

    def test_output_with_tool_calls(self):
        tc = ToolCall(id="1", name="search", arguments={})
        output = LLMOutput(content="", tool_calls=[tc])
        assert output.has_tool_calls is True


class TestModelInfo:
    def test_create_model_info(self):
        info = ModelInfo(
            name="gpt-4",
            provider=ProviderType.OPENAI,
        )
        assert info.name == "gpt-4"
        assert info.supports_tools is True
        assert info.supports_vision is False
