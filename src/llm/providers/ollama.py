"""Ollama provider adapter for local models."""

from __future__ import annotations

import os
from typing import Any

from llm.core.interface import (
    AuthenticationError,
    ContextLengthError,
    LLMProvider,
    RateLimitError,
)
from llm.core.types import (
    LLMInput,
    LLMOutput,
    ModelInfo,
    ProviderType,
    ToolCall,
)


class OllamaProvider(LLMProvider):
    provider_type = ProviderType.OLLAMA

    def __init__(
        self,
        base_url: str | None = None,
        default_model: str | None = None,
    ) -> None:
        self.base_url = base_url or os.environ.get("OLLAMA_BASE_URL", "http://localhost:11434")
        self.default_model = default_model or os.environ.get("OLLAMA_MODEL", "llama3.2")
        self._models = [
            ModelInfo(
                name="llama3.2",
                provider=ProviderType.OLLAMA,
                supports_tools=False,
                supports_vision=False,
                max_tokens=4096,
                context_window=128000,
            ),
            ModelInfo(
                name="mistral",
                provider=ProviderType.OLLAMA,
                supports_tools=False,
                supports_vision=False,
                max_tokens=4096,
                context_window=8192,
            ),
            ModelInfo(
                name="codellama",
                provider=ProviderType.OLLAMA,
                supports_tools=False,
                supports_vision=False,
                max_tokens=4096,
                context_window=16384,
            ),
        ]

    def generate(self, input: LLMInput) -> LLMOutput:
        import json
        import urllib.request

        try:
            url = f"{self.base_url}/api/chat"
            model = input.model or self.default_model

            payload: dict[str, Any] = {
                "model": model,
                "messages": [msg.to_dict() for msg in input.messages],
                "stream": False,
            }
            if input.temperature != 1.0:
                payload["options"] = {"temperature": input.temperature}

            data = json.dumps(payload).encode("utf-8")
            req = urllib.request.Request(url, data=data, headers={"Content-Type": "application/json"})

            with urllib.request.urlopen(req, timeout=60) as response:
                result = json.loads(response.read().decode("utf-8"))

            content = result.get("message", {}).get("content", "")

            tool_calls = None
            if result.get("message", {}).get("tool_calls"):
                tool_calls = [
                    ToolCall(
                        id=tc.get("id", ""),
                        name=tc.get("function", {}).get("name", ""),
                        arguments=tc.get("function", {}).get("arguments", {}),
                    )
                    for tc in result["message"]["tool_calls"]
                ]

            return LLMOutput(
                content=content,
                tool_calls=tool_calls,
                model=model,
                stop_reason=result.get("done_reason"),
            )
        except Exception as e:
            msg = str(e)
            if "401" in msg or "connection" in msg.lower():
                raise AuthenticationError(f"Ollama connection failed: {msg}", provider=ProviderType.OLLAMA) from e
            if "429" in msg or "rate_limit" in msg.lower():
                raise RateLimitError(msg, provider=ProviderType.OLLAMA) from e
            if "context" in msg.lower() and "length" in msg.lower():
                raise ContextLengthError(msg, provider=ProviderType.OLLAMA) from e
            raise

    def list_models(self) -> list[ModelInfo]:
        return self._models.copy()

    def validate_config(self) -> bool:
        return bool(self.base_url)

    def get_default_model(self) -> str:
        return self.default_model
