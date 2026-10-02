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


class TestAsyncTools:
    def test_execute_async_awaits_coroutine(self):
        import asyncio

        registry = ToolRegistry()

        async def fetch(url: str = "") -> str:
            return f"fetched:{url}"

        registry.register(ToolDefinition(name="fetch", description="", parameters={}), fetch)

        executor = ToolExecutor(registry)
        result = asyncio.run(
            executor.execute_async(ToolCall(id="1", name="fetch", arguments={"url": "x"}))
        )

        assert result.tool_call_id == "1"
        assert result.content == "fetched:x"
        assert result.is_error is False

    def test_react_agent_runs_awaitable_tool(self):
        import asyncio

        async def lookup(key: str = "") -> str:
            return f"value:{key}"

        registry = ToolRegistry()
        registry.register(ToolDefinition(name="lookup", description="", parameters={}), lookup)

        seen = {}

        class FakeProvider:
            def generate(self, agent_input):
                if "done" not in seen:
                    seen["done"] = True
                    return LLMOutput(
                        content="",
                        tool_calls=[ToolCall(id="1", name="lookup", arguments={"key": "k"})],
                    )
                tool_messages = [m for m in agent_input.messages if m.role == Role.TOOL]
                assert len(tool_messages) == 1
                assert tool_messages[0].content == "value:k"
                return LLMOutput(content="done")

        agent = ReActAgent(provider=FakeProvider(), executor=ToolExecutor(registry))
        output = asyncio.run(
            agent.run(LLMInput(messages=[Message(role=Role.USER, content="hi")]))
        )

        assert output.content == "done"
