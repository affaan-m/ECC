import pytest
from llm.core.types import ProviderType
from llm.providers import AstraflowCNProvider, AstraflowProvider, AtlasProvider, ClaudeProvider, OpenAIProvider, OllamaProvider, get_provider


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
