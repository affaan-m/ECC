---
paths:
  - "**/*.component.ts"
  - "**/*.component.html"
  - "**/*.service.ts"
  - "**/*.directive.ts"
  - "**/*.pipe.ts"
  - "**/*.guard.ts"
  - "**/*.resolver.ts"
  - "**/*.module.ts"
---
# Angular コーディングスタイル

> このファイルは [common/coding-style.md](../common/coding-style.md) を Angular 固有のコンテンツで拡張します。

## バージョンの確認

コードを書く前に、必ずプロジェクトの Angular バージョンを確認してください — バージョン間で機能が大きく異なります。`ng version` を実行するか、`package.json` を確認してください。新しいプロジェクトを作成する場合、ユーザーが指定しない限りバージョンを固定しないでください。

Angular コードを生成または変更した後は、完了前に必ず `ng build` を実行してエラーを検出してください。

## ファイル命名

Angular CLI の規約に従い、1ファイルにつき1つの成果物を配置します:

- `user-profile.component.ts` + `user-profile.component.html` + `user-profile.component.spec.ts`
- `user.service.ts`、`auth.guard.ts`、`date-format.pipe.ts`
- 機能フォルダ: `features/users/`、`features/auth/`
- CLI で生成: `ng generate component features/users/user-card`

## コンポーネント

スタンドアロンコンポーネント（v17+ デフォルト）を優先します。すべての新しいコンポーネントで `OnPush` 変更検知を使用してください。

```typescript
@Component({
  selector: 'app-user-card',
  standalone: true,
  imports: [RouterModule],
  templateUrl: './user-card.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class UserCardComponent {
  user = input.required<User>();
  select = output<string>();
}
```

## 依存性注入

コンストラクタ注入よりも `inject()` を使用してください。コンストラクタは空にするか、完全に削除してください。

```typescript
// 正しい
@Injectable({ providedIn: 'root' })
export class UserService {
  private http = inject(HttpClient);
  private router = inject(Router);
}

// 誤り: コンストラクタ注入は冗長で、ツリーシェイキングが困難
constructor(private http: HttpClient, private router: Router) {}
```

非クラス依存関係には `InjectionToken` を使用してください:

```typescript
const API_URL = new InjectionToken<string>('API_URL');

// 提供:
{ provide: API_URL, useValue: 'https://api.example.com' }

// 使用:
private apiUrl = inject(API_URL);
```

## シグナル

### 基本プリミティブ

```typescript
count = signal(0);
doubled = computed(() => this.count() * 2);

increment() {
  this.count.update(n => n + 1);
}
```

### `linkedSignal` — 書き込み可能な派生状態

ソースが変更されたときにリセットまたは適応する必要があるが、独立して書き込み可能なシグナルには `linkedSignal` を使用してください:

```typescript
selectedOption = linkedSignal(() => this.options()[0]);
// options が変更されると最初のオプションにリセットされるが、ユーザーはオーバーライド可能
```

### `resource` — 非同期データをシグナルに変換

手動サブスクリプションなしで非同期データをリアクティブに取得するには `resource()` を使用してください:

```typescript
userResource = resource({
  request: () => ({ id: this.userId() }),
  loader: ({ request }) => fetch(`/api/users/${request.id}`).then(r => r.json()),
});

// アクセス: userResource.value(), userResource.isLoading(), userResource.error()
```

### `effect` の使用法

`effect()` はシグナルの変更に反応する必要がある副作用（ログ記録、サードパーティの DOM 操作）にのみ使用してください。シグナルの同期にエフェクトを使用しないでください — 代わりに `computed` または `linkedSignal` を使用してください。レンダリング後の DOM 作業には `afterRenderEffect` を使用してください。

```typescript
// 正しい: 副作用
effect(() => console.log('User changed:', this.user()));

// 誤り: 代わりに computed を使用
effect(() => { this.fullName.set(`${this.first()} ${this.last()}`); });
```

## テンプレート

v17+ のブロック構文を使用してください。`@for` では必ず `track` を指定してください:

```html
@for (item of items(); track item.id) {
  <app-item [item]="item" />
}

@if (isLoading()) {
  <app-spinner />
} @else if (error()) {
  <app-error [message]="error()" />
} @else {
  <app-content [data]="data()" />
}
```

テンプレート内のロジックは単純な条件式に留め、コンポーネントメソッドまたはパイプに移動してください。

## フォーム

プロジェクトの既存アプローチに合ったフォーム戦略を選択してください:

- **Signal Forms**（v21+）: v21+ の新規プロジェクトで推奨。シグナルベースのフォーム状態。
- **Reactive Forms**: `FormBuilder` + `FormGroup` + `FormControl`。動的バリデーションを持つ複雑なフォームに最適。
- **Template-Driven Forms**: `ngModel`。シンプルなフォームにのみ適しています。

```typescript
// Reactive Forms — ほとんどのアプリの標準的なアプローチ
export class LoginComponent {
  private fb = inject(FormBuilder);

  form = this.fb.group({
    email: ['', [Validators.required, Validators.email]],
    password: ['', [Validators.required, Validators.minLength(8)]],
  });

  submit() {
    if (this.form.valid) {
      // this.form.value を使用
    }
  }
}
```

## コンポーネントスタイル

`ViewEncapsulation.Emulated`（デフォルト）でコンポーネントレベルのスタイルを使用してください。意図的にスタイルを漏洩させるデザインシステムを構築する場合を除き、`ViewEncapsulation.None` を避けてください。

- スタイルをコンポーネントにスコープし、コンポーネントスタイルシート内でグローバルクラス名を使用しない
- ホスト要素のスタイリングには `:host` を使用
- テーマ設定可能な値には CSS カスタムプロパティを優先

## 変更検知

- すべての新しいコンポーネントでデフォルトとして `ChangeDetectionStrategy.OnPush` を使用
- シグナルと `async` パイプが検知を自動的に処理 — `markForCheck()` と `detectChanges()` を避ける
- OnPush 使用時に `@Input()` オブジェクトをインプレースで変更しない
