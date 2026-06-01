# アウトレットによるルートの表示

`RouterOutlet` ディレクティブは、Angular が現在の URL に対応するコンポーネントをレンダリングするプレースホルダーです。

## 基本的な使い方

テンプレートに `<router-outlet />` を記述します。Angular はアウトレットの直後の兄弟要素としてルーティングされたコンポーネントを挿入します。

```html
<app-header /> <router-outlet />
<!-- ルートコンテンツがここに表示される -->
<app-footer />
```

## ネストされたアウトレット

子ルートには、親コンポーネントのテンプレート内に独自の `<router-outlet />` が必要です。

```ts
// 親コンポーネントのテンプレート
<h1>Settings</h1>
<router-outlet /> <!-- Profile や Security などの子コンポーネントがここにレンダリングされる -->
```

## 名前付きアウトレット（セカンダリルート）

ページは複数のアウトレットを持つことができます。特定のアウトレットをターゲットにするために `name` を割り当てます。デフォルト名は `'primary'` です。

```html
<router-outlet />
<!-- プライマリ -->
<router-outlet name="sidebar" />
<!-- セカンダリ -->
```

ルート設定で `outlet` を定義します。

```ts
{
  path: 'chat',
  component: Chat,
  outlet: 'sidebar'
}
```

## アウトレットのライフサイクルイベント

`RouterOutlet` はコンポーネントが変更されたときにイベントを発行します。

- `activate`: 新しいコンポーネントがインスタンス化された。
- `deactivate`: コンポーネントが破棄された。
- `attach` / `detach`: `RouteReuseStrategy` と共に使用される。

```html
<router-outlet (activate)="onActivate($event)" />
```

## `routerOutletData` を使ったデータの受け渡し

`routerOutletData` インプットを使用して、ルーティングされたコンポーネントにコンテキストデータを渡すことができます。コンポーネントは `ROUTER_OUTLET_DATA` インジェクショントークンをシグナルとして経由してこれにアクセスします。

```ts
// 親コンポーネント内
<router-outlet [routerOutletData]="{ theme: 'dark' }" />

// ルーティングされたコンポーネント内
outletData = inject(ROUTER_OUTLET_DATA) as Signal<{ theme: string }>;
```
