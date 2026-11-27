---
name: rust-patterns
description: Idiomatic Rust patterns, ownership, error handling, traits, concurrency, and best practices for building safe, performant applications.
origin: ECC
---

# Rust Geliştirme Desenleri

Güvenli, performanslı ve bakım yapılabilir uygulamalar oluşturmak için idiomatic Rust desenleri ve en iyi uygulamalar.

## Ne Zaman Kullanılır

- Yeni Rust kodu yazma
- Rust kodunu inceleme
- Mevcut Rust kodunu refactor etme
- Crate yapısı ve modül düzenini tasarlama

## Nasıl Çalışır

Bu skill altı ana alanda idiomatic Rust kurallarını zorlar: derleme zamanında veri yarışlarını önlemek için ownership ve borrowing, kütüphaneler için `thiserror` ve uygulamalar için `anyhow` ile `Result`/`?` hata yayılımı, yasadışı durumları temsil edilemez yapmak için enum'lar ve kapsamlı desen eşleştirme, sıfır maliyetli soyutlama için trait'ler ve generic'ler, `Arc<Mutex<T>>`, channel'lar ve async/await ile güvenli eşzamanlılık ve domain'e göre düzenlenmiş minimal `pub` yüzeyleri.

## Temel İlkeler

### 1. Ownership ve Borrowing

Rust'ın ownership sistemi derleme zamanında veri yarışlarını ve bellek hatalarını önler.

```rust
// İyi: Ownership'e ihtiyacınız olmadığında referansları geçirin
fn process(data: &[u8]) -> usize {
    data.len()
}

// İyi: Saklamak veya tüketmek için ownership alın
fn store(data: Vec<u8>) -> Record {
    Record { payload: data }
}

// Kötü: Borrow checker'dan kaçınmak için gereksiz clone
fn process_bad(data: &Vec<u8>) -> usize {
    let cloned = data.clone(); // İsraf — sadece borrow alın
    cloned.len()
}
```

### Esnek Ownership için `Cow` Kullanın

```rust
use std::borrow::Cow;

fn normalize(input: &str) -> Cow<'_, str> {
    if input.contains(' ') {
        Cow::Owned(input.replace(' ', "_"))
    } else {
        Cow::Borrowed(input) // Mutasyon gerekmediğinde sıfır maliyet
    }
}
```

## Hata İşleme

### `Result` ve `?` Kullanın — Production'da Asla `unwrap()` Kullanmayın

```rust
// İyi: Hataları context ile yayın
use anyhow::{Context, Result};

fn load_config(path: &str) -> Result<Config> {
    let content = std::fs::read_to_string(path)
        .with_context(|| format!("failed to read config from {path}"))?;
    let config: Config = toml::from_str(&content)
        .with_context(|| format!("failed to parse config from {path}"))?;
    Ok(config)
}

// Kötü: Hata durumunda panic
fn load_config_bad(path: &str) -> Config {
    let content = std::fs::read_to_string(path).unwrap(); // Panic!
    toml::from_str(&content).unwrap()
}
```

### Kütüphane Hataları için `thiserror`, Uygulama Hataları için `anyhow`

```rust
// Kütüphane kodu: yapılandırılmış, tiplendirilmiş hatalar
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

// Uygulama kodu: esnek hata işleme
use anyhow::{bail, Result};

fn run() -> Result<()> {
    let config = load_config("app.toml")?;
    if config.workers == 0 {
        bail!("worker count must be > 0");
    }
    Ok(())
}
```

### İç İçe Eşleştirme Yerine `Option` Combinator'ları

```rust
// İyi: Combinator zinciri
fn find_user_email(users: &[User], id: u64) -> Option<String> {
    users.iter()
        .find(|u| u.id == id)
        .map(|u| u.email.clone())
}

// Kötü: Derinlemesine iç içe eşleştirme
fn find_user_email_bad(users: &[User], id: u64) -> Option<String> {
    match users.iter().find(|u| u.id == id) {
        Some(user) => match &user.email {
            email => Some(email.clone()),
        },
        None => None,
    }
}
```

## Enum'lar ve Desen Eşleştirme

### Durumları Enum'lar Olarak Modelleyin

```rust
// İyi: İmkansız durumlar temsil edilemez
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

### Kapsamlı Eşleştirme — İş Mantığı için Catch-All Yok

```rust
// İyi: Her varyantı açıkça işle
match command {
    Command::Start => start_service(),
    Command::Stop => stop_service(),
    Command::Restart => restart_service(),
    // Yeni bir varyant eklemek burada işlemeyi zorlar
}

// Kötü: Wildcard yeni varyantları gizler
match command {
    Command::Start => start_service(),
    _ => {} // Stop, Restart ve gelecek varyantları sessizce yok sayar
}
```

## Trait'ler ve Generic'ler

### Generic Girişleri Kabul Et, Somut Türleri Döndür

```rust
// İyi: Generic girdi, somut çıktı
fn read_all(reader: &mut impl Read) -> std::io::Result<Vec<u8>> {
    let mut buf = Vec::new();
    reader.read_to_end(&mut buf)?;
    Ok(buf)
}

// İyi: Birden fazla kısıtlama için trait bound'ları
fn process<T: Display + Send + 'static>(item: T) -> String {
    format!("processed: {item}")
}
```

### Dinamik Dispatch için Trait Object'leri

```rust
// Heterojen koleksiyonlara veya plugin sistemlerine ihtiyacınız olduğunda kullanın
trait Handler: Send + Sync {
    fn handle(&self, request: &Request) -> Response;
}

struct Router {
    handlers: Vec<Box<dyn Handler>>,
}

// Performansa ihtiyacınız olduğunda generic'leri kullanın (monomorfizasyon)
fn fast_process<H: Handler>(handler: &H, request: &Request) -> Response {
    handler.handle(request)
}
```

### Tip Güvenliği için Newtype Deseni

```rust
// İyi: Farklı tipler argümanları karıştırmayı önler
struct UserId(u64);
struct OrderId(u64);

fn get_order(user: UserId, order: OrderId) -> Result<Order> {
    // User ve order ID'lerini yanlışlıkla değiştiremezsiniz
    todo!()
}

// Kötü: Argümanları değiştirmek kolay
fn get_order_bad(user_id: u64, order_id: u64) -> Result<Order> {
    todo!()
}
```

## Struct'lar ve Veri Modelleme

### Karmaşık Yapılandırma için Builder Deseni

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

// Kullanım: ServerConfig::builder("localhost", 8080).max_connections(200).build()
```

## Iterator'lar ve Closure'lar

### Manuel Döngüler Yerine Iterator Zincirlerini Tercih Edin

```rust
// İyi: Deklaratif, lazy, birleştirilebilir
let active_emails: Vec<String> = users.iter()
    .filter(|u| u.is_active)
    .map(|u| u.email.clone())
    .collect();

// Kötü: İmperatif biriktirme
let mut active_emails = Vec::new();
for user in &users {
    if user.is_active {
        active_emails.push(user.email.clone());
    }
}
```

### Tip Annotation ile `collect()` Kullanın

```rust
// Farklı tiplere collect et
let names: Vec<_> = items.iter().map(|i| &i.name).collect();
let lookup: HashMap<_, _> = items.iter().map(|i| (i.id, i)).collect();
let combined: String = parts.iter().copied().collect();

// Result'ları collect et — ilk hatada kısa devre yapar
let parsed: Result<Vec<i32>, _> = strings.iter().map(|s| s.parse()).collect();
```

## Eşzamanlılık

### Paylaşılan Mutable State için `Arc<Mutex<T>>`

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

### Mesaj Geçişi için Channel'lar

```rust
use std::sync::mpsc;

let (tx, rx) = mpsc::sync_channel(16); // Backpressure ile bounded channel

for i in 0..5 {
    let tx = tx.clone();
    std::thread::spawn(move || {
        tx.send(format!("message {i}")).expect("receiver disconnected");
    });
}
drop(tx); // Sender'ı kapat böylece rx iterator sonlanır

for msg in rx {
    println!("{msg}");
}
```

### Tokio ile Async

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

// Eşzamanlı görevler spawn et
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

## Unsafe Kod

### Unsafe Ne Zaman Kabul Edilebilir

```rust
// Kabul edilebilir: Belgelenmiş değişmezlerle FFI sınırı (Rust 2024+)
/// # Safety
/// `ptr` başlatılmış bir `Widget`'a geçerli, hizalı bir pointer olmalıdır.
unsafe fn widget_from_raw<'a>(ptr: *const Widget) -> &'a Widget {
    // SAFETY: çağıran ptr'nin geçerli ve hizalı olduğunu garanti eder
    unsafe { &*ptr }
}

// Kabul edilebilir: Doğruluk kanıtı ile performans-kritik yol
// SAFETY: döngü sınırı nedeniyle index her zaman < len
unsafe { slice.get_unchecked(index) }
```

### Unsafe Ne Zaman Kabul EDİLEMEZ

```rust
// Kötü: Borrow checker'ı atlamak için unsafe kullanma
// Kötü: Kolaylık için unsafe kullanma
// Kötü: Safety yorumu olmadan unsafe kullanma
// Kötü: İlgisiz tipler arasında transmute etme
```

## Modül Sistemi ve Crate Yapısı

### Tipe Göre Değil, Domain'e Göre Düzenle

```text
my_app/
├── src/
│   ├── main.rs
│   ├── lib.rs
│   ├── auth/          # Domain modülü
│   │   ├── mod.rs
│   │   ├── token.rs
│   │   └── middleware.rs
│   ├── orders/        # Domain modülü
│   │   ├── mod.rs
│   │   ├── model.rs
│   │   └── service.rs
│   └── db/            # Altyapı
│       ├── mod.rs
│       └── pool.rs
├── tests/             # Entegrasyon testleri
├── benches/           # Benchmark'lar
└── Cargo.toml
```

### Görünürlük — Minimal Şekilde Açığa Çıkarın

```rust
// İyi: Dahili paylaşım için pub(crate)
pub(crate) fn validate_input(input: &str) -> bool {
    !input.is_empty()
}

// İyi: lib.rs'den public API'yi yeniden export et
pub mod auth;
pub use auth::AuthMiddleware;

// Kötü: Her şeyi pub yapmak
pub fn internal_helper() {} // pub(crate) veya private olmalı
```

## Araç Entegrasyonu

### Temel Komutlar

```bash
# Build ve kontrol
cargo build
cargo check              # Codegen olmadan hızlı tip kontrolü
cargo clippy             # Lint'ler ve öneriler
cargo fmt                # Kodu formatla

# Test etme
cargo test
cargo test -- --nocapture    # println çıktısını göster
cargo test --lib             # Sadece unit testler
cargo test --test integration # Sadece entegrasyon testleri

# Bağımlılıklar
cargo audit              # Güvenlik denetimi
cargo tree               # Bağımlılık ağacı
cargo update             # Bağımlılıkları güncelle

# Performans
cargo bench              # Benchmark'ları çalıştır
```

## Hızlı Referans: Rust Deyimleri

| Deyim | Açıklama |
|-------|----------|
| Clone etme, borrow al | Ownership gerekmedikçe clone yerine `&T` geçir |
| Yasadışı durumları temsil edilemez yap | Sadece geçerli durumları modellemek için enum'ları kullan |
| `unwrap()` yerine `?` | Hataları yay, kütüphane/production kodunda asla panic |
| Validate etme, parse et | Sınırda yapılandırılmamış veriyi tiplendirilmiş struct'lara dönüştür |
| Tip güvenliği için newtype | Argüman değişimlerini önlemek için primitive'leri newtype'lara sar |
| Döngüler yerine iterator'ları tercih et | Deklaratif zincirler daha net ve genellikle daha hızlı |
| Result'larda `#[must_use]` | Çağıranların dönüş değerlerini işlemesini garanti et |
| Esnek ownership için `Cow` | Borrow yeterli olduğunda allocation'lardan kaçın |
| Kapsamlı eşleştirme | İş-kritik enum'lar için wildcard `_` yok |
| Minimal `pub` yüzeyi | Dahili API'ler için `pub(crate)` kullan |

## Kaçınılacak Anti-Desenler

```rust
// Kötü: Production kodunda .unwrap()
let value = map.get("key").unwrap();

// Kötü: Nedenini anlamadan borrow checker'ı tatmin etmek için .clone()
let data = expensive_data.clone();
process(&original, &data);

// Kötü: &str yeterken String kullanma
fn greet(name: String) { /* &str olmalı */ }

// Kötü: Kütüphanelerde Box<dyn Error> (yerine thiserror kullanın)
fn parse(input: &str) -> Result<Data, Box<dyn std::error::Error>> { todo!() }

// Kötü: must_use uyarılarını yok sayma
let _ = validate(input); // Bir Result'ı sessizce atma

// Kötü: Async context'te bloke etme
async fn bad_async() {
    std::thread::sleep(Duration::from_secs(1)); // Executor'ı bloke eder!
    // Kullanın: tokio::time::sleep(Duration::from_secs(1)).await;
}
```

**Unutmayın**: Derlenir ise muhtemelen doğrudur — ama sadece `unwrap()` kullanmaktan kaçınır, `unsafe`'i minimize eder ve tip sisteminin sizin için çalışmasına izin verirseniz.
