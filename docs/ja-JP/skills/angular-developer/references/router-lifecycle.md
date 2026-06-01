# ルーターライフサイクルとイベント

Angular Router は `Router.events` Observable を通じてイベントを発行します。これにより、ナビゲーションのライフサイクルを最初から最後まで追跡できます。

## 主なルーターイベント（時系列順）

1. **`NavigationStart`**: ナビゲーション開始。
2. **`RoutesRecognized`**: Router が URL をルートにマッチ。
3. **`GuardsCheckStart` / `End`**: `canActivate`、`canMatch` などの評価。
4. **`ResolveStart` / `End`**: データ解決フェーズ（リゾルバーによるデータフェッチ）。
5. **`NavigationEnd`**: ナビゲーションが正常に完了。
6. **`NavigationCancel`**: ナビゲーションがキャンセルされた（例：ガードが `false` を返した場合）。
7. **`NavigationError`**: ナビゲーションが失敗した（例：リゾルバーでエラーが発生した場合）。

## イベントのサブスクライブ

`Router` をインジェクトして `events` Observable をフィルタリングします。

```ts
import {Router, NavigationStart, NavigationEnd} from '@angular/router';

export class MyService {
  private router = inject(Router);

  constructor() {
    this.router.events.pipe(filter((e) => e instanceof NavigationEnd)).subscribe((event) => {
      console.log('Navigated to:', event.url);
    });
  }
}
```

## デバッグ

アプリケーションのブートストラップ時にすべてのルーティングイベントの詳細なコンソールログを有効にします。

```ts
provideRouter(routes, withDebugTracing());
```

## 主なユースケース

- **ローディングインジケーター**: `NavigationStart` が発火したときにスピナーを表示し、`NavigationEnd`/`Cancel`/`Error` で非表示にします。
- **アナリティクス**: `NavigationEnd` をリッスンしてページビューを追跡します。
- **スクロール管理**: カスタムスクロール動作のために `Scroll` イベントに応答します。
