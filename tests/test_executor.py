from llm.core.interface import RateLimitError
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

    def test_aexecute_awaits_async_tools(self):
        import asyncio

        registry = ToolRegistry()

        async def fetch(url: str) -> str:
            return f"fetched:{url}"

        registry.register(ToolDefinition(name="fetch", description="", parameters={}), fetch)
        executor = ToolExecutor(registry)
        result = asyncio.run(executor.aexecute(ToolCall(id="1", name="fetch", arguments={"url": "x"})))
        assert result.is_error is False
        assert result.content == "fetched:x"

    def test_react_agent_returns_partial_output_on_provider_error(self):
        import asyncio

        from llm.core.types import ProviderType

        class _FailingProvider:
            def generate(self, _input):
                raise RateLimitError("429 rate limited", provider=ProviderType.OPENAI)

        registry = ToolRegistry()
        agent = ReActAgent(provider=_FailingProvider(), executor=ToolExecutor(registry), max_iterations=3)
        output = asyncio.run(agent.run(LLMInput(messages=[Message(role=Role.USER, content="hi")], model="m")))
        assert output.stop_reason == "error"
        assert output.model == "m"
        assert len(output.metadata["messages"]) == 1

    def test_react_agent_preserves_trajectory_on_max_iterations(self):
        import asyncio

        class _LoopProvider:
            def __init__(self):
                self.calls = 0

            def generate(self, _input):
                self.calls += 1
                return LLMOutput(content="", tool_calls=[ToolCall(id=str(self.calls), name="noop", arguments={})], model="m", usage={"prompt_tokens": 1, "completion_tokens": 1, "total_tokens": 2}, stop_reason="tool_calls")

        registry = ToolRegistry()
        registry.register(ToolDefinition(name="noop", description="", parameters={}), lambda: "ok")
        agent = ReActAgent(provider=_LoopProvider(), executor=ToolExecutor(registry), max_iterations=2)
        output = asyncio.run(agent.run(LLMInput(messages=[Message(role=Role.USER, content="hi")], model="m")))
        assert output.stop_reason == "max_iterations"
        assert output.model == "m"
        assert output.usage == {"prompt_tokens": 1, "completion_tokens": 1, "total_tokens": 2}
        assert len(output.metadata["messages"]) == 5
