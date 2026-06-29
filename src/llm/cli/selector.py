

from __future__ import annotations

import os
import sys
from enum import StrEnum


class Color(StrEnum):
    RESET = "\033[0m"
    BOLD = "\033[1m"
    GREEN = "\033[92m"
    YELLOW = "\033[93m"
    BLUE = "\033[94m"
    CYAN = "\033[96m"


_DEFAULT_PROVIDERS: tuple[tuple[str, str], ...] = (
    ("claude", "Anthropic Claude ( Sonnet, Opus, Haiku)"),
    ("openai", "OpenAI GPT (4o, 4o-mini, 3.5-turbo)"),
    ("ollama", "Local Ollama models"),
    ("astraflow", "UModelVerse global OpenAI-compatible models"),
    ("astraflow_cn", "UModelVerse China OpenAI-compatible models"),
)

_DEFAULT_MODELS_PER_PROVIDER: dict[str, tuple[tuple[str, str], ...]] = {
    "claude": (
        ("claude-opus-4-5", "Claude Opus 4.5 - Most capable"),
        ("claude-sonnet-4-7", "Claude Sonnet 4.7 - Balanced"),
        ("claude-haiku-4-7", "Claude Haiku 4.7 - Fast"),
    ),
    "openai": (
        ("gpt-4o", "GPT-4o - Most capable"),
        ("gpt-4o-mini", "GPT-4o-mini - Fast & affordable"),
        ("gpt-4-turbo", "GPT-4 Turbo - Legacy powerful"),
        ("gpt-3.5-turbo", "GPT-3.5 - Legacy fast"),
    ),
    "ollama": (
        ("llama3.2", "Llama 3.2 - General purpose"),
        ("mistral", "Mistral - Fast & efficient"),
        ("codellama", "CodeLlama - Code specialized"),
    ),
    "astraflow": (
        ("gpt-4o-mini", "GPT-4o mini - Default OpenAI-compatible model"),
        ("deepseek-ai/DeepSeek-V3-0324", "DeepSeek V3 - UModelVerse global"),
    ),
    "astraflow_cn": (
        ("gpt-4o-mini", "GPT-4o mini - Default OpenAI-compatible model"),
        ("deepseek-ai/DeepSeek-V3-0324", "DeepSeek V3 - UModelVerse China"),
    ),
}

def print_banner() -> None:
    banner = f"""{Color.CYAN}
╔═══════════════════════════════════════════╗
║   LLM Provider Selector                   ║
║   Provider-agnostic AI interactions       ║
╚═══════════════════════════════════════════╝{Color.RESET}"""
    print(banner)


def print_providers(providers: list[tuple[str, str]]) -> None:
    print(f"\n{Color.BOLD}Available Providers:{Color.RESET}\n")
    for i, (name, desc) in enumerate(providers, 1):
        print(f"  {Color.GREEN}{i}{Color.RESET}. {Color.BOLD}{name}{Color.RESET} - {desc}")


def select_provider(providers: list[tuple[str, str]]) -> str | None:
    if not providers:
        print("No providers available.")
        return None

    print_providers(providers)

    while True:
        try:
            choice = input(f"\n{Color.YELLOW}Select provider (1-{len(providers)}): {Color.RESET}").strip()
            if not choice:
                return None
            idx = int(choice) - 1
            if 0 <= idx < len(providers):
                return providers[idx][0]
            print(f"{Color.YELLOW}Invalid selection. Try again.{Color.RESET}")
        except ValueError:
            print(f"{Color.YELLOW}Please enter a number.{Color.RESET}")


def select_model(models: list[tuple[str, str]]) -> str | None:
    if not models:
        print("No models available.")
        return None

    print(f"\n{Color.BOLD}Available Models:{Color.RESET}\n")
    for i, (name, desc) in enumerate(models, 1):
        print(f"  {Color.GREEN}{i}{Color.RESET}. {Color.BOLD}{name}{Color.RESET} - {desc}")

    while True:
        try:
            choice = input(f"\n{Color.YELLOW}Select model (1-{len(models)}): {Color.RESET}").strip()
            if not choice:
                return None
            idx = int(choice) - 1
            if 0 <= idx < len(models):
                return models[idx][0]
            print(f"{Color.YELLOW}Invalid selection. Try again.{Color.RESET}")
        except ValueError:
            print(f"{Color.YELLOW}Please enter a number.{Color.RESET}")


def save_config(provider: str, model: str, persist: bool = False) -> None:
    config = f"LLM_PROVIDER={provider}\nLLM_MODEL={model}\n"
    env_file = ".llm.env"

    with open(env_file, "w") as f:
        f.write(config)

    print(f"\n{Color.GREEN}✓{Color.RESET} Config saved to {Color.CYAN}{env_file}{Color.RESET}")

    if persist:
        os.environ["LLM_PROVIDER"] = provider
        os.environ["LLM_MODEL"] = model
        print(f"{Color.GREEN}✓{Color.RESET} Config loaded to current session")


def interactive_select(
    providers: list[tuple[str, str]] | None = None,
    models_per_provider: dict[str, list[tuple[str, str]]] | None = None,
    persist: bool = False,
) -> tuple[str, str] | None:
    print_banner()

    if providers is None:
        providers = list(_DEFAULT_PROVIDERS)

    if models_per_provider is None:
        models_per_provider = {
            provider: list(models)
            for provider, models in _DEFAULT_MODELS_PER_PROVIDER.items()
        }

    provider = select_provider(providers)
    if not provider:
        return None

    models = models_per_provider.get(provider, [])
    model = select_model(models)
    if not model:
        return None

    print(f"\n{Color.GREEN}Selected: {Color.BOLD}{provider}{Color.RESET} / {Color.BOLD}{model}{Color.RESET}")

    save_config(provider, model, persist)

    return (provider, model)


def main() -> None:
    result = interactive_select(persist=True)

    if result:
        print(f"\n{Color.GREEN}Ready to use!{Color.RESET}")
        print(f"  export LLM_PROVIDER={result[0]}")
        print(f"  export LLM_MODEL={result[1]}")
    else:
        print("\nSelection cancelled.")
        sys.exit(0)


if __name__ == "__main__":
    main()
