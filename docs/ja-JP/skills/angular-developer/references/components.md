# コンポーネント

Angular コンポーネントはアプリケーションの基本的なビルディングブロックです。各コンポーネントは、動作を持つ TypeScript クラス、HTML テンプレート、そして CSS セレクターで構成されます。

## コンポーネントの定義

`@Component` デコレーターを使用してコンポーネントのメタデータを定義します。

```ts
@Component({
  selector: 'app-profile',
  template: `
    <img src="profile.jpg" alt="Profile photo" />
    <button (click)="save()">Save</button>
  `,
  styles: `
    img {
      border-radius: 50%;
    }
  `,
})
export class Profile {
  save() {
    /* ... */
  }
}
```

## メタデータのオプション

- `selector`: テンプレート内でこのコンポーネントを識別する CSS セレクター。
- `template`: インライン HTML テンプレート（小規模なテンプレートに推奨）。
- `templateUrl`: 外部 HTML ファイルへのパス。
- `styles`: インライン CSS スタイル。
- `styleUrl` / `styleUrls`: 外部 CSS ファイルへのパス（複数可）。
- `imports`: このコンポーネントのテンプレートで使用されるコンポーネント、ディレクティブ、またはパイプを一覧表示します。

## コンポーネントの使用

コンポーネントを使用するには、使用側コンポーネントの `imports` 配列に追加し、テンプレートでそのセレクターを使用します。

```ts
@Component({
  selector: 'app-root',
  imports: [Profile],
  template: `<app-profile />`,
})
export class App {}
```

## テンプレートの制御フロー

Angular は条件付きレンダリングとループに組み込みブロックを使用します。

### 条件付きレンダリング（`@if`）

`@if` を使用してコンテンツを条件付きで表示します。`@else if` と `@else` ブロックを含めることができます。

```html
@if (user.isAdmin) {
<admin-dashboard />
} @else if (user.isModerator) {
<mod-dashboard />
} @else {
<standard-dashboard />
}
```

**結果のエイリアス**: 式の結果を再利用のために保存します。

```html
@if (user.settings(); as settings) {
<p>Theme: {{ settings.theme }}</p>
}
```

### ループ（`@for`）

`@for` ブロックはコレクションを反復処理します。`track` 式はパフォーマンスと DOM の再利用のために**必須**です。

```html
<ul>
  @for (item of items(); track item.id; let i = $index, total = $count) {
  <li>{{ i + 1 }}/{{ total }}: {{ item.name }}</li>
  } @empty {
  <li>No items to display.</li>
  }
</ul>
```

**暗黙的な変数**: `$index`、`$count`、`$first`、`$last`、`$even`、`$odd`。

### コンテンツの切り替え（`@switch`）

`@switch` ブロックは値に基づいてコンテンツをレンダリングします。厳密等価（`===`）を使用し、**フォールスルーはありません**。

```html
@switch (status()) { @case ('loading') { <app-spinner /> } @case ('error') { <app-error-msg /> }
@case ('success') { <app-data-grid /> } @default {
<p>Unknown status</p>
} }
```

**網羅的な型チェック**: `@default never;` を使用して、ユニオン型のすべてのケースが処理されることを保証します。

```html
@switch (state) { @case ('on') { ... } @case ('off') { ... } @default never; // 'standby' などの新しい
状態が追加された場合にエラーになる }
```

## コアコンセプト

- **ホスト要素**: コンポーネントのセレクターに一致する DOM 要素。
- **ビュー**: ホスト要素内にコンポーネントのテンプレートによってレンダリングされる DOM。
- **スタンドアロン**: デフォルトでは、コンポーネントはスタンドアロンです（Angular 19 以降、`standalone: true` がデフォルト）。古いバージョンでは、`standalone: true` を明示的に指定するか、コンポーネントを `NgModule` の一部にする必要があります。
- **コンポーネントツリー**: Angular アプリケーションはコンポーネントのツリーとして構成されており、各コンポーネントが子コンポーネントをホストできます。
- **コンポーネントの命名**: プロジェクトがその命名設定を使用するように設定されていない限り、コンポーネントクラスに `Component` サフィックスを付けないでください（例: AppComponent）。
