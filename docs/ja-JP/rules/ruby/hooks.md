---
paths:
  - "**/*.rb"
  - "**/*.rake"
  - "**/Gemfile"
  - "**/Gemfile.lock"
  - "**/config/routes.rb"
---
# Ruby フック

> このファイルは [common/hooks.md](../common/hooks.md) を Ruby および Rails 固有のコンテンツで拡張します。

## PostToolUse フック

binstub とチェックイン済みツールを優先するようにプロジェクトローカルのフックを設定する:

- **RuboCop**: Ruby 編集後に `bundle exec rubocop -A <file>` またはプロジェクトのより安全なフォーマッタコマンドを実行する。
- **Brakeman**: セキュリティに関わる Rails の変更後に `bundle exec brakeman --no-pager` を実行する。
- **テスト**: 変更されたファイルに対して最も狭い範囲の `bin/rails test ...` または `bundle exec rspec ...` コマンドを実行する。
- **Bundler audit**: `Gemfile` または `Gemfile.lock` が変更され、プロジェクトに bundler-audit がインストールされている場合、`bundle exec bundle-audit check --update` を実行する。

## 警告

- アプリケーションコードにコミットされた `debugger`、`binding.irb`、`binding.pry`、`puts`、`pp`、`p` の呼び出しに対して警告する。
- 編集が CSRF 保護を無効にしたり、マスアサインメントを拡大したり、パラメータ化なしで生の SQL を追加した場合に警告する。
- マイグレーションが可逆的なパスや文書化されたロールアウト計画なしにデータを破壊的に変更する場合に警告する。

## CI ゲートの提案

```bash
bundle exec rubocop
bundle exec brakeman --no-pager
bin/rails test
bundle exec rspec
```

プロジェクトに存在するコマンドのみを使用する。メンテナーの承認なしに新しいフック依存関係をインストールしない。
