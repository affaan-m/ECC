**言語:** [English](../../README.md) | [Português (Brasil)](../pt-BR/README.md) | [简体中文](../../README.zh-CN.md) | [繁體中文](../zh-TW/README.md) | [日本語](README.md) | [한국어](../ko-KR/README.md) | [Türkçe](../tr/README.md) | [Русский](../ru/README.md) | [Tiếng Việt](../vi-VN/README.md) | [ไทย](../th/README.md)

# Everything Claude Code

[![Stars](https://img.shields.io/github/stars/affaan-m/everything-claude-code?style=flat)](https://github.com/affaan-m/everything-claude-code/stargazers)
[![Forks](https://img.shields.io/github/forks/affaan-m/everything-claude-code?style=flat)](https://github.com/affaan-m/everything-claude-code/network/members)
[![Contributors](https://img.shields.io/github/contributors/affaan-m/everything-claude-code?style=flat)](https://github.com/affaan-m/everything-claude-code/graphs/contributors)
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
![Shell](https://img.shields.io/badge/-Shell-4EAA25?logo=gnu-bash&logoColor=white)
![TypeScript](https://img.shields.io/badge/-TypeScript-3178C6?logo=typescript&logoColor=white)
![Python](https://img.shields.io/badge/-Python-3776AB?logo=python&logoColor=white)
![Go](https://img.shields.io/badge/-Go-00ADD8?logo=go&logoColor=white)
![Java](https://img.shields.io/badge/-Java-ED8B00?logo=openjdk&logoColor=white)
![Markdown](https://img.shields.io/badge/-Markdown-000000?logo=markdown&logoColor=white)

> **140K+ stars** | **21K+ forks** | **170+ contributors** | **12+ language ecosystems**

---

<div align="center">

**言語 / Language / 語言 / Dil / Язык / Ngôn ngữ**

[**English**](../../README.md) | [Português (Brasil)](../pt-BR/README.md) | [简体中文](../../README.zh-CN.md) | [繁體中文](../zh-TW/README.md) | [日本語](README.md) | [한국어](../ko-KR/README.md) | [Türkçe](../tr/README.md) | [Русский](../ru/README.md) | [Tiếng Việt](../vi-VN/README.md) | [ไทย](../th/README.md)

</div>

---

**Anthropicハッカソン優勝者による完全なClaude Code設定集。**

10ヶ月以上の集中的な日常使用により、実際のプロダクト構築の過程で進化した、本番環境対応のエージェント、スキル、フック、コマンド、ルール、MCP設定。

---

## ガイド

このリポジトリには、原始コードのみが含まれています。ガイドがすべてを説明しています。

<table>
<tr>
<td width="50%">
<a href="https://x.com/affaanmustafa/status/2012378465664745795">
<img src="https://github.com/user-attachments/assets/1a471488-59cc-425b-8345-5245c7efbcef" alt="The Shorthand Guide to Everything Claude Code" />
</a>
</td>
<td width="50%">
<a href="https://x.com/affaanmustafa/status/2014040193557471352">
<img src="https://github.com/user-attachments/assets/c9ca43bc-b149-427f-b551-af6840c368f0" alt="The Longform Guide to Everything Claude Code" />
</a>
</td>
</tr>
<tr>
<td align="center"><b>簡潔ガイド</b><br/>セットアップ、基礎、哲学。<b>まずこれを読んでください。</b></td>
<td align="center"><b>長文ガイド</b><br/>トークン最適化、メモリ永続化、評価、並列化。</td>
</tr>
</table>

| トピック | 学べる内容 |
|-------|-------------------|
| トークン最適化 | モデル選択、システムプロンプト削減、バックグラウンドプロセス |
| メモリ永続化 | セッション間でコンテキストを自動保存/読み込みするフック |
| 継続的学習 | セッションからパターンを自動抽出して再利用可能なスキルに変換 |
| 検証ループ | チェックポイントと継続的評価、スコアラータイプ、pass@k メトリクス |
| 並列化 | Git ワークツリー、カスケード方法、スケーリング時期 |
| サブエージェント オーケストレーション | コンテキスト問題、反復検索パターン |

---

## 新機能

### v1.4.1 — バグ修正（2026年2月）

- **instinctインポート時のコンテンツ喪失を修正** — `/instinct-import`実行時に`parse_instinct_file()`がfrontmatter後のすべてのコンテンツ（Action、Evidence、Examplesセクション）を暗黙的に削除していた問題を修正。コミュニティ貢献者@ericcai0814により解決されました（[#148](https://github.com/affaan-m/everything-claude-code/issues/148), [#161](https://github.com/affaan-m/everything-claude-code/pull/161)）

### v1.4.0 — マルチ言語ルール、インストールウィザード & PM2（2026年2月）

- **インタラクティブインストールウィザード** — 新しい`configure-ecc`スキルがマージ/上書き検出付きガイドセットアップを提供
- **PM2 & マルチエージェントオーケストレーション** — 複雑なマルチサービスワークフロー管理用の6つの新コマンド（`/pm2`, `/multi-plan`, `/multi-execute`, `/multi-backend`, `/multi-frontend`, `/multi-workflow`）
- **マルチ言語ルールアーキテクチャ** — ルールをフラットファイルから`common/` + `typescript/` + `python/` + `golang/`ディレクトリに再構成。必要な言語のみインストール可能
- **中国語（zh-CN）翻訳** — すべてのエージェント、コマンド、スキル、ルールの完全翻訳（80+ファイル）
- **GitHub Sponsorsサポート** — GitHub Sponsors経由でプロジェクトをスポンサー可能
- **強化されたCONTRIBUTING.md** — 各貢献タイプ向けの詳細なPRテンプレート

### v1.3.0 — OpenCodeプラグイン対応（2026年2月）

- **フルOpenCode統合** — 20+イベントタイプを通じてOpenCodeのプラグインシステムでフック対応の12エージェント、24コマンド、16スキル
- **3つのネイティブカスタムツール** — run-tests、check-coverage、security-audit
- **LLMドキュメンテーション** — 包括的なOpenCodeドキュメント用の`llms.txt`

### v1.2.0 — 統合コマンド & スキル（2026年2月）

- **Python/Djangoサポート** — Djangoパターン、セキュリティ、TDD、検証スキル
- **Java Spring Bootスキル** — Spring Boot用パターン、セキュリティ、TDD、検証
- **セッション管理** — セッション履歴用の`/sessions`コマンド
- **継続的学習 v2** — 信頼度スコアリング、インポート/エクスポート、進化を伴うinstinctベースの学習

完全なチェンジログは[Releases](https://github.com/affaan-m/everything-claude-code/releases)を参照してください。

---

## クイックスタート

2分以内に起動できます：

### ステップ 1：プラグインをインストール

```bash
# マーケットプレイスを追加
/plugin marketplace add https://github.com/affaan-m/everything-claude-code

# プラグインをインストール
/plugin install ecc@ecc
```

### ステップ2：ルールをインストール（必須）

> WARNING: **重要:** Claude Codeプラグインは`rules`を自動配布できません。手動でインストールしてください：

```bash
# まずリポジトリをクローン
git clone https://github.com/affaan-m/everything-claude-code.git

# 共通ルールをインストール（必須）
cp -r everything-claude-code/rules/common ~/.claude/rules/common

# 言語固有ルールをインストール（スタックを選択）
cp -r everything-claude-code/rules/typescript ~/.claude/rules/typescript
cp -r everything-claude-code/rules/python ~/.claude/rules/python
cp -r everything-claude-code/rules/golang ~/.claude/rules/golang
```

### ステップ3：使用開始

```bash
# コマンドを試す（プラグインはネームスペース形式）
/ecc:plan "ユーザー認証を追加"

# 手動インストール（オプション2）は短縮形式：
# /plan "ユーザー認証を追加"

# 利用可能なコマンドを確認
/plugin list ecc@ecc
```

**完了です！** これで13のエージェント、43のスキル、31のコマンドにアクセスできます。

---

## クロスプラットフォーム対応

このプラグインは **Windows、macOS、Linux** を完全にサポートしています。すべてのフックとスクリプトが Node.js で書き直され、最大の互換性を実現しています。

### パッケージマネージャー検出

プラグインは、以下の優先順位で、お好みのパッケージマネージャー（npm、pnpm、yarn、bun）を自動検出します：

1. **環境変数**: `CLAUDE_PACKAGE_MANAGER`
2. **プロジェクト設定**: `.claude/package-manager.json`
3. **package.json**: `packageManager` フィールド
4. **ロックファイル**: package-lock.json、yarn.lock、pnpm-lock.yaml、bun.lockb から検出
5. **グローバル設定**: `~/.claude/package-manager.json`
6. **フォールバック**: 最初に利用可能なパッケージマネージャー

お好みのパッケージマネージャーを設定するには：

```bash
# 環境変数経由
export CLAUDE_PACKAGE_MANAGER=pnpm

# グローバル設定経由
node scripts/setup-package-manager.js --global pnpm

# プロジェクト設定経由
node scripts/setup-package-manager.js --project bun

# 現在の設定を検出
node scripts/setup-package-manager.js --detect
```

または Claude Code で `/setup-pm` コマンドを使用。

---

## 含まれるもの

このリポジトリは**Claude Codeプラグイン**です - 直接インストールするか、コンポーネントを手動でコピーできます。

```
everything-claude-code/
|-- .claude-plugin/   # プラグインとマーケットプレイスマニフェスト
|   |-- plugin.json         # プラグインメタデータとコンポーネントパス
|   |-- marketplace.json    # /plugin marketplace add 用のマーケットプレイスカタログ
|
|-- agents/           # 委任用の専門サブエージェント
|   |-- planner.md           # 機能実装計画
|   |-- architect.md         # システム設計決定
|   |-- tdd-guide.md         # テスト駆動開発
|   |-- code-reviewer.md     # 品質とセキュリティレビュー
|   |-- security-reviewer.md # 脆弱性分析
|   |-- build-error-resolver.md
|   |-- e2e-runner.md        # Playwright E2E テスト
|   |-- refactor-cleaner.md  # デッドコード削除
|   |-- doc-updater.md       # ドキュメント同期
|   |-- go-reviewer.md       # Go コードレビュー
|   |-- go-build-resolver.md # Go ビルドエラー解決
|   |-- python-reviewer.md   # Python コードレビュー（新規）
|   |-- database-reviewer.md # データベース/Supabase レビュー（新規）
|
|-- skills/           # ワークフロー定義と領域知識
|   |-- coding-standards/           # 言語ベストプラクティス
|   |-- backend-patterns/           # API、データベース、キャッシュパターン
|   |-- frontend-patterns/          # React、Next.js パターン
|   |-- continuous-learning/        # セッションからパターンを自動抽出（長文ガイド）
|   |-- continuous-learning-v2/     # 信頼度スコア付き直感ベース学習
|   |-- iterative-retrieval/        # サブエージェント用の段階的コンテキスト精製
|   |-- strategic-compact/          # 手動圧縮提案（長文ガイド）
|   |-- tdd-workflow/               # TDD 方法論
|   |-- security-review/            # セキュリティチェックリスト
|   |-- eval-harness/               # 検証ループ評価（長文ガイド）
|   |-- verification-loop/          # 継続的検証（長文ガイド）
|   |-- golang-patterns/            # Go イディオムとベストプラクティス
|   |-- golang-testing/             # Go テストパターン、TDD、ベンチマーク
|   |-- cpp-testing/                # C++ テスト GoogleTest、CMake/CTest（新規）
|   |-- django-patterns/            # Django パターン、モデル、ビュー（新規）
|   |-- django-security/            # Django セキュリティベストプラクティス（新規）
|   |-- django-tdd/                 # Django TDD ワークフロー（新規）
|   |-- django-verification/        # Django 検証ループ（新規）
|   |-- python-patterns/            # Python イディオムとベストプラクティス（新規）
|   |-- python-testing/             # pytest を使った Python テスト（新規）
|   |-- quarkus-patterns/            # Quarkus アーキテクチャ、Camel、CDI、Panache パターン（新規）
|   |-- quarkus-security/           # Quarkus セキュリティ: JWT/OIDC、RBAC、バリデーション（新規）
|   |-- quarkus-tdd/                # Quarkus TDD: JUnit 5、Mockito、REST Assured（新規）
|   |-- quarkus-verification/       # Quarkus 検証: ビルド、テスト、ネイティブコンパイル（新規）
|   |-- springboot-patterns/        # Java Spring Boot パターン（新規）
|   |-- springboot-security/        # Spring Boot セキュリティ（新規）
|   |-- springboot-tdd/             # Spring Boot TDD（新規）
|   |-- springboot-verification/    # Spring Boot 検証（新規）
|   |-- configure-ecc/              # インタラクティブインストールウィザード（新規）
|   |-- security-scan/              # AgentShield セキュリティ監査統合（新規）
|
|-- commands/         # スラッシュコマンド用クイック実行
|   |-- tdd.md              # /tdd - テスト駆動開発
|   |-- plan.md             # /plan - 実装計画
|   |-- e2e.md              # /e2e - E2E テスト生成
|   |-- code-review.md      # /code-review - 品質レビュー
|   |-- build-fix.md        # /build-fix - ビルドエラー修正
|   |-- refactor-clean.md   # /refactor-clean - デッドコード削除
|   |-- learn.md            # /learn - セッション中のパターン抽出（長文ガイド）
|   |-- checkpoint.md       # /checkpoint - 検証状態を保存（長文ガイド）
|   |-- verify.md           # /verify - 検証ループを実行（長文ガイド）
|   |-- setup-pm.md         # /setup-pm - パッケージマネージャーを設定
|   |-- go-review.md        # /go-review - Go コードレビュー（新規）
|   |-- go-test.md          # /go-test - Go TDD ワークフロー（新規）
|   |-- go-build.md         # /go-build - Go ビルドエラーを修正（新規）
|   |-- skill-create.md     # /skill-create - Git 履歴からスキルを生成（新規）
|   |-- instinct-status.md  # /instinct-status - 学習した直感を表示（新規）
|   |-- instinct-import.md  # /instinct-import - 直感をインポート（新規）
|   |-- instinct-export.md  # /instinct-export - 直感をエクスポート（新規）
|   |-- evolve.md           # /evolve - 直感をスキルにクラスタリング
|   |-- pm2.md              # /pm2 - PM2 サービスライフサイクル管理（新規）
|   |-- multi-plan.md       # /multi-plan - マルチエージェント タスク分解（新規）
|   |-- multi-execute.md    # /multi-execute - オーケストレーション マルチエージェント ワークフロー（新規）
|   |-- multi-backend.md    # /multi-backend - バックエンド マルチサービス オーケストレーション（新規）
|   |-- multi-frontend.md   # /multi-frontend - フロントエンド マルチサービス オーケストレーション（新規）
|   |-- multi-workflow.md   # /multi-workflow - 一般的なマルチサービス ワークフロー（新規）
|
|-- rules/            # 常に従うべきガイドライン（~/.claude/rules/ にコピー）
|   |-- README.md            # 構造概要とインストールガイド
|   |-- common/              # 言語非依存の原則
|   |   |-- coding-style.md    # イミュータビリティ、ファイル組織
|   |   |-- git-workflow.md    # コミットフォーマット、PR プロセス
|   |   |-- testing.md         # TDD、80% カバレッジ要件
|   |   |-- performance.md     # モデル選択、コンテキスト管理
|   |   |-- patterns.md        # デザインパターン、スケルトンプロジェクト
|   |   |-- hooks.md           # フック アーキテクチャ、TodoWrite
|   |   |-- agents.md          # サブエージェントへの委任時機
|   |   |-- security.md        # 必須セキュリティチェック
|   |-- typescript/          # TypeScript/JavaScript 固有
|   |-- python/              # Python 固有
|   |-- golang/              # Go 固有
|
|-- hooks/            # トリガーベースの自動化
|   |-- hooks.json                # すべてのフック設定（PreToolUse、PostToolUse、Stop など）
|   |-- memory-persistence/       # セッションライフサイクルフック（長文ガイド）
|   |-- strategic-compact/        # 圧縮提案（長文ガイド）
|
|-- scripts/          # クロスプラットフォーム Node.js スクリプト（新規）
|   |-- lib/                     # 共有ユーティリティ
|   |   |-- utils.js             # クロスプラットフォーム ファイル/パス/システムユーティリティ
|   |   |-- package-manager.js   # パッケージマネージャー検出と選択
|   |-- hooks/                   # フック実装
|   |   |-- session-start.js     # セッション開始時にコンテキストを読み込む
|   |   |-- session-end.js       # セッション終了時に状態を保存
|   |   |-- pre-compact.js       # 圧縮前の状態保存
|   |   |-- suggest-compact.js   # 戦略的圧縮提案
|   |   |-- evaluate-session.js  # セッションからパターンを抽出
|   |-- setup-package-manager.js # インタラクティブ PM セットアップ
|
|-- tests/            # テストスイート（新規）
|   |-- lib/                     # ライブラリテスト
|   |-- hooks/                   # フックテスト
|   |-- run-all.js               # すべてのテストを実行
|
|-- contexts/         # 動的システムプロンプト注入コンテキスト（長文ガイド）
|   |-- dev.md              # 開発モード コンテキスト
|   |-- review.md           # コードレビューモード コンテキスト
|   |-- research.md         # リサーチ/探索モード コンテキスト
|
|-- examples/         # 設定例とセッション
|   |-- CLAUDE.md           # プロジェクトレベル設定例
|   |-- user-CLAUDE.md      # ユーザーレベル設定例
|
|-- mcp-configs/      # MCP サーバー設定
|   |-- mcp-servers.json    # GitHub、Supabase、Vercel、Railway など
|
|-- marketplace.json  # 自己ホストマーケットプレイス設定（/plugin marketplace add 用）
```

---

## エコシステムツール

### スキル作成ツール

リポジトリから Claude Code スキルを生成する 2 つの方法：

#### オプション A：ローカル分析（ビルトイン）

外部サービスなしで、ローカル分析に `/skill-create` コマンドを使用：

```bash
/skill-create                    # 現在のリポジトリを分析
/skill-create --instincts        # 継続的学習用の直感も生成
```

これはローカルで Git 履歴を分析し、SKILL.md ファイルを生成します。

#### オプション B：GitHub アプリ（高度な機能）

高度な機能用（10k+ コミット、自動 PR、チーム共有）：

[GitHub アプリをインストール](https://github.com/apps/skill-creator) | [ecc.tools](https://ecc.tools)

```bash
# 任意の Issue にコメント：
/skill-creator analyze

# またはデフォルトブランチへのプッシュで自動トリガー
```

両オプションで生成されるもの：
- **SKILL.mdファイル** - Claude Codeですぐに使えるスキル
- **instinctコレクション** - continuous-learning-v2用
- **パターン抽出** - コミット履歴からの学習

### AgentShield — セキュリティ監査ツール

Claude Code 設定の脆弱性、誤設定、インジェクションリスクをスキャンします。

```bash
# クイックスキャン（インストール不要）
npx ecc-agentshield scan

# 安全な問題を自動修正
npx ecc-agentshield scan --fix

# Opus 4.6 による深い分析
npx ecc-agentshield scan --opus --stream

# ゼロから安全な設定を生成
npx ecc-agentshield init
```

CLAUDE.md、settings.json、MCP サーバー、フック、エージェント定義をチェックします。セキュリティグレード（A-F）と実行可能な結果を生成します。

Claude Codeで`/security-scan`を実行、または[GitHub Action](https://github.com/affaan-m/agentshield)でCIに追加できます。

[GitHub](https://github.com/affaan-m/agentshield) | [npm](https://www.npmjs.com/package/ecc-agentshield)

### 継続的学習 v2

instinctベースの学習システムがパターンを自動学習：

```bash
/instinct-status        # 信頼度付きで学習したinstinctを表示
/instinct-import <file> # 他者のinstinctをインポート
/instinct-export        # instinctをエクスポートして共有
/evolve                 # 関連するinstinctをスキルにクラスタリング
```

完全なドキュメントは`skills/continuous-learning-v2/`を参照してください。

---

## 要件

### Claude Code CLI バージョン

**最小バージョン: v2.1.0 以上**

このプラグインは Claude Code CLI v2.1.0+ が必要です。プラグインシステムがフックを処理する方法が変更されたためです。

バージョンを確認：
```bash
claude --version
```

### 重要: フック自動読み込み動作

> WARNING: **貢献者向け:** `.claude-plugin/plugin.json`に`"hooks"`フィールドを追加しないでください。これは回帰テストで強制されます。

Claude Code v2.1+は、インストール済みプラグインの`hooks/hooks.json`（規約）を自動読み込みします。`plugin.json`で明示的に宣言するとエラーが発生します：

```
Duplicate hook file detected: ./hooks/hooks.json is already resolved to a loaded file
```

**背景:** これは本リポジトリで複数の修正/リバート循環を引き起こしました（[#29](https://github.com/affaan-m/everything-claude-code/issues/29), [#52](https://github.com/affaan-m/everything-claude-code/issues/52), [#103](https://github.com/affaan-m/everything-claude-code/issues/103)）。Claude Codeバージョン間で動作が変わったため混乱がありました。今後を防ぐため回帰テストがあります。

---

## インストール

### オプション1：プラグインとしてインストール（推奨）

このリポジトリを使用する最も簡単な方法 - Claude Codeプラグインとしてインストール：

```bash
# このリポジトリをマーケットプレイスとして追加
/plugin marketplace add https://github.com/affaan-m/everything-claude-code

# プラグインをインストール
/plugin install ecc@ecc
```

または、`~/.claude/settings.json` に直接追加：

```json
{
  "extraKnownMarketplaces": {
    "ecc": {
      "source": {
        "source": "github",
        "repo": "affaan-m/everything-claude-code"
      }
    }
  },
  "enabledPlugins": {
    "ecc@ecc": true
  }
}
```

これで、すべてのコマンド、エージェント、スキル、フックにすぐにアクセスできます。

> **注:** Claude Codeプラグインシステムは`rules`をプラグイン経由で配布できません（[アップストリーム制限](https://code.claude.com/docs/en/plugins-reference)）。ルールは手動でインストールする必要があります：
>
> ```bash
> # まずリポジトリをクローン
> git clone https://github.com/affaan-m/everything-claude-code.git
>
> # オプション A：ユーザーレベルルール（すべてのプロジェクトに適用）
> mkdir -p ~/.claude/rules
> cp -r everything-claude-code/rules/common ~/.claude/rules/common
> cp -r everything-claude-code/rules/typescript ~/.claude/rules/typescript   # スタックを選択
> cp -r everything-claude-code/rules/python ~/.claude/rules/python
> cp -r everything-claude-code/rules/golang ~/.claude/rules/golang
>
> # オプション B：プロジェクトレベルルール（現在のプロジェクトのみ）
> mkdir -p .claude/rules
> cp -r everything-claude-code/rules/common .claude/rules/common
> cp -r everything-claude-code/rules/typescript .claude/rules/typescript     # スタックを選択
> ```

---

### オプション2：手動インストール

インストール内容を手動で制御したい場合：

```bash
# リポジトリをクローン
git clone https://github.com/affaan-m/everything-claude-code.git

# エージェントを Claude 設定にコピー
cp everything-claude-code/agents/*.md ~/.claude/agents/

# ルール（共通 + 言語固有）をコピー
cp -r everything-claude-code/rules/common ~/.claude/rules/common
cp -r everything-claude-code/rules/typescript ~/.claude/rules/typescript   # スタックを選択
cp -r everything-claude-code/rules/python ~/.claude/rules/python
cp -r everything-claude-code/rules/golang ~/.claude/rules/golang

# コマンドをコピー
cp everything-claude-code/commands/*.md ~/.claude/commands/

# スキルをコピー
cp -r everything-claude-code/skills/* ~/.claude/skills/
```

#### settings.json にフックを追加

手動インストール時のみ、`hooks/hooks.json` のフックを `~/.claude/settings.json` にコピーします。

`/plugin install` で ECC を導入した場合は、これらのフックを `settings.json` にコピーしないでください。Claude Code v2.1+ はプラグインの `hooks/hooks.json` を自動読み込みするため、二重登録すると重複実行や `${CLAUDE_PLUGIN_ROOT}` の解決失敗が発生します。

#### MCP を設定

`mcp-configs/mcp-servers.json` から必要な MCP サーバーを `~/.claude.json` にコピーします。

**重要:** `YOUR_*_HERE`プレースホルダーを実際のAPIキーに置き換えてください。

---

## 主要概念

### エージェント

サブエージェントは限定的な範囲のタスクを処理します。例：

```markdown
---
name: code-reviewer
description: コードの品質、セキュリティ、保守性をレビュー
tools: ["Read", "Grep", "Glob", "Bash"]
model: opus
---

あなたは経験豊富なコードレビュアーです...

```

### スキル

スキルはコマンドまたはエージェントによって呼び出されるワークフロー定義：

```markdown
# TDD ワークフロー

1. インターフェースを最初に定義
2. テストを失敗させる (RED)
3. 最小限のコードを実装 (GREEN)
4. リファクタリング (IMPROVE)
5. 80%+ のカバレッジを確認
```

### フック

フックはツールイベントでトリガーされます。例 - console.log についての警告：

```json
{
  "matcher": "tool == \"Edit\" && tool_input.file_path matches \"\\\\.(ts|tsx|js|jsx)$\"",
  "hooks": [{
    "type": "command",
    "command": "#!/bin/bash\ngrep -n 'console\\.log' \"$file_path\" && echo '[Hook] Remove console.log' >&2"
  }]
}
```

### ルール

ルールは常に従うべきガイドラインで、`common/`（言語非依存）+ 言語固有ディレクトリに組織化：

```
rules/
  common/          # 普遍的な原則（常にインストール）
  typescript/      # TS/JS 固有パターンとツール
  python/          # Python 固有パターンとツール
  golang/          # Go 固有パターンとツール
```

インストールと構造の詳細は[`rules/README.md`](rules/README.md)を参照してください。

---

## テストを実行

プラグインには包括的なテストスイートが含まれています：

```bash
# すべてのテストを実行
node tests/run-all.js

# 個別のテストファイルを実行
node tests/lib/utils.test.js
node tests/lib/package-manager.test.js
node tests/hooks/hooks.test.js
```

---

## 貢献

**貢献は大歓迎で、奨励されています。**

このリポジトリはコミュニティリソースを目指しています。以下のようなものがあれば：
- 有用なエージェントまたはスキル
- 巧妙なフック
- より良い MCP 設定
- 改善されたルール

ぜひ貢献してください！ガイドについては[CONTRIBUTING.md](CONTRIBUTING.md)を参照してください。

### 貢献アイデア

- 言語固有のスキル（Rust、C#、Swift、Kotlin） — Go、Python、Javaは既に含まれています
- フレームワーク固有の設定（Rails、Laravel、FastAPI） — Django、NestJS、Spring Bootは既に含まれています
- DevOpsエージェント（Kubernetes、Terraform、AWS、Docker）
- テスト戦略（異なるフレームワーク、ビジュアルリグレッション）
- 専門領域の知識（ML、データエンジニアリング、モバイル開発）

---

## Cursor IDE サポート

ecc-universal は [Cursor IDE](https://cursor.com) の事前翻訳設定を含みます。`.cursor/` ディレクトリには、Cursor フォーマット向けに適応されたルール、エージェント、スキル、コマンド、MCP 設定が含まれています。

### クイックスタート (Cursor)

```bash
# パッケージをインストール
npm install ecc-universal

# 言語をインストール
./install.sh --target cursor typescript
./install.sh --target cursor python golang
```

### 翻訳内容

| コンポーネント | Claude Code → Cursor | パリティ |
|-----------|---------------------|--------|
| Rules | YAML フロントマター追加、パスフラット化 | 完全 |
| Agents | モデル ID 展開、ツール → 読み取り専用フラグ | 完全 |
| Skills | 変更不要（同一の標準） | 同一 |
| Commands | パス参照更新、multi-* スタブ化 | 部分的 |
| MCP Config | 環境補間構文更新 | 完全 |
| Hooks | Cursor相当なし | 別の方法を参照 |

詳細は[.cursor/README.md](.cursor/README.md)および完全な移行ガイドは[.cursor/MIGRATION.md](.cursor/MIGRATION.md)を参照してください。

---

## OpenCodeサポート

ECCは**フルOpenCodeサポート**をプラグインとフック含めて提供。

### クイックスタート

```bash
# OpenCode をインストール
npm install -g opencode

# リポジトリルートで実行
opencode
```

設定は`.opencode/opencode.json`から自動検出されます。

### 機能パリティ

| 機能 | Claude Code | OpenCode | ステータス |
|---------|-------------|----------|--------|
| Agents | PASS: 14 エージェント | PASS: 12 エージェント | **Claude Code がリード** |
| Commands | PASS: 30 コマンド | PASS: 24 コマンド | **Claude Code がリード** |
| Skills | PASS: 28 スキル | PASS: 16 スキル | **Claude Code がリード** |
| Hooks | PASS: 3 フェーズ | PASS: 20+ イベント | **OpenCode が多い！** |
| Rules | PASS: 8 ルール | PASS: 8 ルール | **完全パリティ** |
| MCP Servers | PASS: 完全 | PASS: 完全 | **完全パリティ** |
| Custom Tools | PASS: フック経由 | PASS: ネイティブサポート | **OpenCode がより良い** |

### プラグイン経由のフックサポート

OpenCodeのプラグインシステムはClaude Codeより高度で、20+イベントタイプ：

| Claude Code フック | OpenCode プラグインイベント |
|-----------------|----------------------|
| PreToolUse | `tool.execute.before` |
| PostToolUse | `tool.execute.after` |
| Stop | `session.idle` |
| SessionStart | `session.created` |
| SessionEnd | `session.deleted` |

**追加OpenCodeイベント**: `file.edited`, `file.watcher.updated`, `message.updated`, `lsp.client.diagnostics`, `tui.toast.show`など。

### 利用可能なコマンド（24）

| コマンド | 説明 |
|---------|-------------|
| `/plan` | 実装計画を作成 |
| `/tdd` | TDD ワークフロー実行 |
| `/code-review` | コード変更をレビュー |
| `/security` | セキュリティレビュー実行 |
| `/build-fix` | ビルドエラーを修正 |
| `/e2e` | E2E テストを生成 |
| `/refactor-clean` | デッドコードを削除 |
| `/orchestrate` | マルチエージェント ワークフロー |
| `/learn` | セッションからパターン抽出 |
| `/checkpoint` | 検証状態を保存 |
| `/verify` | 検証ループを実行 |
| `/eval` | 基準に対して評価 |
| `/update-docs` | ドキュメントを更新 |
| `/update-codemaps` | コードマップを更新 |
| `/test-coverage` | カバレッジを分析 |
| `/go-review` | Go コードレビュー |
| `/go-test` | Go TDD ワークフロー |
| `/go-build` | Go ビルドエラーを修正 |
| `/skill-create` | Git からスキル生成 |
| `/instinct-status` | 学習した直感を表示 |
| `/instinct-import` | 直感をインポート |
| `/instinct-export` | 直感をエクスポート |
| `/evolve` | 直感をスキルにクラスタリング |
| `/setup-pm` | パッケージマネージャーを設定 |

### プラグインインストール

**オプション1：直接使用**
```bash
cd everything-claude-code
opencode
```

**オプション2：npmパッケージとしてインストール**
```bash
npm install ecc-universal
```

その後`opencode.json`に追加：
```json
{
  "plugin": ["ecc-universal"]
}
```

### ドキュメンテーション

- **移行ガイド**: `.opencode/MIGRATION.md`
- **OpenCode プラグイン README**: `.opencode/README.md`
- **統合ルール**: `.opencode/instructions/INSTRUCTIONS.md`
- **LLM ドキュメンテーション**: `llms.txt`（完全な OpenCode ドキュメント）

---

## 背景

実験的なリリース以来、Claude Codeを使用してきました。2025年9月、[@DRodriguezFX](https://x.com/DRodriguezFX)と一緒にClaude Codeで[zenith.chat](https://zenith.chat)を構築し、Anthropic x Forum Venturesハッカソンで優勝しました。

これらの設定は複数の本番環境アプリケーションで実戦テストされています。

---

## WARNING: 重要な注記

### コンテキストウィンドウ管理

**重要:** すべてのMCPを一度に有効にしないでください。多くのツールを有効にすると、200kのコンテキストウィンドウが70kに縮小される可能性があります。

経験則：
- 20-30のMCPを設定
- プロジェクトごとに10未満を有効にしたままにしておく
- アクティブなツール80未満

プロジェクト設定で`disabledMcpServers`を使用して、未使用のツールを無効にします。

### カスタマイズ

これらの設定は私のワークフロー用です。あなたは以下を行うべきです：
1. 共感できる部分から始める
2. 技術スタックに合わせて修正
3. 使用しない部分を削除
4. 独自のパターンを追加

---

## Star 履歴

[![Star History Chart](https://api.star-history.com/svg?repos=affaan-m/everything-claude-code&type=Date)](https://star-history.com/#affaan-m/everything-claude-code&Date)

---

## リンク

- **簡潔ガイド（まずはこれ）:** [Everything Claude Code 簡潔ガイド](https://x.com/affaanmustafa/status/2012378465664745795)
- **詳細ガイド（高度）:** [Everything Claude Code 詳細ガイド](https://x.com/affaanmustafa/status/2014040193557471352)
- **フォロー:** [@affaanmustafa](https://x.com/affaanmustafa)
- **zenith.chat:** [zenith.chat](https://zenith.chat)
- **スキル ディレクトリ:** awesome-agent-skills（コミュニティ管理のエージェントスキル ディレクトリ）

---

## ライセンス

MIT - 自由に使用、必要に応じて修正、可能であれば貢献してください。

---

**このリポジトリが役に立ったら、Star を付けてください。両方のガイドを読んでください。素晴らしいものを構築してください。**
