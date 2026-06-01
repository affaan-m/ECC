# メモリ永続化フック

これらのライフサイクルフック定義は、Claude Code プラグインおよび手動インストールに対する ECC のメモリ永続化コントラクトを文書化したものです。

実行可能な実装は `scripts/hooks/` に配置されています:

- `session-start.js` は、有界な過去のコンテキストを読み込み、プロジェクトの状態を検出し、セッションメタデータを準備します。
- `pre-compact.js` は、コンテキスト圧縮の前に状態を保存します。
- `session-end.js` は、トランスクリプトのメタデータが利用可能な場合にセッション終了時のサマリーを永続化します。
- `observe-runner.js` は、継続的な学習のためにツール使用の観察結果を記録します。
- `session-activity-tracker.js` は、ECC2 のステータスと可観測性のためにツールの使用状況とファイルアクティビティを記録します。

インストール済みのフックグラフは引き続き `hooks/hooks.json` です。このディレクトリは、ハーネス監査および詳細なドキュメントから参照される、安定した人間可読なライフサイクル定義サーフェスです。

## ライフサイクルコントラクト

| イベント | フック | 目的 | ブロッキング |
|---|---|---|---|
| `SessionStart` | `session:start` | 有界な過去のコンテキストとプロジェクトメタデータを読み込む | いいえ |
| `PreCompact` | `pre:compact` | 圧縮前に状態を保存する | いいえ |
| `PreToolUse` | `pre:observe:continuous-learning` | 学習シグナルのためにツールの意図を取得する | いいえ |
| `PostToolUse` | `post:observe:continuous-learning` | 学習シグナルのためにツールの結果を取得する | いいえ |
| `PostToolUse` | `post:session-activity-tracker` | ECC2 メトリクスのためにツールとファイルのアクティビティを記録する | いいえ |
| `Stop` | `stop:format-typecheck` | 編集後のバッチ品質ゲート | フック失敗時にあり |
| `Stop` | `stop:check-console-log` | 変更されたファイルのデバッグログを監査する | フック出力による警告/エラー |

## オペレーターの期待事項

- デフォルトでは永続化をローカルに保つ。
- ユーザーが明示的にインテグレーションを有効にした場合を除き、トランスクリプトやツールトレースをホスト型サービスに送信しない。
- セッション開始時に読み込まれるコンテキストを `ECC_SESSION_START_MAX_CHARS` で制限する。
- `ECC_SESSION_START_CONTEXT=off` によるオプトアウトを許可する。
- `ECC_HOOK_PROFILE` および `ECC_DISABLED_HOOKS` を通じてライフサイクルフックをプロファイルゲートで管理する。

## 関連ファイル

- `hooks/hooks.json`
- `hooks/README.md`
- `scripts/hooks/session-start.js`
- `scripts/hooks/pre-compact.js`
- `scripts/hooks/session-end.js`
- `scripts/hooks/observe-runner.js`
- `scripts/hooks/session-activity-tracker.js`
- `docs/architecture/observability-readiness.md`
