from types import SimpleNamespace
from typing import Any

import pytest

from llm.core.types import LLMInput, Message, Role, ToolCall
from llm.providers.claude import ClaudeProvider


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
def test_generate_serializes_tool_round_trip_for_anthropic() -> None:
    provider = make_provider(make_response([SimpleNamespace(type="text", text="Done.")], stop_reason="end_turn"))

    provider.generate(
        LLMInput(
            messages=[
                Message(role=Role.USER, content="Search"),
                Message(
                    role=Role.ASSISTANT,
                    content="",
                    tool_calls=[
                        ToolCall(id="toolu_1", name="search", arguments={"query": "claude"}),
                        ToolCall(id="toolu_2", name="read", arguments={"path": "README.md"}),
                    ],
                ),
                Message(role=Role.TOOL, content="results", tool_call_id="toolu_1"),
                Message(role=Role.TOOL, content="more results", tool_call_id="toolu_2"),
            ]
        )
    )

    assert provider.client.messages.last_params["messages"] == [
        {"role": "user", "content": "Search"},
        {
            "role": "assistant",
            "content": [
                {
                    "type": "tool_use",
                    "id": "toolu_1",
                    "name": "search",
                    "input": {"query": "claude"},
                },
                {
                    "type": "tool_use",
                    "id": "toolu_2",
                    "name": "read",
                    "input": {"path": "README.md"},
                },
            ],
        },
        {
            "role": "user",
            "content": [
                {"type": "tool_result", "tool_use_id": "toolu_1", "content": "results"},
                {"type": "tool_result", "tool_use_id": "toolu_2", "content": "more results"},
            ],
        },
    ]


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


@pytest.mark.unit
def test_to_anthropic_dict_drops_orphan_tool_message_with_no_tool_call_id() -> None:
    """A TOOL message without a `tool_call_id` would serialize to
    `"tool_use_id": ""`, which the Anthropic API rejects with a 400. The
    serializer must return None so the provider skips it (chenhz01 #3057)."""
    message = Message(role=Role.TOOL, content="orphan", tool_call_id=None)

    assert message.to_anthropic_dict() is None

    empty = Message(role=Role.TOOL, content="orphan", tool_call_id="")

    assert empty.to_anthropic_dict() is None


@pytest.mark.unit
def test_generate_drops_tool_message_with_no_tool_call_id() -> None:
    """End-to-end: orphan TOOL messages (no `tool_call_id`) are skipped
    rather than corrupting the request payload with empty tool_use_id."""
    provider = make_provider(make_response([SimpleNamespace(type="text", text="ok")]))

    provider.generate(
        LLMInput(
            messages=[
                Message(role=Role.USER, content="hi"),
                Message(role=Role.ASSISTANT, content="", tool_calls=[
                    ToolCall(id="toolu_1", name="search", arguments={"q": "x"}),
                ]),
                Message(role=Role.TOOL, content="results", tool_call_id="toolu_1"),
                Message(role=Role.TOOL, content="orphan", tool_call_id=None),
            ]
        )
    )

    params = provider.client.messages.last_params
    # The orphan must not appear in the serialized payload at all.
    flat_tool_use_ids: list[str] = []
    for msg in params["messages"]:
        content = msg.get("content")
        if isinstance(content, list):
            for block in content:
                if isinstance(block, dict) and block.get("type") == "tool_result":
                    flat_tool_use_ids.append(block["tool_use_id"])
    assert flat_tool_use_ids == ["toolu_1"]


@pytest.mark.unit
def test_generate_drops_tool_result_orphaned_by_interleaved_user_text() -> None:
    """A tool_result that no longer immediately follows its tool_use (a
    user text turn was interleaved) would 400 on the API because the
    Anthropic Messages API requires tool_result in the user turn
    directly after the tool_use. Drop it (chenhz01 #3057)."""
    provider = make_provider(make_response([SimpleNamespace(type="text", text="ok")]))

    provider.generate(
        LLMInput(
            messages=[
                Message(role=Role.USER, content="hi"),
                Message(
                    role=Role.ASSISTANT,
                    content="",
                    tool_calls=[
                        ToolCall(id="toolu_1", name="search", arguments={"q": "x"}),
                    ],
                ),
                # tool_result for toolu_1 — immediately after tool_use, kept
                Message(role=Role.TOOL, content="results", tool_call_id="toolu_1"),
                # User text turn interleaved BEFORE the second tool_result
                Message(role=Role.USER, content="while you were at it"),
                # tool_result whose tool_use is no longer immediately before
                Message(role=Role.TOOL, content="stale", tool_call_id="toolu_1"),
            ]
        )
    )

    params = provider.client.messages.last_params
    flat_tool_use_ids: list[str] = []
    for msg in params["messages"]:
        content = msg.get("content")
        if isinstance(content, list):
            for block in content:
                if isinstance(block, dict) and block.get("type") == "tool_result":
                    flat_tool_use_ids.append(block["tool_use_id"])
    # Only the first tool_result (which immediately follows its tool_use)
    # survives; the interleaved one is dropped.
    assert flat_tool_use_ids == ["toolu_1"]


@pytest.mark.unit
def test_generate_removes_matching_tool_use_when_orphan_result_is_dropped() -> None:
    """When a tool_result is dropped because the user text turn was
    interleaved, the matching tool_use block must also be stripped from
    the prior assistant turn — otherwise the Anthropic API rejects the
    request because every tool_use must have a matching tool_result in
    the immediately following user turn (greptile P1 on #3057)."""
    provider = make_provider(make_response([SimpleNamespace(type="text", text="ok")]))

    provider.generate(
        LLMInput(
            messages=[
                Message(role=Role.USER, content="hi"),
                Message(
                    role=Role.ASSISTANT,
                    content="",
                    tool_calls=[
                        ToolCall(id="toolu_1", name="search", arguments={"q": "x"}),
                        ToolCall(id="toolu_2", name="read", arguments={"p": "y"}),
                    ],
                ),
                Message(role=Role.TOOL, content="results-1", tool_call_id="toolu_1"),
                # User text interleaved BEFORE the second tool_result
                Message(role=Role.USER, content="while you were at it"),
                # Orphan tool_result: toolu_2 is no longer the immediately
                # previous tool_use.
                Message(role=Role.TOOL, content="results-2", tool_call_id="toolu_2"),
            ]
        )
    )

    params = provider.client.messages.last_params
    # Both tool_use blocks must NOT appear in the request anymore — the
    # orphan tool_result for toolu_2 was dropped, so toolu_2 would
    # otherwise be an unanswered tool_use on the wire.
    flat_tool_use_ids: list[str] = []
    for msg in params["messages"]:
        content = msg.get("content")
        if isinstance(content, list):
            for block in content:
                if isinstance(block, dict) and block.get("type") == "tool_use":
                    flat_tool_use_ids.append(block["id"])
    assert flat_tool_use_ids == ["toolu_1"], (
        "Only the answered tool_use (toolu_1) should remain; "
        f"got {flat_tool_use_ids}"
    )
