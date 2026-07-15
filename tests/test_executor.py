import pytest
from llm.core.types import LLMInput, LLMOutput, Message, Role, ToolCall, ToolDefinition
from llm.tools import ReActAgent, ToolExecutor, ToolRegistry


class TestToolRegistry:
    def test_register_and_get(self):
        registry = ToolRegistry()

        def dummy_func() -> str:
            return "result"

        tool_def = ToolDefinition(
            name="dummy",
            description="A dummy tool",
            parameters={"type": "object"},
        )
        registry.register(tool_def, dummy_func)

        assert registry.has("dummy") is True
        assert registry.get("dummy") is dummy_func
        assert registry.get_definition("dummy") == tool_def

    def test_list_tools(self):
        registry = ToolRegistry()
        tool_def = ToolDefinition(name="test", description="Test", parameters={})
        registry.register(tool_def, lambda: None)

        tools = registry.list_tools()
        assert len(tools) == 1
        assert tools[0].name == "test"


class TestToolExecutor:
    def test_execute_success(self):
        registry = ToolRegistry()

        def search(query: str) -> str:
            return f"Results for: {query}"

        registry.register(
            ToolDefinition(
                name="search",
                description="Search",
                parameters={"type": "object", "properties": {"query": {"type": "string"}}},
            ),
            search,
        )

        executor = ToolExecutor(registry)
        result = executor.execute(ToolCall(id="1", name="search", arguments={"query": "test"}))

        assert result.tool_call_id == "1"
        assert result.content == "Results for: test"
        assert result.is_error is False

    def test_execute_unknown_tool(self):
        registry = ToolRegistry()
        executor = ToolExecutor(registry)

        result = executor.execute(ToolCall(id="1", name="unknown", arguments={}))

        assert result.is_error is True
        assert "not found" in result.content

    def test_execute_all(self):
        registry = ToolRegistry()

        def tool1() -> str:
            return "result1"

        def tool2() -> str:
            return "result2"

        registry.register(ToolDefinition(name="t1", description="", parameters={}), tool1)
        registry.register(ToolDefinition(name="t2", description="", parameters={}), tool2)

        executor = ToolExecutor(registry)
        results = executor.execute_all([
            ToolCall(id="1", name="t1", arguments={}),
            ToolCall(id="2", name="t2", arguments={}),
        ])

        assert len(results) == 2
        assert results[0].content == "result1"
        assert results[1].content == "result2"


@pytest.mark.asyncio
async def test_react_agent_preserves_request_and_response_metadata() -> None:
    class MetadataProvider:
        def __init__(self) -> None:
            self.inputs: list[LLMInput] = []

        def generate(self, llm_input: LLMInput) -> LLMOutput:
            self.inputs.append(llm_input)
            if len(self.inputs) == 1:
                return LLMOutput(
                    content="",
                    tool_calls=[ToolCall(id="tool_1", name="search", arguments={})],
                    metadata={"anthropic_content": [{"type": "thinking"}]},
                )
            return LLMOutput(content="done")

    registry = ToolRegistry()
    registry.register(
        ToolDefinition(name="search", description="Search", parameters={}),
        lambda: "found",
    )
    provider = MetadataProvider()
    agent = ReActAgent(provider, ToolExecutor(registry), max_iterations=2)

    output = await agent.run(
        LLMInput(
            messages=[Message(role=Role.USER, content="Search.")],
            tools=[ToolDefinition(name="search", description="Search", parameters={})],
            metadata={"thinking": {"type": "adaptive"}},
        )
    )

    assert output.content == "done"
    assert provider.inputs[0].metadata == {"thinking": {"type": "adaptive"}}
    assert provider.inputs[1].metadata == {"thinking": {"type": "adaptive"}}
    assert provider.inputs[1].messages[1].metadata == {
        "anthropic_content": [{"type": "thinking"}]
    }
