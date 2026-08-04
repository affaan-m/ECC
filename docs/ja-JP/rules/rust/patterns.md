---
paths:
  - "**/*.rs"
---
# Rust パターン

> このファイルは [common/patterns.md](../common/patterns.md) を Rust 固有のコンテンツで拡張します。

## トレイトを使ったリポジトリパターン

データアクセスをトレイトの背後にカプセル化する:

```rust
pub trait OrderRepository: Send + Sync {
    fn find_by_id(&self, id: u64) -> Result<Option<Order>, StorageError>;
    fn find_all(&self) -> Result<Vec<Order>, StorageError>;
    fn save(&self, order: &Order) -> Result<Order, StorageError>;
    fn delete(&self, id: u64) -> Result<(), StorageError>;
}
```

具象実装がストレージの詳細を処理する（Postgres、SQLite、テスト用インメモリ）。

## サービスレイヤー

サービス構造体にビジネスロジックを配置する。コンストラクタ経由で依存関係を注入する:

```rust
pub struct OrderService {
    repo: Box<dyn OrderRepository>,
    payment: Box<dyn PaymentGateway>,
}

impl OrderService {
    pub fn new(repo: Box<dyn OrderRepository>, payment: Box<dyn PaymentGateway>) -> Self {
        Self { repo, payment }
    }

    pub fn place_order(&self, request: CreateOrderRequest) -> anyhow::Result<OrderSummary> {
        let order = Order::from(request);
        self.payment.charge(order.total())?;
        let saved = self.repo.save(&order)?;
        Ok(OrderSummary::from(saved))
    }
}
```

## 型安全のための Newtype パターン

引数の取り違えを防ぐために個別のラッパー型を使用する:

```rust
struct UserId(u64);
struct OrderId(u64);

fn get_order(user: UserId, order: OrderId) -> anyhow::Result<Order> {
    // 呼び出し側で user と order の ID を誤って入れ替えることができない
    todo!()
}
```

## 列挙型ステートマシン

状態を列挙型としてモデリングする — 不正な状態を表現不可能にする:

```rust
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

ビジネス上重要な列挙型では常に網羅的にマッチする — ワイルドカード `_` は使わない。

## ビルダーパターン

多数のオプションパラメータを持つ構造体に使用する:

```rust
pub struct ServerConfig {
    host: String,
    port: u16,
    max_connections: usize,
}

impl ServerConfig {
    pub fn builder(host: impl Into<String>, port: u16) -> ServerConfigBuilder {
        ServerConfigBuilder {
            host: host.into(),
            port,
            max_connections: 100,
        }
    }
}

pub struct ServerConfigBuilder {
    host: String,
    port: u16,
    max_connections: usize,
}

impl ServerConfigBuilder {
    pub fn max_connections(mut self, n: usize) -> Self {
        self.max_connections = n;
        self
    }

    pub fn build(self) -> ServerConfig {
        ServerConfig {
            host: self.host,
            port: self.port,
            max_connections: self.max_connections,
        }
    }
}
```

## 拡張性制御のための Sealed トレイト

プライベートモジュールを使用してトレイトをシールし、外部からの実装を防止する:

```rust
mod private {
    pub trait Sealed {}
}

pub trait Format: private::Sealed {
    fn encode(&self, data: &[u8]) -> Vec<u8>;
}

pub struct Json;
impl private::Sealed for Json {}
impl Format for Json {
    fn encode(&self, data: &[u8]) -> Vec<u8> { todo!() }
}
```

## API レスポンスエンベロープ

ジェネリック列挙型を使用した一貫した API レスポンス:

```rust
#[derive(Debug, serde::Serialize)]
#[serde(tag = "status")]
pub enum ApiResponse<T: serde::Serialize> {
    #[serde(rename = "ok")]
    Ok { data: T },
    #[serde(rename = "error")]
    Error { message: String },
}
```

## 参考

所有権、トレイト、ジェネリクス、並行性、非同期を含む包括的なパターンについてはスキル: `rust-patterns` を参照。
