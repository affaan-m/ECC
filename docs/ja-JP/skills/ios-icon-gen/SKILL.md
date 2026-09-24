---
name: ios-icon-gen
description: SF Symbols（Apple ネイティブ 5,000 件以上）または Iconify API（200 以上のコレクションから 275,000 件以上のオープンソースアイコン）から Xcode アセットカタログ用の PNG イメージセットとして iOS アプリアイコンを生成します。アイコンの生成、アイコンアセットの作成、アセットカタログへのアイコン追加、または iOS プロジェクト向けアイコンの検索を行う際に使用します。
origin: community
---

# iOS Icon Generator

2 つのソースから Xcode アセットカタログ用の PNG アイコンイメージセットを生成します。

## アクティベートするタイミング

- iOS/macOS Xcode プロジェクト向けアイコンアセットを生成する
- オープンソースコレクション全体でアイコンを検索する
- アセットカタログ用の PNG イメージセット（1x、2x、3x）を作成する
- プレースホルダーアイコンをプロダクション品質のアセットに置き換える
- Xcode プロジェクト内の既存アイコンスタイルに合わせる

## コア原則

### 1. 2 つのソース、1 つの出力フォーマット
どちらのソースも同一の Xcode 互換イメージセットを生成します。必要に応じて選択してください。

| ソース | アイコン数 | 要件 | 最適な用途 |
|--------|----------|------|-----------|
| **Iconify API** | 200 以上のコレクションから 275,000 件以上 | インターネット | 幅広い選択肢、特定スタイル、オープンソースアイコン |
| **SF Symbols** | Apple シンボル 5,000 件以上 | macOS のみ | Apple ネイティブスタイル、オフライン使用 |

### 2. 常に既存スタイルに合わせる
生成する前に、サイズ・色・ウェイトの一貫性について、プロジェクトの既存アイコンを確認してください。

### 3. 出力構造
どちらの方法も完全な Xcode イメージセットを生成します。

```
<output-dir>/<asset-name>.imageset/
  Contents.json
  <asset-name>.png        # 1x（デフォルト 68px）
  <asset-name>@2x.png     # 2x（デフォルト 136px）
  <asset-name>@3x.png     # 3x（デフォルト 204px）
```

## 使用例

### ステップ 1: 要件の確認

アイコンのニーズを決定します。アイコンが表すもの、好みのスタイル、対象の色とサイズ。

プロジェクトにすでにアイコンがある場合は、既存スタイルを確認します。
```bash
# 既存アイコンのサイズを確認
sips -g pixelWidth -g pixelHeight path/to/existing@2x.png
```

### ステップ 2: アイコンの検索

**Iconify API（幅広い選択肢に推奨）:**
```bash
# すべてのコレクションを検索
$SKILL_DIR/scripts/iconify_gen.sh search "receipt"

# 特定のコレクション内で検索
$SKILL_DIR/scripts/iconify_gen.sh search "business card" --prefix mdi

# 利用可能なコレクションを一覧表示
$SKILL_DIR/scripts/iconify_gen.sh collections
```

**SF Symbols（Apple ネイティブスタイル向け）:**
SF Symbols アプリを参照するか、一般的な名前を確認します。

| ユースケース | シンボル名 |
|-------------|-----------|
| ドキュメント | `doc.text`, `doc.fill` |
| レシート | `doc.text.below.ecg`, `receipt` |
| 人物 | `person.crop.rectangle`, `person.text.rectangle` |
| カメラ | `camera`, `camera.fill` |
| スキャン | `doc.viewfinder`, `qrcode.viewfinder` |
| 設定 | `gearshape`, `slider.horizontal.3` |

### ステップ 3: プレビュー（オプション）

```bash
# Iconify プレビュー
$SKILL_DIR/scripts/iconify_gen.sh preview mdi:receipt-text-outline
```

### ステップ 4: 生成

**Iconify API:**
```bash
# 基本的な生成
$SKILL_DIR/scripts/iconify_gen.sh mdi:receipt-text-outline editTool_expenseReport

# カスタムカラーと出力場所
$SKILL_DIR/scripts/iconify_gen.sh mdi:receipt-text-outline myIcon --color 007AFF --output ./Assets.xcassets/icons
```

オプション: `--size <pt>`（デフォルト: 68）、`--color <hex>`（デフォルト: 8E8E93）、`--output <dir>`（デフォルト: /tmp/icons）

**SF Symbols:**
```bash
# 基本的な生成
swift $SKILL_DIR/scripts/generate_icons.swift doc.text.below.ecg editTool_expenseReport

# カスタムカラー、ウェイト、出力
swift $SKILL_DIR/scripts/generate_icons.swift person.crop.rectangle myIcon --color 007AFF --weight regular --output ./Assets.xcassets/icons
```

オプション: `--size <pt>`（デフォルト: 68）、`--color <hex>`（デフォルト: 8E8E93）、`--weight <name>`（デフォルト: thin）、`--output <dir>`（デフォルト: /tmp/icons）

### ステップ 5: 確認と統合

1. 生成された @2x PNG を読み込んで視覚的に確認する
2. 直接出力していない場合はアセットカタログにコピーする。
   ```bash
   cp -r /tmp/icons/<name>.imageset path/to/Assets.xcassets/<group>/
   ```
3. プロジェクトをビルドして Xcode が新しいアセットを認識することを確認する

## 人気の Iconify コレクション

| プレフィックス | 名前 | 件数 | スタイル |
|-------------|------|------|---------|
| `mdi` | Material Design Icons | 7,400 件以上 | 塗りつぶし＋アウトラインバリアント |
| `ph` | Phosphor | 9,000 件以上 | アイコンごとに 6 ウェイト |
| `solar` | Solar | 7,400 件以上 | Bold、Linear、Outline |
| `tabler` | Tabler Icons | 6,000 件以上 | 一定のストローク幅 |
| `lucide` | Lucide | 1,700 件以上 | クリーン、ミニマル |
| `ri` | Remix Icon | 3,100 件以上 | 塗りつぶし＋ラインバリアント |
| `carbon` | Carbon | 2,400 件以上 | IBM デザイン言語 |
| `heroicons` | HeroIcons | 1,200 件以上 | Tailwind CSS のコンパニオン |

すべてを閲覧: <https://icon-sets.iconify.design/>

## スクリプトリファレンス

| スクリプト | ソース | パス |
|-----------|--------|------|
| `iconify_gen.sh` | Iconify API（275,000 件以上のアイコン） | `$SKILL_DIR/scripts/iconify_gen.sh` |
| `generate_icons.swift` | SF Symbols（5,000 件以上のアイコン） | `$SKILL_DIR/scripts/generate_icons.swift` |

## ベストプラクティス

- **生成前に検索する** -- 利用可能なアイコンを閲覧して最適なものを見つける
- **既存プロジェクトスタイルに合わせる** -- 新しいアイコンを生成する前に既存アイコンのサイズ・色・ウェイトを確認する
- **バラエティには Iconify を使う** -- 200 以上のコレクションから必要なスタイルを見つけられる
- **Apple の一貫性には SF Symbols を使う** -- システム UI と完全に一致する
- **アセットカタログに直接生成する** -- 手動コピーを省略するため `--output ./Assets.xcassets/icons` を使う
- **視覚的に確認する** -- コミット前に必ず @2x PNG をプレビューする

## アンチパターン

- 既存プロジェクトのアイコンスタイルを確認せずにアイコンを生成する
- プロジェクトに定義されたカラーパレットがあるのにデフォルトカラーを使う
- 間違ったサイズで生成する（まず既存アイコンを確認する）
- 視覚的確認なしに生成されたアイコンをコミットする
