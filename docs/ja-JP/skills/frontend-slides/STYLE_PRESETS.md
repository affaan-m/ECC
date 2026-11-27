# スタイルプリセットリファレンス

`frontend-slides` 用にまとめられたビジュアルスタイル。

このファイルの用途：

* 強制的なビューポート適合CSSの基礎
* プリセットの選択とムードマッピング
* CSSの落とし穴とバリデーションルール

抽象的な形状のみを使用する。ユーザーが明示的に要求しない限り、イラストを避ける。

## ビューポート適合は妥協しない

各スライドは1つのビューポートに完全に収まる必要がある。

### 黄金ルール

```text
各スライド = ちょうど1つのビューポートの高さ。
コンテンツが多すぎる = 複数のスライドに分割する。
スライド内でスクロールさせない。
```

### コンテンツ密度の制限

| スライドタイプ | 最大コンテンツ量 |
|---|---|
| タイトルスライド | 1つのタイトル + 1つのサブタイトル + オプションのキャッチフレーズ |
| コンテンツスライド | 1つのタイトル + 4〜6つの箇条書きまたは2段落 |
| 機能グリッド | 最大6枚のカード |
| コードスライド | 最大8〜10行 |
| 引用スライド | 1つの引用 + 出典 |
| 画像スライド | 1枚の画像、理想的には60vh未満 |

## 強制基礎CSS

このコードブロックを生成されるすべてのプレゼンテーションにコピーし、その上にテーマを適用する。

```css
/* ===========================================
   VIEWPORT FITTING: MANDATORY BASE STYLES
   =========================================== */

html, body {
    height: 100%;
    overflow-x: hidden;
}

html {
    scroll-snap-type: y mandatory;
    scroll-behavior: smooth;
}

.slide {
    width: 100vw;
    height: 100vh;
    height: 100dvh;
    overflow: hidden;
    scroll-snap-align: start;
    display: flex;
    flex-direction: column;
    position: relative;
}

.slide-content {
    flex: 1;
    display: flex;
    flex-direction: column;
    justify-content: center;
    max-height: 100%;
    overflow: hidden;
    padding: var(--slide-padding);
}

:root {
    --title-size: clamp(1.5rem, 5vw, 4rem);
    --h2-size: clamp(1.25rem, 3.5vw, 2.5rem);
    --h3-size: clamp(1rem, 2.5vw, 1.75rem);
    --body-size: clamp(0.75rem, 1.5vw, 1.125rem);
    --small-size: clamp(0.65rem, 1vw, 0.875rem);

    --slide-padding: clamp(1rem, 4vw, 4rem);
    --content-gap: clamp(0.5rem, 2vw, 2rem);
    --element-gap: clamp(0.25rem, 1vw, 1rem);
}

.card, .container, .content-box {
    max-width: min(90vw, 1000px);
    max-height: min(80vh, 700px);
}

.feature-list, .bullet-list {
    gap: clamp(0.4rem, 1vh, 1rem);
}

.feature-list li, .bullet-list li {
    font-size: var(--body-size);
    line-height: 1.4;
}

.grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(100%, 250px), 1fr));
    gap: clamp(0.5rem, 1.5vw, 1rem);
}

img, .image-container {
    max-width: 100%;
    max-height: min(50vh, 400px);
    object-fit: contain;
}

@media (max-height: 700px) {
    :root {
        --slide-padding: clamp(0.75rem, 3vw, 2rem);
        --content-gap: clamp(0.4rem, 1.5vw, 1rem);
        --title-size: clamp(1.25rem, 4.5vw, 2.5rem);
        --h2-size: clamp(1rem, 3vw, 1.75rem);
    }
}

@media (max-height: 600px) {
    :root {
        --slide-padding: clamp(0.5rem, 2.5vw, 1.5rem);
        --content-gap: clamp(0.3rem, 1vw, 0.75rem);
        --title-size: clamp(1.1rem, 4vw, 2rem);
        --body-size: clamp(0.7rem, 1.2vw, 0.95rem);
    }

    .nav-dots, .keyboard-hint, .decorative {
        display: none;
    }
}

@media (max-height: 500px) {
    :root {
        --slide-padding: clamp(0.4rem, 2vw, 1rem);
        --title-size: clamp(1rem, 3.5vw, 1.5rem);
        --h2-size: clamp(0.9rem, 2.5vw, 1.25rem);
        --body-size: clamp(0.65rem, 1vw, 0.85rem);
    }
}

@media (max-width: 600px) {
    :root {
        --title-size: clamp(1.25rem, 7vw, 2.5rem);
    }

    .grid {
        grid-template-columns: 1fr;
    }
}

@media (prefers-reduced-motion: reduce) {
    *, *::before, *::after {
        animation-duration: 0.01ms !important;
        transition-duration: 0.2s !important;
    }

    html {
        scroll-behavior: auto;
    }
}
```

## ビューポートチェックリスト

* すべての `.slide` に `height: 100vh`、`height: 100dvh`、`overflow: hidden` がある
* すべてのタイポグラフィが `clamp()` を使用している
* すべての間隔が `clamp()` またはビューポート単位を使用している
* 画像に `max-height` 制約がある
* グリッドが適合のために `auto-fit` + `minmax()` を使用している
* 短い高さのブレークポイントが `700px`、`600px`、`500px` に存在する
* コンテンツが窮屈に感じられる場合は、スライドを分割する

## ムードからプリセットへのマッピング

| ムード | 推奨プリセット |
|---|---|
| 印象的 / 自信あり | Bold Signal, Electric Studio, Dark Botanical |
| 興奮 / 活力 | Creative Voltage, Neon Cyber, Split Pastel |
| 落ち着き / 集中 | Notebook Tabs, Paper & Ink, Swiss Modern |
| インスピレーション / 感動 | Dark Botanical, Vintage Editorial, Pastel Geometry |

## プリセットカタログ

### 1. Bold Signal

* 雰囲気：自信あり、高インパクト、基調講演に適している
* 最適用途：ピッチデッキ、製品ローンチ、アナウンス
* フォント：Archivo Black + Space Grotesk
* カラーパレット：チャコールの基調色、明るいオレンジのフォーカスカード、純白のテキスト
* 特徴：超大きなセクション番号、ダーク背景上の高コントラストカード

### 2. Electric Studio

* 雰囲気：クリーン、大胆、機関誌レベルの洗練さ
* 最適用途：クライアントデッキ、戦略レビュー
* フォント：Manropeのみ
* カラーパレット：ブラック、ホワイト、彩度の高いコバルトブルーのアクセント
* 特徴：デュアルパネル分割とシャープな編集スタイルのアライメント

### 3. Creative Voltage

* 雰囲気：活力、レトロモダン、遊び心と自信
* 最適用途：クリエイティブスタジオ、ブランドワーク、プロダクトストーリーテリング
* フォント：Syne + Space Mono
* カラーパレット：エレクトリックブルー、ネオンイエロー、ディープネイビー
* 特徴：ハーフトーンテクスチャ、バッジ、強いコントラスト

### 4. Dark Botanical

* 雰囲気：エレガント、ハイエンド、雰囲気がある
* 最適用途：ラグジュアリーブランド、思慮深いナラティブ、プレミアム製品デモ
* フォント：Cormorant + IBM Plex Sans
* カラーパレット：ほぼブラック、温かみのあるアイボリー、ブラッシュ、ゴールド、テラコッタ
* 特徴：ぼかされた抽象的な円、細いライン、抑制されたモーション

### 5. Notebook Tabs

* 雰囲気：編集的、整理された、触覚的
* 最適用途：レポート、レビュー、構造化されたストーリーテリング
* フォント：Bodoni Moda + DM Sans
* カラーパレット：チャコール上のクリーム色の用紙とソフトカラーのタブ
* 特徴：紙の効果、カラーサイドタブ、バインダーの詳細

### 6. Pastel Geometry

* 雰囲気：親しみやすい、モダン、フレンドリー
* 最適用途：製品概要、入門、軽めのブランドプレゼン
* フォント：Plus Jakarta Sansのみ
* カラーパレット：薄いブルーの背景、クリーム色のカード、ソフトなピンク/ミント/ラベンダーのアクセント
* 特徴：縦長のピル形状、角丸カード、ソフトシャドウ

### 7. Split Pastel

* 雰囲気：楽しい、モダン、クリエイティブ
* 最適用途：エージェンシー紹介、ワークショップ、ポートフォリオ
* フォント：Outfitのみ
* カラーパレット：ミントバッジとのピーチ + ラベンダーの分割背景
* 特徴：分割背景、角丸タグ、軽いグリッドオーバーレイ

### 8. Vintage Editorial

* 雰囲気：機知に富む、個性的、雑誌にインスパイアされた
* 最適用途：パーソナルブランド、オピニオントーク、ストーリーテリング
* フォント：Fraunces + Work Sans
* カラーパレット：クリーム、チャコール、くすんだ温かみのあるアクセント
* 特徴：幾何学的なアクセント、ボーダー付きのコールアウト、印象的なセリフの見出し

### 9. Neon Cyber

* 雰囲気：未来的、テック感、ダイナミック
* 最適用途：AI、インフラ、デベロッパーツール、未来トレンドについての講演
* フォント：Clash Display + Satoshi
* カラーパレット：ミッドナイトネイビー、シアン、マゼンタ
* 特徴：グロー効果、パーティクル、グリッド、データレーダーエナジー感

### 10. Terminal Green

* 雰囲気：デベロッパー向け、ハッカーな簡潔さ
* 最適用途：API、CLIツール、エンジニアリングデモ
* フォント：JetBrains Monoのみ
* カラーパレット：GitHubダーク + ターミナルグリーン
* 特徴：スキャンライン、コマンドラインフレーミング、精確なモノスペースのリズム

### 11. Swiss Modern

* 雰囲気：ミニマリスト、精密、データ指向
* 最適用途：エンタープライズ、製品戦略、アナリティクス
* フォント：Archivo + Nunito
* カラーパレット：ホワイト、ブラック、シグナルレッド
* 特徴：可視グリッド、非対称、幾何学的な秩序感

### 12. Paper & Ink

* 雰囲気：文学的、思慮深い、ストーリー駆動
* 最適用途：散文、基調講演のナラティブ、マニフェスト的なプレゼン
* フォント：Cormorant Garamond + Source Serif 4
* カラーパレット：温かみのあるクリーム、チャコール、ディープレッドのアクセント
* 特徴：引用のハイライト、ドロップキャップ、エレガントなライン

## 直接選択プロンプト

ユーザーがすでに望むスタイルを知っている場合、プレビューを強制的に生成するのではなく、上記のプリセット名から直接選んでもらう。

## アニメーションの感覚マッピング

| 感覚 | モーションの方向 |
|---|---|
| ドラマチック / シネマティック | ゆっくりとしたフェード、視差スクロール、大スケールのズームイン |
| テック感 / 未来的 | グロー、パーティクル、グリッドモーション、テキストのスクランブル表示 |
| 楽しい / フレンドリー | バウンスのイージング、丸い形状、フローティングモーション |
| プロフェッショナル / エンタープライズ | 微妙な200〜300msのトランジション、クリーンなスライド切り替え |
| 落ち着き / ミニマリスト | 非常に控えめなモーション、空白を優先 |
| 編集的 / 雑誌的 | 強い階層性、テキストと画像のずらしたインタラクション |

## CSSの落とし穴：否定関数

以下は絶対に書かない：

```css
right: -clamp(28px, 3.5vw, 44px);
margin-left: -min(10vw, 100px);
```

ブラウザはそれらを静かに無視する。

代わりに常にこのように書く：

```css
right: calc(-1 * clamp(28px, 3.5vw, 44px));
margin-left: calc(-1 * min(10vw, 100px));
```

## バリデーションサイズ

少なくとも以下のサイズでテストする：

* デスクトップ：`1920x1080`、`1440x900`、`1280x720`
* タブレット：`1024x768`、`768x1024`
* モバイル：`375x667`、`414x896`
* 横向きモバイル：`667x375`、`896x414`

## アンチパターン

使用しない：

* 紫背景に白テキストのスタートアップテンプレート
* Inter / Roboto / Arial をビジュアルボイスとして使用する（ユーザーが実用主義的なニュートラルスタイルを明示的に望む場合を除く）
* 箇条書きの詰め込み、過小なフォント、スクロールが必要なコードブロック
* 抽象的な幾何学形状がより良い働きをする場合に装飾的なイラストを使用する
