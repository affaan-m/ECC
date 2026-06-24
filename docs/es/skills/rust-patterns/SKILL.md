---
name: rust-patterns
description: Patrones idiomáticos de Rust, ownership, manejo de errores, traits, concurrencia y buenas prácticas para construir aplicaciones seguras y eficientes.
origin: ECC
---

# Patrones de Desarrollo Rust

Patrones idiomáticos y buenas prácticas de Rust para construir aplicaciones seguras, eficientes y mantenibles.

## Cuándo Usar

- Escribir código Rust nuevo
- Revisar código Rust
- Refactorizar código Rust existente
- Diseñar la estructura de crates y la organización de módulos

## Cómo Funciona

Este skill refuerza las convenciones idiomáticas de Rust en seis áreas clave: ownership y borrowing para prevenir data races en tiempo de compilación, propagación de errores con `Result`/`?` usando `thiserror` para bibliotecas y `anyhow` para aplicaciones, enums y pattern matching exhaustivo para hacer imposibles los estados inválidos, traits y genéricos para abstracciones de costo cero, concurrencia segura con `Arc<Mutex<T>>`, canales y async/await, y superficies `pub` mínimas organizadas por dominio.

## Principios Fundamentales

### 1. Ownership y Borrowing

El sistema de ownership de Rust previene data races y bugs de memoria en tiempo de compilación.

```rust
// Bien: Pasar referencias cuando no se necesita el ownership
fn process(data: &[u8]) -> usize {
    data.len()
}

// Bien: Tomar ownership solo cuando se necesita almacenar o consumir
fn store(data: Vec<u8>) -> Record {
    Record { payload: data }
}

// Mal: Clonar innecesariamente para evitar el borrow checker
fn process_bad(data: &Vec<u8>) -> usize {
    let cloned = data.clone(); // Costoso — solo tomar prestado
    cloned.len()
}
```

### Usar `Cow` para Ownership Flexible

```rust
use std::borrow::Cow;

fn normalize(input: &str) -> Cow<'_, str> {
    if input.contains(' ') {
        Cow::Owned(input.replace(' ', "_"))
    } else {
        Cow::Borrowed(input) // Costo cero cuando no se necesita mutación
    }
}
```

## Manejo de Errores

### Usar `Result` y `?` — Nunca `unwrap()` en Producción

```rust
// Bien: Propagar errores con contexto
use anyhow::{Context, Result};

fn load_config(path: &str) -> Result<Config> {
    let content = std::fs::read_to_string(path)
        .with_context(|| format!("failed to read config from {path}"))?;
    let config: Config = toml::from_str(&content)
        .with_context(|| format!("failed to parse config from {path}"))?;
    Ok(config)
}

// Mal: Causa panic en caso de error
fn load_config_bad(path: &str) -> Config {
    let content = std::fs::read_to_string(path).unwrap(); // ¡Panic!
    toml::from_str(&content).unwrap()
}
```

### Errores de Biblioteca con `thiserror`, Errores de Aplicación con `anyhow`

```rust
// Código de biblioteca: errores estructurados y tipados
use thiserror::Error;

#[derive(Debug, Error)]
pub enum StorageError {
    #[error("record not found: {id}")]
    NotFound { id: String },
    #[error("connection failed")]
    Connection(#[from] std::io::Error),
    #[error("invalid data: {0}")]
    InvalidData(String),
}

// Código de aplicación: manejo de errores flexible
use anyhow::{bail, Result};

fn run() -> Result<()> {
    let config = load_config("app.toml")?;
    if config.workers == 0 {
        bail!("worker count must be > 0");
    }
    Ok(())
}
```

### Combinadores de `Option` en Lugar de Matching Anidado

```rust
// Bien: Cadena de combinadores
fn find_user_email(users: &[User], id: u64) -> Option<String> {
    users.iter()
        .find(|u| u.id == id)
        .map(|u| u.email.clone())
}

// Mal: Matching profundamente anidado
fn find_user_email_bad(users: &[User], id: u64) -> Option<String> {
    match users.iter().find(|u| u.id == id) {
        Some(user) => match &user.email {
            email => Some(email.clone()),
        },
        None => None,
    }
}
```

## Enums y Pattern Matching

### Modelar Estados con Enums

```rust
// Bien: Los estados imposibles son irrepresentables
enum ConnectionState {
    Disconnected,
    Connecting { attempt: u32 },
    Connected { session_id: String },
    Failed { reason: String, retries: u32 },
}

fn handle(state: &ConnectionState) {
    match state {
        ConnectionState::Disconnected => connect(),
        ConnectionState::Connecting { attempt } if *attempt > 3 => abort(),
        ConnectionState::Connecting { .. } => wait(),
        ConnectionState::Connected { session_id } => use_session(session_id),
        ConnectionState::Failed { retries, .. } if *retries < 5 => retry(),
        ConnectionState::Failed { reason, .. } => log_failure(reason),
    }
}
```

### Matching Exhaustivo — Sin Comodín en Lógica de Negocio

```rust
// Bien: Manejar cada variante explícitamente
match command {
    Command::Start => start_service(),
    Command::Stop => stop_service(),
    Command::Restart => restart_service(),
    // Agregar una nueva variante fuerza su manejo aquí
}

// Mal: El comodín oculta nuevas variantes
match command {
    Command::Start => start_service(),
    _ => {} // Ignora silenciosamente Stop, Restart y variantes futuras
}
```

## Traits y Genéricos

### Aceptar Genéricos, Retornar Tipos Concretos

```rust
// Bien: Entrada genérica, salida concreta
fn read_all(reader: &mut impl Read) -> std::io::Result<Vec<u8>> {
    let mut buf = Vec::new();
    reader.read_to_end(&mut buf)?;
    Ok(buf)
}

// Bien: Bounds de traits para múltiples restricciones
fn process<T: Display + Send + 'static>(item: T) -> String {
    format!("processed: {item}")
}
```

### Trait Objects para Dispatch Dinámico

```rust
// Usar cuando se necesitan colecciones heterogéneas o sistemas de plugins
trait Handler: Send + Sync {
    fn handle(&self, request: &Request) -> Response;
}

struct Router {
    handlers: Vec<Box<dyn Handler>>,
}

// Usar genéricos cuando se necesita rendimiento (monomorfización)
fn fast_process<H: Handler>(handler: &H, request: &Request) -> Response {
    handler.handle(request)
}
```

### Patrón Newtype para Seguridad de Tipos

```rust
// Bien: Tipos distintos previenen mezclar argumentos
struct UserId(u64);
struct OrderId(u64);

fn get_order(user: UserId, order: OrderId) -> Result<Order> {
    // No se pueden intercambiar accidentalmente user ID y order ID
    todo!()
}

// Mal: Fácil intercambiar argumentos
fn get_order_bad(user_id: u64, order_id: u64) -> Result<Order> {
    todo!()
}
```

## Structs y Modelado de Datos

### Patrón Builder para Construcción Compleja

```rust
struct ServerConfig {
    host: String,
    port: u16,
    max_connections: usize,
}

impl ServerConfig {
    fn builder(host: impl Into<String>, port: u16) -> ServerConfigBuilder {
        ServerConfigBuilder { host: host.into(), port, max_connections: 100 }
    }
}

struct ServerConfigBuilder { host: String, port: u16, max_connections: usize }

impl ServerConfigBuilder {
    fn max_connections(mut self, n: usize) -> Self { self.max_connections = n; self }
    fn build(self) -> ServerConfig {
        ServerConfig { host: self.host, port: self.port, max_connections: self.max_connections }
    }
}

// Uso: ServerConfig::builder("localhost", 8080).max_connections(200).build()
```

## Iteradores y Closures

### Preferir Cadenas de Iteradores sobre Bucles Manuales

```rust
// Bien: Declarativo, lazy, composable
let active_emails: Vec<String> = users.iter()
    .filter(|u| u.is_active)
    .map(|u| u.email.clone())
    .collect();

// Mal: Acumulación imperativa
let mut active_emails = Vec::new();
for user in &users {
    if user.is_active {
        active_emails.push(user.email.clone());
    }
}
```

### Usar `collect()` con Anotación de Tipo

```rust
// Recolectar en diferentes tipos
let names: Vec<_> = items.iter().map(|i| &i.name).collect();
let lookup: HashMap<_, _> = items.iter().map(|i| (i.id, i)).collect();
let combined: String = parts.iter().copied().collect();

// Recolectar Results — cortocircuita al primer error
let parsed: Result<Vec<i32>, _> = strings.iter().map(|s| s.parse()).collect();
```

## Concurrencia

### `Arc<Mutex<T>>` para Estado Mutable Compartido

```rust
use std::sync::{Arc, Mutex};

let counter = Arc::new(Mutex::new(0));
let handles: Vec<_> = (0..10).map(|_| {
    let counter = Arc::clone(&counter);
    std::thread::spawn(move || {
        let mut num = counter.lock().expect("mutex poisoned");
        *num += 1;
    })
}).collect();

for handle in handles {
    handle.join().expect("worker thread panicked");
}
```

### Canales para Paso de Mensajes

```rust
use std::sync::mpsc;

let (tx, rx) = mpsc::sync_channel(16); // Canal acotado con backpressure

for i in 0..5 {
    let tx = tx.clone();
    std::thread::spawn(move || {
        tx.send(format!("message {i}")).expect("receiver disconnected");
    });
}
drop(tx); // Cerrar el sender para que el iterador rx termine

for msg in rx {
    println!("{msg}");
}
```

### Async con Tokio

```rust
use tokio::time::Duration;

async fn fetch_with_timeout(url: &str) -> Result<String> {
    let response = tokio::time::timeout(
        Duration::from_secs(5),
        reqwest::get(url),
    )
    .await
    .context("request timed out")?
    .context("request failed")?;

    response.text().await.context("failed to read body")
}

// Lanzar tareas concurrentes
async fn fetch_all(urls: Vec<String>) -> Vec<Result<String>> {
    let handles: Vec<_> = urls.into_iter()
        .map(|url| tokio::spawn(async move {
            fetch_with_timeout(&url).await
        }))
        .collect();

    let mut results = Vec::with_capacity(handles.len());
    for handle in handles {
        results.push(handle.await.unwrap_or_else(|e| panic!("spawned task panicked: {e}")));
    }
    results
}
```

## Código Unsafe

### Cuándo Unsafe Es Aceptable

```rust
// Aceptable: Frontera FFI con invariantes documentados (Rust 2024+)
/// # Safety
/// `ptr` must be a valid, aligned pointer to an initialized `Widget`.
unsafe fn widget_from_raw<'a>(ptr: *const Widget) -> &'a Widget {
    // SAFETY: el llamador garantiza que ptr es válido y alineado
    unsafe { &*ptr }
}

// Aceptable: Ruta crítica de rendimiento con prueba de corrección
// SAFETY: index is always < len due to the loop bound
unsafe { slice.get_unchecked(index) }
```

### Cuándo Unsafe NO Es Aceptable

```rust
// Mal: Usar unsafe para evadir el borrow checker
// Mal: Usar unsafe por conveniencia
// Mal: Usar unsafe sin un comentario Safety
// Mal: Hacer transmute entre tipos no relacionados
```

## Sistema de Módulos y Estructura de Crates

### Organizar por Dominio, No por Tipo

```text
my_app/
├── src/
│   ├── main.rs
│   ├── lib.rs
│   ├── auth/          # Módulo de dominio
│   │   ├── mod.rs
│   │   ├── token.rs
│   │   └── middleware.rs
│   ├── orders/        # Módulo de dominio
│   │   ├── mod.rs
│   │   ├── model.rs
│   │   └── service.rs
│   └── db/            # Infraestructura
│       ├── mod.rs
│       └── pool.rs
├── tests/             # Pruebas de integración
├── benches/           # Benchmarks
└── Cargo.toml
```

### Visibilidad — Exponer el Mínimo

```rust
// Bien: pub(crate) para compartir internamente
pub(crate) fn validate_input(input: &str) -> bool {
    !input.is_empty()
}

// Bien: Re-exportar la API pública desde lib.rs
pub mod auth;
pub use auth::AuthMiddleware;

// Mal: Hacer todo pub
pub fn internal_helper() {} // Debería ser pub(crate) o privado
```

## Integración con Herramientas

### Comandos Esenciales

```bash
# Construir y verificar
cargo build
cargo check              # Verificación de tipos rápida sin codegen
cargo clippy             # Lints y sugerencias
cargo fmt                # Formatear código

# Pruebas
cargo test
cargo test -- --nocapture    # Mostrar salida de println
cargo test --lib             # Solo pruebas unitarias
cargo test --test integration # Solo pruebas de integración

# Dependencias
cargo audit              # Auditoría de seguridad
cargo tree               # Árbol de dependencias
cargo update             # Actualizar dependencias

# Rendimiento
cargo bench              # Ejecutar benchmarks
```

## Referencia Rápida: Modismos Rust

| Modismo | Descripción |
|---------|-------------|
| Tomar prestado, no clonar | Pasar `&T` en lugar de clonar a menos que se necesite el ownership |
| Hacer estados ilegales irrepresentables | Usar enums para modelar solo estados válidos |
| `?` en lugar de `unwrap()` | Propagar errores, nunca causar panic en biblioteca/producción |
| Parsear, no validar | Convertir datos no estructurados a structs tipados en la frontera |
| Newtype para seguridad de tipos | Envolver primitivos en newtypes para prevenir intercambio de argumentos |
| Preferir iteradores sobre bucles | Las cadenas declarativas son más claras y frecuentemente más rápidas |
| `#[must_use]` en Results | Asegurar que los llamadores manejen los valores de retorno |
| `Cow` para ownership flexible | Evitar asignaciones cuando el borrowing es suficiente |
| Matching exhaustivo | Sin comodín `_` para enums críticos de negocio |
| Superficie `pub` mínima | Usar `pub(crate)` para APIs internas |

## Anti-Patrones a Evitar

```rust
// Mal: .unwrap() en código de producción
let value = map.get("key").unwrap();

// Mal: .clone() para satisfacer el borrow checker sin entender por qué
let data = expensive_data.clone();
process(&original, &data);

// Mal: Usar String cuando &str es suficiente
fn greet(name: String) { /* debería ser &str */ }

// Mal: Box<dyn Error> en bibliotecas (usar thiserror en su lugar)
fn parse(input: &str) -> Result<Data, Box<dyn std::error::Error>> { todo!() }

// Mal: Ignorar advertencias must_use
let _ = validate(input); // Descartando silenciosamente un Result

// Mal: Bloquear en contexto async
async fn bad_async() {
    std::thread::sleep(Duration::from_secs(1)); // ¡Bloquea el executor!
    // Usar: tokio::time::sleep(Duration::from_secs(1)).await;
}
```

**Recuerda**: Si compila, probablemente es correcto — pero solo si evitas `unwrap()`, minimizas `unsafe` y dejas que el sistema de tipos trabaje para ti.
