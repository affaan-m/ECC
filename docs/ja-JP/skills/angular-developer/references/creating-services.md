# サービスの作成と使用

Angular のサービスは、複数のコンポーネントやその他のサービスがアクセスする必要があるデータ取得、ビジネスロジック、または状態管理を処理する再利用可能なコードです。

## サービスの作成

Angular CLI を使用してサービスを生成できます：

```bash
ng generate service my-data
```

または、TypeScript クラスを手動で作成し、`@Injectable()` でデコレートすることもできます。

```ts
import {Injectable} from '@angular/core';

@Injectable({
  providedIn: 'root',
})
export class BasicDataStore {
  private data: string[] = [];

  addData(item: string): void {
    this.data.push(item);
  }

  getData(): string[] {
    return [...this.data];
  }
}
```

### `providedIn: 'root'` オプション

`providedIn: 'root'` の使用は、ほとんどのサービスで推奨されるアプローチです。これにより Angular に以下を指示します：

- アプリケーション全体で**単一のインスタンス（シングルトン）を作成**します。
- `providers` 配列に記載する必要なく、**どこからでも自動的にアクセス可能**にします。
- **ツリーシェイキングを有効にし**、サービスが実際にどこかにインジェクトされている場合にのみ最終的な JavaScript バンドルに含めます。

## サービスのインジェクト

サービスが作成されたら、`inject()` 関数を使用してコンポーネント、ディレクティブ、または他のサービスにインジェクトできます。

### コンポーネントへのインジェクト

```ts
import {Component, inject} from '@angular/core';
import {BasicDataStore} from './basic-data-store.service';

@Component({
  selector: 'app-example',
  template: `
    <div>
      <p>Data items: {{ dataStore.getData().length }}</p>
      <button (click)="dataStore.addData('New Item')">Add Item</button>
    </div>
  `,
})
export class Example {
  // サービスをクラスフィールドとしてインジェクト
  dataStore = inject(BasicDataStore);
}
```

### 別のサービスへのインジェクト

サービスは全く同じ方法で他のサービスをインジェクトできます。

```ts
import {Injectable, inject} from '@angular/core';
import {AdvancedDataStore} from './advanced-data-store.service';

@Injectable({
  providedIn: 'root',
})
export class BasicDataStore {
  // 別のサービスをインジェクト
  private advancedDataStore = inject(AdvancedDataStore);

  private data: string[] = [];

  getData(): string[] {
    // このサービスとインジェクトされたサービスのデータを結合
    return [...this.data, ...this.advancedDataStore.getData()];
  }
}
```

## 高度なサービスパターン

`providedIn: 'root'` がほとんどのシナリオをカバーしますが、以下が必要になる場合があります：

- **コンポーネント固有のインスタンス**: コンポーネントがサービスの独立したインスタンスを必要とする場合、コンポーネントの `@Component({ providers: [MyService] })` 配列で直接提供します。
- **ファクトリープロバイダー**: 動的な作成のために使用します。
- **バリュープロバイダー**: 設定オブジェクトのインジェクトのために使用します。
