---
description: FastAPIアプリケーションのアーキテクチャ、async正確性、依存性注入、Pydanticスキーマ、セキュリティ、パフォーマンス、テスト可能性をレビューします。
---

# FastAPIレビュー

`fastapi-reviewer`エージェントを呼び出して、焦点を絞ったFastAPIレビューを実行します。

## 使い方

```text
/fastapi-review [ファイルまたはディレクトリ]
```

## レビュー領域

- アプリファクトリ、ルーター境界、ミドルウェア、例外ハンドラ。
- Pydanticのリクエストとレスポンススキーマの分離。
- データベースセッション、認証、ページネーション、設定の依存性注入。
- 非同期データベースと外部HTTPパターン。
- CORS、認証、レート制限、ロギング、シークレット処理。
- OpenAPIメタデータとドキュメント化されたレスポンスモデル。
- テストクライアントセットアップと依存関係のオーバーライド。

## 期待される出力

```text
[SEVERITY] 問題の短いタイトル
File: path/to/file.py:42
Issue: 何が問題でなぜ重要か。
Fix: 実施すべき具体的な変更。
```

## 関連

- エージェント: `fastapi-reviewer`
- スキル: `fastapi-patterns`
- コマンド: `/python-review`
- スキル: `security-scan`
