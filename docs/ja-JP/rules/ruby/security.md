---
paths:
  - "**/*.rb"
  - "**/*.rake"
  - "**/Gemfile"
  - "**/Gemfile.lock"
  - "**/config/routes.rb"
  - "**/config/credentials*.yml.enc"
---
# Ruby セキュリティ

> このファイルは [common/security.md](../common/security.md) を Ruby および Rails 固有のコンテンツで拡張します。

## Rails デフォルト

- 状態を変更するブラウザリクエストでは CSRF 保護を有効にしておく。
- マスアサインメントの前に strong parameters または型付き境界オブジェクトを使用する。
- シークレットは Rails credentials、環境変数、またはシークレットマネージャーに保存する。平文のキー、トークン、プライベート資格情報、またはコピーした `.env` 値をコミットしない。

## SQL と Active Record

- Active Record クエリ API とパラメータ化された SQL を優先する。
- リクエスト、Cookie、ヘッダー、ジョブ、または Webhook の値を SQL 文字列に補間しない。
- モデルコールバックのスコープを慎重に設定する。セキュリティに関わる副作用は明示的にし、テストでカバーする。

## 認証とセッション

- シンプルなセッション認証には Rails 8 認証ジェネレータを使用する。OAuth、MFA、confirmable、lockable、マルチモデル認証、または既存の Devise 規約が必要な場合は Devise を使用する。
- サインインと権限変更後にセッションをローテーションする。
- アカウント回復フローは有効期限、ワンタイムトークン、レート制限、および監査ログで保護する。

## 依存関係

- ロックファイルが変更された時に依存関係チェックを実行する:

```bash
bundle audit check --update
bundle exec brakeman --no-pager
```

- 新しい gem については、メンテナーの活動状況、ネイティブ拡張のリスク、推移的依存関係、および Rails コアで同じ動作を実装できるかどうかを確認する。

## Web セーフティ

- デフォルトでテンプレート出力をエスケープする。`html_safe`、`raw`、およびカスタムサニタイザーはセキュリティに関わるコードとして扱う。
- ファイルアップロードはコンテンツタイプ、拡張子、サイズ、および保存先で検証する。
- バックグラウンドジョブ、Webhook、Action Cable メッセージ、および Turbo Stream 入力は信頼されない境界として扱う。

## 参考

セキュア・バイ・デフォルトのレビューパターンについてはスキル: `security-review` を参照。
