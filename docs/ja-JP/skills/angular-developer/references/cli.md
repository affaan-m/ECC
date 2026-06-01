# エージェント向け Angular CLI ガイド

Angular CLI（`ng`）は Angular ワークスペースを管理するための主要ツールです。プロジェクト構造の変更や Angular 固有の依存関係の追加には、手動でのファイル作成や汎用の `npm` コマンドよりも、CLI コマンドを常に優先してください。

## 1. 依存関係の管理

**Angular ライブラリには `npm install` の代わりに常に `ng add` を使用してください**。`ng add` はパッケージのインストールと初期化スキーマの実行（例: `angular.json` の設定、ルートプロバイダーの更新）の両方を行います。

```bash
ng add @angular/material
ng add tailwindcss
ng add @angular/fire
```

アプリケーションとその依存関係を更新するには（コードのマイグレーションが自動的に実行されます）：

```bash
ng update @angular/core@<latest or specific version> @angular/cli<latest or specific version>
```

## 2. コードの生成（`ng generate` または `ng g`）

Angular の標準に準拠し、必要な設定ファイルを自動的に更新するため、コードの生成には常に CLI を使用してください。

| 対象             | コマンド                  | 備考                                                                                              |
| :--------------- | :------------------------ | :------------------------------------------------------------------------------------------------ |
| コンポーネント   | `ng g c path/to/name`     | コンポーネントを生成します。必要に応じて `--inline-style`（`-s`）または `--inline-template`（`-t`）を使用します。 |
| サービス         | `ng g s path/to/name`     | `@Injectable({providedIn: 'root'})` サービスを生成します。                                        |
| ディレクティブ   | `ng g d path/to/name`     | ディレクティブを生成します。                                                                       |
| パイプ           | `ng g p path/to/name`     | パイプを生成します。                                                                               |
| ガード           | `ng g g path/to/name`     | 関数型ルートガードを生成します。                                                                   |
| 環境設定         | `ng g environments`       | `src/environments/` をスキャフォールドし、`angular.json` にファイル置換設定を追加します。          |

_注意: 単一のルート定義を生成するコマンドはありません。コンポーネントを生成した後、`app.routes.ts` の `Routes` 配列に手動で追加してください。_

## 3. 開発サーバーとプロキシ

ホットモジュールリプレースメント（HMR）付きのローカル開発サーバーを起動します：

```bash
ng serve
```

### バックエンド API のプロキシ

開発中に API リクエストをプロキシする場合（例: `/api` をローカルの Node サーバーにリルーティング）：

1. `src/proxy.conf.json` を作成します：
   ```json
   {
     "/api/**": {"target": "http://localhost:3000", "secure": false}
   }
   ```
2. `angular.json` の `serve` ターゲットを更新します：
   ```json
   "serve": {
     "builder": "@angular/build:dev-server",
     "options": { "proxyConfig": "src/proxy.conf.json" }
   }
   ```

## 4. アプリケーションのビルド

アプリケーションを出力ディレクトリ（デフォルト: `dist/<project-name>/browser`）にコンパイルします。モダンな Angular は esbuild ベースの `@angular/build:application` ビルダーを使用します。

```bash
ng build
```

- `ng build` はデフォルトで本番設定を使用し、Ahead-of-Time（AOT）コンパイル、ミニフィケーション、ツリーシェイキングを有効にします。
- `--configuration` を使用して `angular.json` で定義された特定の設定をターゲットにします：`ng build --configuration=staging`。

## 5. テスト

- **ユニットテスト**: `ng test` を実行して、設定済みのテストランナー（例: Karma または Vitest）でユニットテストを実行します。
- **エンドツーエンド（E2E）**: `ng e2e` を実行します。E2E フレームワークが設定されていない場合、CLI はインストールするフレームワーク（Cypress、Playwright、Puppeteer 等）の選択を促します。

## 6. デプロイ

アプリケーションをデプロイするには、まずデプロイビルダーを追加してから、デプロイコマンドを実行します：

```bash
# Firebase の例
ng add @angular/fire
ng deploy
```
