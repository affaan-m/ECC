# リアクティブフォーム

リアクティブフォームは、フォーム入力をモデル駆動で処理するアプローチを提供します。オブザーバブルストリームを中心に構築されており、データモデルへの同期的なアクセスを提供するため、テンプレート駆動フォームよりもスケーラブルでテストしやすくなっています。

## コアクラス

リアクティブフォームは `@angular/forms` の以下の基本クラスで構築されます:

- `FormControl`: 個々の入力の値と有効性を管理します。
- `FormGroup`: コントロールのグループ（オブジェクト状の構造）を管理します。
- `FormArray`: 数値インデックス付きのコントロール配列を管理します。
- `FormBuilder`: コントロールインスタンスを生成するファクトリーメソッドを提供するサービスです。

## セットアップ

コンポーネントに `ReactiveFormsModule` をインポートします。

```ts
import {Component, inject} from '@angular/core';
import {ReactiveFormsModule, FormGroup, FormControl, Validators, FormBuilder} from '@angular/forms';

@Component({
  selector: 'app-profile-editor',
  imports: [ReactiveFormsModule],
  templateUrl: './profile-editor.component.html',
})
export class ProfileEditor {
  private fb = inject(FormBuilder);

  // FormBuilderを使用した簡潔な定義
  profileForm = this.fb.group({
    firstName: ['', Validators.required],
    lastName: [''],
    address: this.fb.group({
      street: [''],
      city: [''],
    }),
    aliases: this.fb.array([this.fb.control('')]),
  });

  onSubmit() {
    console.warn(this.profileForm.value);
  }
}
```

## テンプレートバインディング

モデルをビューにバインドするためのディレクティブを使用します:

- `[formGroup]`: `FormGroup` を `<form>` または `<div>` にバインドします。
- `formControlName`: グループ内の名前付きコントロールを入力にバインドします。
- `formGroupName`: ネストされた `FormGroup` をバインドします。
- `formArrayName`: ネストされた `FormArray` をバインドします。
- `[formControl]`: スタンドアロンの `FormControl` をバインドします。

```html
<form [formGroup]="profileForm" (ngSubmit)="onSubmit()">
  <input type="text" formControlName="firstName" />

  <div formGroupName="address">
    <input type="text" formControlName="street" />
  </div>

  <div formArrayName="aliases">
    @for (alias of aliases.controls; track $index) {
    <input type="text" [formControlName]="$index" />
    }
  </div>

  <button type="submit" [disabled]="!profileForm.valid">Submit</button>
</form>
```

## コントロールへのアクセス

特に `FormArray` の場合は、コントロールへの簡単なアクセスのためにゲッターを使用します。

```ts
get aliases() {
  return this.profileForm.get('aliases') as FormArray;
}

addAlias() {
  this.aliases.push(this.fb.control(''));
}
```

## 値の更新

- `patchValue()`: 指定したプロパティのみを更新します。構造の不一致があっても静かに失敗します。
- `setValue()`: モデル全体を置き換えます。フォーム構造を厳密に適用します。

```ts
updateProfile() {
  this.profileForm.patchValue({
    firstName: 'Nancy',
    address: { street: '123 Drew Street' }
  });
}
```

## 統一された変更イベント

モダンなAngular（v18以降）では、すべてのコントロールに単一の `events` オブザーバブルが提供され、値、ステータス、pristine、touched、リセット、サブミットイベントを追跡できます。

```ts
import {ValueChangeEvent, StatusChangeEvent} from '@angular/forms';

this.profileForm.events.subscribe((event) => {
  if (event instanceof ValueChangeEvent) {
    console.log('New value:', event.value);
  }
});
```

## 手動状態管理

- `markAsTouched()` / `markAllAsTouched()`: サブミット時にバリデーションエラーを表示するために役立ちます。
- `markAsDirty()` / `markAsPristine()`: 値が変更されたかどうかを追跡します。
- `updateValueAndValidity()`: 値とステータスの再計算を手動でトリガーします。
- オプション `{ emitEvent: false }` または `{ onlySelf: true }` をほとんどのメソッドに渡して、伝播を制御できます。
