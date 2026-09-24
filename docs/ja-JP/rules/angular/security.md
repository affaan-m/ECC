---
paths:
  - "**/*.component.ts"
  - "**/*.component.html"
  - "**/*.service.ts"
  - "**/*.interceptor.ts"
---
# Angular セキュリティ

> このファイルは [common/security.md](../common/security.md) を Angular 固有のコンテンツで拡張します。

## XSS 防止

Angular はバインドされた値を自動的にサニタイズします。ユーザー制御の入力に対してサニタイザをバイパスしないでください。

```typescript
// 誤り: サニタイゼーションをバイパス — XSS リスク
this.safeHtml = this.sanitizer.bypassSecurityTrustHtml(userInput);

// 正しい: 信頼する前に明示的にサニタイズ
this.safeHtml = this.sanitizer.sanitize(SecurityContext.HTML, userInput);
```

- 文書化されレビューされた理由なしに `bypassSecurityTrust*` メソッドを使用しない
- 信頼できないコンテンツに `[innerHTML]` を使用しない — `innerText` またはサニタイズパイプを使用
- ユーザー入力に `[href]` をバインドしない — Angular はすべてのコンテキストで `javascript:` URL をブロックするわけではない
- ユーザーデータからテンプレート文字列を構築しない

## HTTP セキュリティ

`HttpClient` のみを使用してください — 代替手段がない場合を除き、生の `fetch()` や `XHR` を使用しないでください。

```typescript
// 誤り: インターセプターをバイパス（認証ヘッダー、エラーハンドリング、ログ記録）
const res = await fetch('/api/users');

// 正しい
users$ = this.http.get<User[]>('/api/users');
```

- インターセプター経由で認証トークンを添付 — 個々のサービス呼び出しにハードコードしない
- API レスポンスを型付けしてバリデーション — 境界では外部データを `unknown` として扱う
- トークン、PII、または認証情報を含む可能性のある HTTP レスポンスをログに記録しない

## シークレット管理

```typescript
// 誤り: ソースにハードコードされたシークレット
const apiKey = 'sk-live-xxxx';

// 正しい: 環境経由で注入
import { environment } from '../environments/environment';
const apiKey = environment.apiKey;
```

- `environment.ts` を設定の形として扱う — ソース管理されている環境ファイルに実際のシークレットを格納しない
- CI/CD 経由で本番シークレットを注入（環境変数、シークレットマネージャー）

## ルートガード

すべての認証済みまたはロール制限されたルートにはガードが必要です。UI 要素の非表示だけに頼らないでください。

```typescript
{
  path: 'admin',
  canMatch: [authGuard, roleGuard('admin')],
  loadChildren: () => import('./admin/admin.routes'),
}
```

機密性の高いルートには `canMatch` を使用してください — 未認証ユーザーに対してルートモジュールの読み込み自体を防止します。

## SSR セキュリティ

Angular SSR を使用する場合:

- 意図的に公開する場合を除き、`TransferState` 経由でサーバーサイドの環境変数をクライアントに公開しない
- サーバーサイドレンダリング前にすべての入力をサニタイズ — DOM ベースの XSS はサーバーサイドでも発生する可能性がある
- サーバー上で `window`、`document`、`localStorage` を使用しない — `isPlatformBrowser` でゲートするか、`DOCUMENT` トークン経由で注入

## コンテンツセキュリティポリシー

サーバーサイドで CSP ヘッダーを設定してください。`script-src` で `unsafe-inline` を避けてください。インラインスクリプトを使用する SSR では、Angular の CSP サポートを通じてナンスを使用してください。

## エージェントサポート

- 包括的なセキュリティ監査には **security-reviewer** スキルを使用
