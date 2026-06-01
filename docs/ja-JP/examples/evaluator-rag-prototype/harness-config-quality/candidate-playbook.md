# ハーネス設定品質プレイブック

Candidate id: `adapter-matrix-backed-drift-check`

PR・インストール変更・セットアップ推奨が、MCP・プラグイン・フック・コマンド・エージェント・ルール・インストールターゲット・ハーネスアダプターサーフェスに触れる場合に、このプレイブックを使用してください。

## 受け入れパス

1. 変更したハーネス/設定サーフェスを特定する。
2. `docs/architecture/harness-adapter-compliance.md` または `scripts/lib/harness-adapter-compliance.js` からアダプターの状態を取得する。
3. ハーネスが `Native`・`Adapter-backed`・`Instruction-backed`・`Reference-only` のいずれであるかを記録する。
4. マトリクスからインストール/オンランプパスと確認コマンドを明記する。
5. マージ・ドライラン・明示的な上書き禁止動作を使用して、既存のユーザーおよびプロジェクト設定を保持する。
6. 関連するバリデーションゲートを実行する:
   - `npm run harness:adapters -- --check`
   - `npm run harness:audit -- --format json`
   - `node tests/lib/install-targets.test.js`
   - `node tests/opencode-plugin-hooks.test.js`
   - `node tests/docs/mcp-management-docs.test.js`
7. 証拠がハーネスの状態と一致し、設定の保持動作が明示的である場合にのみ、設定の推奨を昇格させる。

## 拒否パス

アダプターマトリクスとテストが証明していない限り、Codex・Gemini・Zed・OpenCode・その他のハーネスに対して Claude フックの同等性を主張してはならない。

マージ/ドライランパスおよびロールバックノートなしに、`settings.json`・MCP 設定・プラグインマニフェスト・ルールファイル・コマンドサーフェスを上書きしてはならない。

エバリュエーター実行から、稼働中の MCP サーバーの切り替え・プラグインの公開・ユーザーレベルのハーネス設定の編集を行ってはならない。

## 最低限のバリデーション

- `npm run harness:adapters -- --check`
- `npm run harness:audit -- --format json`
- 変更したサーフェスに対する、絞り込まれたインストール・プラグイン・MCP・フックのテスト
- `git diff --check`
- ドキュメントを変更した場合は Markdown lint

アダプターの状態・リスクノート・バリデーションコマンド・設定の保持動作をメンテナーの PR 本文またはハンドオフに記録すること。
