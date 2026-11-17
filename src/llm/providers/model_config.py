"""Model environment parsing shared by the resolver and provider adapters."""

import os


def read_model_env(name: str) -> str | None:
    """Read a model ID, treating surrounding whitespace and quotes as config syntax."""
    value = os.environ.get(name, "").strip()
    if len(value) >= 2 and value[0] == value[-1] and value[0] in {"'", '"'}:
        value = value[1:-1].strip()
    return value or None
