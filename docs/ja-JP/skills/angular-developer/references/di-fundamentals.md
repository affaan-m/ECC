# 依存性注入（DI）の基礎

依存性注入（DI）は、アプリケーション全体でコードを整理・共有するためのデザインパターンで、機能をさまざまな部分に「注入」できるようにします。これにより、コードの保守性、スケーラビリティ、テスタビリティが向上します。

## Angular における DI の仕組み

コードが Angular の DI システムと連携する主な方法は 2 つあります：

1. **プロバイディング**: 値（オブジェクト、関数、プリミティブ）を DI システムで利用可能にすること。
2. **インジェクティング**: DI システムにそれらの値を要求すること。

Angular のコンポーネント、ディレクティブ、サービスは自動的に DI に参加します。

## サービス

**サービス**はアプリケーション全体でデータと機能を共有する最も一般的な方法です。`@Injectable()` でデコレートされた TypeScript クラスです。

### サービスの作成

`@Injectable` デコレーターで `providedIn: 'root'` オプションを使用して、アプリケーション全体で利用可能なシングルトンとしてサービスを作成します。これはほとんどのサービスで推奨されるアプローチです。

```ts
import {Injectable} from '@angular/core';

@Injectable({
  providedIn: 'root', // これによりどこでも利用可能なシングルトンになる
})
export class AnalyticsLogger {
  trackEvent(category: string, value: string) {
    console.log('Analytics event logged:', {category, value});
  }
}
```

サービスの一般的な用途：

- データクライアント（API 呼び出し）
- 状態管理
- 認証と認可
- ロギングとエラー処理
- ユーティリティ関数

## 依存関係のインジェクト

依存関係を要求するには Angular の `inject()` 関数を使用します。

### `inject()` 関数

`inject()` 関数を使用して、サービス（またはその他の提供されたトークン）のインスタンスを取得できます。

```ts
import {Component, inject} from '@angular/core';
import {Router} from '@angular/router';
import {AnalyticsLogger} from './analytics-logger.service';

@Component({
  selector: 'app-navbar',
  template: `<a href="#" (click)="navigateToDetail($event)">Detail Page</a>`,
})
export class Navbar {
  // クラスフィールドイニシャライザーを使用して依存関係をインジェクト
  private router = inject(Router);
  private analytics = inject(AnalyticsLogger);

  navigateToDetail(event: Event) {
    event.preventDefault();
    this.analytics.trackEvent('navigation', '/details');
    this.router.navigate(['/details']);
  }
}
```

### `inject()` はどこで使用できるか？（インジェクションコンテキスト）

`inject()` は**インジェクションコンテキスト**内で呼び出せます。最も一般的なインジェクションコンテキストは、コンポーネント、ディレクティブ、またはサービスの構築中です。

`inject()` を呼び出せる有効な場所：

1. **クラスフィールドイニシャライザー**（推奨）
2. **コンストラクターの本体**
3. **ルートガードとリゾルバー**（インジェクションコンテキストで実行されます）
4. **プロバイダーで使用されるファクトリー関数**

```typescript
import {Component, Directive, Injectable, inject, ElementRef} from '@angular/core';
import {HttpClient} from '@angular/common/http';

// 1. コンポーネント内（フィールドイニシャライザーとコンストラクター）
@Component({
  /*...*/
})
export class Example {
  private service1 = inject(MyService); // 有効なフィールドイニシャライザー

  private service2: MyService;
  constructor() {
    this.service2 = inject(MyService); // 有効なコンストラクター本体
  }
}

// 2. ディレクティブ内
@Directive({
  /*...*/
})
export class MyDirective {
  private element = inject(ElementRef); // 有効なフィールドイニシャライザー
}

// 3. サービス内
@Injectable({providedIn: 'root'})
export class MyService {
  private http = inject(HttpClient); // 有効なフィールドイニシャライザー
}

// 4. ルートガード内（関数型）
export const authGuard = () => {
  const auth = inject(AuthService); // 有効なルートガード
  return auth.isAuthenticated();
};
```
