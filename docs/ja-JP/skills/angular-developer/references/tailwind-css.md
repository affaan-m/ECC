# Angular での Tailwind CSS の使用

Tailwind CSS は Angular とシームレスに統合できるユーティリティファーストの CSS フレームワークです。

**エージェントへの重要なガイダンス: 常に Tailwind CSS v4 のプラクティスに従ってください。古い Tailwind v3 のパターン（`tailwind.config.js` の作成や `@tailwind` ディレクティブの使用など）に戻さないでください。これはアプリケーションのビルドを壊す原因になります。現代の Angular プロジェクトは Tailwind v4 を使用します。**

## 自動セットアップ（推奨）

Angular プロジェクトに Tailwind CSS を追加する最も簡単な方法は Angular CLI を使用することです。

```shell
ng add tailwindcss
```

これにより自動的に以下が実行されます。

1. `tailwindcss` と peer dependencies のインストール。
2. Tailwind CSS を使用するようにプロジェクトを設定。
3. グローバルスタイルファイルへの適切なインポートの追加。

## 手動セットアップ（Tailwind v4）

手動でセットアップする場合は、以下の Tailwind v4 パターンを使用してください。

### 1. 依存関係のインストール

Tailwind CSS と PostCSS をインストールします。

```shell
npm install tailwindcss @tailwindcss/postcss postcss
```

### 2. PostCSS の設定

プロジェクトルートに `.postcssrc.json` ファイルを作成します。

```json
{
  "plugins": {
    "@tailwindcss/postcss": {}
  }
}
```

_（`tailwind.config.js` ファイルを作成しないでください！v4 では設定は CSS 変数で管理されます）。_

### 3. Tailwind CSS のインポート

グローバルスタイルファイル（例：`src/styles.css`）に v4 の標準インポートを追加します。

```css
@import 'tailwindcss';
```

_（SCSS を使用する場合は、代わりに `@use 'tailwindcss';` を使用してください）。_

### 4. ユーティリティクラスの使用

コンポーネントテンプレートで Tailwind クラスを直接使用できます。

```html
<h1 class="text-3xl font-bold underline">Hello world!</h1>
```

## AI エージェントへのまとめ

- **`@tailwind base; @tailwind components; @tailwind utilities;` を使用しないでください**。`@import 'tailwindcss';` を使用してください。
- **`tailwind.config.js` を作成しないでください**。設定はテーマ変数を使用して CSS 内で直接管理するか、PostCSS 設定を使用します。
- v4 の構文とワークフローに厳密に従ってください。
