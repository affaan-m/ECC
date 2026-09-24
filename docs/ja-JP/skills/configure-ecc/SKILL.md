---
name: configure-ecc
description: Everything Claude Code のインタラクティブなインストーラー — スキルとルールの選択とインストールをユーザーレベルまたはプロジェクトレベルのディレクトリへガイドし、パスを検証し、必要に応じてインストールされたファイルを最適化します。
---

# Configure Everything Claude Code (ECC)

Everything Claude Code プロジェクトのインタラクティブなステップバイステップのインストールウィザードです。`AskUserQuestion` を使用してスキルとルールの選択的インストールをユーザーにガイドし、正確性を検証し、最適化を提供します。

## 起動タイミング

- ユーザーが "configure ecc"、"install ecc"、"setup everything claude code" などと言った場合
- ユーザーがこのプロジェクトからスキルまたはルールを選択的にインストールしたい場合
- ユーザーが既存の ECC インストールを検証または修正したい場合
- ユーザーがインストールされたスキルまたはルールをプロジェクト用に最適化したい場合

## 前提条件

このスキルは起動前に Claude Code からアクセス可能である必要があります。ブートストラップには2つの方法があります：
1. **プラグイン経由**: `/plugin install ecc@ecc` — プラグインがこのスキルを自動的にロードします
2. **手動**: このスキルのみを `~/.claude/skills/configure-ecc/SKILL.md` にコピーし、"configure ecc" と言って起動します

---

## ステップ 0: ECC リポジトリのクローン

インストールの前に、最新の ECC ソースを `/tmp` にクローンします：

```bash
rm -rf /tmp/everything-claude-code
git clone https://github.com/affaan-m/everything-claude-code.git /tmp/everything-claude-code
```

以降のすべてのコピー操作のソースとして `ECC_ROOT=/tmp/everything-claude-code` を設定します。

クローンが失敗した場合（ネットワークの問題など）、`AskUserQuestion` を使用してユーザーに既存の ECC クローンへのローカルパスを提供するよう依頼します。

---

## ステップ 1: インストールレベルの選択

`AskUserQuestion` を使用してユーザーにインストール先を尋ねます：

```
Question: "ECC コンポーネントをどこにインストールしますか？"
Options:
  - "User-level (~/.claude/)" — "すべての Claude Code プロジェクトに適用されます"
  - "Project-level (.claude/)" — "現在のプロジェクトのみに適用されます"
  - "Both" — "共通/共有アイテムはユーザーレベル、プロジェクト固有アイテムはプロジェクトレベル"
```

選択を `INSTALL_LEVEL` として保存します。ターゲットディレクトリを設定します：
- User-level: `TARGET=~/.claude`
- Project-level: `TARGET=.claude`（現在のプロジェクトルートからの相対パス）
- Both: `TARGET_USER=~/.claude`、`TARGET_PROJECT=.claude`

ターゲットディレクトリが存在しない場合は作成します：
```bash
mkdir -p $TARGET/skills $TARGET/rules
```

---

## ステップ 2: スキルの選択とインストール

### 2a: スキルカテゴリの選択

31個のスキルが4つのカテゴリに分類されています。`multiSelect: true` で `AskUserQuestion` を使用します：

```
Question: "どのスキルカテゴリをインストールしますか？"
Options:
  - "Framework & Language" — "Django, Spring Boot, Go, Python, Java, Frontend, Backend パターン"
  - "Database" — "PostgreSQL, ClickHouse, JPA/Hibernate パターン"
  - "Workflow & Quality" — "TDD, 検証, 学習, セキュリティレビュー, コンパクション"
  - "All skills" — "利用可能なすべてのスキルをインストール"
```

### 2b: 個別スキルの確認

選択された各カテゴリについて、以下の完全なスキルリストを表示し、ユーザーに確認または特定のものの選択解除を依頼します。リストが4項目を超える場合、リストをテキストとして表示し、`AskUserQuestion` で「リストされたすべてをインストール」オプションと、ユーザーが特定の名前を貼り付けるための「その他」オプションを使用します。

**カテゴリ: Framework & Language（20スキル）**

| スキル | 説明 |
|-------|-------------|
| `backend-patterns` | バックエンドアーキテクチャ、API設計、Node.js/Express/Next.js のサーバーサイドベストプラクティス |
| `coding-standards` | TypeScript、JavaScript、React、Node.js の汎用コーディング標準 |
| `django-patterns` | Django アーキテクチャ、DRF による REST API、ORM、キャッシング、シグナル、ミドルウェア |
| `django-security` | Django セキュリティ: 認証、CSRF、SQL インジェクション、XSS 防止 |
| `django-tdd` | pytest-django、factory_boy、モック、カバレッジによる Django テスト |
| `django-verification` | Django 検証ループ: マイグレーション、リンティング、テスト、セキュリティスキャン |
| `frontend-patterns` | React、Next.js、状態管理、パフォーマンス、UI パターン |
| `golang-patterns` | 慣用的な Go パターン、堅牢な Go アプリケーションのための規約 |
| `golang-testing` | Go テスト: テーブル駆動テスト、サブテスト、ベンチマーク、ファジング |
| `java-coding-standards` | Spring Boot 用 Java コーディング標準: 命名、不変性、Optional、ストリーム |
| `python-patterns` | Pythonic なイディオム、PEP 8、型ヒント、ベストプラクティス |
| `python-testing` | pytest、TDD、フィクスチャ、モック、パラメータ化による Python テスト |
| `quarkus-patterns` | Quarkus アーキテクチャ、Camel メッセージング、CDI サービス、Panache データアクセス |
| `quarkus-security` | Quarkus セキュリティ: JWT/OIDC、RBAC、入力バリデーション、シークレット管理 |
| `quarkus-tdd` | JUnit 5、Mockito、REST Assured、Camel テストによる Quarkus TDD |
| `quarkus-verification` | Quarkus 検証: ビルド、静的解析、テスト、ネイティブコンパイル |
| `springboot-patterns` | Spring Boot アーキテクチャ、REST API、レイヤードサービス、キャッシング、非同期 |
| `springboot-security` | Spring Security: 認証/認可、検証、CSRF、シークレット、レート制限 |
| `springboot-tdd` | JUnit 5、Mockito、MockMvc、Testcontainers による Spring Boot TDD |
| `springboot-verification` | Spring Boot 検証: ビルド、静的解析、テスト、セキュリティスキャン |

**カテゴリ: Database（3スキル）**

| スキル | 説明 |
|-------|-------------|
| `clickhouse-io` | ClickHouse パターン、クエリ最適化、分析、データエンジニアリング |
| `jpa-patterns` | JPA/Hibernate エンティティ設計、リレーションシップ、クエリ最適化、トランザクション |
| `postgres-patterns` | PostgreSQL クエリ最適化、スキーマ設計、インデックス作成、セキュリティ |

**カテゴリ: Workflow & Quality（8スキル）**

| スキル | 説明 |
|-------|-------------|
| `continuous-learning` | セッションから再利用可能なパターンを学習済みスキルとして自動抽出 |
| `continuous-learning-v2` | 信頼度スコアリングを持つ本能ベースの学習、スキル/コマンド/エージェントに進化 |
| `eval-harness` | 評価駆動開発（EDD）のための正式な評価フレームワーク |
| `iterative-retrieval` | サブエージェントコンテキスト問題のための段階的コンテキスト改善 |
| `security-review` | セキュリティチェックリスト: 認証、入力、シークレット、API、決済機能 |
| `strategic-compact` | 論理的な間隔で手動コンテキスト圧縮を提案 |
| `tdd-workflow` | 80%以上のカバレッジで TDD を強制: ユニット、統合、E2E |
| `verification-loop` | 検証と品質ループのパターン |

**スタンドアロン**

| スキル | 説明 |
|-------|-------------|
| `docs/examples/project-guidelines-template.md` | プロジェクト固有のスキルを作成するためのテンプレート |

### 2c: インストールの実行

選択された各スキルについて、正しいソースルートからスキルディレクトリ全体をコピーします：

```bash
# コアスキルは .agents/skills/ 配下にあります
cp -R "$ECC_ROOT/.agents/skills/<skill-name>" "$TARGET/skills/"

# ニッチスキルは skills/ 配下にあります
cp -R "$ECC_ROOT/skills/<skill-name>" "$TARGET/skills/"
```

glob で取得したソースディレクトリを処理するときは、trailing slash 付きのソースをそのまま `cp` に渡さないでください。宛先名にディレクトリ名を明示します：

```bash
cp -R "${src%/}" "$TARGET/skills/$(basename "${src%/}")"
```

注: `continuous-learning` と `continuous-learning-v2` には追加ファイル（config.json、フック、スクリプト）があります — SKILL.md だけでなく、ディレクトリ全体がコピーされることを確認してください。

---

## ステップ 3: ルールの選択とインストール

`multiSelect: true` で `AskUserQuestion` を使用します：

```
Question: "どのルールセットをインストールしますか？"
Options:
  - "Common rules (Recommended)" — "言語に依存しない原則: コーディングスタイル、git ワークフロー、テスト、セキュリティなど（8ファイル）"
  - "TypeScript/JavaScript" — "TS/JS パターン、フック、Playwright によるテスト（5ファイル）"
  - "Python" — "Python パターン、pytest、black/ruff フォーマット（5ファイル）"
  - "Go" — "Go パターン、テーブル駆動テスト、gofmt/staticcheck（5ファイル）"
```

インストールを実行：
```bash
# 共通ルール
cp -r $ECC_ROOT/rules/common $TARGET/rules/common

# 言語固有のルール（言語別ディレクトリを保持）
cp -r $ECC_ROOT/rules/typescript $TARGET/rules/typescript   # 選択された場合
cp -r $ECC_ROOT/rules/python $TARGET/rules/python            # 選択された場合
cp -r $ECC_ROOT/rules/golang $TARGET/rules/golang            # 選択された場合
```

**重要**: ユーザーが言語固有のルールを選択したが、共通ルールを選択しなかった場合、警告します：
> "言語固有のルールは共通ルールを拡張します。共通ルールなしでインストールすると、不完全なカバレッジになる可能性があります。共通ルールもインストールしますか？"

---

## ステップ 4: インストール後の検証

インストール後、以下の自動チェックを実行します：

### 4a: ファイルの存在確認

インストールされたすべてのファイルをリストし、ターゲットロケーションに存在することを確認します：
```bash
ls -la $TARGET/skills/
ls -la $TARGET/rules/
```

### 4b: パス参照のチェック

インストールされたすべての `.md` ファイルでパス参照をスキャンします：
```bash
grep -rn "~/.claude/" $TARGET/skills/ $TARGET/rules/
grep -rn "../common/" $TARGET/rules/
grep -rn "skills/" $TARGET/skills/
```

**プロジェクトレベルのインストールの場合**、`~/.claude/` パスへの参照をフラグします：
- スキルが `~/.claude/settings.json` を参照している場合 — これは通常問題ありません（設定は常にユーザーレベルです）
- スキルが `~/.claude/skills/` または `~/.claude/rules/` を参照している場合 — プロジェクトレベルのみにインストールされている場合、これは壊れている可能性があります
- スキルが別のスキルを名前で参照している場合 — 参照されているスキルもインストールされているか確認します

### 4c: スキル間の相互参照のチェック

一部のスキルは他のスキルを参照します。これらの依存関係を検証します：
- `django-tdd` は `django-patterns` を参照する可能性があります
- `springboot-tdd` は `springboot-patterns` を参照する可能性があります
- `continuous-learning-v2` は `~/.claude/homunculus/` ディレクトリを参照します
- `python-testing` は `python-patterns` を参照する可能性があります
- `golang-testing` は `golang-patterns` を参照する可能性があります
- 言語固有のルールは `common/` の対応物を参照します

### 4d: 問題の報告

見つかった各問題について、報告します：
1. **ファイル**: 問題のある参照を含むファイル
2. **行**: 行番号
3. **問題**: 何が間違っているか（例: "~/.claude/skills/python-patterns を参照していますが、python-patterns がインストールされていません"）
4. **推奨される修正**: 何をすべきか（例: "python-patterns スキルをインストール" または "パスを .claude/skills/ に更新"）

---

## ステップ 5: インストールされたファイルの最適化（オプション）

`AskUserQuestion` を使用します：

```
Question: "インストールされたファイルをプロジェクト用に最適化しますか？"
Options:
  - "Optimize skills" — "無関係なセクションを削除、パスを調整、技術スタックに合わせて調整"
  - "Optimize rules" — "カバレッジ目標を調整、プロジェクト固有のパターンを追加、ツール設定をカスタマイズ"
  - "Optimize both" — "インストールされたすべてのファイルの完全な最適化"
  - "Skip" — "すべてをそのまま維持"
```

### スキルを最適化する場合：
1. インストールされた各 SKILL.md を読み取ります
2. ユーザーにプロジェクトの技術スタックを尋ねます（まだ不明な場合）
3. 各スキルについて、無関係なセクションの削除を提案します
4. インストール先（ソースリポジトリではなく）で SKILL.md ファイルをその場で編集します
5. ステップ4で見つかったパスの問題を修正します

### ルールを最適化する場合：
1. インストールされた各ルール .md ファイルを読み取ります
2. ユーザーに設定について尋ねます：
   - テストカバレッジ目標（デフォルト80%）
   - 優先フォーマットツール
   - Git ワークフロー規約
   - セキュリティ要件
3. インストール先でルールファイルをその場で編集します

**重要**: インストール先（`$TARGET/`）のファイルのみを変更し、ソース ECC リポジトリ（`$ECC_ROOT/`）のファイルは決して変更しないでください。

---

## ステップ 6: インストールサマリー

`/tmp` からクローンされたリポジトリをクリーンアップします：

```bash
rm -rf /tmp/everything-claude-code
```

次にサマリーレポートを出力します：

```
## ECC インストール完了

### インストール先
- レベル: [user-level / project-level / both]
- パス: [ターゲットパス]

### インストールされたスキル（[数]）
- skill-1, skill-2, skill-3, ...

### インストールされたルール（[数]）
- common（8ファイル）
- typescript（5ファイル）
- ...

### 検証結果
- [数]個の問題が見つかり、[数]個が修正されました
- [残っている問題をリスト]

### 適用された最適化
- [加えられた変更をリスト、または "なし"]
```

---

## トラブルシューティング

### "スキルが Claude Code に認識されません"
- スキルディレクトリに `SKILL.md` ファイルが含まれていることを確認します（単なる緩い .md ファイルではありません）
- ユーザーレベルの場合: `~/.claude/skills/<skill-name>/SKILL.md` が存在するか確認します
- プロジェクトレベルの場合: `.claude/skills/<skill-name>/SKILL.md` が存在するか確認します

### "ルールが機能しません"
- ルールはフラットファイルで、サブディレクトリにはありません: `$TARGET/rules/coding-style.md`（正しい） vs `$TARGET/rules/common/coding-style.md`（フラットインストールでは不正）
- ルールをインストール後、Claude Code を再起動します

### "プロジェクトレベルのインストール後のパス参照エラー"
- 一部のスキルは `~/.claude/` パスを前提としています。ステップ4の検証を実行してこれらを見つけて修正します。
- `continuous-learning-v2` の場合、`~/.claude/homunculus/` ディレクトリは常にユーザーレベルです — これは想定されており、エラーではありません。
