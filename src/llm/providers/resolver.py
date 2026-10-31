"""Provider factory and resolver."""

from __future__ import annotations

import os
from pathlib import Path

from llm.core.interface import LLMProvider
from llm.core.types import ProviderType
from llm.providers.astraflow import AstraflowCNProvider, AstraflowProvider
from llm.providers.atlas import AtlasProvider
from llm.providers.claude import ClaudeProvider
from llm.providers.model_config import read_model_env
from llm.providers.ollama import OllamaProvider
from llm.providers.openai import OpenAIProvider

_PROVIDER_MAP: dict[ProviderType, type[LLMProvider]] = {
    ProviderType.ASTRAFLOW: AstraflowProvider,
    ProviderType.ASTRAFLOW_CN: AstraflowCNProvider,
    ProviderType.ATLAS: AtlasProvider,
    ProviderType.CLAUDE: ClaudeProvider,
    ProviderType.OPENAI: OpenAIProvider,
    ProviderType.OLLAMA: OllamaProvider,
}

# Only built-in adapters have a known default_model constructor contract.
_MODEL_ENV_VARS: dict[type[LLMProvider], tuple[str, ...]] = {
    ClaudeProvider: (),
    OpenAIProvider: (),
    OllamaProvider: ("OLLAMA_MODEL",),
    AtlasProvider: (AtlasProvider.model_env,),
    AstraflowProvider: (AstraflowProvider.model_env,),
    AstraflowCNProvider: (AstraflowCNProvider.model_env, AstraflowProvider.model_env),
}

LLM_ENV_FILE = ".llm.env"


def _strip_env_value(value: str) -> str:
    value = value.strip()
    if len(value) >= 2 and value[0] == value[-1] and value[0] in {"'", '"'}:
        return value[1:-1].strip()
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


def _resolve_provider_config(
    provider_type: ProviderType | str | None,
) -> tuple[ProviderType | str, str | None]:
    if provider_type is not None:
        return provider_type, None

    env_provider = os.environ.get("LLM_PROVIDER")
    if env_provider:
        return _strip_env_value(env_provider).lower(), None

    saved_config = _read_saved_llm_config()
    saved_provider = saved_config.get("LLM_PROVIDER", "").lower()
    # A saved model belongs to its saved provider, never to an override.
    saved_model = saved_config.get("LLM_MODEL") if saved_provider else None
    return saved_provider or "claude", saved_model


def _resolve_default_model(
    provider_type: ProviderType, provider_cls: type[LLMProvider], saved_model: str | None,
) -> str | None:
    for name in _MODEL_ENV_VARS[provider_cls]:
        model = read_model_env(name)
        if model:
            return model

    env_provider = _strip_env_value(os.environ.get("LLM_PROVIDER", "")).lower()
    if not env_provider or env_provider == provider_type.value:
        env_model = read_model_env("LLM_MODEL")
        if env_model:
            return env_model
    return saved_model or None


def get_provider(provider_type: ProviderType | str | None = None, **kwargs: str | None) -> LLMProvider:
    """Create a provider, honoring the model selected by llm-select.

    Built-in model defaults prefer explicit kwargs, then existing provider-specific
    environment variables, LLM_MODEL, and the saved provider/model pair. Saved
    config is only read when neither an explicit nor an environment provider wins.
    Custom providers retain their own constructor and configuration semantics.
    """
    provider_type, saved_model = _resolve_provider_config(provider_type)

    if isinstance(provider_type, str):
        try:
            provider_type = ProviderType(provider_type)
        except ValueError:
            raise ValueError(f"Unknown provider type: {provider_type}. Valid types: {[p.value for p in ProviderType]}")

    provider_cls = _PROVIDER_MAP.get(provider_type)
    if not provider_cls:
        raise ValueError(f"No provider registered for type: {provider_type}")

    if not kwargs.get("default_model") and provider_cls in _MODEL_ENV_VARS:
        model = _resolve_default_model(provider_type, provider_cls, saved_model)
        if model:
            kwargs = {**kwargs, "default_model": model}

    return provider_cls(**kwargs)


def register_provider(provider_type: ProviderType, provider_cls: type[LLMProvider]) -> None:
    _PROVIDER_MAP[provider_type] = provider_cls
