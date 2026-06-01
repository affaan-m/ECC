# ルートへのナビゲート

Angularはルート間をナビゲートするための宣言的な方法とプログラム的な方法の両方を提供します。

## 宣言的ナビゲーション（`RouterLink`）

アンカー要素に `RouterLink` ディレクティブを使用します。

```ts
import {RouterLink, RouterLinkActive} from '@angular/router';

@Component({
  imports: [RouterLink, RouterLinkActive],
  template: `
    <nav>
      <a routerLink="/dashboard" routerLinkActive="active-link">Dashboard</a>
      <a [routerLink]="['/user', userId]">Profile</a>
    </nav>
  `,
})
export class Nav {
  userId = '123';
}
```

- **絶対パス**: `/` で始まります（例: `/settings`）。
- **相対パス**: 先頭に `/` がありません。`../` を使用して1つ上のレベルに移動します。

## プログラム的ナビゲーション（`Router`）

`Router` サービスをインジェクトして、TypeScriptコードからナビゲートします。

### `router.navigate()`

コマンドの配列を使用します。

```ts
private router = inject(Router);
private route = inject(ActivatedRoute);

// 標準ナビゲーション
this.router.navigate(['/profile']);

// パラメーター付き
this.router.navigate(['/search'], {
  queryParams: { q: 'angular' },
  fragment: 'results'
});

// 相対ナビゲーション
this.router.navigate(['edit'], { relativeTo: this.route });
```

### `router.navigateByUrl()`

文字列パスを使用します。絶対ナビゲーションまたは完全なURLに最適です。

```ts
this.router.navigateByUrl('/products/123?view=details');

// 履歴の現在のエントリを置き換える
this.router.navigateByUrl('/login', {replaceUrl: true});
```

## URLパラメーター

- **ルートパラメーター**: パスの一部です（例: `/user/123`）。
- **クエリパラメーター**: `?` の後に続きます（例: `/search?q=query`）。
- **マトリックスパラメーター**: セグメントにスコープされます（例: `/products;category=books`）。
