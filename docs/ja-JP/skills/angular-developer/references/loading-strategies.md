# ルートのローディング戦略

Angularは、初期ロード時間とナビゲーションの応答性のバランスを取るために、ルートとコンポーネントをロードする2つの主要な戦略をサポートしています。

## イーガーローディング（Eager Loading）

コンポーネントは初期JavaScriptペイロードにバンドルされ、即座に利用可能になります。

```ts
{ path: 'home', component: Home }
```

- **メリット**: シームレスな画面遷移。
- **デメリット**: 初期バンドルサイズが増加する。

## レイジーローディング（Lazy Loading）

コンポーネントまたはルートは、ユーザーがナビゲートしたときにのみロードされます。これにより、個別のJavaScript「チャンク」が生成されます。

### コンポーネントのレイジーローディング

`loadComponent` を使用してコンポーネントをオンデマンドで取得します。

```ts
{
  path: 'admin',
  loadComponent: () => import('./admin/admin.component').then(m => m.AdminComponent)`,
}
```

### 子ルートのレイジーローディング

`loadChildren` を使用してルートのセットを取得します。

```ts
{
  path: 'settings',
  loadChildren: () => import('./settings/settings.routes'),
}
```

## インジェクションコンテキストとレイジーローディング

ローダー関数は現在のルートの **インジェクションコンテキスト** 内で実行されます。これにより、`inject()` を呼び出してコンテキストに応じたローディング判断を行うことができます。

```ts
{
  path: 'dashboard',
  loadComponent: () => {
    const flags = inject(FeatureFlags);
    return flags.isPremium
      ? import('./premium-dashboard')
      : import('./basic-dashboard');
  },
}
```

## 推奨事項

- **イーガーローディング**はプライマリのランディングページに使用してください。
- **レイジーローディング**は初期バンドルを小さく保つために、その他すべてのフィーチャー領域に使用してください。
