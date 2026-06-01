# ルートの定義

ルートは特定の URL パスに対してどのコンポーネントをレンダリングするかを定義するオブジェクトです。

## 基本設定

`Routes` 配列にルートを定義し、`appConfig` で `provideRouter` を使用して提供します。

```ts
// app.routes.ts
export const routes: Routes = [
  {path: '', component: HomePage},
  {path: 'admin', component: AdminPage},
];

// app.config.ts
export const appConfig: ApplicationConfig = {
  providers: [provideRouter(routes)],
};
```

## URL パス

- **静的**: 正確な文字列にマッチします（例: `'admin'`）。
- **ルートパラメーター**: コロンをプレフィックスとした動的なセグメント（例: `'user/:id'`）。
- **ワイルドカード**: `**` を使用してすべての URL にマッチします。「ページが見つかりません」のページに便利です。**常に配列の末尾に配置してください。**

## マッチング戦略

Angular は**最初にマッチしたものが優先**される戦略を使用します。より具体的なルートをより汎用的なルートより前に配置する必要があります。

## リダイレクト

`redirectTo` を使用してあるパスを別のパスに転送します。

```ts
{ path: 'articles', redirectTo: '/blog' },
{ path: 'blog', component: Blog },
```

## ページタイトル

アクセシビリティのためにルートにタイトルを関連付けます。タイトルは静的または動的（`ResolveFn` またはカスタム `TitleStrategy` 経由）にできます。

```ts
{ path: 'home', component: Home, title: 'Home Page' }
```

## ルートデータとプロバイダー

- **静的データ**: `data` プロパティを使用してメタデータを付加します。
- **ルートプロバイダー**: `providers` 配列を使用して特定のルートとその子に依存関係をスコープします。

## ネスト（子）ルート

`children` プロパティを使用してサブビューを定義します。親コンポーネントには `<router-outlet />` を含める必要があります。

```ts
{
  path: 'product/:id',
  component: Product,
  children: [
    { path: 'info', component: ProductInfo },
    { path: 'reviews', component: ProductReviews },
  ],
}
```
