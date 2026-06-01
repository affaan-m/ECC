---
name: social-publisher
description: SocialClaw を通じて 13 のプラットフォームにわたるソーシャルメディア投稿のエージェント駆動スケジューリングおよび公開。X、LinkedIn、Instagram、Facebook Pages、TikTok、Discord、Telegram、YouTube、Reddit、WordPress、Pinterest への投稿、キャンペーン管理、メディアアップロード、投稿配信ステータスの監視を行いたい場合に使用する。
origin: community
---

# Social Publisher (SocialClaw)

Claude Code を [SocialClaw](https://getsocialclaw.com) に接続し、単一のワークスペース API キーで 13 のプラットフォームにわたるエージェント駆動型ソーシャルメディア公開を実現する。

## 有効化するタイミング

- X、LinkedIn、Instagram、TikTok、その他のプラットフォームにコンテンツを公開する場合
- 複数のプラットフォームにわたる投稿キャンペーンを一括スケジュールする場合
- ソーシャル投稿に使用するメディアをアップロードする場合
- 公開前に投稿スケジュールを検証する場合
- 公開実行のステータスと配信アナリティクスを監視する場合

## セットアップ

```bash
# 必須: https://getsocialclaw.com/dashboard からワークスペース API キーを取得
export SC_API_KEY="<workspace-key>"

# アクセスを確認する
curl -sS -H "Authorization: Bearer $SC_API_KEY" https://getsocialclaw.com/v1/keys/validate

# CLI のインストール（任意だが推奨）
npm install -g socialclaw@0.1.12
socialclaw login --api-key <workspace-key>
```

## 基本ワークフロー

### 1. 連携済みアカウントの一覧表示
```bash
socialclaw accounts list --json
```

未連携の場合:
```bash
socialclaw accounts connect --provider x --open
socialclaw accounts connect --provider linkedin --open
```

### 2. メディアのアップロード（任意）
```bash
socialclaw assets upload --file ./image.png --json
# → { "asset_id": "..." }
```

### 3. schedule.json の作成
```json
{
  "posts": [
    {
      "provider": "x",
      "account_id": "<account-id>",
      "text": "Post text here",
      "scheduled_at": "2026-06-01T10:00:00Z"
    }
  ]
}
```

### 4. 公開前の検証
```bash
socialclaw validate -f schedule.json --json
```

### 5. 公開
```bash
socialclaw apply -f schedule.json --json
# → { "run_id": "..." }
```

### 6. 監視
```bash
socialclaw status --run-id <run-id> --json
socialclaw posts list --json
```

## 対応プロバイダー

| プロバイダー | キー |
|----------|-----|
| X (Twitter) | `x` |
| LinkedIn プロフィール | `linkedin` |
| LinkedIn ページ | `linkedin_page` |
| Instagram ビジネス | `instagram_business` |
| Instagram スタンドアロン | `instagram` |
| Facebook ページ | `facebook` |
| TikTok | `tiktok` |
| YouTube | `youtube` |
| Reddit | `reddit` |
| WordPress | `wordpress` |
| Discord | `discord` |
| Telegram | `telegram` |
| Pinterest | `pinterest` |

## セキュリティ

- アウトバウンドリクエストは `getsocialclaw.com` のみに送信される
- プロバイダーの OAuth 認証は SocialClaw ダッシュボードで管理される — プロバイダーごとのシークレットはエージェントに公開されない
- `SC_API_KEY` はワークスペーススコープのキーである

## 関連スキル

- `x-api` — X/Twitter API の直接操作
- `social-graph-ranker` — アウトリーチターゲティングのためのネットワーク分析

## ソース

- npm: `npm install -g socialclaw@0.1.12`
- ダッシュボード: [SocialClaw ダッシュボード](https://getsocialclaw.com/dashboard)
