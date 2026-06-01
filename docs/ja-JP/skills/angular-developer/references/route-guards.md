# ルートガード

ルートガードは、ユーザーがルートにナビゲートできるか、またはルートから離れられるかを制御します。

## ガードの種類

- **`CanActivate`**: ユーザーはこのルートにアクセスできるか？（例：認証チェック）
- **`CanActivateChild`**: ユーザーはこのルートの子ルートにアクセスできるか？
- **`CanDeactivate`**: ユーザーはこのルートから離れられるか？（例：未保存の変更がある場合）
- **`CanMatch`**: このルートはマッチング対象として考慮されるべきか？（例：フィーチャーフラグ）`false` を返すと、ルーターは他のルートの確認を続けます。

## ガードの作成

Angular 15 以降、ガードは通常関数形式で定義します。

```ts
export const authGuard: CanActivateFn = (route, state) => {
  const authService = inject(AuthService);
  const router = inject(Router);

  if (authService.isLoggedIn()) {
    return true;
  }

  // ログインページへリダイレクト
  return router.parseUrl('/login');
};
```

## ガードの適用

ルート設定に配列として追加します。配列の順番に実行されます。

```ts
{
  path: 'admin',
  component: Admin,
  canActivate: [authGuard],
  canActivateChild: [adminChildGuard],
  canDeactivate: [unsavedChangesGuard]
}
```

## 戻り値

- `boolean`: `true` で許可、`false` でブロック。
- `UrlTree` または `RedirectCommand`: 別のルートへリダイレクト。
- `Observable` または `Promise`: 上記の型に解決される。

## セキュリティに関する注意

**クライアントサイドのガードはサーバーサイドのセキュリティの代替手段ではありません。** 必ずサーバー側でも権限を検証してください。
