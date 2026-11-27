---
name: swift-actor-persistence
description: Swiftでactorを使用してスレッドセーフなデータ永続化を実装する——メモリキャッシュとファイルバックドストレージを組み合わせ、設計によってデータ競合を排除する。
origin: ECC
---

# スレッドセーフな永続化のための Swift Actor

Swiftのactorを使用してスレッドセーフなデータ永続化レイヤーを構築するパターン。メモリキャッシュとファイルバックドストレージを組み合わせ、actorモデルを活用してコンパイル時にデータ競合を排除する。

## 起動条件

* Swift 5.5以降でデータ永続化レイヤーを構築する場合
* 共有可変状態へのスレッドセーフアクセスが必要な場合
* 手動の同期（ロック、DispatchQueue）を排除したい場合
* ローカルストレージを持つオフラインファースとアプリを構築する場合

## コアパターン

### Actorベースのリポジトリ

Actorモデルはシリアライズされたアクセスを保証する——コンパイラによって強制されるデータ競合なし。

```swift
public actor LocalRepository<T: Codable & Identifiable> where T.ID == String {
    private var cache: [String: T] = [:]
    private let fileURL: URL

    public init(directory: URL = .documentsDirectory, filename: String = "data.json") {
        self.fileURL = directory.appendingPathComponent(filename)
        // Synchronous load during init (actor isolation not yet active)
        self.cache = Self.loadSynchronously(from: fileURL)
    }

    // MARK: - Public API

    public func save(_ item: T) throws {
        let previous = cache[item.id]
        cache[item.id] = item
        do {
            try persistToFile()
        } catch {
            // ディスク書き込み失敗時はキャッシュをロールバックして整合性を維持
            cache[item.id] = previous
            throw error
        }
    }

    public func delete(_ id: String) throws {
        let previous = cache[id]
        cache[id] = nil
        do {
            try persistToFile()
        } catch {
            // ディスク書き込み失敗時はキャッシュをロールバックして整合性を維持
            cache[id] = previous
            throw error
        }
    }

    public func find(by id: String) -> T? {
        cache[id]
    }

    public func loadAll() -> [T] {
        Array(cache.values)
    }

    // MARK: - Private

    private func persistToFile() throws {
        let data = try JSONEncoder().encode(Array(cache.values))
        try data.write(to: fileURL, options: .atomic)
    }

    private static func loadSynchronously(from url: URL) -> [String: T] {
        guard let data = try? Data(contentsOf: url),
              let items = try? JSONDecoder().decode([T].self, from: data) else {
            return [:]
        }
        return Dictionary(uniqueKeysWithValues: items.map { ($0.id, $0) })
    }
}
```

### 使い方

Actorの分離により、すべての呼び出しは自動的に非同期になる：

```swift
let repository = LocalRepository<Question>()

// Read — fast O(1) lookup from in-memory cache
let question = await repository.find(by: "q-001")
let allQuestions = await repository.loadAll()

// Write — updates cache and persists to file atomically
try await repository.save(newQuestion)
try await repository.delete("q-001")
```

### @Observable ViewModel との組み合わせ

```swift
@Observable
final class QuestionListViewModel {
    private(set) var questions: [Question] = []
    private let repository: LocalRepository<Question>

    init(repository: LocalRepository<Question> = LocalRepository()) {
        self.repository = repository
    }

    func load() async {
        questions = await repository.loadAll()
    }

    func add(_ question: Question) async throws {
        try await repository.save(question)
        questions = await repository.loadAll()
    }
}
```

## 重要な設計上の決定

| 決定 | 理由 |
|----------|-----------|
| Actorを使用（クラス + ロックではなく） | コンパイラによって強制されるスレッド安全性、手動同期不要 |
| メモリキャッシュ + ファイル永続化 | キャッシュからの高速読み取り、ディスクへの永続的な書き込み |
| 初期化時の同期ロード | 非同期初期化の複雑さを回避 |
| IDをキーとする辞書 | 識別子によるO(1)検索 |
| ジェネリック `Codable & Identifiable` | あらゆるモデル型で再利用可能 |
| アトミックなファイル書き込み（`.atomic`） | クラッシュ時の部分書き込みを防ぐ |

## ベストプラクティス

* **Actorの境界を越えるすべてのデータに `Sendable` 型を使用する**
* **Actorのパブリックなアビリティを最小化する** —— 永続化の詳細ではなく、ドメイン操作のみを公開する
* **`.atomic` 書き込みを使用する** —— 書き込み中のアプリクラッシュによるデータ破損を防ぐ
* **`init` で同期的にロードする** —— 非同期イニシャライザはローカルファイルに対するわずかな利点のために複雑さが増す
* **`@Observable` ViewModelと組み合わせる** —— リアクティブなUI更新を実現する

## 避けるべきアンチパターン

* Swiftの新しい並行処理コードでActorの代わりに `DispatchQueue` または `NSLock` を使用する
* 内部のキャッシュ辞書を外部の呼び出し元に公開する
* 初期化後にファイルURLを外部から変更可能にする（初期化時のみ設定を許可すること）
* すべてのActor メソッド呼び出しが `await` であることを忘れる——呼び出し元は非同期コンテキストを処理する必要がある
* Actor の分離をバイパスするために `nonisolated` を使用する（本末転倒）

## 使用場面

* iOS/macOSアプリのローカルデータストレージ（ユーザーデータ、設定、キャッシュコンテンツ）
* 後でサーバーと同期するオフラインファーストアーキテクチャ
* アプリの複数の部分から並行アクセスされる共有可変状態
* `DispatchQueue` ベースのレガシーなスレッド安全機構を最新のSwift並行処理に置き換える
