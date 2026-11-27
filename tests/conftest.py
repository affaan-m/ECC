import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent / "src"))


def pytest_configure(config: pytest.Config) -> None:
    config.addinivalue_line("markers", "unit: marks fast unit tests")
