# 変更履歴

## 2.0.0-rc.1 - 2026-04-28

### ハイライト

- HermesオペレーターストーリーのためのパブリックECC 2.0リリース候補サーフェスを追加。
- Claude Code、Codex、Cursor、OpenCode、Gemini全体で再利用可能なクロスハーネス基盤としてECCをドキュメント化。
- プライベートなオペレーター状態を公開する代わりに、サニタイズされたHermesインポートスキルサーフェスを追加。

### リリースサーフェス

- パッケージ、プラグイン、マーケットプレイス、OpenCode、エージェント、READMEのメタデータを `2.0.0-rc.1` に更新。
- `docs/releases/2.0.0-rc.1/` にリリースノート、ソーシャル草稿、ローンチチェックリスト、引き継ぎノート、デモプロンプトを追加。
- `docs/architecture/cross-harness.md` とECC/Hermesバウンダリのリグレッションカバレッジを追加。
- `ecc2/` のバージョニングは現時点では独立を維持；リリースエンジニアリングが別途決定しない限り、アルファコントロールプレーンのスキャフォールドのまま。

### 注記

- これはリリース候補であり、完全なECC 2.0コントロールプレーンロードマップのGA宣言ではありません。
- プレリリースnpm公開は、リリースエンジニアリングが明示的に別途選択しない限り `next` distタグを使用してください。

## 1.10.0 - 2026-04-05

### ハイライト

- 数週間にわたるOSSの成長とバックログマージ後に、ライブリポジトリと同期したパブリックリリースサーフェス。
- オペレーターワークフローレーンが音声、グラフランキング、課金、ワークスペース、アウトバウンドスキルで拡張。
- メディア生成レーンがManim、Remotionファーストのローンチツールで拡張。
- ECC 2.0アルファコントロールプレーンバイナリが `ecc2/` からローカルビルド可能になり、最初の使用可能なCLI/TUIサーフェスを公開。

### リリースサーフェス

- プラグイン、マーケットプレイス、Codex、OpenCode、エージェントのメタデータを `1.10.0` に更新。
- 公開数をライブOSSサーフェスに同期：エージェント38、スキル156、コマンド72。
- 現在のリポジトリ状態に合わせてトップレベルのインストール向けドキュメントとマーケットプレイスの説明を更新。

### 新しいワークフローレーン

- `brand-voice` — 正規のソース派生ライティングスタイルシステム。
- `social-graph-ranker` — 重み付きウォームイントログラフランキングプリミティブ。
- `connections-optimizer` — グラフランキング上のネットワーク整理/追加ワークフロー。
- `customer-billing-ops`、`google-workspace-ops`、`project-flow-ops`、`workspace-surface-audit`。
- `manim-video`、`remotion-video-creation`、`nestjs-patterns`。

### ECC 2.0アルファ

- `cargo build --manifest-path ecc2/Cargo.toml` がリポジトリのベースラインで通過。
- `ecc-tui` は現在 `dashboard`、`start`、`sessions`、`status`、`stop`、`resume`、`daemon` を公開。
- アルファはローカル実験で実際に使用可能だが、より広範なコントロールプレーンロードマップは未完成であり、GAとして扱うべきではない。

### 注記

- Claudeプラグインはプラットフォームレベルのルール配布の制約により制限されたまま；選択的インストール/OSSパスが依然として最も信頼性の高い完全インストール方法。
- このリリースはリポジトリサーフェスの修正とエコシステム同期であり、完全なECC 2.0ロードマップが完成したという主張ではありません。

## 1.9.0 - 2026-03-20

### ハイライト

- マニフェスト駆動のパイプラインとSQLite状態ストアによる選択的インストールアーキテクチャ。
- 言語カバレッジが6つの新しいエージェントと言語固有ルールで10以上のエコシステムに拡張。
- メモリスロットリング、サンドボックス修正、5層ループガードによるオブザーバーの信頼性強化。
- スキル進化とセッションアダプターによる自己改善スキルの基盤。

### 新しいエージェント

- `typescript-reviewer` — TypeScript/JavaScriptコードレビュースペシャリスト (#647)
- `pytorch-build-resolver` — PyTorchランタイム、CUDA、トレーニングエラー解決 (#549)
- `java-build-resolver` — Maven/Gradleビルドエラー解決 (#538)
- `java-reviewer` — JavaおよびSpring Bootコードレビュー (#528)
- `kotlin-reviewer` — Kotlin/Android/KMPコードレビュー (#309)
- `kotlin-build-resolver` — Kotlin/Gradleビルドエラー (#309)
- `rust-reviewer` — Rustコードレビュー (#523)
- `rust-build-resolver` — Rustビルドエラー解決 (#523)
- `docs-lookup` — ドキュメントとAPIリファレンスの調査 (#529)

### 新しいスキル

- `pytorch-patterns` — PyTorchディープラーニングワークフロー (#550)
- `documentation-lookup` — APIリファレンスとライブラリドキュメントの調査 (#529)
- `bun-runtime` — Bunランタイムパターン (#529)
- `nextjs-turbopack` — Next.js Turbopackワークフロー (#529)
- `mcp-server-patterns` — MCPサーバー設計パターン (#531)
- `data-scraper-agent` — AI駆動のパブリックデータ収集 (#503)
- `team-builder` — チーム構成スキル (#501)
- `ai-regression-testing` — AIリグレッションテストワークフロー (#433)
- `claude-devfleet` — マルチエージェントオーケストレーション (#505)
- `blueprint` — マルチセッション構築計画
- `everything-claude-code` — 自己参照型ECCスキル (#335)
- `prompt-optimizer` — プロンプト最適化スキル (#418)
- 8つのEvos運用ドメインスキル (#290)
- 3つのLaravelスキル (#420)
- VideoDBスキル (#301)

### 新しいコマンド

- `/docs` — ドキュメントルックアップ (#530)
- `/aside` — サイドカンバセーション (#407)
- `/prompt-optimize` — プロンプト最適化 (#418)
- `/resume-session`、`/save-session` — セッション管理
- チェックリストベースの総合評価による `learn-eval` の改善

### 新しいルール

- Java言語ルール (#645)
- PHPルールパック (#389)
- Perl言語ルールとスキル（パターン、セキュリティ、テスト）
- Kotlin/Android/KMPルール (#309)
- C++言語サポート (#539)
- Rust言語サポート (#523)

### インフラストラクチャ

- マニフェスト解決による選択的インストールアーキテクチャ（`install-plan.js`、`install-apply.js`）(#509, #512)
- インストール済みコンポーネントを追跡するためのクエリCLI付きSQLite状態ストア (#510)
- 構造化セッション記録のためのセッションアダプター (#511)
- 自己改善スキルのためのスキル進化基盤 (#514)
- 決定論的スコアリングによるオーケストレーションハーネス (#524)
- CIでのカタログカウント強制 (#525)
- 109すべてのスキルのインストールマニフェスト検証 (#537)
- PowerShellインストーラーラッパー (#532)
- `--target antigravity` フラグによるAntigravity IDEサポート (#332)
- Codex CLIカスタマイズスクリプト (#336)

### バグ修正

- 6ファイルにわたる19件のCIテスト失敗を解決 (#519)
- インストールパイプライン、オーケストレーター、リペアの8件のテスト失敗を修正 (#564)
- スロットリング、再入ガード、テールサンプリングによるオブザーバーのメモリ爆発 (#536)
- Haiku呼び出しのためのオブザーバーサンドボックスアクセス修正 (#661)
- ワークツリープロジェクトIDの不一致修正 (#665)
- オブザーバーの遅延起動ロジック (#508)
- オブザーバーの5層ループ防止ガード (#399)
- フックのポータビリティとWindows .cmdサポート
- Biomeフック最適化 — npxオーバーヘッドを排除 (#359)
- InsAItsセキュリティフックをオプトイン化 (#370)
- Windows spawnSync エクスポート修正 (#431)
- instinct CLIのUTF-8エンコーディング修正 (#353)
- フックでのシークレットスクラビング (#348)

### 翻訳

- 韓国語（ko-KR）翻訳 — README、エージェント、コマンド、スキル、ルール (#392)
- 中国語（zh-CN）ドキュメント同期 (#428)

### クレジット

- @ymdvsymd — オブザーバーサンドボックスとワークツリー修正
- @pythonstrup — Biomeフック最適化
- @Nomadu27 — InsAItsセキュリティフック
- @hahmee — 韓国語翻訳
- @zdocapp — 中国語翻訳同期
- @cookiee339 — Kotlinエコシステム
- @pangerlkr — CIワークフロー修正
- @0xrohitgarg — VideoDBスキル
- @nocodemf — Evos運用スキル
- @swarnika-cmd — コミュニティへの貢献

## 1.8.0 - 2026-03-04

### ハイライト

- 信頼性、eval規律、自律ループ操作に焦点を当てたハーネスファーストリリース。
- フックランタイムがプロファイルベースの制御とターゲットを絞ったフック無効化をサポート。
- NanoClaw v2がモデルルーティング、スキルホットロード、ブランチング、検索、コンパクション、エクスポート、メトリクスを追加。

### コア

- 新しいコマンドを追加：`/harness-audit`、`/loop-start`、`/loop-status`、`/quality-gate`、`/model-route`。
- 新しいスキルを追加：
  - `agent-harness-construction`
  - `agentic-engineering`
  - `ralphinho-rfc-pipeline`
  - `ai-first-engineering`
  - `enterprise-agent-ops`
  - `nanoclaw-repl`
  - `continuous-agent-loop`
- 新しいエージェントを追加：
  - `harness-optimizer`
  - `loop-operator`

### フックの信頼性

- 堅牢なフォールバック検索によるSessionStartルート解決を修正。
- トランスクリプトのペイロードが利用可能な `Stop` にセッションサマリーの永続化を移動。
- 品質ゲートとコストトラッカーフックを追加。
- 脆弱なインラインフックのワンライナーを専用スクリプトファイルに置き換え。
- `ECC_HOOK_PROFILE` と `ECC_DISABLED_HOOKS` 制御を追加。

### クロスプラットフォーム

- ドキュメント警告ロジックでのWindowsセーフなパス処理を改善。
- 非インタラクティブなハングを避けるためにオブザーバーのループ動作を強化。

### 注記

- `autonomous-loops` は1リリース分の互換性エイリアスとして保持；`continuous-agent-loop` が正規名称。

### クレジット

- [zarazhangrui](https://github.com/zarazhangrui) にインスパイアされて
- [humanplane](https://github.com/humanplane) にインスパイアされたホムンクルス
