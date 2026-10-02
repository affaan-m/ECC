"""Ollama provider adapter for local models."""

from __future__ import annotations

import json
import logging
import os
import urllib.request
import uuid
from typing import Any

from llm.core.interface import (
    AuthenticationError,
    ContextLengthError,
    LLMError,
    LLMProvider,
    RateLimitError,
)
from llm.core.types import (
    LLMInput,
    LLMOutput,
    Message,
    ModelInfo,
    ProviderType,
    Role,
    ToolCall,
)

logger = logging.getLogger(__name__)


def _messages_payload(messages: list[Message]) -> list[dict[str, Any]]:
    """Serialize messages, naming the tool each tool result answers.

    Ollama correlates a tool result with its call through ``tool_name``; ids
    are optional on its side, so the name is what keeps several results apart.
    """
    names: dict[str, str] = {}
    payload = []
    for msg in messages:
        item = msg.to_dict()
        for tc in msg.tool_calls or []:
            names[tc.id] = tc.name
        if msg.role == Role.TOOL:
            tool_name = msg.name or names.get(msg.tool_call_id or "")
            if tool_name:
                item["tool_name"] = tool_name
        payload.append(item)
    return payload


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
                supports_tools=True,
                supports_vision=False,
                max_tokens=4096,
                context_window=128000,
            ),
            ModelInfo(
                name="mistral",
                provider=ProviderType.OLLAMA,
                supports_tools=True,
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
        self._tool_support: dict[str, bool] = {}

    def model_supports_tools(self, model: str) -> bool:
        """Whether ``model`` declares tool support.

        Catalogued models answer from :attr:`ModelInfo.supports_tools`. Any other
        model is looked up once through ``/api/show``, whose ``capabilities``
        list is what the installed model itself declares. Only an answered lookup
        is cached: a failed one counts as no tool support for that request and
        is retried on the next.
        """
        for info in self._models:
            if info.name == model:
                return info.supports_tools
        if model in self._tool_support:
            return self._tool_support[model]
        try:
            req = urllib.request.Request(
                f"{self.base_url}/api/show",
                data=json.dumps({"model": model}).encode("utf-8"),
                headers={"Content-Type": "application/json"},
            )
            with urllib.request.urlopen(req, timeout=10) as response:
                capabilities = json.loads(response.read().decode("utf-8")).get("capabilities") or []
        except Exception as e:
            logger.warning("Could not read capabilities for Ollama model '%s': %s", model, type(e).__name__)
            return False
        supports_tools = "tools" in capabilities
        self._tool_support = {**self._tool_support, model: supports_tools}
        return supports_tools

    def generate(self, input: LLMInput) -> LLMOutput:
        try:
            url = f"{self.base_url}/api/chat"
            model = input.model or self.default_model

            payload: dict[str, Any] = {
                "model": model,
                "messages": _messages_payload(input.messages),
                "stream": False,
            }
            options: dict[str, Any] = {}
            if input.temperature != 1.0:
                options["temperature"] = input.temperature
            if input.max_tokens is not None:
                options["num_predict"] = input.max_tokens
            if options:
                payload["options"] = options
            if input.tools:
                if self.model_supports_tools(model):
                    payload["tools"] = [tool.to_openai_tool() for tool in input.tools]
                else:
                    logger.warning("Ollama model '%s' does not declare tool support; sending no tools", model)

            data = json.dumps(payload).encode("utf-8")
            req = urllib.request.Request(url, data=data, headers={"Content-Type": "application/json"})

            with urllib.request.urlopen(req, timeout=60) as response:
                result = json.loads(response.read().decode("utf-8"))

            content = result.get("message", {}).get("content", "")

            tool_calls = None
            if result.get("message", {}).get("tool_calls"):
                tool_calls = [
                    ToolCall(
                        # Native Ollama calls often carry no id; give each one a
                        # unique id so its result can be matched to it.
                        id=tc.get("id") or f"call_{uuid.uuid4().hex[:24]}",
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
            lowered = msg.lower()
            if "401" in msg or "unauthorized" in lowered or "forbidden" in lowered:
                raise AuthenticationError(f"Ollama authentication failed: {msg}", provider=ProviderType.OLLAMA) from e
            if "429" in msg or "rate_limit" in lowered:
                raise RateLimitError(msg, provider=ProviderType.OLLAMA) from e
            if "context" in lowered and "length" in lowered:
                raise ContextLengthError(msg, provider=ProviderType.OLLAMA) from e
            if (
                "connection" in lowered
                or "refused" in lowered
                or "timed out" in lowered
                or "timeout" in lowered
                or "unreachable" in lowered
                or "name resolution" in lowered
                or "nodename nor servname" in lowered
                or isinstance(e, (ConnectionError, TimeoutError))
            ):
                raise LLMError(
                    f"Ollama connection failed: {type(e).__name__}",
                    provider=ProviderType.OLLAMA,
                    code="connection_error",
                ) from e
            raise LLMError(
                f"Ollama request failed: {type(e).__name__}",
                provider=ProviderType.OLLAMA,
                code="provider_error",
            ) from e

    def list_models(self) -> list[ModelInfo]:
        return self._models.copy()

    def validate_config(self) -> bool:
        return bool(self.base_url)

    def get_default_model(self) -> str:
        return self.default_model
