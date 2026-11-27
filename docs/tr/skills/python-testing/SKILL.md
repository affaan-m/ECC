---
name: python-testing
description: pytest, TDD metodolojisi, fixture'lar, mocking, parametrizasyon ve coverage gereksinimleri kullanarak Python test stratejileri.
origin: ECC
---

# Python Test Desenleri

pytest, TDD metodolojisi ve en iyi uygulamalar kullanarak Python uygulamaları için kapsamlı test stratejileri.

## Ne Zaman Etkinleştirmeli

- Yeni Python kodu yazarken (TDD'yi takip et: red, green, refactor)
- Python projeleri için test suite'leri tasarlarken
- Python test coverage'ını gözden geçirirken
- Test altyapısını kurarken

## Temel Test Felsefesi

### Test-Driven Development (TDD)

Her zaman TDD döngüsünü takip edin:

1. **RED**: İstenen davranış için başarısız bir test yaz
2. **GREEN**: Testi geçirmek için minimal kod yaz
3. **REFACTOR**: Testleri yeşil tutarken kodu iyileştir

```python
# Adım 1: Başarısız test yaz (RED)
def test_add_numbers():
    result = add(2, 3)
    assert result == 5

# Adım 2: Minimal implementasyon yaz (GREEN)
def add(a, b):
    return a + b

# Adım 3: Gerekirse refactor et (REFACTOR)
```

### Coverage Gereksinimleri

- **Hedef**: 80%+ kod coverage'ı
- **Kritik yollar**: 100% coverage gereklidir
- Coverage'ı ölçmek için `pytest --cov` kullanın

```bash
pytest --cov=mypackage --cov-report=term-missing --cov-report=html
```

## pytest Temelleri

### Temel Test Yapısı

```python
import pytest

def test_addition():
    """Temel toplama testi."""
    assert 2 + 2 == 4

def test_string_uppercase():
    """String büyük harf yapma testi."""
    text = "hello"
    assert text.upper() == "HELLO"

def test_list_append():
    """Liste append testi."""
    items = [1, 2, 3]
    items.append(4)
    assert 4 in items
    assert len(items) == 4
```

### Assertion'lar

```python
# Eşitlik
assert result == expected

# Eşitsizlik
assert result != unexpected

# Doğruluk değeri
assert result  # Truthy
assert not result  # Falsy
assert result is True  # Tam olarak True
assert result is False  # Tam olarak False
assert result is None  # Tam olarak None

# Üyelik
assert item in collection
assert item not in collection

# Karşılaştırmalar
assert result > 0
assert 0 <= result <= 100

# Tip kontrolü
assert isinstance(result, str)

# Exception testi (tercih edilen yaklaşım)
with pytest.raises(ValueError):
    raise ValueError("error message")

# Exception mesajını kontrol et
with pytest.raises(ValueError, match="invalid input"):
    raise ValueError("invalid input provided")

# Exception niteliklerini kontrol et
with pytest.raises(ValueError) as exc_info:
    raise ValueError("error message")
assert str(exc_info.value) == "error message"
```

## Fixture'lar

### Temel Fixture Kullanımı

```python
import pytest

@pytest.fixture
def sample_data():
    """Örnek veri sağlayan fixture."""
    return {"name": "Alice", "age": 30}

def test_sample_data(sample_data):
    """Fixture kullanan test."""
    assert sample_data["name"] == "Alice"
    assert sample_data["age"] == 30
```

### Setup/Teardown ile Fixture

```python
@pytest.fixture
def database():
    """Setup ve teardown ile fixture."""
    # Setup
    db = Database(":memory:")
    db.create_tables()
    db.insert_test_data()

    yield db  # Teste sağla

    # Teardown
    db.close()

def test_database_query(database):
    """Veritabanı operasyonlarını test et."""
    result = database.query("SELECT * FROM users")
    assert len(result) > 0
```

### Fixture Scope'ları

```python
# Function scope (varsayılan) - her test için çalışır
@pytest.fixture
def temp_file():
    with open("temp.txt", "w") as f:
        yield f
    os.remove("temp.txt")

# Module scope - modül başına bir kez çalışır
@pytest.fixture(scope="module")
def module_db():
    db = Database(":memory:")
    db.create_tables()
    yield db
    db.close()

# Session scope - test oturumu başına bir kez çalışır
@pytest.fixture(scope="session")
def shared_resource():
    resource = ExpensiveResource()
    yield resource
    resource.cleanup()
```

### Parametreli Fixture

```python
@pytest.fixture(params=[1, 2, 3])
def number(request):
    """Parametreli fixture."""
    return request.param

def test_numbers(number):
    """Test her parametre için 3 kez çalışır."""
    assert number > 0
```

### Birden Fazla Fixture Kullanma

```python
@pytest.fixture
def user():
    return User(id=1, name="Alice")

@pytest.fixture
def admin():
    return User(id=2, name="Admin", role="admin")

def test_user_admin_interaction(user, admin):
    """Birden fazla fixture kullanan test."""
    assert admin.can_manage(user)
```

### Autouse Fixture'ları

```python
@pytest.fixture(autouse=True)
def reset_config():
    """Her testten önce otomatik olarak çalışır."""
    Config.reset()
    yield
    Config.cleanup()

def test_without_fixture_call():
    # reset_config otomatik olarak çalışır
    assert Config.get_setting("debug") is False
```

### Paylaşılan Fixture'lar için Conftest.py

```python
# tests/conftest.py
import pytest

@pytest.fixture
def client():
    """Tüm testler için paylaşılan fixture."""
    app = create_app(testing=True)
    with app.test_client() as client:
        yield client

@pytest.fixture
def auth_headers(client):
    """API testi için auth header'ları oluştur."""
    response = client.post("/api/login", json={
        "username": "test",
        "password": "test"
    })
    token = response.json["token"]
    return {"Authorization": f"Bearer {token}"}
```

## Parametrizasyon

### Temel Parametrizasyon

```python
@pytest.mark.parametrize("input,expected", [
    ("hello", "HELLO"),
    ("world", "WORLD"),
    ("PyThOn", "PYTHON"),
])
def test_uppercase(input, expected):
    """Test farklı input'larla 3 kez çalışır."""
    assert input.upper() == expected
```

### Birden Fazla Parametre

```python
@pytest.mark.parametrize("a,b,expected", [
    (2, 3, 5),
    (0, 0, 0),
    (-1, 1, 0),
    (100, 200, 300),
])
def test_add(a, b, expected):
    """Birden fazla input ile toplama testi."""
    assert add(a, b) == expected
```

### ID'li Parametrizasyon

```python
@pytest.mark.parametrize("input,expected", [
    ("valid@email.com", True),
    ("invalid", False),
    ("@no-domain.com", False),
], ids=["valid-email", "missing-at", "missing-domain"])
def test_email_validation(input, expected):
    """Okunabilir test ID'leri ile email validation testi."""
    assert is_valid_email(input) is expected
```

### Parametreli Fixture'lar

```python
@pytest.fixture(params=["sqlite", "postgresql", "mysql"])
def db(request):
    """Birden fazla veritabanı backend'ine karşı test."""
    if request.param == "sqlite":
        return Database(":memory:")
    elif request.param == "postgresql":
        return Database("postgresql://localhost/test")
    elif request.param == "mysql":
        return Database("mysql://localhost/test")

def test_database_operations(db):
    """Test her veritabanı için 3 kez çalışır."""
    result = db.query("SELECT 1")
    assert result is not None
```

## Marker'lar ve Test Seçimi

### Özel Marker'lar

```python
# Yavaş testleri işaretle
@pytest.mark.slow
def test_slow_operation():
    time.sleep(5)

# Entegrasyon testlerini işaretle
@pytest.mark.integration
def test_api_integration():
    response = requests.get("https://api.example.com")
    assert response.status_code == 200

# Unit testleri işaretle
@pytest.mark.unit
def test_unit_logic():
    assert calculate(2, 3) == 5
```

### Belirli Testleri Çalıştırma

```bash
# Sadece hızlı testleri çalıştır
pytest -m "not slow"

# Sadece entegrasyon testlerini çalıştır
pytest -m integration

# Entegrasyon veya yavaş testleri çalıştır
pytest -m "integration or slow"

# Unit olarak işaretlenmiş ama yavaş olmayan testleri çalıştır
pytest -m "unit and not slow"
```

### pytest.ini'de Marker'ları Yapılandırma

```ini
[pytest]
markers =
    slow: marks tests as slow
    integration: marks tests as integration tests
    unit: marks tests as unit tests
    django: marks tests as requiring Django
```

## Mocking ve Patching

### Fonksiyonları Mocking

```python
from unittest.mock import patch, Mock

@patch("mypackage.external_api_call")
def test_with_mock(api_call_mock):
    """Mock'lanmış harici API ile test."""
    api_call_mock.return_value = {"status": "success"}

    result = my_function()

    api_call_mock.assert_called_once()
    assert result["status"] == "success"
```

### Dönüş Değerlerini Mocking

```python
@patch("mypackage.Database.connect")
def test_database_connection(connect_mock):
    """Mock'lanmış veritabanı bağlantısı ile test."""
    connect_mock.return_value = MockConnection()

    db = Database()
    db.connect()

    connect_mock.assert_called_once_with("localhost")
```

### Exception'ları Mocking

```python
@patch("mypackage.api_call")
def test_api_error_handling(api_call_mock):
    """Mock'lanmış exception ile hata işleme testi."""
    api_call_mock.side_effect = ConnectionError("Network error")

    with pytest.raises(ConnectionError):
        api_call()

    api_call_mock.assert_called_once()
```

### Context Manager'ları Mocking

```python
@patch("builtins.open", new_callable=mock_open)
def test_file_reading(mock_file):
    """Mock'lanmış open ile dosya okuma testi."""
    mock_file.return_value.read.return_value = "file content"

    result = read_file("test.txt")

    mock_file.assert_called_once_with("test.txt", "r")
    assert result == "file content"
```

### Autospec Kullanma

```python
@patch("mypackage.DBConnection", autospec=True)
def test_autospec(db_mock):
    """API yanlış kullanımını yakalamak için autospec ile test."""
    db = db_mock.return_value
    db.query("SELECT * FROM users")

    # DBConnection query metodu yoksa bu başarısız olur
    db_mock.assert_called_once()
```

### Mock Class Instance'ları

```python
class TestUserService:
    @patch("mypackage.UserRepository")
    def test_create_user(self, repo_mock):
        """Mock'lanmış repository ile kullanıcı oluşturma testi."""
        repo_mock.return_value.save.return_value = User(id=1, name="Alice")

        service = UserService(repo_mock.return_value)
        user = service.create_user(name="Alice")

        assert user.name == "Alice"
        repo_mock.return_value.save.assert_called_once()
```

### Mock Property

```python
@pytest.fixture
def mock_config():
    """Property'li bir mock oluştur."""
    config = Mock()
    type(config).debug = PropertyMock(return_value=True)
    type(config).api_key = PropertyMock(return_value="test-key")
    return config

def test_with_mock_config(mock_config):
    """Mock'lanmış config property'leri ile test."""
    assert mock_config.debug is True
    assert mock_config.api_key == "test-key"
```

## Asenkron Kodu Test Etme

### pytest-asyncio ile Asenkron Testler

```python
import pytest

@pytest.mark.asyncio
async def test_async_function():
    """Asenkron fonksiyon testi."""
    result = await async_add(2, 3)
    assert result == 5

@pytest.mark.asyncio
async def test_async_with_fixture(async_client):
    """Asenkron fixture ile asenkron test."""
    response = await async_client.get("/api/users")
    assert response.status_code == 200
```

### Asenkron Fixture

```python
@pytest.fixture
async def async_client():
    """Asenkron test client sağlayan asenkron fixture."""
    app = create_app()
    async with app.test_client() as client:
        yield client

@pytest.mark.asyncio
async def test_api_endpoint(async_client):
    """Asenkron fixture kullanan test."""
    response = await async_client.get("/api/data")
    assert response.status_code == 200
```

### Asenkron Fonksiyonları Mocking

```python
@pytest.mark.asyncio
@patch("mypackage.async_api_call")
async def test_async_mock(api_call_mock):
    """Mock ile asenkron fonksiyon testi."""
    api_call_mock.return_value = {"status": "ok"}

    result = await my_async_function()

    api_call_mock.assert_awaited_once()
    assert result["status"] == "ok"
```

## Exception'ları Test Etme

### Beklenen Exception'ları Test Etme

```python
def test_divide_by_zero():
    """Sıfıra bölmenin ZeroDivisionError raise ettiğini test et."""
    with pytest.raises(ZeroDivisionError):
        divide(10, 0)

def test_custom_exception():
    """Mesaj ile özel exception testi."""
    with pytest.raises(ValueError, match="invalid input"):
        validate_input("invalid")
```

### Exception Niteliklerini Test Etme

```python
def test_exception_with_details():
    """Özel niteliklerle exception testi."""
    with pytest.raises(CustomError) as exc_info:
        raise CustomError("error", code=400)

    assert exc_info.value.code == 400
    assert "error" in str(exc_info.value)
```

## Yan Etkileri Test Etme

### Dosya Operasyonlarını Test Etme

```python
import tempfile
import os

def test_file_processing():
    """Geçici dosya ile dosya işleme testi."""
    with tempfile.NamedTemporaryFile(mode='w', delete=False, suffix='.txt') as f:
        f.write("test content")
        temp_path = f.name

    try:
        result = process_file(temp_path)
        assert result == "processed: test content"
    finally:
        os.unlink(temp_path)
```

### pytest'in tmp_path Fixture'ı ile Test Etme

```python
def test_with_tmp_path(tmp_path):
    """pytest'in built-in geçici yol fixture'ını kullanarak test."""
    test_file = tmp_path / "test.txt"
    test_file.write_text("hello world")

    result = process_file(str(test_file))
    assert result == "hello world"
    # tmp_path otomatik olarak temizlenir
```

### tmpdir Fixture ile Test Etme

```python
def test_with_tmpdir(tmpdir):
    """pytest'in tmpdir fixture'ını kullanarak test."""
    test_file = tmpdir.join("test.txt")
    test_file.write("data")

    result = process_file(str(test_file))
    assert result == "data"
```

## Test Organizasyonu

### Dizin Yapısı

```
tests/
├── conftest.py                 # Paylaşılan fixture'lar
├── __init__.py
├── unit/                       # Unit testler
│   ├── __init__.py
│   ├── test_models.py
│   ├── test_utils.py
│   └── test_services.py
├── integration/                # Entegrasyon testleri
│   ├── __init__.py
│   ├── test_api.py
│   └── test_database.py
└── e2e/                        # End-to-end testler
    ├── __init__.py
    └── test_user_flow.py
```

### Test Class'ları

```python
class TestUserService:
    """İlgili testleri bir class'ta grupla."""

    @pytest.fixture(autouse=True)
    def setup(self):
        """Bu class'taki her testten önce çalışan setup."""
        self.service = UserService()

    def test_create_user(self):
        """Kullanıcı oluşturma testi."""
        user = self.service.create_user("Alice")
        assert user.name == "Alice"

    def test_delete_user(self):
        """Kullanıcı silme testi."""
        user = User(id=1, name="Bob")
        self.service.delete_user(user)
        assert not self.service.user_exists(1)
```

## En İyi Uygulamalar

### YAPIN

- **TDD'yi takip edin**: Koddan önce testleri yazın (red-green-refactor)
- **Bir şeyi test edin**: Her test tek bir davranışı doğrulamalı
- **Açıklayıcı isimler kullanın**: `test_user_login_with_invalid_credentials_fails`
- **Fixture'ları kullanın**: Tekrarı fixture'larla ortadan kaldırın
- **Harici bağımlılıkları mock'layın**: Harici servislere bağımlı olmayın
- **Kenar durumları test edin**: Boş input'lar, None değerleri, sınır koşulları
- **%80+ coverage hedefleyin**: Kritik yollara odaklanın
- **Testleri hızlı tutun**: Yavaş testleri ayırmak için marker'lar kullanın

### YAPMAYIN

- **İmplementasyonu test etmeyin**: Davranışı test edin, iç yapıyı değil
- **Testlerde karmaşık koşullar kullanmayın**: Testleri basit tutun
- **Test hatalarını göz ardı etmeyin**: Tüm testler geçmeli
- **Third-party kodu test etmeyin**: Kütüphanelerin çalıştığına güvenin
- **Testler arası state paylaşmayın**: Testler bağımsız olmalı
- **Testlerde exception yakalamayın**: `pytest.raises` kullanın
- **Print statement'ları kullanmayın**: Assertion'ları ve pytest çıktısını kullanın
- **Çok kırılgan testler yazmayın**: Aşırı spesifik mock'lardan kaçının

## Yaygın Desenler

### API Endpoint'lerini Test Etme (FastAPI/Flask)

```python
@pytest.fixture
def client():
    app = create_app(testing=True)
    return app.test_client()

def test_get_user(client):
    response = client.get("/api/users/1")
    assert response.status_code == 200
    assert response.json["id"] == 1

def test_create_user(client):
    response = client.post("/api/users", json={
        "name": "Alice",
        "email": "alice@example.com"
    })
    assert response.status_code == 201
    assert response.json["name"] == "Alice"
```

### Veritabanı Operasyonlarını Test Etme

```python
@pytest.fixture
def db_session():
    """Test veritabanı oturumu oluştur."""
    session = Session(bind=engine)
    session.begin_nested()
    yield session
    session.rollback()
    session.close()

def test_create_user(db_session):
    user = User(name="Alice", email="alice@example.com")
    db_session.add(user)
    db_session.commit()

    retrieved = db_session.query(User).filter_by(name="Alice").first()
    assert retrieved.email == "alice@example.com"
```

### Class Metodlarını Test Etme

```python
class TestCalculator:
    @pytest.fixture
    def calculator(self):
        return Calculator()

    def test_add(self, calculator):
        assert calculator.add(2, 3) == 5

    def test_divide_by_zero(self, calculator):
        with pytest.raises(ZeroDivisionError):
            calculator.divide(10, 0)
```

## pytest Yapılandırması

### pytest.ini

```ini
[pytest]
testpaths = tests
python_files = test_*.py
python_classes = Test*
python_functions = test_*
addopts =
    --strict-markers
    --disable-warnings
    --cov=mypackage
    --cov-report=term-missing
    --cov-report=html
markers =
    slow: marks tests as slow
    integration: marks tests as integration tests
    unit: marks tests as unit tests
```

### pyproject.toml

```toml
[tool.pytest.ini_options]
testpaths = ["tests"]
python_files = ["test_*.py"]
python_classes = ["Test*"]
python_functions = ["test_*"]
addopts = [
    "--strict-markers",
    "--cov=mypackage",
    "--cov-report=term-missing",
    "--cov-report=html",
]
markers = [
    "slow: marks tests as slow",
    "integration: marks tests as integration tests",
    "unit: marks tests as unit tests",
]
```

## Testleri Çalıştırma

```bash
# Tüm testleri çalıştır
pytest

# Belirli dosyayı çalıştır
pytest tests/test_utils.py

# Belirli testi çalıştır
pytest tests/test_utils.py::test_function

# Verbose çıktı ile çalıştır
pytest -v

# Coverage ile çalıştır
pytest --cov=mypackage --cov-report=html

# Sadece hızlı testleri çalıştır
pytest -m "not slow"

# İlk hataya kadar çalıştır
pytest -x

# N hataya kadar çalıştır
pytest --maxfail=3

# Son başarısız testleri çalıştır
pytest --lf

# Pattern ile testleri çalıştır
pytest -k "test_user"

# Hatada debugger ile çalıştır
pytest --pdb
```

## Hızlı Referans

| Desen | Kullanım |
|-------|----------|
| `pytest.raises()` | Beklenen exception'ları test et |
| `@pytest.fixture()` | Yeniden kullanılabilir test fixture'ları oluştur |
| `@pytest.mark.parametrize()` | Birden fazla input ile testleri çalıştır |
| `@pytest.mark.slow` | Yavaş testleri işaretle |
| `pytest -m "not slow"` | Yavaş testleri atla |
| `@patch()` | Fonksiyonları ve class'ları mock'la |
| `tmp_path` fixture | Otomatik geçici dizin |
| `pytest --cov` | Coverage raporu oluştur |
| `assert` | Basit ve okunabilir assertion'lar |

**Unutmayın**: Testler de koddur. Temiz, okunabilir ve bakımı kolay tutun. İyi testler hata yakalar; harika testler hataları önler.
