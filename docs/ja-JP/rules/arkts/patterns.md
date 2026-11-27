---
paths:
  - "**/*.ets"
  - "**/*.ts"
---
# HarmonyOS / ArkTS パターン

> このファイルは [common/patterns.md](../common/patterns.md) を HarmonyOS および ArkTS 固有のパターンで拡張します。

## 状態管理: V2 のみ

ArkUI 状態管理 V2 を**必ず使用**すること。V1 デコレーターは非推奨であり、使用してはならない。

### V2 デコレーター

| デコレーター | 用途 |
|------------|------|
| `@ComponentV2` | 構造体を V2 コンポーネントとしてマークする |
| `@Local` | コンポーネント内のローカル状態 |
| `@Param` | 親から受け取るプロパティ（読み取り専用） |
| `@Event` | 子から親へのコールバックイベント |
| `@Provider` | 子孫コンポーネントへ状態を提供する |
| `@Consumer` | 祖先の `@Provider` から状態を取得する |
| `@Monitor` | 状態変化を監視する（V1 の `@Watch` を置き換え） |
| `@Computed` | 派生/計算された値 |
| `@ObservedV2` | V2 状態管理のためにクラスをオブザーバブルにする |
| `@Trace` | `@ObservedV2` クラスのオブザーバブルプロパティをマークする |

### 禁止されている V1 デコレーター

絶対に使用しないこと: `@State`、`@Prop`、`@Link`、`@ObjectLink`、`@Observed`、`@Provide`、`@Consume`、`@Watch`、`@Component`（代わりに `@ComponentV2` を使用）。

### V2 コンポーネントの例

```typescript
@ObservedV2
class UserModel {
  @Trace name: string = ''
  @Trace age: number = 0
}

@ComponentV2
struct UserCard {
  @Param user: UserModel = new UserModel()
  @Event onDelete: () => void = () => {}

  build() {
    Column() {
      Text(this.user.name)
        .fontSize($r('app.float.font_size_title'))
      Text(`${this.user.age}`)
        .fontSize($r('app.float.font_size_body'))
      Button($r('app.string.delete'))
        .onClick(() => this.onDelete())
    }
  }
}
```

### 状態の同期

```typescript
@ComponentV2
struct ParentPage {
  @Provider('userState') userModel: UserModel = new UserModel()

  build() {
    Column() {
      ChildComponent()  // @Consumer('userState') を自動的に受け取る
    }
  }
}

@ComponentV2
struct ChildComponent {
  @Consumer('userState') userModel: UserModel = new UserModel()

  build() {
    Text(this.userModel.name)
  }
}
```

## ルーティング: Navigation のみ

`NavPathStack` を使用した `Navigation` コンポーネントを**必ず使用**すること。`@ohos.router` は絶対に使用しないこと。

### Navigation のセットアップ

```typescript
@ComponentV2
struct MainPage {
  @Local navPathStack: NavPathStack = new NavPathStack()

  build() {
    Navigation(this.navPathStack) {
      // ホームコンテンツ
    }
    .navDestination(this.routerMap)
  }

  @Builder
  routerMap(name: string, param: ESObject) {
    if (name === 'detail') {
      DetailPage()
    } else if (name === 'settings') {
      SettingsPage()
    }
  }
}
```

### ページナビゲーション

```typescript
// 新しいページをプッシュする
this.navPathStack.pushPath({ name: 'detail', param: { id: '123' } })

// 現在のページを置き換える
this.navPathStack.replacePath({ name: 'settings' })

// 戻る
this.navPathStack.pop()

// ルートに戻る
this.navPathStack.clear()
```

### NavDestination サブページ

```typescript
@ComponentV2
struct DetailPage {
  build() {
    NavDestination() {
      Column() {
        Text($r('app.string.detail_title'))
      }
    }
    .title($r('app.string.detail_nav_title'))
  }
}
```

## アーキテクチャパターン: MVVM

HarmonyOS アプリケーションに推奨されるアーキテクチャ:

```
feature/
  |-- model/           # データモデル（@ObservedV2 クラス）
  |-- viewmodel/       # ビジネスロジック（ViewModel クラス）
  |-- view/            # UI コンポーネント（@ComponentV2 構造体）
  |-- service/         # API 呼び出し、データアクセス
```

- **View**: レンダリングロジックのみ、`build()` 内にビジネスロジックを含めない
- **ViewModel**: すべてのビジネスロジックをここにカプセル化する
- **Model**: `@ObservedV2` と `@Trace` を持つ純粋なデータクラス
- **Service**: ネットワークリクエスト、データベース操作、ファイル I/O

## ArkUI アニメーションパターン

### 状態駆動アニメーション

```typescript
@ComponentV2
struct AnimatedCard {
  @Local isExpanded: boolean = false
  @Local cardScale: number = 0.8

  build() {
    Column() {
      // コンテンツ
    }
    .scale({ x: this.cardScale, y: this.cardScale })
    .animation({ duration: 300, curve: Curve.EaseInOut })
    .onClick(() => {
      this.isExpanded = !this.isExpanded
      this.cardScale = this.isExpanded ? 1.0 : 0.8
    })
  }
}
```

### アニメーションのルール

- ネイティブ HarmonyOS アニメーション API と高度なテンプレートを優先する
- 状態変数の変更でアニメーションをトリガーする状態駆動アニメーションを持つ宣言的 UI を使用する
- 複雑なサブコンポーネントアニメーションのレンダリングバッチを削減するために `renderGroup(true)` を設定する
- アニメーション中に `width`、`height`、`padding`、`margin` を頻繁に変更しないこと — パフォーマンスに深刻な影響
- 明示的なアニメーション制御には `animateTo` を使用する
- パフォーマンスの高いアニメーションには `transform`（translate、scale、rotate）と `opacity` を優先する

## パフォーマンスパターン

### 大きなリストへの LazyForEach

```typescript
@ComponentV2
struct LargeList {
  @Local dataSource: MyDataSource = new MyDataSource()

  build() {
    List() {
      LazyForEach(this.dataSource, (item: ItemModel) => {
        ListItem() {
          ItemComponent({ item: item })
        }
      }, (item: ItemModel) => item.id)
    }
  }
}
```

### コンポーネントの再利用

- 再利用可能なコンポーネントを別のファイルに抽出する
- コンポーネント内の軽量な UI フラグメントには `@Builder` を使用する
- 設定可能なコンポーネントには `@Param` を使用する

## リソース参照

UI 定数は常にリソースとして定義し、`$r()` 経由で参照する:

```typescript
// BAD: ハードコードされた値
Text('Hello')
  .fontSize(16)
  .fontColor('#333333')

// GOOD: リソース参照
Text($r('app.string.greeting'))
  .fontSize($r('app.float.font_size_body'))
  .fontColor($r('app.color.text_primary'))
```
