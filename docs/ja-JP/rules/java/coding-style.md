---
paths:
  - "**/*.java"
---
# Java コーディングスタイル

> このファイルは [common/coding-style.md](../common/coding-style.md) を Java 固有のコンテンツで拡張します。

## フォーマット

- **google-java-format** または **Checkstyle**（Google または Sun スタイル）で強制
- ファイルごとに1つの public トップレベル型
- 一貫したインデント: 2 または 4 スペース（プロジェクト標準に合わせる）
- メンバー順序: 定数、フィールド、コンストラクタ、public メソッド、protected、private

## 不変性

- 値型には `record` を優先（Java 16+）
- フィールドはデフォルトで `final` にする — 可変状態は必要な場合のみ使用
- public API からは防御的コピーを返す: `List.copyOf()`、`Map.copyOf()`、`Set.copyOf()`
- コピーオンライト: 既存のインスタンスを変更するのではなく、新しいインスタンスを返す

```java
// GOOD — 不変の値型
public record OrderSummary(Long id, String customerName, BigDecimal total) {}

// GOOD — final フィールド、setter なし
public class Order {
    private final Long id;
    private final List<LineItem> items;

    public List<LineItem> getItems() {
        return List.copyOf(items);
    }
}
```

## 命名

標準的な Java の慣例に従う:
- `PascalCase` — クラス、インターフェース、レコード、列挙型
- `camelCase` — メソッド、フィールド、パラメータ、ローカル変数
- `SCREAMING_SNAKE_CASE` — `static final` 定数
- パッケージ: すべて小文字、逆ドメイン（`com.example.app.service`）

## モダン Java 機能

明確さを向上させるモダンな言語機能を使用する:
- **レコード** — DTO と値型（Java 16+）
- **シールドクラス** — 閉じた型階層（Java 17+）
- **パターンマッチング** — `instanceof` で明示的キャスト不要（Java 16+）
- **テキストブロック** — 複数行文字列（SQL、JSON テンプレート）（Java 15+）
- **Switch 式** — アロー構文（Java 14+）
- **switch でのパターンマッチング** — 網羅的なシールド型処理（Java 21+）

```java
// パターンマッチング instanceof
if (shape instanceof Circle c) {
    return Math.PI * c.radius() * c.radius();
}

// シールド型階層
public sealed interface PaymentMethod permits CreditCard, BankTransfer, Wallet {}

// Switch 式
String label = switch (status) {
    case ACTIVE -> "Active";
    case SUSPENDED -> "Suspended";
    case CLOSED -> "Closed";
};
```

## Optional の使い方

- 結果がない可能性がある検索メソッドから `Optional<T>` を返す
- `map()`、`flatMap()`、`orElseThrow()` を使用する — `isPresent()` なしで `get()` を呼ばない
- `Optional` をフィールド型やメソッドパラメータとして使用しない

```java
// GOOD
return repository.findById(id)
    .map(ResponseDto::from)
    .orElseThrow(() -> new OrderNotFoundException(id));

// BAD — パラメータとしての Optional
public void process(Optional<String> name) {}
```

## エラーハンドリング

- ドメインエラーには非チェック例外を優先
- `RuntimeException` を継承するドメイン固有の例外を作成
- トップレベルハンドラ以外では広範な `catch (Exception e)` を避ける
- 例外メッセージにコンテキストを含める

```java
public class OrderNotFoundException extends RuntimeException {
    public OrderNotFoundException(Long id) {
        super("Order not found: id=" + id);
    }
}
```

## ストリーム

- 変換にはストリームを使用する; パイプラインは短く保つ（最大3〜4操作）
- 可読性がある場合はメソッド参照を優先: `.map(Order::getTotal)`
- ストリーム操作での副作用を避ける
- 複雑なロジックの場合、入り組んだストリームパイプラインよりもループを優先

## リファレンス

スキル: `java-coding-standards` で完全なコーディング規約と例を参照してください。
スキル: `jpa-patterns` で JPA/Hibernate エンティティ設計パターンを参照してください。
