# テンプレート駆動フォーム

テンプレート駆動フォームは双方向データバインディング（`[(ngModel)]`）を使用して、テンプレートで変更が行われるとコンポーネントのデータモデルを更新し、逆方向も同様に処理します。シンプルなフォームに最適で、HTML テンプレートのディレクティブを使用してフォームの状態とバリデーションを管理します。

## コアディレクティブ

テンプレート駆動フォームは `FormsModule` に依存しており、これにより以下の主要なディレクティブが提供されます。

- `NgModel`: フォーム要素の値の変化とデータモデルを調整します（`[(ngModel)]`）。
- `NgForm`: `<form>` タグにバインドされたトップレベルの `FormGroup` を自動的に作成します。
- `NgModelGroup`: DOM 要素にバインドされたネストされた `FormGroup` を作成します。

## セットアップ

最初に、コンポーネントまたはモジュールに `FormsModule` をインポートします。

```ts
import {Component} from '@angular/core';
import {FormsModule} from '@angular/forms';

@Component({
  selector: 'app-user-form',
  imports: [FormsModule],
  templateUrl: './user-form.component.html',
})
export class UserForm {
  user = {name: '', role: 'Guest'};

  onSubmit() {
    console.log('Form submitted!', this.user);
  }
}
```

## フォームテンプレートの構築

### `[(ngModel)]` による双方向バインディング

入力要素に `[(ngModel)]` を使用します。**`[(ngModel)]` を使用するすべての要素には `name` 属性が必須です。** Angular は `name` 属性を使用して、コントロールを親の `NgForm` に登録します。

```html
<form #userForm="ngForm" (ngSubmit)="onSubmit()">
  <!-- 基本的な入力フィールド -->
  <div>
    <label for="name">Name:</label>
    <input type="text" id="name" required [(ngModel)]="user.name" name="name" #nameCtrl="ngModel" />
  </div>

  <!-- セレクトボックス -->
  <div>
    <label for="role">Role:</label>
    <select id="role" [(ngModel)]="user.role" name="role">
      <option value="Admin">Admin</option>
      <option value="Guest">Guest</option>
    </select>
  </div>

  <!-- 送信ボタン（フォームが無効な場合は無効化） -->
  <button type="submit" [disabled]="!userForm.form.valid">Submit</button>
</form>
```

## フォームとコントロールの状態

Angular は状態に基づいてコントロールとフォームに CSS クラスを自動的に適用します。

| 状態 | 真の場合のクラス | 偽の場合のクラス |
| :------------- | :-------------------------------- | :------------- |
| 訪問済み | `ng-touched` | `ng-untouched` |
| 値変更済み | `ng-dirty` | `ng-pristine` |
| 値が有効 | `ng-valid` | `ng-invalid` |
| フォーム送信済み | `ng-submitted`（`<form>` のみ） | - |

これらのクラスを CSS でビジュアルフィードバックに使用できます。

```css
.ng-valid[required],
.ng-valid.required {
  border-left: 5px solid #42a948; /* 緑 */
}
.ng-invalid:not(form) {
  border-left: 5px solid #a94442; /* 赤 */
}
```

## バリデーションとエラーメッセージ

条件付きでエラーメッセージを表示するには、`ngModel` ディレクティブをテンプレート参照変数にエクスポートします（例：`#nameCtrl="ngModel"`）。

```html
<input type="text" id="name" required [(ngModel)]="user.name" name="name" #nameCtrl="ngModel" />

<!-- コントロールが無効かつ（touched または dirty の場合）にのみエラーを表示 -->
@if (nameCtrl.invalid && (nameCtrl.dirty || nameCtrl.touched)) {
<div class="alert alert-danger">
  @if (nameCtrl.errors?.['required']) {
  <div>Name is required.</div>
  }
</div>
}
```

## フォームの送信

1. `<form>` 要素で `(ngSubmit)` イベントを使用します。
2. `NgForm` テンプレート参照変数を使用して、フォーム全体の有効性に送信ボタンの無効状態をバインドします（例：`[disabled]="!userForm.form.valid"`）。

## フォームのリセット

フォームをプリスティン状態にプログラムでリセットする（値とバリデーションフラグをクリアする）には、`NgForm` インスタンスの `reset()` メソッドを使用します。

```html
<button type="button" (click)="userForm.reset()">Reset</button>
```
