# リポジトリ評価 vs 現在のセットアップ

**日付：** 2026年3月21日
**ブランチ：** `claude/evaluate-repo-comparison-ASZ9Y`

---

## 現在のセットアップ（`~/.claude/`）

アクティブなClaude Codeインストールはほぼ最小構成：

| コンポーネント | 現在 |
|---------------|------|
| エージェント | 0 |
| スキル | 0（インストール済み） |
| コマンド | 0 |
| フック | 1（Stop: gitチェック） |
| ルール | 0 |
| MCP設定 | 0 |

**インストール済みフック：**
- `Stop` → `stop-hook-git-check.sh` — コミットされていない変更やプッシュされていないコミットがある場合にセッション終了をブロック

**インストール済みパーミッション：**
- `Skill` — スキルの呼び出しを許可

**プラグイン：** `blocklist.json`のみ（アクティブなプラグインなし）

---

## このリポジトリ（`everything-claude-code` v1.9.0）

| コンポーネント | リポジトリ |
|---------------|-----------|
| エージェント | 28 |
| スキル | 116 |
| コマンド | 59 |
| ルールセット | 12言語 + 共通（60以上のルールファイル） |
| フック | 包括的システム（PreToolUse、PostToolUse、SessionStart、Stop） |
| MCP設定 | 1（Context7 + その他） |
| スキーマ | 9つのJSONバリデーター |
| スクリプト/CLI | 46以上のNode.jsモジュール + 複数のCLI |
| テスト | 58のテストファイル |
| インストールプロファイル | core、developer、security、research、full |
| 対応ハーネス | Claude Code、Codex、Cursor、OpenCode |

---

## ギャップ分析

### フック
- **現在：** 1つのStopフック（git衛生チェック）
- **リポジトリ：** 以下をカバーする完全なフックマトリクス：
  - 危険なコマンドのブロック（`rm -rf`、強制プッシュ）
  - ファイル編集時の自動フォーマット
  - 開発サーバーのtmux強制
  - コスト追跡
  - セッション評価とガバナンスキャプチャ
  - MCPヘルスモニタリング

### エージェント（28個不足）
リポジトリは主要なワークフローごとに専門エージェントを提供：
- 言語レビュアー：TypeScript、Python、Go、Java、Kotlin、Rust、C++、Flutter
- ビルドリゾルバー：Go、Java、Kotlin、Rust、C++、PyTorch
- ワークフローエージェント：planner、tdd-guide、code-reviewer、security-reviewer、architect
- 自動化：loop-operator、doc-updater、refactor-cleaner、harness-optimizer

### スキル（116個不足）
以下をカバーするドメイン知識モジュール：
- 言語パターン（Python、Go、Kotlin、Rust、C++、Java、Swift、Perl、Laravel、Django）
- テスト戦略（TDD、E2E、カバレッジ）
- アーキテクチャパターン（バックエンド、フロントエンド、API設計、データベースマイグレーション）
- AI/MLワークフロー（Claude API、評価ハーネス、エージェントループ、コスト意識パイプライン）
- ビジネスワークフロー（投資家向け資料、市場調査、コンテンツエンジン）

### コマンド（59個不足）
- `/tdd`、`/plan`、`/e2e`、`/code-review` — コア開発ワークフロー
- `/sessions`、`/save-session`、`/resume-session` — セッション永続化
- `/orchestrate`、`/multi-plan`、`/multi-execute` — マルチエージェント協調
- `/learn`、`/skill-create`、`/evolve` — 継続的改善
- `/build-fix`、`/verify`、`/quality-gate` — ビルド/品質自動化

### ルール（60以上のファイルが不足）
以下の言語固有のコーディングスタイル、パターン、テスト、セキュリティガイドライン：
TypeScript、Python、Go、Java、Kotlin、Rust、C++、C#、Swift、Perl、PHP、および共通/クロス言語ルール。

---

## 推奨事項

### 即座に価値を得られるもの（coreインストール）
`ecc install --profile core` を実行して以下を取得：
- コアエージェント（code-reviewer、planner、tdd-guide、security-reviewer）
- 必須スキル（tdd-workflow、coding-standards、security-review）
- 主要コマンド（/tdd、/plan、/code-review、/build-fix）

### フルインストール
`ecc install --profile full` を実行して全28エージェント、116スキル、59コマンドを取得。

### フックのアップグレード
現在のStopフックは堅実です。リポジトリの`hooks.json`は以下を追加：
- 危険なコマンドのブロック（安全性）
- 自動フォーマット（品質）
- コスト追跡（可観測性）
- セッション評価（学習）

### ルール
言語ルール（例：TypeScript、Python）を追加することで、セッションごとのプロンプトに依存せず、常時有効なコーディングガイドラインを提供。

---

## 現在のセットアップの優れている点

- `stop-hook-git-check.sh` Stopフックはプロダクション品質で、良好なgit衛生を既に強制している
- `Skill` パーミッションが正しく設定されている
- セットアップがクリーンで、競合やゴミがない

---

## まとめ

現在のセットアップは、1つの優れた実装のgit衛生フックを持つ基本的にブランクスレートです。このリポジトリは、エージェント、スキル、コマンド、フック、ルールをカバーする完全でプロダクションテスト済みの拡張レイヤーを提供し、設定を肥大化させずに必要なものだけを追加できる選択的インストールシステムを備えています。
