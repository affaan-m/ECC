# アニメーションパターンリファレンス

プレゼンテーションを生成する際にこのリファレンスを活用してください。意図する印象に合わせてアニメーションを選択します。

## 効果と印象の対応ガイド

| 印象 | アニメーション | ビジュアルの特徴 |
|------|---------------|-----------------|
| **ドラマティック / シネマティック** | スローフェードイン（1〜1.5秒）、大きなスケールトランジション（0.9 から 1）、パララックススクロール | 暗い背景、スポットライト効果、フルブリード画像 |
| **テック系 / フューチャリスティック** | ネオングロー（box-shadow）、グリッチ/スクランブルテキスト、グリッドリビール | パーティクルシステム（canvas）、グリッドパターン、等幅フォントアクセント、シアン/マゼンタ/エレクトリックブルー |
| **ポップ / フレンドリー** | バウンシーなイージング（スプリング物理）、フローティング/ボビング | 角丸、パステル/鮮やかなカラー、手書き風要素 |
| **プロフェッショナル / コーポレート** | 控えめで素早いアニメーション（200〜300ms）、クリーンなスライド | ネイビー/スレート/チャコール、精密なスペーシング、データビジュアライゼーション重視 |
| **落ち着いた / ミニマル** | 非常にゆっくりとした微細な動き、ソフトなフェード | 広い余白、落ち着いたパレット、セリフ体フォント、余裕あるパディング |
| **エディトリアル / マガジン風** | スタガーされたテキストリビール、画像とテキストのインタープレイ | 強いタイプ階層、引用ブロック、グリッドを崩したレイアウト、セリフ見出し＋サンセリフ本文 |

## 入場アニメーション

```css
/* フェード + スライドアップ（最も汎用性が高い） */
.reveal {
    opacity: 0;
    transform: translateY(30px);
    transition: opacity 0.6s var(--ease-out-expo),
                transform 0.6s var(--ease-out-expo);
}
.visible .reveal {
    opacity: 1;
    transform: translateY(0);
}

/* スケールイン */
.reveal-scale {
    opacity: 0;
    transform: scale(0.9);
    transition: opacity 0.6s, transform 0.6s var(--ease-out-expo);
}
.visible .reveal-scale {
    opacity: 1;
    transform: scale(1);
}

/* 左からスライドイン */
.reveal-left {
    opacity: 0;
    transform: translateX(-50px);
    transition: opacity 0.6s, transform 0.6s var(--ease-out-expo);
}
.visible .reveal-left {
    opacity: 1;
    transform: translateX(0);
}

/* ブラーイン */
.reveal-blur {
    opacity: 0;
    filter: blur(10px);
    transition: opacity 0.8s, filter 0.8s var(--ease-out-expo);
}
.visible .reveal-blur {
    opacity: 1;
    filter: blur(0);
}
```

## 背景エフェクト

```css
/* グラデーションメッシュ — 奥行きを出す重ね合わせ放射状グラデーション */
.gradient-bg {
    background:
        radial-gradient(ellipse at 20% 80%, rgba(120, 0, 255, 0.3) 0%, transparent 50%),
        radial-gradient(ellipse at 80% 20%, rgba(0, 255, 200, 0.2) 0%, transparent 50%),
        var(--bg-primary);
}

/* ノイズテクスチャ — 粒状感のためのインラインSVG */
.noise-bg {
    background-image: url("data:image/svg+xml,..."); /* Inline SVG noise */
}

/* グリッドパターン — 構造を示す控えめなライン */
.grid-bg {
    background-image:
        linear-gradient(rgba(255,255,255,0.03) 1px, transparent 1px),
        linear-gradient(90deg, rgba(255,255,255,0.03) 1px, transparent 1px);
    background-size: 50px 50px;
}
```

## インタラクティブエフェクト

```javascript
/* ホバー時の3Dチルト — カード/パネルに奥行きを加える */
class TiltEffect {
    constructor(element) {
        this.element = element;
        this.element.style.transformStyle = 'preserve-3d';
        this.element.style.perspective = '1000px';

        this.element.addEventListener('mousemove', (e) => {
            const rect = this.element.getBoundingClientRect();
            const x = (e.clientX - rect.left) / rect.width - 0.5;
            const y = (e.clientY - rect.top) / rect.height - 0.5;
            this.element.style.transform = `rotateY(${x * 10}deg) rotateX(${-y * 10}deg)`;
        });

        this.element.addEventListener('mouseleave', () => {
            this.element.style.transform = 'rotateY(0) rotateX(0)';
        });
    }
}
```

## トラブルシューティング

| 問題 | 対処法 |
|------|--------|
| フォントが読み込まれない | Fontshare/Google Fonts のURLを確認し、CSSのフォント名が一致しているか確認する |
| アニメーションが起動しない | Intersection Observer が動作しているか確認し、`.visible` クラスが付与されているか確認する |
| スクロールスナップが機能しない | html 要素に `scroll-snap-type: y mandatory` が設定されているか確認する。各スライドに `scroll-snap-align: start` が必要 |
| モバイルでの問題 | 768pxブレークポイントで重いエフェクトを無効化し、タッチイベントをテストし、パーティクル数を減らす |
| パフォーマンスの問題 | `will-change` は最小限に使用し、`transform`/`opacity` アニメーションを優先し、スクロールハンドラーをスロットルする |
