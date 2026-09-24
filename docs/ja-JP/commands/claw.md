---
description: NanoClaw v2 を起動します — モデルルーティング、スキルホットロード、ブランチ、圧縮、エクスポート、メトリクス機能を備えた ECC の永続的でゼロ依存の REPL。
---

# Claw コマンド

永続的な Markdown 履歴と操作コントロールを備えた、インタラクティブな AI エージェントセッションを起動します。

## 使用方法

```bash
node scripts/claw.js
```

または npm 経由：

```bash
npm run claw
```

## 環境変数

| 変数 | デフォルト値 | 説明 |
|----------|---------|-------------|
| `CLAW_SESSION` | `default` | セッション名（英数字 + ハイフン） |
| `CLAW_SKILLS` | *(空)* | 起動時に読み込むスキルのカンマ区切りリスト |
| `CLAW_MODEL` | `sonnet` | セッションのデフォルトモデル |

## REPL コマンド

```text
/help                          ヘルプを表示
/clear                         現在のセッション履歴をクリア
/history                       会話履歴全体を表示
/sessions                      保存済みセッションを一覧表示
/model [name]                  モデルを表示/設定
/load <skill-name>             スキルをコンテキストにホットロード
/branch <session-name>         現在のセッションをブランチ
/search <query>                セッションをまたいでクエリを検索
/compact                       古いラウンドを圧縮し、最近のコンテキストを保持
/export <md|json|txt> [path]   セッションをエクスポート
/metrics                       セッションメトリクスを表示
exit                           終了
```

## 説明

* NanoClaw はゼロ依存を維持します。
* セッションは `~/.claude/claw/<session>.md` に保存されます。
* 圧縮は最近のラウンドを保持し、圧縮ヘッダーを書き込みます。
* エクスポートは Markdown、JSON ラウンド、プレーンテキストに対応しています。
