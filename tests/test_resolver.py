import io
import json
from pathlib import Path
from unittest.mock import Mock

import pytest

from llm.cli.selector import save_config
from llm.core.types import LLMInput, Message, ProviderType, Role
from llm.providers import (
    AstraflowCNProvider,
    AstraflowProvider,
    AtlasProvider,
    ClaudeProvider,
    OllamaProvider,
    OpenAIProvider,
    get_provider,
    resolver,
)


class TestGetProvider:
    def test_get_claude_provider(self):
        provider = get_provider("claude")
        assert isinstance(provider, ClaudeProvider)
        assert provider.provider_type == ProviderType.CLAUDE

    def test_get_openai_provider(self):
        provider = get_provider("openai")
        assert isinstance(provider, OpenAIProvider)
        assert provider.provider_type == ProviderType.OPENAI

    def test_get_ollama_provider(self):
        provider = get_provider("ollama")
        assert isinstance(provider, OllamaProvider)
        assert provider.provider_type == ProviderType.OLLAMA

    def test_get_astraflow_provider(self):
        provider = get_provider("astraflow")
        assert isinstance(provider, AstraflowProvider)
        assert provider.provider_type == ProviderType.ASTRAFLOW

    def test_get_astraflow_cn_provider(self):
        provider = get_provider("astraflow_cn")
        assert isinstance(provider, AstraflowCNProvider)

        assert provider.provider_type == ProviderType.ASTRAFLOW_CN

    def test_get_atlas_provider(self):
        provider = get_provider("atlas")
        assert isinstance(provider, AtlasProvider)
        assert provider.provider_type == ProviderType.ATLAS

    def test_get_provider_by_enum(self):
        provider = get_provider(ProviderType.CLAUDE)
        assert isinstance(provider, ClaudeProvider)

    def test_invalid_provider_raises(self):
        with pytest.raises(ValueError, match="Unknown provider type"):
            get_provider("invalid")

    def test_saved_llm_env_selects_provider(self, monkeypatch, tmp_path):
        monkeypatch.delenv("LLM_PROVIDER", raising=False)
        monkeypatch.chdir(tmp_path)
        tmp_path.joinpath(".llm.env").write_text("LLM_PROVIDER=ollama\nLLM_MODEL=llama3.2\n")

        provider = get_provider()

        assert isinstance(provider, OllamaProvider)

    def test_env_provider_overrides_saved_llm_env(self, monkeypatch, tmp_path):
        monkeypatch.setenv("LLM_PROVIDER", "ollama")
        monkeypatch.chdir(tmp_path)
        tmp_path.joinpath(".llm.env").write_text("LLM_PROVIDER=openai\n")

        provider = get_provider()

        assert isinstance(provider, OllamaProvider)

    def test_env_provider_is_normalized(self, monkeypatch):
        monkeypatch.setenv("LLM_PROVIDER", "OLLAMA")

        provider = get_provider()

        assert isinstance(provider, OllamaProvider)

    def test_astraflow_env_provider_is_normalized(self, monkeypatch):
        monkeypatch.setenv("LLM_PROVIDER", "ASTRAFLOW")

        provider = get_provider()

        assert isinstance(provider, AstraflowProvider)

    def test_explicit_provider_overrides_saved_llm_env(self, monkeypatch, tmp_path):
        monkeypatch.delenv("LLM_PROVIDER", raising=False)
        monkeypatch.chdir(tmp_path)
        tmp_path.joinpath(".llm.env").write_text("LLM_PROVIDER=openai\n")

        provider = get_provider("ollama")

        assert isinstance(provider, OllamaProvider)

    def test_saved_llm_env_selects_astraflow_cn_provider(self, monkeypatch, tmp_path):
        monkeypatch.delenv("LLM_PROVIDER", raising=False)
        monkeypatch.chdir(tmp_path)
        tmp_path.joinpath(".llm.env").write_text("LLM_PROVIDER=astraflow_cn\n")

        provider = get_provider()

        assert isinstance(provider, AstraflowCNProvider)


class TestSelectedModel:
    @pytest.fixture(autouse=True)
    def isolated_config(self, monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
        monkeypatch.chdir(tmp_path)
        for name in (
            "LLM_PROVIDER", "LLM_MODEL", "OLLAMA_MODEL", "ATLAS_MODEL",
            "ASTRAFLOW_MODEL", "ASTRAFLOW_CN_MODEL",
        ):
            # save_config(persist=True) writes os.environ directly; restore it after each test.
            monkeypatch.setenv(name, "")
            monkeypatch.delenv(name)
        monkeypatch.setenv("ANTHROPIC_API_KEY", "test-key")
        monkeypatch.setenv("OPENAI_API_KEY", "test-key")

    @pytest.mark.parametrize("persist", [False, True])
    def test_selector_model_reaches_actual_request(self, monkeypatch: pytest.MonkeyPatch, persist: bool) -> None:
        save_config("ollama", "mistral", persist=persist)
        urlopen = Mock(side_effect=lambda *args, **kwargs: io.BytesIO(
            b'{"message":{"content":"ok"},"model":"mistral"}'
        ))
        monkeypatch.setattr("urllib.request.urlopen", urlopen)

        provider = get_provider()
        provider.generate(LLMInput(messages=[Message(Role.USER, "hello")]))

        assert provider.get_default_model() == "mistral"
        assert json.loads(urlopen.call_args.args[0].data)["model"] == "mistral"

        provider.generate(LLMInput(messages=[], model="codellama"))
        assert json.loads(urlopen.call_args.args[0].data)["model"] == "codellama"

    @pytest.mark.parametrize("provider_type", list(ProviderType))
    @pytest.mark.parametrize("source", ["saved", "environment"])
    def test_selected_model_applies_to_every_builtin(
        self, monkeypatch: pytest.MonkeyPatch, provider_type: ProviderType, source: str,
    ) -> None:
        save_config(provider_type.value, "Selected/MixedCase-model", persist=source == "environment")

        provider = get_provider()

        assert provider.provider_type == provider_type
        assert provider.get_default_model() == "Selected/MixedCase-model"

    def test_environment_model_overrides_saved_model(self, monkeypatch: pytest.MonkeyPatch) -> None:
        save_config("ollama", "mistral")
        monkeypatch.setenv("LLM_MODEL", "codellama")

        assert get_provider().get_default_model() == "codellama"

    @pytest.mark.parametrize("provider_type,model_env", [
        ("ollama", "OLLAMA_MODEL"),
        ("atlas", "ATLAS_MODEL"),
        ("astraflow", "ASTRAFLOW_MODEL"),
        ("astraflow_cn", "ASTRAFLOW_CN_MODEL"),
        ("astraflow_cn", "ASTRAFLOW_MODEL"),
    ])
    def test_provider_environment_retains_precedence(
        self, monkeypatch: pytest.MonkeyPatch, provider_type: str, model_env: str,
    ) -> None:
        save_config(provider_type, "saved-model")
        monkeypatch.setenv("LLM_MODEL", "global-model")
        monkeypatch.setenv(model_env, "provider-model")

        assert get_provider().get_default_model() == "provider-model"

    def test_cn_specific_environment_overrides_shared_fallback(self, monkeypatch: pytest.MonkeyPatch) -> None:
        save_config("astraflow_cn", "saved-model")
        monkeypatch.setenv("ASTRAFLOW_MODEL", "shared-model")
        monkeypatch.setenv("ASTRAFLOW_CN_MODEL", "cn-model")

        assert get_provider().get_default_model() == "cn-model"

    @pytest.mark.parametrize("provider_type", list(ProviderType))
    def test_explicit_default_model_overrides_selection(
        self, monkeypatch: pytest.MonkeyPatch, provider_type: ProviderType,
    ) -> None:
        save_config(provider_type.value, "saved-model", persist=True)
        monkeypatch.setenv("OLLAMA_MODEL", "provider-model")

        assert get_provider(default_model="explicit-model").get_default_model() == "explicit-model"

    @pytest.mark.parametrize("default_model", [None, ""])
    def test_explicit_empty_default_retains_constructor_fallback(
        self, monkeypatch: pytest.MonkeyPatch, default_model: str | None,
    ) -> None:
        save_config("ollama", "saved-model", persist=True)
        monkeypatch.setenv("OLLAMA_MODEL", "provider-model")

        assert get_provider(default_model=default_model).get_default_model() == "provider-model"

    @pytest.mark.parametrize("explicit", [False, True])
    def test_provider_override_does_not_inherit_saved_model(
        self, monkeypatch: pytest.MonkeyPatch, explicit: bool,
    ) -> None:
        save_config("openai", "gpt-selected")
        if explicit:
            provider = get_provider("ollama")
        else:
            monkeypatch.setenv("LLM_PROVIDER", "ollama")
            provider = get_provider()

        assert provider.get_default_model() == "llama3.2"

    def test_explicit_provider_does_not_inherit_another_environment_model(
        self, monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        monkeypatch.setenv("LLM_PROVIDER", "openai")
        monkeypatch.setenv("LLM_MODEL", "gpt-selected")

        assert get_provider("ollama").get_default_model() == "llama3.2"

    @pytest.mark.parametrize("env_provider", [None, "  'OLLAMA'  "])
    def test_environment_model_applies_to_matching_explicit_provider(
        self, monkeypatch: pytest.MonkeyPatch, env_provider: str | None,
    ) -> None:
        if env_provider is not None:
            monkeypatch.setenv("LLM_PROVIDER", env_provider)
        monkeypatch.setenv("LLM_MODEL", '  "MixedCase/Model"  ')

        assert get_provider("ollama").get_default_model() == "MixedCase/Model"

    @pytest.mark.parametrize("source", ["saved", "environment"])
    @pytest.mark.parametrize("model", ["", "   ", '""'])
    def test_empty_selected_model_retains_default(
        self, monkeypatch: pytest.MonkeyPatch, source: str, model: str,
    ) -> None:
        save_config("ollama", model, persist=source == "environment")

        assert get_provider().get_default_model() == "llama3.2"

    def test_empty_environment_model_falls_back_to_saved_model(self, monkeypatch: pytest.MonkeyPatch) -> None:
        save_config("ollama", "mistral")
        monkeypatch.setenv("LLM_MODEL", "  ")

        assert get_provider().get_default_model() == "mistral"

    def test_quoted_saved_model_preserves_case(self, tmp_path: Path) -> None:
        tmp_path.joinpath(".llm.env").write_text(
            "LLM_PROVIDER='OLLAMA'\nLLM_MODEL='MixedCase/Model'\n"
        )

        assert get_provider().get_default_model() == "MixedCase/Model"

    def test_unpaired_saved_model_does_not_override_default_provider(self, tmp_path: Path) -> None:
        tmp_path.joinpath(".llm.env").write_text("LLM_MODEL=orphan-model\n")

        assert get_provider().get_default_model() == "claude-sonnet-4-6"

    @pytest.mark.parametrize("saved_provider", [None, "", "   ", '""', "'  '"])
    def test_missing_or_blank_saved_provider_ignores_unpaired_model(
        self, tmp_path: Path, saved_provider: str | None,
    ) -> None:
        provider_line = "" if saved_provider is None else f"LLM_PROVIDER={saved_provider}\n"
        tmp_path.joinpath(".llm.env").write_text(provider_line + "LLM_MODEL=orphan-model\n")

        provider = get_provider()

        assert provider.provider_type == ProviderType.CLAUDE
        assert provider.get_default_model() == "claude-sonnet-4-6"

    @pytest.mark.parametrize("explicit", [False, True])
    def test_blank_saved_provider_preserves_provider_and_model_overrides(
        self, monkeypatch: pytest.MonkeyPatch, tmp_path: Path, explicit: bool,
    ) -> None:
        tmp_path.joinpath(".llm.env").write_text('LLM_PROVIDER=""\nLLM_MODEL=orphan-model\n')
        if explicit:
            provider = get_provider("ollama", default_model="explicit-model")
            expected_model = "explicit-model"
        else:
            monkeypatch.setenv("LLM_PROVIDER", "ollama")
            monkeypatch.setenv("LLM_MODEL", "environment-model")
            provider = get_provider()
            expected_model = "environment-model"

        assert provider.provider_type == ProviderType.OLLAMA
        assert provider.get_default_model() == expected_model

    @pytest.mark.parametrize("explicit", [False, True])
    def test_provider_override_does_not_read_invalid_saved_file(
        self, monkeypatch: pytest.MonkeyPatch, tmp_path: Path, explicit: bool,
    ) -> None:
        tmp_path.joinpath(".llm.env").write_bytes(b"\xff\xfe")
        monkeypatch.setenv("LLM_MODEL", "mistral")
        if explicit:
            provider = get_provider("ollama")
        else:
            monkeypatch.setenv("LLM_PROVIDER", "ollama")
            provider = get_provider()

        assert provider.get_default_model() == "mistral"

    def test_registered_provider_keeps_its_constructor_contract(self, monkeypatch: pytest.MonkeyPatch) -> None:
        class CustomProvider(OllamaProvider):
            def __init__(self, base_url: str | None = None) -> None:
                super().__init__(base_url=base_url, default_model="custom-default")

        monkeypatch.setattr(resolver, "_PROVIDER_MAP", resolver._PROVIDER_MAP.copy())
        resolver.register_provider(ProviderType.OLLAMA, CustomProvider)
        save_config("ollama", "mistral", persist=True)

        provider = get_provider(base_url="http://localhost:1234")

        assert isinstance(provider, CustomProvider)
        assert provider.base_url == "http://localhost:1234"
        assert provider.get_default_model() == "custom-default"

    def test_registered_provider_receives_explicit_default_model(self, monkeypatch: pytest.MonkeyPatch) -> None:
        class CustomProvider(OllamaProvider):
            pass

        monkeypatch.setattr(resolver, "_PROVIDER_MAP", resolver._PROVIDER_MAP.copy())
        resolver.register_provider(ProviderType.OLLAMA, CustomProvider)
        save_config("ollama", "mistral", persist=True)

        provider = get_provider(default_model="custom-explicit")

        assert isinstance(provider, CustomProvider)
        assert provider.get_default_model() == "custom-explicit"
