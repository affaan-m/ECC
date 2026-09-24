---
name: angular-developer
description: Angular コードを生成し、アーキテクチャ ガイダンスを提供します。プロジェクトの作成、コンポーネント、またはサービスを作成するとき、または反応性（シグナル、linkedSignal、リソース）、フォーム、依存性注入、ルーティング、SSR、アクセシビリティ（ARIA）、アニメーション、スタイリング（コンポーネント スタイル、Tailwind CSS）、テスト、または CLI ツール作成のベスト プラクティスについてトリガーされます。
origin: ECC
---

# Angular 開発者 ガイドライン

## アクティブ化するとき

- 任意の Angular プロジェクトまたはコードベースで作業しているとき
- 新しい Angular プロジェクト、アプリケーション、またはライブラリを作成またはスキャフォールディングするとき
- コンポーネント、サービス、ディレクティブ、パイプ、ガード、またはリソルバーを生成するとき
- Angular シグナル、`linkedSignal`、または `resource` で反応性を実装するとき
- Angular フォーム（シグナル フォーム、リアクティブ フォーム、またはテンプレート駆動）で作業するとき
- 依存性注入、ルーティング、遅延ロード、またはルート ガードをセットアップするとき
- アクセシビリティ（ARIA）、アニメーション、またはコンポーネント スタイリングを追加するとき
- Angular 固有のテスト（ユニット、コンポーネント ハーネス、E2E）を作成またはデバッグするとき
- Angular CLI ツール作成または Angular MCP サーバーを構成するとき

1. ガイダンスを提供する前に、常にプロジェクトの Angular バージョンを分析してください。ベスト プラクティスと利用可能な機能はバージョン間で大きく異なる場合があります。Angular CLI を使用して新しいプロジェクトを作成する場合、ユーザーによるプロンプトがない限り、バージョンを指定しないでください。

2. コードを生成するときは、メンテナンス性とパフォーマンスのため、Angular のスタイル ガイドと Angular のベスト プラクティスに従ってください。Angular CLI を使用して、コンポーネント、サービス、ディレクティブ、パイプ、およびルートをスキャフォールディングして、一貫性を確保します。

3. コード生成を完了したら、`ng build` を実行してビルド エラーがないか確認してください。エラーがある場合は、エラー メッセージを分析して修正してから続行してください。生成されたコードが正しく機能することを確認するために、このステップをスキップしないことが重要です。

## 新しいプロジェクトの作成

ユーザーがガイドラインを提供しない場合は、新しい Angular プロジェクトを作成するときに、これらのデフォルトを使用してください。

1. ユーザーが別途指定しない限り、Angular の最新の安定バージョンを使用してください。
2. 対象の Angular バージョンがシグナル フォームをサポートしている場合のみ、新しいプロジェクトではシグナル フォームを優先してください。[詳細情報](references/signal-forms.md)を確認してください。

**`ng new` の実行ルール:**
新しい Angular プロジェクトを作成するよう求められたとき、以下の厳密な手順に従って正しい実行コマンドを決定する必要があります。

**ステップ 1: ユーザーが明示的にバージョンを指定しているか確認します。**

- **IF** ユーザーが特定のバージョンをリクエストしている場合（例：Angular 15）、ローカル インストールをバイパスして、厳密に `npx` を使用してください。
- **コマンド:** `npx @angular/cli@<requested_version> new <project-name>`

**ステップ 2: 既存の Angular インストールを確認します。**

- **IF** 特定のバージョンがリクエストされていない場合、ターミナルで `ng version` を実行して、Angular CLI がシステムに既にインストールされているかどうかを確認してください。
- **IF** コマンドが成功して、インストール済みバージョンが返された場合は、ローカル/グローバル インストールを直接使用してください。
- **コマンド:** `ng new <project-name>`

**ステップ 3: 最新版へのフォールバック**

- **IF** 特定のバージョンがリクエストされていない場合、`ng version` コマンドが失敗した場合（Angular インストールが存在しないことを示す）、`npx` を使用して最新バージョンを取得する必要があります。
- **コマンド:** `npx @angular/cli@latest new <project-name>`

## コンポーネント

Angular コンポーネントで作業するとき、タスクに基づいて次のリファレンスを参照してください。

- **基礎:** 解剖学、メタデータ、コア概念、およびテンプレート制御フロー（@if、@for、@switch）。[components.md](references/components.md) を読んでください。
- **入力:** シグナルベースの入力、変換、およびモデル入力。[inputs.md](references/inputs.md) を読んでください。
- **出力:** シグナルベースの出力とカスタム イベント ベストプラクティス。[outputs.md](references/outputs.md) を読んでください。
- **ホスト要素:** ホスト バインディングとアトリビュート注入。[host-elements.md](references/host-elements.md) を読んでください。

より詳細なドキュメントが上記のリファレンスで見つからない場合は、`https://angular.dev/guide/components` のドキュメントを参照してください。

## 反応性とデータ管理

状態とデータ反応性を管理する場合、Angular シグナルを使用し、次のリファレンスを参照してください。

- **シグナル概要:** コア シグナル概念（`signal`、`computed`）、反応的コンテキスト、および `untracked`。[signals-overview.md](references/signals-overview.md) を読んでください。
- **依存状態（`linkedSignal`）:** ソース シグナルにリンクされた書き込み可能な状態を作成します。[linked-signal.md](references/linked-signal.md) を読んでください。
- **非同期反応性（`resource`）:** シグナル状態に非同期データを直接フェッチします。[resource.md](references/resource.md) を読んでください。
- **副作用（`effect`）:** ロギング、サードパーティ DOM 操作（`afterRenderEffect`）、および副作用を使用しないテーム。[effects.md](references/effects.md) を読んでください。

## フォーム

ほとんどの場合、新しいアプリケーション では **シグナル フォームを優先してください**。フォーム決定を行うときは、プロジェクトを分析し、次のガイドラインを検討してください。

- アプリケーション バージョンがシグナル フォームをサポートしており、これが新しいフォームの場合、**シグナル フォームを優先してください**。
- 古いアプリケーションまたは既存のフォーム については、アプリケーションの現在のフォーム戦略と一致させてください。

- **シグナル フォーム:** フォーム状態管理用にシグナルを使用します。[signal-forms.md](references/signal-forms.md) を読んでください。
- **テンプレート駆動フォーム:** シンプルなフォーム用に使用します。[template-driven-forms.md](references/template-driven-forms.md) を読んでください。
- **リアクティブ フォーム:** 複雑なフォーム用に使用します。[reactive-forms.md](references/reactive-forms.md) を読んでください。

## 依存性注入

Angular に依存性注入を実装するときは、次のガイドラインに従ってください。

- **基礎:** 依存性注入の概要、サービス、および `inject()` 関数。[di-fundamentals.md](references/di-fundamentals.md) を読んでください。
- **サービスの作成と使用:** サービスの作成、`providedIn: 'root'` オプション、およびコンポーネントまたは他のサービスへの注入。[creating-services.md](references/creating-services.md) を読んでください。
- **依存性プロバイダーの定義:** 自動と手動のプロビジョニング、`InjectionToken`、`useClass`、`useValue`、`useFactory`、およびスコープ。[defining-providers.md](references/defining-providers.md) を読んでください。
- **注入コンテキスト:** `inject()` が許可される場所、`runInInjectionContext`、および `assertInInjectionContext`。[injection-context.md](references/injection-context.md) を読んでください。
- **階層型インジェクター:** `EnvironmentInjector` と `ElementInjector`、解決ルール、修飾子（`optional`、`skipSelf`）、および `providers` と `viewProviders`。[hierarchical-injectors.md](references/hierarchical-injectors.md) を読んでください。

## Angular Aria

Accordion、Listbox、Combobox、Menu、Tabs、Toolbar、Tree、Grid などのパターン用のアクセシブルなカスタム コンポーネントを構築する場合は、次のリファレンスを参照してください。

- **Angular Aria コンポーネント:** ヘッドレスで アクセシブルなコンポーネント（Accordion、Listbox、Combobox、Menu、Tabs、Toolbar、Tree、Grid）の構築と ARIA アトリビュートのスタイリング。[angular-aria.md](references/angular-aria.md) を読んでください。

## ルーティング

Angular にナビゲーションを実装する場合は、次のリファレンスを参照してください。

- **ルートを定義:** URL パス、静的vs動的セグメント、ワイルドカード、およびリダイレクト。[define-routes.md](references/define-routes.md) を読んでください。
- **ルート読み込み戦略:** 遅延ロードとコンテキスト対応読み込み。[loading-strategies.md](references/loading-strategies.md) を読んでください。
- **ルートアウトレットで表示:** `<router-outlet>`、ネストされたアウトレット、および名前付きアウトレットの使用。[show-routes-with-outlets.md](references/show-routes-with-outlets.md) を読んでください。
- **ルートにナビゲート:** `RouterLink` による宣言的ナビゲーションと `Router` による プログラマティック ナビゲーション。[navigate-to-routes.md](references/navigate-to-routes.md) を読んでください。
- **ルート アクセスを制御:** `CanActivate`、`CanMatch` などのガードを実装してセキュリティを確保します。[route-guards.md](references/route-guards.md) を読んでください。
- **データリソルバー:** `ResolveFn` によるルート有効化前のデータ プリフェッチ。[data-resolvers.md](references/data-resolvers.md) を読んでください。
- **ルーター ライフサイクルとイベント:** ナビゲーション イベントの時間的順序とデバッグ。[router-lifecycle.md](references/router-lifecycle.md) を読んでください。
- **レンダリング戦略:** CSR、SGG（プリレンダリング）、およびハイドレーションを備えた SSR。[rendering-strategies.md](references/rendering-strategies.md) を読んでください。
- **ルート遷移アニメーション:** ビュー遷移 API の有効化とカスタマイズ。[route-animations.md](references/route-animations.md) を読んでください。

より詳細なドキュメントまたは詳細なコンテキストが必要な場合は、[公式 Angular ルーティング ガイド](https://angular.dev/guide/routing) をご覧ください。

## スタイリングとアニメーション

Angular でスタイリングとアニメーションを実装する場合は、次のリファレンスを参照してください。

- **Angular での Tailwind CSS の使用:** Angular プロジェクトへの Tailwind CSS 統合。[tailwind-css.md](references/tailwind-css.md) を読んでください。
- **Angular アニメーション:** ネイティブ CSS（推奨）またはレガシー DSL を使用した動的エフェクト。[angular-animations.md](references/angular-animations.md) を読んでください。
- **コンポーネント スタイリング:** コンポーネント スタイルとカプセル化のベスト プラクティス。[component-styling.md](references/component-styling.md) を読んでください。

## テスト

テストを作成または更新するときは、タスクに基づいて次のリファレンスを参照してください。

- **基礎:** ユニット テスト、非同期パターン、および `TestBed` のベスト プラクティス。[testing-fundamentals.md](references/testing-fundamentals.md) を読んでください。
- **コンポーネント ハーネス:** コンポーネント操作の標準パターン。[component-harnesses.md](references/component-harnesses.md) を読んでください。
- **ルーター テスト:** 信頼性の高いナビゲーション テストに `RouterTestingHarness` を使用します。[router-testing.md](references/router-testing.md) を読んでください。
- **エンドツーエンド（E2E）テスト:** Cypress または Playwright を使用した E2E テストのベスト プラクティス。[e2e-testing.md](references/e2e-testing.md) を読んでください。

## ツール

Angular ツール作成で作業するときは、次のリファレンスを参照してください。

- **Angular CLI:** アプリケーション、生成コード（コンポーネント、ルート、サービス）、提供、およびビルドの作成。[cli.md](references/cli.md) を読んでください。
- **Angular MCP サーバー:** 利用可能なツール、構成、および実験的機能。[mcp.md](references/mcp.md) を読んでください。

## アンチパターン

- シグナル フォーム フィールド値として `null` または `undefined` を使用する — 代わりに `''`、`0`、または `[]` を使用してください。
- フィールドを呼び出さずにフォーム フィールド状態フラグにアクセスする：`form.field.valid()` — 代わりに `form.field().valid()` を使用してください。
- 対象の Angular バージョンがシグナル フォームをサポートしているときに古いフォーム API で新しいフォームを開始する。
- `[formField]` 入力に `min`、`max`、`value`、`disabled`、または `readonly` HTML アトリビュートを設定する — 代わりにこれらをスキーマ ルールとして定義してください。
- 注入コンテキストの外で `inject()` を呼び出す — 必要な場合は `runInInjectionContext` を使用してください。
- 派生状態に `effect()` を使用する — 代わりに `computed()` を使用してください。
- ネストされた `@for` ループで `$parent.$index` を参照する — Angular は `$parent` をサポートしていません。代わりに `let outerIdx = $index` を使用してください。

## 関連スキル

- `tdd-workflow` — Angular コンポーネントおよびサービスに適用可能なテスト駆動開発ワークフロー。
- `security-review` — Angular 固有の懸念を含む Web アプリケーションのセキュリティ チェックリスト。
- `frontend-patterns` — React/Next.js アプローチのコンテキスト用の一般的なフロントエンド パターン。
