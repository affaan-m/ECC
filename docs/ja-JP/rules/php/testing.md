---
paths:
  - "**/*.php"
  - "**/phpunit.xml"
  - "**/phpunit.xml.dist"
  - "**/composer.json"
---
# PHP テスト

> このファイルは [common/testing.md](../common/testing.md) を PHP 固有のコンテンツで拡張します。

## フレームワーク

デフォルトのテストフレームワークとして **PHPUnit** を使用する。プロジェクトに **Pest** が設定されている場合、新しいテストには Pest を優先し、フレームワークの混在を避ける。

## カバレッジ

```bash
vendor/bin/phpunit --coverage-text
# または
vendor/bin/pest --coverage
```

CI では **pcov** または **Xdebug** を優先し、カバレッジ閾値は暗黙知ではなく CI で管理する。

## テストの構成

- 高速なユニットテストとフレームワーク/データベース統合テストを分離する。
- フィクスチャには大きな手書き配列ではなくファクトリ/ビルダーを使用する。
- HTTP/コントローラテストはトランスポートとバリデーションに集中する; ビジネスルールはサービスレベルのテストに移動する。

## Inertia

プロジェクトが Inertia.js を使用している場合、生の JSON アサーションではなく `AssertableInertia` 付きの `assertInertia` でコンポーネント名とプロップスを検証することを優先する。

## リファレンス

スキル: `tdd-workflow` でリポジトリ全体の RED -> GREEN -> REFACTOR ループを参照してください。
スキル: `laravel-tdd` で Laravel 固有のテストパターン（PHPUnit と Pest）を参照してください。
