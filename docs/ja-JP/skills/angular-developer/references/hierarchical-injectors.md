# 階層型インジェクター

Angularの依存性注入システムは階層型であり、サービスをアプリケーションの異なるレベルにスコープできます。

## インジェクター階層の種類

1. **`EnvironmentInjector` 階層**: ブートストラップ時に `@Injectable({ providedIn: 'root' })` または `ApplicationConfig.providers` で設定されます。これらはグローバルシングルトンです。
2. **`ElementInjector` 階層**: 各DOM要素で暗黙的に生成されます。`@Component()` または `@Directive()` の `providers` または `viewProviders` 配列で設定されます。

## 解決ルール

依存関係が要求されると、Angularは2つのフェーズで解決します:

1. 要求元のコンポーネント/ディレクティブからルート要素まで、**`ElementInjector`** ツリーを上方向に検索します。
2. 見つからない場合、最も近い環境インジェクターからルートまで、**`EnvironmentInjector`** ツリーを検索します。
3. それでも見つからない場合、（オプションとしてマークされていない限り）エラーをスローします。

## 解決修飾子

`inject()` のオプションオブジェクトを使用して、Angularが依存関係を検索する方法を変更できます:

- **`optional`**: 依存関係が見つからない場合、エラーをスローする代わりに `null` を返します。
- **`self`**: 現在の `ElementInjector` のみを確認します。親ツリーは検索しません。
- **`skipSelf`**: 現在の要素をスキップして、親の `ElementInjector` から検索を開始します。
- **`host`**: ホストコンポーネントのビュー境界に到達した時点で検索を停止します。

```ts
@Component({...})
export class Example {
  // 見つからない場合にクラッシュする代わりにnullを返す
  optionalService = inject(MyService, { optional: true });

  // このコンポーネントのプロバイダーをスキップして、親を参照する
  parentService = inject(ParentService, { skipSelf: true });
}
```

## `providers` と `viewProviders` の違い

コンポーネントレベルでサービスを提供する場合:

- **`providers`**: サービスはコンポーネント、そのビュー（テンプレート）、および **プロジェクトされたコンテンツ**（`<ng-content>`）で利用可能です。
- **`viewProviders`**: サービスはコンポーネントとそのビューで利用可能ですが、プロジェクトされたコンテンツからは **利用できません**。コンシューマーから渡されたコンテンツからサービスを隔離するために使用します。
