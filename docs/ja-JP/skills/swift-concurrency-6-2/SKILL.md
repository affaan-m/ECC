---
name: swift-concurrency-6-2
description: Swift 6.2のアクセシブルな並行処理——デフォルトはシングルスレッド、@concurrentは明示的なバックグラウンドオフロードに使用し、分離の一貫性はMainActor型に使用する。
---

# Swift 6.2 アクセシブルな並行処理

コードがデフォルトでシングルスレッドで実行され、並行処理が明示的に導入されるSwift 6.2の並行処理モデルを採用したパターン。パフォーマンスを犠牲にすることなく、よくあるデータ競合エラーを排除する。

## 起動条件

* Swift 5.x または 6.0/6.1 プロジェクトを Swift 6.2 に移行する場合
* データ競合安全性のコンパイラエラーを解決する場合
* MainActorベースのアプリアーキテクチャを設計する場合
* CPU集約的な処理をバックグラウンドスレッドにオフロードする場合
* MainActor分離された型にプロトコル一貫性を実装する場合
* Xcode 26で「アクセシブルな並行処理」ビルド設定を有効にする場合

## 核心的な問題：暗黙のバックグラウンドオフロード

Swift 6.1以前では、非同期関数が暗黙的にバックグラウンドスレッドにオフロードされ、一見安全に見えるコードでもデータ競合エラーを引き起こすことがあった：

```swift
// Swift 6.1: ERROR
@MainActor
final class StickerModel {
    let photoProcessor = PhotoProcessor()

    func extractSticker(_ item: PhotosPickerItem) async throws -> Sticker? {
        guard let data = try await item.loadTransferable(type: Data.self) else { return nil }

        // Error: Sending 'self.photoProcessor' risks causing data races
        return await photoProcessor.extractSticker(data: data, with: item.itemIdentifier)
    }
}
```

Swift 6.2ではこの問題が修正された：非同期関数はデフォルトで呼び出し元と同じActorに留まる。

```swift
// Swift 6.2: OK — async stays on MainActor, no data race
@MainActor
final class StickerModel {
    let photoProcessor = PhotoProcessor()

    func extractSticker(_ item: PhotosPickerItem) async throws -> Sticker? {
        guard let data = try await item.loadTransferable(type: Data.self) else { return nil }
        return await photoProcessor.extractSticker(data: data, with: item.itemIdentifier)
    }
}
```

## コアパターン——分離の一貫性

MainActor型が非分離プロトコルに安全に準拠できるようになった：

```swift
protocol Exportable {
    func export()
}

// Swift 6.1: ERROR — crosses into main actor-isolated code
// Swift 6.2: OK with isolated conformance
extension StickerModel: @MainActor Exportable {
    func export() {
        photoProcessor.exportAsPNG()
    }
}
```

コンパイラはこの一貫性がMainActor上でのみ使用されることを保証する：

```swift
// OK — ImageExporter is also @MainActor
@MainActor
struct ImageExporter {
    var items: [any Exportable]

    mutating func add(_ item: StickerModel) {
        items.append(item)  // Safe: same actor isolation
    }
}

// ERROR — nonisolated context can't use MainActor conformance
nonisolated struct ImageExporter {
    var items: [any Exportable]

    mutating func add(_ item: StickerModel) {
        items.append(item)  // Error: Main actor-isolated conformance cannot be used here
    }
}
```

## コアパターン——グローバル変数と静的変数

MainActorを使用してグローバル/静的状態を保護する：

```swift
// Swift 6.1: ERROR — non-Sendable type may have shared mutable state
final class StickerLibrary {
    static let shared: StickerLibrary = .init()  // Error
}

// Fix: Annotate with @MainActor
@MainActor
final class StickerLibrary {
    static let shared: StickerLibrary = .init()  // OK
}
```

### MainActorデフォルト推論パターン

Swift 6.2ではMainActorをデフォルトで推論するパターンが導入された——手動の注釈なし：

```swift
// With MainActor default inference enabled:
final class StickerLibrary {
    static let shared: StickerLibrary = .init()  // Implicitly @MainActor
}

final class StickerModel {
    let photoProcessor: PhotoProcessor
    var selection: [PhotosPickerItem]  // Implicitly @MainActor
}

extension StickerModel: Exportable {  // Implicitly @MainActor conformance
    func export() {
        photoProcessor.exportAsPNG()
    }
}
```

このパターンはオプトインで、アプリ、スクリプト、その他の実行可能ターゲットに推奨される。

## コアパターン——@concurrent を使ったバックグラウンド処理

真の並列処理が必要な場合、`@concurrent` を使って明示的にオフロードする：

> **重要：** この例は「アクセシブルな並行処理」ビルド設定——SE-0466 (MainActorデフォルト分離) と SE-0461 (デフォルト非分離非送信) の有効化が必要。これらの設定を有効にすると、`extractSticker` は呼び出し元のActorに留まり、可変状態へのアクセスが安全になる。**これらの設定なしでは、このコードにはデータ競合がある**——コンパイラがフラグを立てる。

```swift
nonisolated final class PhotoProcessor {
    private var cachedStickers: [String: Sticker] = [:]

    func extractSticker(data: Data, with id: String) async -> Sticker {
        if let sticker = cachedStickers[id] {
            return sticker
        }

        let sticker = await Self.extractSubject(from: data)
        cachedStickers[id] = sticker
        return sticker
    }

    // Offload expensive work to concurrent thread pool
    @concurrent
    static func extractSubject(from data: Data) async -> Sticker { /* ... */ }
}

// Callers must await
let processor = PhotoProcessor()
processedPhotos[item.id] = await processor.extractSticker(data: data, with: item.id)
```

`@concurrent` を使用するには：

1. コンテナとなる型に `nonisolated` をマークする
2. 関数に `@concurrent` を追加する
3. 関数がまだ非同期でない場合は `async` を追加する
4. 呼び出し側に `await` を追加する

## 重要な設計上の決定

| 決定 | 理由 |
|----------|-----------|
| デフォルトシングルスレッド | 最も自然なコードはデータ競合がない。並行処理はオプトイン |
| 非同期関数は呼び出し元のActorに留まる | データ競合エラーを引き起こす暗黙のオフロードを排除 |
| 分離の一貫性 | MainActor型が安全でない回避策なしにプロトコルに準拠できる |
| `@concurrent` による明示的なオプトイン | バックグラウンド実行は偶発的なものではなく意図的なパフォーマンス選択 |
| MainActorデフォルト推論 | アプリターゲットの定型的な `@MainActor` 注釈を削減 |
| オプトイン採用 | 非破壊的な移行パス——機能を段階的に有効化 |

## 移行手順

1. **Xcodeで有効化**：ビルド設定のSwift Compiler > Concurrencyセクション
2. **SPMで有効化**：パッケージマニフェストで `SwiftSettings` APIを使用
3. **移行ツールを使用**：swift.org/migrationを通じて自動コード変更
4. **MainActorデフォルトから始める**：アプリターゲットの推論モードを有効化
5. **必要な場所に `@concurrent` を追加**：まずプロファイリングし、ホットパスをオフロード
6. **徹底的にテスト**：データ競合の問題はコンパイル時エラーになる

## ベストプラクティス

* **MainActorから始める** —— まずシングルスレッドコードを書き、後で最適化する
* **CPU集約的な処理のみに `@concurrent` を使用する** —— 画像処理、圧縮、複雑な計算
* **主にシングルスレッドのアプリターゲットのMainActor推論モードを有効にする**
* **オフロード前にプロファイリングする** —— Instrumentsで実際のボトルネックを見つける
* **グローバル変数を保護するために MainActor を使用する** —— グローバル/静的な可変状態にはActor分離が必要
* **`nonisolated` 回避策や `@Sendable` ラッパーではなく分離の一貫性を使用する**
* **段階的に移行する** —— ビルド設定で一度に1つの機能を有効化する

## 避けるべきアンチパターン

* すべての非同期関数に `@concurrent` を適用する（ほとんどはバックグラウンド実行を必要としない）
* 分離を理解せずにコンパイラエラーを抑制するために `nonisolated` を使用する
* Actorが同じ安全性を提供できる場面でレガシーの `DispatchQueue` パターンを保持する
* 並行処理関連のFoundation Modelsコードで `model.availability` チェックをスキップする
* コンパイラと戦う——データ競合をレポートしている場合、コードには本当の並行処理の問題がある
* すべての非同期コードがバックグラウンドで実行されると仮定する（Swift 6.2のデフォルト：呼び出し元のActorに留まる）

## 使用場面

* すべての新しいSwift 6.2+プロジェクト（「アクセシブルな並行処理」は推奨されるデフォルト設定）
* Swift 5.x または 6.0/6.1 の並行処理から既存のアプリを移行する場合
* Xcode 26の採用中にデータ競合安全性のコンパイラエラーを解決する場合
* MainActorを中心としたアプリアーキテクチャを構築する場合（ほとんどのUIアプリ）
* パフォーマンス最適化——特定の重い計算をバックグラウンドにオフロードする場合
