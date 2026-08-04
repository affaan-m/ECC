"""Provider factory and resolver."""

from __future__ import annotations

import os
from pathlib import Path

from llm.core.interface import LLMProvider
from llm.core.types import ProviderType
from llm.providers.astraflow import AstraflowCNProvider, AstraflowProvider
from llm.providers.atlas import AtlasProvider
from llm.providers.claude import ClaudeProvider
from llm.providers.openai import OpenAIProvider
from llm.providers.ollama import OllamaProvider


_PROVIDER_MAP: dict[ProviderType, type[LLMProvider]] = {
    ProviderType.ASTRAFLOW: AstraflowProvider,
    ProviderType.ASTRAFLOW_CN: AstraflowCNProvider,
    ProviderType.ATLAS: AtlasProvider,
    ProviderType.CLAUDE: ClaudeProvider,
    ProviderType.OPENAI: OpenAIProvider,
    ProviderType.OLLAMA: OllamaProvider,
}

LLM_ENV_FILE = ".llm.env"


def _strip_env_value(value: str) -> str:
    value = value.strip()
    if len(value) >= 2 and value[0] == value[-1] and value[0] in {"'", '"'}:
        return value[1:-1]
    return value


def _read_saved_llm_config(env_path: str | Path = LLM_ENV_FILE) -> dict[str, str]:
    path = Path(env_path)
    if not path.is_file():
        return {}

    config: dict[str, str] = {}
    for line in path.read_text().splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("#") or "=" not in stripped:
            continue
        key, value = stripped.split("=", 1)
        config[key.strip()] = _strip_env_value(value)
    return config


def _resolve_provider_type(provider_type: ProviderType | str | None) -> ProviderType | str:
    if provider_type is not None:
        return provider_type

    env_provider = os.environ.get("LLM_PROVIDER")
    if env_provider:
        return _strip_env_value(env_provider).lower()

    saved_config = _read_saved_llm_config()
    return saved_config.get("LLM_PROVIDER", "claude").lower()


def get_provider(provider_type: ProviderType | str | None = None, **kwargs: str) -> LLMProvider:
    provider_type = _resolve_provider_type(provider_type)

    if isinstance(provider_type, str):
        try:
            provider_type = ProviderType(provider_type)
        except ValueError:
            raise ValueError(f"Unknown provider type: {provider_type}. Valid types: {[p.value for p in ProviderType]}")

    provider_cls = _PROVIDER_MAP.get(provider_type)
    if not provider_cls:
        raise ValueError(f"No provider registered for type: {provider_type}")

    return provider_cls(**kwargs)


def register_provider(provider_type: ProviderType, provider_cls: type[LLMProvider]) -> None:
    _PROVIDER_MAP[provider_type] = provider_cls
