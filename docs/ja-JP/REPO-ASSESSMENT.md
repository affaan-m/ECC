# リポジトリ・フォーク評価とセットアップ推奨事項

**日付:** 2026-03-21

---

## 利用可能なもの

### リポジトリ: `Infiniteyieldai/everything-claude-code`

これは**`affaan-m/everything-claude-code`のフォーク**です（スター数50K以上、フォーク数6K以上のアップストリームプロジェクト）。

| 属性 | 値 |
|------|-----|
| バージョン | 1.9.0（最新） |
| ステータス | クリーンなフォーク — アップストリーム `main` より1コミット先行（このセッションで追加されたEVALUATION.mdドキュメント） |
| リモートブランチ | `main`、`claude/evaluate-repo-comparison-ASZ9Y` |
| アップストリーム同期 | 完全同期済み — マージ済みの最後のアップストリームコミットはzh-CNドキュメントのPR（#728） |
| ライセンス | MIT |

**これが作業対象として正しいリポジトリです。** 最新のアップストリームバージョンであり、差分もマージコンフリクトもありません。

---

### 現在の `~/.claude/` インストール状況

| コンポーネント | インストール済み | リポジトリで利用可能 |
|--------------|----------------|-------------------|
| エージェント | 0 | 28 |
| スキル | 0 | 116 |
| コマンド | 0 | 59 |
| ルール | 0 | 60以上のファイル（12言語） |
| フック | 1（git Stopチェック） | PreToolUse/PostToolUseフルマトリックス |
| MCP設定 | 0 | 1（Context7） |

既存のStopフック（`stop-hook-git-check.sh`）は堅牢です — コミット/プッシュ未完了の作業があるときにセッション終了をブロックします。このまま維持してください。

---

## インストールプロファイルの推奨事項

リポジトリには5つのインストールプロファイルが用意されています。主な用途に応じて選択してください。

### プロファイル: `core`（最小限の構成）
> 最もインストールが速い。コマンド、コアエージェント、フックランタイム、品質ワークフローを提供する。

**適している場面:** ECCを試す場合、フットプリントを最小限に抑えたい場合、制約のある環境。

```bash
node scripts/install-plan.js --profile core
node scripts/install-apply.js
```

**インストール対象:** rules-core、agents-core、commands-core、hooks-runtime、platform-configs、workflow-quality

---

### プロファイル: `developer`（日常的な開発作業に推奨）
> ほとんどのECCユーザー向けのデフォルトエンジニアリングプロファイル。

**適している場面:** アプリケーションコードベースを横断した一般的なソフトウェア開発。

```bash
node scripts/install-plan.js --profile developer
node scripts/install-apply.js
```

**coreに追加されるもの:** フレームワーク・言語スキル、データベースパターン、オーケストレーションコマンド

---

### プロファイル: `security`
> ベースラインランタイムにセキュリティ特化エージェントとルールを追加。

**適している場面:** セキュリティ重視のワークフロー、コード監査、脆弱性レビュー。

---

### プロファイル: `research`
> 調査、情報統合、公開のワークフロー。

**適している場面:** コンテンツ制作、投資家向け資料、市場調査、クロスポスト。

---

### プロファイル: `full`
> すべてのモジュール18個を含む完全版。

**適している場面:** 完全なツールキットを求めるパワーユーザー。

```bash
node scripts/install-plan.js --profile full
node scripts/install-apply.js
```

---

## 優先追加項目（高価値・低リスク）

プロファイルに関わらず、以下のコンポーネントは即座に価値を発揮します。

### 1. コアエージェント（最高のROI）

| エージェント | 重要な理由 |
|------------|-----------|
| `planner.md` | 複雑なタスクを実装計画に分解する |
| `code-reviewer.md` | 品質と保守性のレビュー |
| `tdd-guide.md` | TDDワークフロー（RED→GREEN→IMPROVE） |
| `security-reviewer.md` | 脆弱性検出 |
| `architect.md` | システム設計とスケーラビリティの意思決定 |

### 2. 主要コマンド

| コマンド | 重要な理由 |
|---------|-----------|
| `/plan` | コーディング前の実装計画 |
| `/tdd` | テスト駆動ワークフロー |
| `/code-review` | オンデマンドレビュー |
| `/build-fix` | ビルドエラーの自動解決 |
| `/learn` | 現在のセッションからパターンを抽出 |

### 3. フックのアップグレード（`hooks/hooks.json`から）
リポジトリのフックシステムは、現在の単一Stopフックに以下を追加します。

| フック | トリガー | 価値 |
|--------|---------|------|
| `block-no-verify` | PreToolUse: Bash | `--no-verify` gitフラグの不正使用をブロック |
| `pre-bash-git-push-reminder` | PreToolUse: Bash | プッシュ前のレビューリマインダー |
| `doc-file-warning` | PreToolUse: Write | 非標準ドキュメントファイルへの警告 |
| `suggest-compact` | PreToolUse: Edit/Write | 論理的な間隔でコンパクション提案 |
| 継続学習オブザーバー | PreToolUse: * | スキル改善のためのツール使用パターン収集 |

### 4. ルール（常時有効のガイドライン）
`rules/common/` ディレクトリには、すべてのセッションで機能するベースラインガイドラインが含まれています。
- `security.md` — セキュリティガードレール
- `testing.md` — 80%以上のカバレッジ要件
- `git-workflow.md` — コンベンショナルコミット、ブランチ戦略
- `coding-style.md` — 言語横断スタイル標準

---

## フォークの活用方法

### オプションA: アップストリームトラッカーとして使用（現在の状態）
フォークを `affaan-m/everything-claude-code` アップストリームと同期し続ける。定期的にアップストリームの変更をマージする:
```bash
git fetch upstream
git merge upstream/main
```
ローカルクローンからインストールする。これはクリーンで保守性が高い方法です。

### オプションB: フォークのカスタマイズ
個人的なスキル、エージェント、コマンドをフォークに追加する。以下の用途に適しています。
- ビジネス固有のドメインスキル（自分の専門領域）
- チーム固有のコーディング規約
- 自分のスタック向けカスタムフック

フォークにはすでにEVALUATION.mdとREPO-ASSESSMENT.mdのドキュメントがありますが、これは作業フォークとして問題ありません。

### オプションC: npmからインストール（新規マシンに最も簡単）
```bash
npx ecc-universal install --profile developer
```
リポジトリをクローンする必要はありません。ほとんどのユーザーに推奨されるインストール方法です。

---

## 推奨セットアップ手順

1. **既存のStopフックを維持する** — 正しく機能しています
2. **ローカルフォークからdeveloperプロファイルをインストールする**:
   ```bash
   cd /path/to/everything-claude-code
   node scripts/install-plan.js --profile developer
   node scripts/install-apply.js
   ```
3. **主要スタックの言語ルールを追加する**（TypeScript、Python、Go等）:
   ```bash
   node scripts/install-plan.js --add rules/typescript
   node scripts/install-apply.js
   ```
4. **MCP Context7を有効にする** — ライブドキュメント検索のために:
   - `mcp-configs/mcp-servers.json` をプロジェクトの `.claude/` ディレクトリにコピーする
5. **フックを確認する** — `hooks/hooks.json` の追加分を選択的に有効化する。まず `block-no-verify` と `pre-bash-git-push-reminder` から始めることを推奨

---

## まとめ

| 質問 | 回答 |
|------|------|
| フォークは健全か? | はい — アップストリームv1.9.0と完全同期済み |
| 検討すべき他のフォークはあるか? | この環境では見当たらない；アップストリーム `affaan-m/everything-claude-code` が信頼できる情報源 |
| 最適なインストールプロファイルは? | 日常的な開発作業には `developer` |
| 現在のセットアップで最大のギャップは? | エージェントが0個インストールされていない — 最低限追加すべき: planner、code-reviewer、tdd-guide、security-reviewer |
| 最も手軽な改善策は? | `node scripts/install-plan.js --profile core && node scripts/install-apply.js` を実行する |
