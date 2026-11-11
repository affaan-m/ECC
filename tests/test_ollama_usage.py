from __future__ import annotations

import json
import urllib.request
from io import BytesIO
from typing import Any

import pytest

from llm.core.types import LLMInput, Message, Role
from llm.providers.ollama import OllamaProvider

pytestmark = pytest.mark.unit


@pytest.mark.parametrize(
    "counters, expected",
    [
        (
            {"prompt_eval_count": 142, "eval_count": 57},
            {"prompt_tokens": 142, "completion_tokens": 57, "total_tokens": 199},
        ),
        (
            {"prompt_eval_count": 0, "eval_count": 0},
            {"prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0},
        ),
        ({"prompt_eval_count": 7}, {"prompt_tokens": 7}),
        ({"eval_count": 5}, {"completion_tokens": 5}),
        ({}, None),
        ({"prompt_eval_count": True, "eval_count": -1}, None),
        ({"prompt_eval_count": "12", "eval_count": 4}, {"completion_tokens": 4}),
        ({"prompt_eval_count": 1.5, "eval_count": None}, None),
    ],
)
def test_native_ollama_counters_reach_output_usage(
    monkeypatch: pytest.MonkeyPatch,
    counters: dict[str, Any],
    expected: dict[str, int] | None,
) -> None:
    response = {
        "model": "llama3.2",
        "message": {"role": "assistant", "content": "result"},
        "done": True,
        "done_reason": "stop",
        **counters,
    }

    def native_response(request: urllib.request.Request, timeout: float) -> BytesIO:
        assert request.full_url == "http://localhost:11434/api/chat"
        assert request.get_method() == "POST"
        assert isinstance(request.data, bytes)
        assert json.loads(request.data)["stream"] is False
        assert timeout == 60
        return BytesIO(json.dumps(response).encode("utf-8"))

    monkeypatch.setattr(urllib.request, "urlopen", native_response)
    output = OllamaProvider(base_url="http://localhost:11434", default_model="llama3.2").generate(
        LLMInput(messages=[Message(role=Role.USER, content="hello")])
    )

    assert output.usage == expected
    assert output.to_dict().get("usage") == expected
    assert output.content == "result"
    assert output.model == "llama3.2"
    assert output.stop_reason == "stop"


def test_tool_call_response_retains_usage(monkeypatch: pytest.MonkeyPatch) -> None:
    response = {
        "message": {
            "role": "assistant",
            "content": "",
            "tool_calls": [{"function": {"name": "lookup", "arguments": {"key": "value"}}}],
        },
        "done_reason": "stop",
        "prompt_eval_count": 10,
        "eval_count": 3,
    }
    def native_response(request: urllib.request.Request, timeout: float) -> BytesIO:
        return BytesIO(json.dumps(response).encode("utf-8"))

    monkeypatch.setattr(urllib.request, "urlopen", native_response)

    output = OllamaProvider(default_model="llama3.2").generate(
        LLMInput(messages=[Message(role=Role.USER, content="lookup")])
    )

    assert output.usage == {"prompt_tokens": 10, "completion_tokens": 3, "total_tokens": 13}
    assert output.has_tool_calls
    assert output.tool_calls is not None
    assert output.tool_calls[0].name == "lookup"
    assert output.tool_calls[0].arguments == {"key": "value"}
