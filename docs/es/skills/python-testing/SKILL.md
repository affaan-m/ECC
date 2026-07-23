---
name: python-testing
description: Estrategias de pruebas Python usando pytest, metodología TDD, fixtures, mocking, parametrización y requisitos de cobertura.
origin: ECC
---

# Patrones de Pruebas Python

Estrategias completas de pruebas para aplicaciones Python usando pytest, metodología TDD y buenas prácticas.

## Cuándo Activar

- Escribir código Python nuevo (seguir TDD: rojo, verde, refactorizar)
- Diseñar suites de pruebas para proyectos Python
- Revisar la cobertura de pruebas Python
- Configurar infraestructura de pruebas

## Filosofía Central de Pruebas

### Desarrollo Guiado por Pruebas (TDD)

Siempre seguir el ciclo TDD:

1. **ROJO**: Escribir una prueba que falle para el comportamiento deseado
2. **VERDE**: Escribir el código mínimo para que la prueba pase
3. **REFACTORIZAR**: Mejorar el código manteniendo las pruebas en verde

```python
# Paso 1: Escribir prueba fallida (ROJO)
def test_add_numbers():
    result = add(2, 3)
    assert result == 5

# Paso 2: Escribir implementación mínima (VERDE)
def add(a, b):
    return a + b

# Paso 3: Refactorizar si es necesario (REFACTORIZAR)
```

### Requisitos de Cobertura

- **Objetivo**: 80%+ de cobertura de código
- **Rutas críticas**: 100% de cobertura requerida
- Usar `pytest --cov` para medir la cobertura

```bash
pytest --cov=mypackage --cov-report=term-missing --cov-report=html
```

## Fundamentos de pytest

### Estructura Básica de Pruebas

```python
import pytest

def test_addition():
    """Prueba la suma básica."""
    assert 2 + 2 == 4

def test_string_uppercase():
    """Prueba la conversión a mayúsculas."""
    text = "hello"
    assert text.upper() == "HELLO"

def test_list_append():
    """Prueba el append de lista."""
    items = [1, 2, 3]
    items.append(4)
    assert 4 in items
    assert len(items) == 4
```

### Aserciones

```python
# Igualdad
assert result == expected

# Desigualdad
assert result != unexpected

# Veracidad
assert result  # Truthy
assert not result  # Falsy
assert result is True  # Exactamente True
assert result is False  # Exactamente False
assert result is None  # Exactamente None

# Membresía
assert item in collection
assert item not in collection

# Comparaciones
assert result > 0
assert 0 <= result <= 100

# Verificación de tipo
assert isinstance(result, str)

# Prueba de excepción (enfoque preferido)
with pytest.raises(ValueError):
    raise ValueError("mensaje de error")

# Verificar mensaje de excepción
with pytest.raises(ValueError, match="entrada inválida"):
    raise ValueError("entrada inválida proporcionada")
```

## Fixtures

### Uso Básico de Fixtures

```python
import pytest

@pytest.fixture
def sample_data():
    """Fixture que proporciona datos de ejemplo."""
    return {"name": "Alice", "age": 30}

def test_sample_data(sample_data):
    """Prueba usando el fixture."""
    assert sample_data["name"] == "Alice"
    assert sample_data["age"] == 30
```

### Fixture con Setup/Teardown

```python
@pytest.fixture
def database():
    """Fixture con setup y teardown."""
    # Setup
    db = Database(":memory:")
    db.create_tables()
    db.insert_test_data()

    yield db  # Proporcionar a la prueba

    # Teardown
    db.close()

def test_database_query(database):
    """Prueba operaciones de base de datos."""
    result = database.query("SELECT * FROM users")
    assert len(result) > 0
```

### Alcances de Fixtures

```python
# Alcance de función (por defecto) - se ejecuta por cada prueba
@pytest.fixture
def temp_file():
    with open("temp.txt", "w") as f:
        yield f
    os.remove("temp.txt")

# Alcance de módulo - se ejecuta una vez por módulo
@pytest.fixture(scope="module")
def module_db():
    db = Database(":memory:")
    db.create_tables()
    yield db
    db.close()

# Alcance de sesión - se ejecuta una vez por sesión de pruebas
@pytest.fixture(scope="session")
def shared_resource():
    resource = ExpensiveResource()
    yield resource
    resource.cleanup()
```

### Fixture con Parámetros

```python
@pytest.fixture(params=[1, 2, 3])
def number(request):
    """Fixture parametrizado."""
    return request.param

def test_numbers(number):
    """La prueba se ejecuta 3 veces, una por cada parámetro."""
    assert number > 0
```

### Fixtures Autouse

```python
@pytest.fixture(autouse=True)
def reset_config():
    """Se ejecuta automáticamente antes de cada prueba."""
    Config.reset()
    yield
    Config.cleanup()

def test_without_fixture_call():
    # reset_config se ejecuta automáticamente
    assert Config.get_setting("debug") is False
```

### Conftest.py para Fixtures Compartidos

```python
# tests/conftest.py
import pytest

@pytest.fixture
def client():
    """Fixture compartido para todas las pruebas."""
    app = create_app(testing=True)
    with app.test_client() as client:
        yield client

@pytest.fixture
def auth_headers(client):
    """Genera cabeceras de autenticación para pruebas de API."""
    response = client.post("/api/login", json={
        "username": "test",
        "password": "test"
    })
    token = response.json["token"]
    return {"Authorization": f"Bearer {token}"}
```

## Parametrización

### Parametrización Básica

```python
@pytest.mark.parametrize("input,expected", [
    ("hello", "HELLO"),
    ("world", "WORLD"),
    ("PyThOn", "PYTHON"),
])
def test_uppercase(input, expected):
    """La prueba se ejecuta 3 veces con diferentes entradas."""
    assert input.upper() == expected
```

### Múltiples Parámetros

```python
@pytest.mark.parametrize("a,b,expected", [
    (2, 3, 5),
    (0, 0, 0),
    (-1, 1, 0),
    (100, 200, 300),
])
def test_add(a, b, expected):
    """Prueba la suma con múltiples entradas."""
    assert add(a, b) == expected
```

### Parametrizar con IDs

```python
@pytest.mark.parametrize("input,expected", [
    ("valid@email.com", True),
    ("invalid", False),
    ("@no-domain.com", False),
], ids=["valid-email", "missing-at", "missing-domain"])
def test_email_validation(input, expected):
    """Prueba validación de email con IDs legibles."""
    assert is_valid_email(input) is expected
```

## Markers y Selección de Pruebas

### Markers Personalizados

```python
# Marcar pruebas lentas
@pytest.mark.slow
def test_slow_operation():
    time.sleep(5)

# Marcar pruebas de integración
@pytest.mark.integration
def test_api_integration():
    response = requests.get("https://api.example.com")
    assert response.status_code == 200

# Marcar pruebas unitarias
@pytest.mark.unit
def test_unit_logic():
    assert calculate(2, 3) == 5
```

### Ejecutar Pruebas Específicas

```bash
# Ejecutar solo pruebas rápidas
pytest -m "not slow"

# Ejecutar solo pruebas de integración
pytest -m integration

# Ejecutar pruebas de integración o lentas
pytest -m "integration or slow"
```

### Configurar Markers en pytest.ini

```ini
[pytest]
markers =
    slow: marca pruebas como lentas
    integration: marca pruebas como de integración
    unit: marca pruebas como unitarias
```

## Mocking y Patching

### Mocking de Funciones

```python
from unittest.mock import patch, Mock

@patch("mypackage.external_api_call")
def test_with_mock(api_call_mock):
    """Prueba con API externa mockeada."""
    api_call_mock.return_value = {"status": "success"}

    result = my_function()

    api_call_mock.assert_called_once()
    assert result["status"] == "success"
```

### Mocking de Excepciones

```python
@patch("mypackage.api_call")
def test_api_error_handling(api_call_mock):
    """Prueba manejo de errores con excepción mockeada."""
    api_call_mock.side_effect = ConnectionError("Error de red")

    with pytest.raises(ConnectionError):
        api_call()

    api_call_mock.assert_called_once()
```

### Mocking de Context Managers

```python
@patch("builtins.open", new_callable=mock_open)
def test_file_reading(mock_file):
    """Prueba lectura de archivo con open mockeado."""
    mock_file.return_value.read.return_value = "contenido del archivo"

    result = read_file("test.txt")

    mock_file.assert_called_once_with("test.txt", "r")
    assert result == "contenido del archivo"
```

### Usar Autospec

```python
@patch("mypackage.DBConnection", autospec=True)
def test_autospec(db_mock):
    """Prueba con autospec para detectar mal uso de API."""
    db = db_mock.return_value
    db.query("SELECT * FROM users")

    db_mock.assert_called_once()
```

### Mock de Propiedades

```python
@pytest.fixture
def mock_config():
    """Crea un mock con una propiedad."""
    config = Mock()
    type(config).debug = PropertyMock(return_value=True)
    type(config).api_key = PropertyMock(return_value="test-key")
    return config
```

## Pruebas de Código Asíncrono

### Pruebas Async con pytest-asyncio

```python
import pytest

@pytest.mark.asyncio
async def test_async_function():
    """Prueba función async."""
    result = await async_add(2, 3)
    assert result == 5
```

### Fixture Async

```python
@pytest.fixture
async def async_client():
    """Fixture async que proporciona cliente de prueba async."""
    app = create_app()
    async with app.test_client() as client:
        yield client
```

## Pruebas de Excepciones

### Probar Excepciones Esperadas

```python
def test_divide_by_zero():
    """Prueba que dividir por cero lanza ZeroDivisionError."""
    with pytest.raises(ZeroDivisionError):
        divide(10, 0)

def test_custom_exception():
    """Prueba excepción personalizada con mensaje."""
    with pytest.raises(ValueError, match="entrada inválida"):
        validate_input("invalid")
```

## Pruebas con tmp_path

```python
def test_with_tmp_path(tmp_path):
    """Prueba usando el fixture de ruta temporal de pytest."""
    test_file = tmp_path / "test.txt"
    test_file.write_text("hello world")

    result = process_file(str(test_file))
    assert result == "hello world"
    # tmp_path se limpia automáticamente
```

## Organización de Pruebas

### Estructura de Directorio

```
tests/
├── conftest.py                 # Fixtures compartidos
├── __init__.py
├── unit/                       # Pruebas unitarias
│   ├── __init__.py
│   ├── test_models.py
│   ├── test_utils.py
│   └── test_services.py
├── integration/                # Pruebas de integración
│   ├── __init__.py
│   ├── test_api.py
│   └── test_database.py
└── e2e/                        # Pruebas end-to-end
    ├── __init__.py
    └── test_user_flow.py
```

### Clases de Prueba

```python
class TestUserService:
    """Agrupa pruebas relacionadas en una clase."""

    @pytest.fixture(autouse=True)
    def setup(self):
        """Setup se ejecuta antes de cada prueba en esta clase."""
        self.service = UserService()

    def test_create_user(self):
        """Prueba creación de usuario."""
        user = self.service.create_user("Alice")
        assert user.name == "Alice"

    def test_delete_user(self):
        """Prueba eliminación de usuario."""
        user = User(id=1, name="Bob")
        self.service.delete_user(user)
        assert not self.service.user_exists(1)
```

## Buenas Prácticas

### HACER

- **Seguir TDD**: Escribir pruebas antes que el código (rojo-verde-refactorizar)
- **Probar una sola cosa**: Cada prueba debe verificar un único comportamiento
- **Usar nombres descriptivos**: `test_user_login_with_invalid_credentials_fails`
- **Usar fixtures**: Eliminar duplicación con fixtures
- **Mockear dependencias externas**: No depender de servicios externos
- **Probar casos borde**: Entradas vacías, valores None, condiciones de frontera
- **Apuntar a 80%+ de cobertura**: Enfocarse en rutas críticas
- **Mantener pruebas rápidas**: Usar markers para separar pruebas lentas

### NO HACER

- **No probar implementación**: Probar comportamiento, no internos
- **No usar condicionales complejos en pruebas**: Mantener pruebas simples
- **No ignorar fallos de prueba**: Todas las pruebas deben pasar
- **No probar código de terceros**: Confiar en que las bibliotecas funcionan
- **No compartir estado entre pruebas**: Las pruebas deben ser independientes

## Configuración de pytest

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
    slow: marca pruebas como lentas
    integration: marca pruebas como de integración
    unit: marca pruebas como unitarias
```

## Ejecutar Pruebas

```bash
# Ejecutar todas las pruebas
pytest

# Ejecutar archivo específico
pytest tests/test_utils.py

# Ejecutar prueba específica
pytest tests/test_utils.py::test_function

# Ejecutar con salida detallada
pytest -v

# Ejecutar con cobertura
pytest --cov=mypackage --cov-report=html

# Ejecutar solo pruebas rápidas
pytest -m "not slow"

# Ejecutar hasta el primer fallo
pytest -x

# Ejecutar últimas pruebas fallidas
pytest --lf

# Ejecutar pruebas con patrón
pytest -k "test_user"

# Ejecutar con depurador al fallar
pytest --pdb
```

**Recuerda**: Las pruebas también son código. Mantenlas limpias, legibles y mantenibles. Las buenas pruebas detectan bugs; las excelentes pruebas los previenen.
