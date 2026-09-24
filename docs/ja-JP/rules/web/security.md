> このファイルは [common/security.md](../common/security.md) を Web 固有のセキュリティコンテンツで拡張します。

# Web セキュリティルール

## コンテンツセキュリティポリシー

本番環境では常に CSP を設定する。

### ノンスベースの CSP

`'unsafe-inline'` の代わりに、スクリプトにはリクエストごとのノンスを使用する。

```text
Content-Security-Policy:
  default-src 'self';
  script-src 'self' 'nonce-{RANDOM}' https://cdn.jsdelivr.net;
  style-src 'self' 'unsafe-inline' https://fonts.googleapis.com;
  img-src 'self' data: https:;
  font-src 'self' https://fonts.gstatic.com;
  connect-src 'self' https://*.example.com;
  frame-src 'none';
  object-src 'none';
  base-uri 'self';
```

オリジンはプロジェクトに合わせて調整する。このブロックをそのままコピーして使わない。

## XSS 防止

- サニタイズされていない HTML を注入しない
- サニタイズなしで `innerHTML` / `dangerouslySetInnerHTML` を使用しない
- 動的テンプレート値をエスケープする
- どうしても必要な場合は、検証済みのローカルサニタイザーでユーザー HTML をサニタイズする

## サードパーティスクリプト

- 非同期で読み込む
- CDN から配信する場合は SRI を使用する
- 四半期ごとに監査する
- 実用的な場合、重要な依存関係にはセルフホスティングを優先する

## HTTPS とヘッダー

```text
Strict-Transport-Security: max-age=31536000; includeSubDomains; preload
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
Referrer-Policy: strict-origin-when-cross-origin
Permissions-Policy: camera=(), microphone=(), geolocation=()
```

## フォーム

- 状態を変更するフォームには CSRF 保護
- 送信エンドポイントにはレート制限
- クライアント側とサーバー側の両方でバリデーション
- 重い CAPTCHA デフォルトよりもハニーポットや軽量なアンチアビューズ制御を優先する
