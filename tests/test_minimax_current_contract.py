"""Protocol fields from MiniMax's official API contract checked 2026-11-16."""

from types import SimpleNamespace

import pytest

from llm.core.interface import AuthenticationError, RateLimitError
from llm.core.types import LLMInput, Message, Role
from llm.providers.minimax import MINIMAX_ANTHROPIC_BASE_URL, MiniMaxProvider


def test_openai_preserves_reasoning_and_current_completion_controls() -> None:
    calls = []

    def create(**params):
        calls.append(params)
        return SimpleNamespace(
            choices=[
                SimpleNamespace(
                    message=SimpleNamespace(
                        content="answer",
                        tool_calls=None,
                        reasoning_content="provider context",
                    ),
                    finish_reason="stop",
                )
            ],
            model="MiniMax-M3.1-Flash",
            usage=None,
        )

    provider = MiniMaxProvider(api_key="fixture-only")
    provider.client = SimpleNamespace(
        chat=SimpleNamespace(completions=SimpleNamespace(create=create))
    )
    output = provider.generate(
        LLMInput(
            messages=[Message(role=Role.USER, content="hello")],
            max_tokens=256,
            metadata={"reasoning_effort": "high"},
        )
    )
    assert calls[0]["max_completion_tokens"] == 256
    assert "max_tokens" not in calls[0]
    assert calls[0]["reasoning_effort"] == "high"
    assert output.metadata["openai_reasoning_content"] == "provider context"
    provider.generate(
        LLMInput(
            messages=[
                Message(
                    role=Role.ASSISTANT,
                    content=output.content,
                    metadata=output.metadata,
                ),
                Message(role=Role.USER, content="continue"),
            ]
        )
    )
    assert calls[1]["messages"][0]["reasoning_content"] == "provider context"


def test_anthropic_preserves_effort_configuration() -> None:
    calls = []

    def create(**params):
        calls.append(params)
        return SimpleNamespace(
            content=[SimpleNamespace(type="text", text="answer")],
            model="MiniMax-M3.1-Flash",
            usage=None,
            stop_reason="end_turn",
        )

    provider = MiniMaxProvider(
        api_key="fixture-only", base_url=MINIMAX_ANTHROPIC_BASE_URL
    )
    provider.client = SimpleNamespace(messages=SimpleNamespace(create=create))
    provider.generate(
        LLMInput(
            messages=[Message(role=Role.USER, content="hello")],
            max_tokens=256,
            metadata={"output_config": {"effort": "high"}},
        )
    )
    assert calls[0]["max_tokens"] == 256
    assert calls[0]["output_config"] == {"effort": "high"}


@pytest.mark.parametrize("anthropic", [False, True])
@pytest.mark.parametrize(
    ("status", "error_type"), [(401, AuthenticationError), (429, RateLimitError)]
)
def test_minimax_errors_use_structured_status(anthropic, status, error_type) -> None:
    class HTTPFailureError(Exception):
        status_code = status

    def create(**params):
        raise HTTPFailureError("request failed")

    provider = MiniMaxProvider(
        api_key="fixture-only",
        **({"base_url": MINIMAX_ANTHROPIC_BASE_URL} if anthropic else {}),
    )
    provider.client = SimpleNamespace(
        messages=SimpleNamespace(create=create),
        chat=SimpleNamespace(completions=SimpleNamespace(create=create)),
    )
    with pytest.raises(error_type):
        provider.generate(LLMInput(messages=[]))


def test_incidental_error_text_does_not_reclassify_a_failure() -> None:
    def create(**params):
        raise ValueError("value 401 is invalid, not an authentication error")

    provider = MiniMaxProvider(api_key="fixture-only")
    provider.client = SimpleNamespace(
        chat=SimpleNamespace(completions=SimpleNamespace(create=create))
    )
    with pytest.raises(ValueError):
        provider.generate(LLMInput(messages=[]))
