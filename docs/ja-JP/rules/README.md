# ルール

## 構造

ルールは **common** レイヤーと **言語固有** ディレクトリで構成されています:

```
rules/
├── common/          # 言語に依存しない原則（常にインストール）
│   ├── coding-style.md
│   ├── git-workflow.md
│   ├── testing.md
│   ├── performance.md
│   ├── patterns.md
│   ├── hooks.md
│   ├── agents.md
│   └── security.md
├── typescript/      # TypeScript/JavaScript 固有
├── python/          # Python 固有
└── golang/          # Go 固有
```

- **common/** には普遍的な原則が含まれています。言語固有のコード例は含まれません。
- **言語ディレクトリ** は common ルールをフレームワーク固有のパターン、ツール、コード例で拡張します。各ファイルは対応する common ファイルを参照します。

## インストール

### オプション 1: インストールスクリプト（推奨）

```bash
# common + 1つ以上の言語固有ルールセットをインストール
./install.sh typescript
./install.sh python
./install.sh golang

# 複数の言語を一度にインストール
./install.sh typescript python
```

### オプション 2: 手動インストール

> **重要:** ディレクトリ全体をコピーしてください。`/*` でフラット化しないでください。
> Common と言語固有ディレクトリには同じ名前のファイルが含まれています。
> それらを1つのディレクトリにフラット化すると、言語固有ファイルが common ルールを上書きし、
> 言語固有ファイルが使用する相対パス `../common/` の参照が壊れます。

```bash
# common ルールをインストール（すべてのプロジェクトに必須）
cp -r rules/common ~/.claude/rules/common

# プロジェクトの技術スタックに応じて言語固有ルールをインストール
cp -r rules/typescript ~/.claude/rules/typescript
cp -r rules/python ~/.claude/rules/python
cp -r rules/golang ~/.claude/rules/golang

# 注意！実際のプロジェクト要件に応じて設定してください。ここでの設定は参考例です。
```

## ルール vs スキル

- **ルール** は広範に適用される標準、規約、チェックリストを定義します（例: 「80% テストカバレッジ」、「ハードコードされたシークレットなし」）。
- **スキル** （`skills/` ディレクトリ）は特定のタスクに対する詳細で実行可能な参考資料を提供します（例: `python-patterns`、`golang-testing`）。

言語固有のルールファイルは必要に応じて関連するスキルを参照します。ルールは *何を* するかを示し、スキルは *どのように* するかを示します。

## 新しい言語の追加

新しい言語（例: `rust/`）のサポートを追加するには:

1. `rules/rust/` ディレクトリを作成
2. common ルールを拡張するファイルを追加:
   - `coding-style.md` — フォーマットツール、イディオム、エラーハンドリングパターン
   - `testing.md` — テストフレームワーク、カバレッジツール、テスト構成
   - `patterns.md` — 言語固有の設計パターン
   - `hooks.md` — フォーマッタ、リンター、型チェッカー用の PostToolUse フック
   - `security.md` — シークレット管理、セキュリティスキャンツール
3. 各ファイルは次の内容で始めてください:
   ```
   > このファイルは [common/xxx.md](../common/xxx.md) を <言語> 固有のコンテンツで拡張します。
   ```
4. 利用可能な既存のスキルを参照するか、`skills/` 配下に新しいものを作成してください。
