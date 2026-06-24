---
name: docker-patterns
description: Docker イメージの構築、最適化、マルチステージビルド、ネットワーク、ボリューム管理。本番環境デプロイメント用のベストプラクティス。
origin: ECC
---

# Docker パターン

本番環境対応のDocker イメージとコンテナ。

## 使用時期

- Dockerfile を書く
- イメージサイズを最適化
- マルチステージビルド
- ネットワークと永続化を設定
- デプロイメント戦略

## Dockerfile ベストプラクティス

### 1. イメージサイズを最小化

```dockerfile
FROM node:18-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm install

FROM node:18-alpine
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY . .
CMD ["node", "server.js"]
```

### 2. レイヤー最適化

```dockerfile
# キャッシュを活用するため、変更がない部分を上に
FROM node:18-alpine
WORKDIR /app

# 依存関係（変更が少ない）
COPY package*.json ./
RUN npm install

# アプリケーション（頻繁に変更）
COPY . .

CMD ["node", "server.js"]
```

### 3. セキュリティ

- root ユーザーで実行しない
- シークレットを避ける
- ヘルスチェック追加

```dockerfile
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node healthcheck.js
```

## docker-compose

```yaml
version: '3.8'
services:
  app:
    build: .
    ports:
      - "3000:3000"
    environment:
      - NODE_ENV=production
    volumes:
      - ./data:/app/data
    depends_on:
      - db
  db:
    image: postgres:15
    environment:
      - POSTGRES_PASSWORD=secret
```

## チェックリスト

- [ ] イメージサイズ最適化
- [ ] セキュリティスキャン
- [ ] ヘルスチェック
- [ ] ログ管理
- [ ] ネットワーク構成

詳細については、ドキュメントを参照してください。
