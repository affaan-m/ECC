from types import SimpleNamespace
from typing import Any, NoReturn, TypeVar

import anthropic
import openai
import pytest

from llm.core.interface import (
    AuthenticationError,
    ContextLengthError,
    LLMError,
    LLMProvider,
    RateLimitError,
)
from llm.core.types import LLMInput
from llm.providers.astraflow import AstraflowCNProvider, AstraflowProvider
from llm.providers.atlas import AtlasProvider
from llm.providers.claude import ClaudeProvider
from llm.providers.openai import OpenAIProvider

pytestmark = pytest.mark.unit

PROVIDERS = [ClaudeProvider, OpenAIProvider, AstraflowProvider, AstraflowCNProvider, AtlasProvider]
ProviderT = TypeVar("ProviderT", bound=LLMProvider)


def provider_raising(provider_class: type[ProviderT], error: Exception) -> ProviderT:
    def create(**params: object) -> NoReturn:
        raise error

    # Exercise each production generate method without opening a network client.
    provider = provider_class.__new__(provider_class)
    object.__setattr__(provider, "default_model", "test-model")
    object.__setattr__(provider, "client", SimpleNamespace(
        messages=SimpleNamespace(create=create),
        chat=SimpleNamespace(completions=SimpleNamespace(create=create)),
    ))
    return provider


def status_error(
    provider_class: type[LLMProvider], status: int, message: str,
) -> anthropic.APIStatusError | openai.APIStatusError:
    sdk = anthropic if provider_class is ClaudeProvider else openai
    response: Any = SimpleNamespace(status_code=status, request=SimpleNamespace(), headers={})
    return sdk.APIStatusError(message, response=response, body={})


@pytest.mark.parametrize("provider_class", PROVIDERS)
@pytest.mark.parametrize(("status", "message", "expected"), [
    (401, "Access denied", AuthenticationError),
    (429, "Capacity exhausted", RateLimitError),
])
def test_real_status_controls_authentication_and_rate_limit_mapping(
    provider_class: type[LLMProvider], status: int, message: str, expected: type[LLMError],
) -> None:
    original = status_error(provider_class, status, message)
    provider = provider_raising(provider_class, original)

    with pytest.raises(expected) as caught:
        provider.generate(LLMInput(messages=[]))

    assert caught.value.provider == provider.provider_type
    assert caught.value.__cause__ is original


@pytest.mark.parametrize("provider_class", PROVIDERS)
@pytest.mark.parametrize("status", [400, 404, 500])
def test_request_identifiers_and_echoed_words_cannot_reclassify_http_errors(
    provider_class: type[LLMProvider], status: int,
) -> None:
    original = status_error(provider_class, status, "Failed req_401429: authentication rate_limit")

    with pytest.raises(type(original)) as caught:
        provider_raising(provider_class, original).generate(LLMInput(messages=[]))

    assert caught.value is original


@pytest.mark.parametrize("provider_class", PROVIDERS)
def test_local_parsing_errors_containing_status_digits_keep_their_type(provider_class: type[LLMProvider]) -> None:
    original = ValueError("Cannot decode tool result for req_401429")

    with pytest.raises(ValueError) as caught:
        provider_raising(provider_class, original).generate(LLMInput(messages=[]))

    assert caught.value is original


@pytest.mark.parametrize("provider_class", PROVIDERS)
def test_context_length_error_mapping_remains_available(provider_class: type[LLMProvider]) -> None:
    original = status_error(provider_class, 400, "Maximum context length exceeded")

    with pytest.raises(ContextLengthError) as caught:
        provider_raising(provider_class, original).generate(LLMInput(messages=[]))

    assert caught.value.__cause__ is original
