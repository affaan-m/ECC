---
name: python-testing
description: >
  Python testing best practices using pytest including fixtures, parametrization,
  mocking, coverage analysis, async testing, and test organization. Use when
  writing or improving Python tests.
metadata:
  origin: ECC
  globs: ["**/*.py", "**/*.pyi"]
---

# Python Testing

> This skill provides comprehensive Python testing patterns using pytest as the primary testing framework.

## Testing Framework

Use **pytest** as the testing framework for its powerful features and clean syntax.

### Basic Test Structure

```python
def test_user_creation():
    """Test that a user can be created with valid data"""
    user = User(name="Alice", email="alice@example.com")

    assert user.name == "Alice"
    assert user.email == "alice@example.com"
    assert user.is_active is True
```

### Test Discovery

pytest automatically discovers tests following these conventions:
- Files: `test_*.py` or `*_test.py`
- Functions: `test_*`
- Classes: `Test*` (without `__init__`)
- Methods: `test_*`

## Fixtures

Fixtures provide reusable test setup and teardown:

```python
import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

@pytest.fixture
def db_session():
    """Provide a database session for tests"""
    engine = create_engine("sqlite:///:memory:")
    Session = sessionmaker(bind=engine)
    session = Session()

    # Setup
    Base.metadata.create_all(engine)

    yield session

    # Teardown
    session.close()

def test_user_repository(db_session):
    """Test using the db_session fixture"""
    repo = UserRepository(db_session)
    user = repo.create(name="Alice", email="alice@example.com")

    assert user.id is not None
```

### Fixture Scopes

```python
@pytest.fixture(scope="function")  # Default: per test
def user():
    return User(name="Alice")

@pytest.fixture(scope="class")  # Per test class
def database():
    db = Database()
    db.connect()
    yield db
    db.disconnect()

@pytest.fixture(scope="module")  # Per module
def app():
    return create_app()

@pytest.fixture(scope="session")  # Once per test session
def config():
    return load_config()
```

### Fixture Dependencies

```python
@pytest.fixture
def database():
    db = Database()
    db.connect()
    yield db
    db.disconnect()

@pytest.fixture
def user_repository(database):
    """Fixture that depends on database fixture"""
    return UserRepository(database)

def test_create_user(user_repository):
    user = user_repository.create(name="Alice")
    assert user.id is not None
```

## Parametrization

Test multiple inputs with `@pytest.mark.parametrize`:

```python
import pytest

@pytest.mark.parametrize("email,expected", [
    ("user@example.com", True),
    ("invalid-email", False),
    ("", False),
    ("user@", False),
    ("@example.com", False),
])
def test_email_validation(email, expected):
    result = validate_email(email)
    assert result == expected
```

### Multiple Parameters

```python
@pytest.mark.parametrize("name,age,valid", [
    ("Alice", 25, True),
    ("Bob", 17, False),
    ("", 25, False),
    ("Charlie", -1, False),
])
def test_user_validation(name, age, valid):
    result = validate_user(name, age)
    assert result == valid
```

### Parametrize with IDs

```python
@pytest.mark.parametrize("input,expected", [
    ("hello", "HELLO"),
    ("world", "WORLD"),
], ids=["lowercase", "another_lowercase"])
def test_uppercase(input, expected):
    assert input.upper() == expected
```

## Test Markers

Use markers for test categorization and selective execution:

```python
import pytest

@pytest.mark.unit
def test_calculate_total():
    """Fast unit test"""
    assert calculate_total([1, 2, 3]) == 6

@pytest.mark.integration
def test_database_connection():
    """Slower integration test"""
    db = Database()
    assert db.connect() is True

@pytest.mark.slow
def test_large_dataset():
    """Very slow test"""
    process_million_records()

@pytest.mark.skip(reason="Not implemented yet")
def test_future_feature():
    pass

@pytest.mark.skipif(sys.version_info < (3, 10), reason="Requires Python 3.10+")
def test_new_syntax():
    pass
```

**Run specific markers:**
```bash
pytest -m unit              # Run only unit tests
pytest -m "not slow"        # Skip slow tests
pytest -m "unit or integration"  # Run unit OR integration
```

## Mocking

### Using unittest.mock

```python
from unittest.mock import Mock, patch, MagicMock

def test_user_service_with_mock():
    """Test with mock repository"""
    mock_repo = Mock()
    mock_repo.find_by_id.return_value = User(id="1", name="Alice")

    service = UserService(mock_repo)
    user = service.get_user("1")

    assert user.name == "Alice"
    mock_repo.find_by_id.assert_called_once_with("1")

@patch('myapp.services.EmailService')
def test_send_notification(mock_email_service):
    """Test with patched dependency"""
    service = NotificationService()
    service.send("user@example.com", "Hello")

    mock_email_service.send.assert_called_once()
```

### pytest-mock Plugin

```python
def test_with_mocker(mocker):
    """Using pytest-mock plugin"""
    mock_repo = mocker.Mock()
    mock_repo.find_by_id.return_value = User(id="1", name="Alice")

    service = UserService(mock_repo)
    user = service.get_user("1")

    assert user.name == "Alice"
```

## Coverage Analysis

### Basic Coverage

```bash
pytest --cov=src --cov-report=term-missing
```

### HTML Coverage Report

```bash
pytest --cov=src --cov-report=html
open htmlcov/index.html
```

### Coverage Configuration

```ini
# pytest.ini or pyproject.toml
[tool.pytest.ini_options]
addopts = """
    --cov=src
    --cov-report=term-missing
    --cov-report=html
    --cov-fail-under=80
"""
```

### Branch Coverage

```bash
pytest --cov=src --cov-branch
```

## Async Testing

### Testing Async Functions

```python
import pytest

@pytest.mark.asyncio
async def test_async_fetch_user():
    """Test async function"""
    user = await fetch_user("1")
    assert user.name == "Alice"

@pytest.fixture
async def async_client():
    """Async fixture"""
    client = AsyncClient()
    await client.connect()
    yield client
    await client.disconnect()

@pytest.mark.asyncio
async def test_with_async_fixture(async_client):
    result = await async_client.get("/users/1")
    assert result.status == 200
```

## Test Organization

### Directory Structure

```
tests/
├── unit/
│   ├── test_models.py
│   ├── test_services.py
│   └── test_utils.py
├── integration/
│   ├── test_database.py
│   └── test_api.py
├── conftest.py          # Shared fixtures
└── pytest.ini           # Configuration
```

### conftest.py

```python
# tests/conftest.py
import pytest

@pytest.fixture(scope="session")
def app():
    """Application fixture available to all tests"""
    return create_app()

@pytest.fixture
def client(app):
    """Test client fixture"""
    return app.test_client()

def pytest_configure(config):
    """Register custom markers"""
    config.addinivalue_line("markers", "unit: Unit tests")
    config.addinivalue_line("markers", "integration: Integration tests")
    config.addinivalue_line("markers", "slow: Slow tests")
```

## Assertions

### Basic Assertions

```python
def test_assertions():
    assert value == expected
    assert value != other
    assert value > 0
    assert value in collection
    assert isinstance(value, str)
```

### pytest Assertions with Better Error Messages

```python
def test_with_context():
    """pytest provides detailed assertion introspection"""
    result = calculate_total([1, 2, 3])
    expected = 6

    # pytest shows: assert 5 == 6
    assert result == expected
```

### Custom Assertion Messages

```python
def test_with_message():
    result = process_data(input_data)
    assert result.is_valid, f"Expected valid result, got errors: {result.errors}"
```

### Approximate Comparisons

```python
import pytest

def test_float_comparison():
    result = 0.1 + 0.2
    assert result == pytest.approx(0.3)

    # With tolerance
    assert result == pytest.approx(0.3, abs=1e-9)
```

## Exception Testing

```python
import pytest

def test_raises_exception():
    """Test that function raises expected exception"""
    with pytest.raises(ValueError):
        validate_age(-1)

def test_exception_message():
    """Test exception message"""
    with pytest.raises(ValueError, match="Age must be positive"):
        validate_age(-1)

def test_exception_details():
    """Capture and inspect exception"""
    with pytest.raises(ValidationError) as exc_info:
        validate_user(name="", age=-1)

    assert "name" in exc_info.value.errors
    assert "age" in exc_info.value.errors
```

## Test Helpers

```python
# tests/helpers.py
def assert_user_equal(actual, expected):
    """Custom assertion helper"""
    assert actual.id == expected.id
    assert actual.name == expected.name
    assert actual.email == expected.email

def create_test_user(**kwargs):
    """Test data factory"""
    defaults = {
        "name": "Test User",
        "email": "test@example.com",
        "age": 25,
    }
    defaults.update(kwargs)
    return User(**defaults)
```

## Property-Based Testing

Using `hypothesis` for property-based testing:

```python
from hypothesis import given, strategies as st

@given(st.integers(), st.integers())
def test_addition_commutative(a, b):
    """Test that addition is commutative"""
    assert a + b == b + a

@given(st.lists(st.integers()))
def test_sort_idempotent(lst):
    """Test that sorting twice gives same result"""
    sorted_once = sorted(lst)
    sorted_twice = sorted(sorted_once)
    assert sorted_once == sorted_twice
```

## Best Practices

1. **One assertion per test** (when possible)
2. **Use descriptive test names** - describe what's being tested
3. **Arrange-Act-Assert pattern** - clear test structure
4. **Use fixtures for setup** - avoid duplication
5. **Mock external dependencies** - keep tests fast and isolated
6. **Test edge cases** - empty inputs, None, boundaries
7. **Use parametrize** - test multiple scenarios efficiently
8. **Keep tests independent** - no shared state between tests

## Running Tests

```bash
# Run all tests
pytest

# Run specific file
pytest tests/test_user.py

# Run specific test
pytest tests/test_user.py::test_create_user

# Run with verbose output
pytest -v

# Run with output capture disabled
pytest -s

# Run in parallel (requires pytest-xdist)
pytest -n auto

# Run only failed tests from last run
pytest --lf

# Run failed tests first
pytest --ff
```

## When to Use This Skill

- Writing new Python tests
- Improving test coverage
- Setting up pytest infrastructure
- Debugging flaky tests
- Implementing integration tests
- Testing async Python code
