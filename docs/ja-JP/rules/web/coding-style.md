> このファイルは [common/coding-style.md](../common/coding-style.md) を Web 固有のフロントエンドコンテンツで拡張します。

# Web コーディングスタイル

## ファイル構成

ファイルタイプではなく、機能またはサーフェスエリアごとに整理する:

```text
src/
├── components/
│   ├── hero/
│   │   ├── Hero.tsx
│   │   ├── HeroVisual.tsx
│   │   └── hero.css
│   ├── scrolly-section/
│   │   ├── ScrollySection.tsx
│   │   ├── StickyVisual.tsx
│   │   └── scrolly.css
│   └── ui/
│       ├── Button.tsx
│       ├── SurfaceCard.tsx
│       └── AnimatedText.tsx
├── hooks/
│   ├── useReducedMotion.ts
│   └── useScrollProgress.ts
├── lib/
│   ├── animation.ts
│   └── color.ts
└── styles/
    ├── tokens.css
    ├── typography.css
    └── global.css
```

## CSS カスタムプロパティ

デザイントークンを変数として定義する。パレット、タイポグラフィ、スペーシングを繰り返しハードコードしない:

```css
:root {
  --color-surface: oklch(98% 0 0);
  --color-text: oklch(18% 0 0);
  --color-accent: oklch(68% 0.21 250);

  --text-base: clamp(1rem, 0.92rem + 0.4vw, 1.125rem);
  --text-hero: clamp(3rem, 1rem + 7vw, 8rem);

  --space-section: clamp(4rem, 3rem + 5vw, 10rem);

  --duration-fast: 150ms;
  --duration-normal: 300ms;
  --ease-out-expo: cubic-bezier(0.16, 1, 0.3, 1);
}
```

## アニメーション専用プロパティ

コンポジタフレンドリーなモーションを優先する:
- `transform`
- `opacity`
- `clip-path`
- `filter`（控えめに）

レイアウトに紐づくプロパティのアニメーションを避ける:
- `width`
- `height`
- `top`
- `left`
- `margin`
- `padding`
- `border`
- `font-size`

## セマンティック HTML ファースト

```html
<header>
  <nav aria-label="Main navigation">...</nav>
</header>
<main>
  <section aria-labelledby="hero-heading">
    <h1 id="hero-heading">...</h1>
  </section>
</main>
<footer>...</footer>
```

セマンティック要素が存在するときに、汎用的な `div` ラッパースタックに頼らない。

## 命名

- コンポーネント: PascalCase（`ScrollySection`、`SurfaceCard`）
- フック: `use` プレフィックス（`useReducedMotion`）
- CSS クラス: kebab-case またはユーティリティクラス
- アニメーションタイムライン: 意図を含む camelCase（`heroRevealTl`）
