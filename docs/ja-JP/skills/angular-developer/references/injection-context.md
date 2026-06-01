# インジェクションコンテキスト

`inject()` 関数は、コードが **インジェクションコンテキスト** 内で実行されている場合にのみ使用できます。

## インジェクションコンテキストが利用可能な場所

インジェクションコンテキストは以下の場所で自動的に利用可能です:

1. DIによってインスタンス化されるクラス（`@Injectable`、`@Component`、`@Directive`、`@Pipe`）の **フィールド初期化子**。
2. DIによってインスタンス化されるクラスの **コンストラクター**。
3. `useFactory` または `InjectionToken` の設定で指定された **ファクトリー関数**。
4. Angularが実行する **関数型API**（関数型ルートガード、リゾルバー、インターセプターなど）。

```ts
@Component({...})
export class Example {
  // 有効: フィールド初期化子
  private router = inject(Router);

  constructor() {
    // 有効: コンストラクター
    const http = inject(HttpClient);
  }

  onClick() {
    // 無効: インジェクションコンテキストではない
    // const auth = inject(AuthService);
  }
}
```

## `runInInjectionContext`

インジェクションコンテキスト内で関数を実行する必要がある場合（動的なコンポーネント生成やテストで必要になることがあります）は、`runInInjectionContext` を使用してください。これには既存のインジェクター（`EnvironmentInjector` や `Injector` など）へのアクセスが必要です。

```ts
import {Injectable, inject, EnvironmentInjector, runInInjectionContext} from '@angular/core';

@Injectable({providedIn: 'root'})
export class MyService {
  private injector = inject(EnvironmentInjector);

  doSomethingDynamic() {
    runInInjectionContext(this.injector, () => {
      // ここでは inject() の使用が有効になります
      const router = inject(Router);
    });
  }
}
```

## `assertInInjectionContext`

ユーティリティ関数が有効なコンテキストから呼び出されることを保証するために、`assertInInjectionContext` を使用します。無効な場合は明確なエラーをスローします。

```ts
import {assertInInjectionContext, inject, ElementRef} from '@angular/core';

export function injectNativeElement<T extends Element>(): T {
  assertInInjectionContext(injectNativeElement);
  return inject(ElementRef).nativeElement;
}
```
