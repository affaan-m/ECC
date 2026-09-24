---
name: rust-testing
description: Patrones de pruebas en Rust incluyendo pruebas unitarias, de integración, async, basadas en propiedades, mocking y cobertura. Sigue la metodología TDD.
origin: ECC
---

# Patrones de Pruebas Rust

Patrones completos de pruebas en Rust para escribir pruebas confiables y mantenibles siguiendo la metodología TDD.

## Cuándo Usar

- Escribir nuevas funciones, métodos o traits en Rust
- Agregar cobertura de pruebas a código existente
- Crear benchmarks para código con requisitos de rendimiento
- Implementar pruebas basadas en propiedades para validación de entrada
- Seguir el flujo de trabajo TDD en proyectos Rust

## Cómo Funciona

1. **Identificar el código objetivo** — Encontrar la función, trait o módulo a probar
2. **Escribir una prueba** — Usar `#[test]` en un módulo `#[cfg(test)]`, rstest para pruebas parametrizadas, o proptest para pruebas basadas en propiedades
3. **Mockear dependencias** — Usar mockall para aislar la unidad bajo prueba
4. **Ejecutar pruebas (ROJO)** — Verificar que la prueba falla con el error esperado
5. **Implementar (VERDE)** — Escribir el código mínimo para que pase
6. **Refactorizar** — Mejorar mientras se mantienen las pruebas en verde
7. **Verificar cobertura** — Usar cargo-llvm-cov, objetivo 80%+

## Flujo de Trabajo TDD en Rust

### El Ciclo ROJO-VERDE-REFACTORIZAR

```
ROJO        → Escribir primero una prueba que falle
VERDE       → Escribir el código mínimo para que pase
REFACTORIZAR → Mejorar el código manteniendo las pruebas en verde
REPETIR     → Continuar con el siguiente requisito
```

### TDD Paso a Paso en Rust

```rust
// ROJO: Escribir la prueba primero, usar todo!() como placeholder
pub fn add(a: i32, b: i32) -> i32 { todo!() }

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn test_add() { assert_eq!(add(2, 3), 5); }
}
// cargo test → panic en 'not yet implemented'
```

```rust
// VERDE: Reemplazar todo!() con implementación mínima
pub fn add(a: i32, b: i32) -> i32 { a + b }
// cargo test → PASS, luego REFACTORIZAR manteniendo pruebas en verde
```

## Pruebas Unitarias

### Organización de Pruebas a Nivel de Módulo

```rust
// src/user.rs
pub struct User {
    pub name: String,
    pub email: String,
}

impl User {
    pub fn new(name: impl Into<String>, email: impl Into<String>) -> Result<Self, String> {
        let email = email.into();
        if !email.contains('@') {
            return Err(format!("invalid email: {email}"));
        }
        Ok(Self { name: name.into(), email })
    }

    pub fn display_name(&self) -> &str {
        &self.name
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn creates_user_with_valid_email() {
        let user = User::new("Alice", "alice@example.com").unwrap();
        assert_eq!(user.display_name(), "Alice");
        assert_eq!(user.email, "alice@example.com");
    }

    #[test]
    fn rejects_invalid_email() {
        let result = User::new("Bob", "not-an-email");
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("invalid email"));
    }
}
```

### Macros de Aserción

```rust
assert_eq!(2 + 2, 4);                                    // Igualdad
assert_ne!(2 + 2, 5);                                    // Desigualdad
assert!(vec![1, 2, 3].contains(&2));                     // Booleano
assert_eq!(value, 42, "expected 42 but got {value}");    // Mensaje personalizado
assert!((0.1_f64 + 0.2 - 0.3).abs() < f64::EPSILON);   // Comparación de flotantes
```

## Pruebas de Errores y Panics

### Probar Retornos de `Result`

```rust
#[test]
fn parse_returns_error_for_invalid_input() {
    let result = parse_config("}{invalid");
    assert!(result.is_err());

    // Verificar variante de error específica
    let err = result.unwrap_err();
    assert!(matches!(err, ConfigError::ParseError(_)));
}

#[test]
fn parse_succeeds_for_valid_input() -> Result<(), Box<dyn std::error::Error>> {
    let config = parse_config(r#"{"port": 8080}"#)?;
    assert_eq!(config.port, 8080);
    Ok(()) // La prueba falla si algún ? retorna Err
}
```

### Probar Panics

```rust
#[test]
#[should_panic]
fn panics_on_empty_input() {
    process(&[]);
}

#[test]
#[should_panic(expected = "index out of bounds")]
fn panics_with_specific_message() {
    let v: Vec<i32> = vec![];
    let _ = v[0];
}
```

## Pruebas de Integración

### Estructura de Archivos

```text
my_crate/
├── src/
│   └── lib.rs
├── tests/              # Pruebas de integración
│   ├── api_test.rs     # Cada archivo es un binario de prueba separado
│   ├── db_test.rs
│   └── common/         # Utilidades de prueba compartidas
│       └── mod.rs
```

### Escribir Pruebas de Integración

```rust
// tests/api_test.rs
use my_crate::{App, Config};

#[test]
fn full_request_lifecycle() {
    let config = Config::test_default();
    let app = App::new(config);

    let response = app.handle_request("/health");
    assert_eq!(response.status, 200);
    assert_eq!(response.body, "OK");
}
```

## Pruebas Async

### Con Tokio

```rust
#[tokio::test]
async fn fetches_data_successfully() {
    let client = TestClient::new().await;
    let result = client.get("/data").await;
    assert!(result.is_ok());
    assert_eq!(result.unwrap().items.len(), 3);
}

#[tokio::test]
async fn handles_timeout() {
    use std::time::Duration;
    let result = tokio::time::timeout(
        Duration::from_millis(100),
        slow_operation(),
    ).await;

    assert!(result.is_err(), "should have timed out");
}
```

## Patrones de Organización de Pruebas

### Pruebas Parametrizadas con `rstest`

```rust
use rstest::{rstest, fixture};

#[rstest]
#[case("hello", 5)]
#[case("", 0)]
#[case("rust", 4)]
fn test_string_length(#[case] input: &str, #[case] expected: usize) {
    assert_eq!(input.len(), expected);
}

// Fixtures
#[fixture]
fn test_db() -> TestDb {
    TestDb::new_in_memory()
}

#[rstest]
fn test_insert(test_db: TestDb) {
    test_db.insert("key", "value");
    assert_eq!(test_db.get("key"), Some("value".into()));
}
```

### Helpers de Prueba

```rust
#[cfg(test)]
mod tests {
    use super::*;

    /// Crea un usuario de prueba con valores predeterminados sensatos.
    fn make_user(name: &str) -> User {
        User::new(name, &format!("{name}@test.com")).unwrap()
    }

    #[test]
    fn user_display() {
        let user = make_user("alice");
        assert_eq!(user.display_name(), "alice");
    }
}
```

## Pruebas Basadas en Propiedades con `proptest`

### Pruebas de Propiedades Básicas

```rust
use proptest::prelude::*;

proptest! {
    #[test]
    fn encode_decode_roundtrip(input in ".*") {
        let encoded = encode(&input);
        let decoded = decode(&encoded).unwrap();
        assert_eq!(input, decoded);
    }

    #[test]
    fn sort_preserves_length(mut vec in prop::collection::vec(any::<i32>(), 0..100)) {
        let original_len = vec.len();
        vec.sort();
        assert_eq!(vec.len(), original_len);
    }

    #[test]
    fn sort_produces_ordered_output(mut vec in prop::collection::vec(any::<i32>(), 0..100)) {
        vec.sort();
        for window in vec.windows(2) {
            assert!(window[0] <= window[1]);
        }
    }
}
```

### Estrategias Personalizadas

```rust
use proptest::prelude::*;

fn valid_email() -> impl Strategy<Value = String> {
    ("[a-z]{1,10}", "[a-z]{1,5}")
        .prop_map(|(user, domain)| format!("{user}@{domain}.com"))
}

proptest! {
    #[test]
    fn accepts_valid_emails(email in valid_email()) {
        assert!(User::new("Test", &email).is_ok());
    }
}
```

## Mocking con `mockall`

### Mocking Basado en Traits

```rust
use mockall::{automock, predicate::eq};

#[automock]
trait UserRepository {
    fn find_by_id(&self, id: u64) -> Option<User>;
    fn save(&self, user: &User) -> Result<(), StorageError>;
}

#[test]
fn service_returns_user_when_found() {
    let mut mock = MockUserRepository::new();
    mock.expect_find_by_id()
        .with(eq(42))
        .times(1)
        .returning(|_| Some(User { id: 42, name: "Alice".into() }));

    let service = UserService::new(Box::new(mock));
    let user = service.get_user(42).unwrap();
    assert_eq!(user.name, "Alice");
}

#[test]
fn service_returns_none_when_not_found() {
    let mut mock = MockUserRepository::new();
    mock.expect_find_by_id()
        .returning(|_| None);

    let service = UserService::new(Box::new(mock));
    assert!(service.get_user(99).is_none());
}
```

## Pruebas de Documentación

### Documentación Ejecutable

```rust
/// Suma dos números.
///
/// # Examples
///
/// ```
/// use my_crate::add;
///
/// assert_eq!(add(2, 3), 5);
/// assert_eq!(add(-1, 1), 0);
/// ```
pub fn add(a: i32, b: i32) -> i32 {
    a + b
}

/// Parsea una cadena de configuración.
///
/// # Errors
///
/// Retorna `Err` si la entrada no es TOML válido.
///
/// ```no_run
/// use my_crate::parse_config;
///
/// let config = parse_config(r#"port = 8080"#).unwrap();
/// assert_eq!(config.port, 8080);
/// ```
///
/// ```no_run
/// use my_crate::parse_config;
///
/// assert!(parse_config("}{invalid").is_err());
/// ```
pub fn parse_config(input: &str) -> Result<Config, ParseError> {
    todo!()
}
```

## Benchmarks con Criterion

```toml
# Cargo.toml
[dev-dependencies]
criterion = { version = "0.5", features = ["html_reports"] }

[[bench]]
name = "benchmark"
harness = false
```

```rust
// benches/benchmark.rs
use criterion::{black_box, criterion_group, criterion_main, Criterion};

fn fibonacci(n: u64) -> u64 {
    match n {
        0 | 1 => n,
        _ => fibonacci(n - 1) + fibonacci(n - 2),
    }
}

fn bench_fibonacci(c: &mut Criterion) {
    c.bench_function("fib 20", |b| b.iter(|| fibonacci(black_box(20))));
}

criterion_group!(benches, bench_fibonacci);
criterion_main!(benches);
```

## Cobertura de Pruebas

### Ejecutar Cobertura

```bash
# Instalar: cargo install cargo-llvm-cov (o usar taiki-e/install-action en CI)
cargo llvm-cov                    # Resumen
cargo llvm-cov --html             # Reporte HTML
cargo llvm-cov --lcov > lcov.info # Formato LCOV para CI
cargo llvm-cov --fail-under-lines 80  # Fallar si está por debajo del umbral
```

### Objetivos de Cobertura

| Tipo de Código | Objetivo |
|----------------|----------|
| Lógica de negocio crítica | 100% |
| API pública | 90%+ |
| Código general | 80%+ |
| Bindings generados / FFI | Excluir |

## Comandos de Prueba

```bash
cargo test                        # Ejecutar todas las pruebas
cargo test -- --nocapture         # Mostrar salida de println
cargo test test_name              # Ejecutar pruebas que coincidan con el patrón
cargo test --lib                  # Solo pruebas unitarias
cargo test --test api_test        # Solo pruebas de integración
cargo test --doc                  # Solo pruebas de documentación
cargo test --no-fail-fast         # No detener al primer fallo
cargo test -- --ignored           # Ejecutar pruebas ignoradas
```

## Buenas Prácticas

**HACER:**
- Escribir pruebas PRIMERO (TDD)
- Usar módulos `#[cfg(test)]` para pruebas unitarias
- Probar comportamiento, no implementación
- Usar nombres de prueba descriptivos que expliquen el escenario
- Preferir `assert_eq!` sobre `assert!` para mejores mensajes de error
- Usar `?` en pruebas que retornan `Result` para salida de errores más limpia
- Mantener las pruebas independientes — sin estado mutable compartido

**NO HACER:**
- Usar `#[should_panic]` cuando se puede probar `Result::is_err()`
- Mockear todo — preferir pruebas de integración cuando sea factible
- Ignorar pruebas inestables — corregirlas o ponerlas en cuarentena
- Usar `sleep()` en pruebas — usar canales, barreras o `tokio::time::pause()`
- Omitir las pruebas de rutas de error

## Integración con CI

```yaml
# GitHub Actions
test:
  runs-on: ubuntu-latest
  steps:
    - uses: actions/checkout@v4
    - uses: dtolnay/rust-toolchain@stable
      with:
        components: clippy, rustfmt

    - name: Check formatting
      run: cargo fmt --check

    - name: Clippy
      run: cargo clippy -- -D warnings

    - name: Run tests
      run: cargo test

    - uses: taiki-e/install-action@cargo-llvm-cov

    - name: Coverage
      run: cargo llvm-cov --fail-under-lines 80
```

**Recuerda**: Las pruebas son documentación. Muestran cómo debe usarse tu código. Escríbelas con claridad y mantenlas actualizadas.
