"""LLM Provider interface definition."""

from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Any

from llm.core.types import LLMInput, LLMOutput, ModelInfo, ProviderType


class LLMProvider(ABC):
    provider_type: ProviderType

    @abstractmethod
    def generate(self, input: LLMInput) -> LLMOutput: ...

    @abstractmethod
    def list_models(self) -> list[ModelInfo]: ...

    @abstractmethod
    def validate_config(self) -> bool: ...

    def supports_tools(self) -> bool:
        return True

    def supports_vision(self) -> bool:
        return False

    def get_default_model(self) -> str:
        raise NotImplementedError(f"{self.__class__.__name__} must implement get_default_model")


class LLMError(Exception):
    def __init__(
        self,
        message: str,
        provider: ProviderType | None = None,
        code: str | None = None,
        details: dict[str, Any] | None = None,
    ) -> None:
        super().__init__(message)
        self.message = message
        self.provider = provider
        self.code = code
        self.details = details or {}


class AuthenticationError(LLMError): ...


class RateLimitError(LLMError): ...


class ContextLengthError(LLMError): ...


class ModelNotFoundError(LLMError): ...


class ToolExecutionError(LLMError): ...
