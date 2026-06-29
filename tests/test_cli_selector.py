from llm.cli.selector import _DEFAULT_MODELS_PER_PROVIDER, _DEFAULT_PROVIDERS


def test_default_provider_choices_include_astraflow_endpoints():
    provider_names = [name for name, _description in _DEFAULT_PROVIDERS]

    assert "astraflow" in provider_names
    assert "astraflow_cn" in provider_names


def test_default_model_choices_include_astraflow_providers():
    astraflow_models = [name for name, _description in _DEFAULT_MODELS_PER_PROVIDER["astraflow"]]
    astraflow_cn_models = [name for name, _description in _DEFAULT_MODELS_PER_PROVIDER["astraflow_cn"]]

    assert "gpt-4o-mini" in astraflow_models
    assert "gpt-4o-mini" in astraflow_cn_models
