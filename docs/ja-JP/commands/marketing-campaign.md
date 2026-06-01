---
description: マーケティングキャンペーンをブリーフからフルコンテンツスイートまで計画・実行します。プロダクトブリーフを受け取り、ポジショニング、ランディングページコピー、メールシーケンス、ソーシャル投稿、広告バリアント、動画スクリプト、コンテンツカレンダーを返します。既存のコピーのコンバージョン品質レビューにも対応します。
allowed_tools: ["Read", "Grep", "Glob", "WebSearch", "WebFetch", "Write"]
---

# /marketing-campaign

ブリーフからフルコンテンツスイートまでマーケティングキャンペーンを計画・実行します。

## 使用方法

```
/marketing-campaign                          # インタラクティブにブリーフを入力
/marketing-campaign [product brief]          # インラインブリーフからフルキャンペーンを実行
/marketing-campaign copy [type]              # 単一成果物のみ
/marketing-campaign review [file-or-brief]   # コンバージョンとブランド一貫性のコピー監査
```

## 機能

1. **リサーチ** — 何かを書く前にターゲットオーディエンスをプロファイリングし競合他社をマッピング
2. **ポジショニング** — 先にキャンペーンアングルとトーンプロファイルを固める
3. **コピー制作** — 正しい順序でフルコンテンツスイートを生成（ランディングページ → メール → ソーシャル → 広告 → 動画スクリプト → カレンダー）
4. **レビュー** — コンバージョンとブランド一貫性チェックリストを通じてすべての出力をゲート

## モード

### フルキャンペーンモード

以下を含むプロダクトブリーフを提供する:
- プロダクト名と説明
- ターゲットオーディエンス（具体的に、汎用的でなく）
- プロダクトが解決する核心的な問題
- 核心的なベネフィット / 成果
- トーンガイダンス
- 必要なチャネル
- ローンチゴールまたはタイムライン

エージェントはすべてのキャンペーン成果物を順序通りに返し、最後にコピーレビューサマリーを付ける。

### 単一成果物モード

```
/marketing-campaign copy landing-page
/marketing-campaign copy email-sequence
/marketing-campaign copy social-posts
/marketing-campaign copy ads
/marketing-campaign copy video-scripts
```

ポジショニングが先に定義されている必要がある。単一の成果物をリクエストする前に、フルモードを実行するかアングルを提供する。

### コピーレビューモード

```
/marketing-campaign review path/to/copy.md
/marketing-campaign review "ここにコピーを貼り付け"
```

以下に対して構造化された監査を返す:
- 5 秒明確性テスト（ファーストビューのコピー）
- CTA 品質（具体的、根拠あり、1 件につき 1 つ）
- ブランドトーンの一貫性
- クレームの具体性と裏付け可能性
- プラットフォームネイティブの適合性
- クロスチャネルの一貫性

## ブリーフテンプレート

```markdown
Product: [名前]
Description: [何をするかを 1〜3 文で]
Audience: [誰に対して、具体的に]
Problem: [プロダクトが解決する特定のペイン]
Benefit: [ユーザーが得る成果]
Tone: [形容詞 + 避けるべきもの]
Channels: [ランディングページ、メール、LinkedIn、X、広告、動画]
Goal: [ローンチ、ウェイトリスト、サインアップ、認知 — およびタイムライン]
```

## 出力場所

キャンペーンアセットを保存する際の規約は `.claude/campaigns/{campaign-name}/`:

```
.claude/campaigns/product-launch/
├── positioning.md
├── landing-page.md
├── email-sequence.md
├── social-posts.md
├── ad-copy.md
├── video-scripts.md
└── content-calendar.md
```

ファイルを書き込む前に保存場所を確認する。

## 例

```
/marketing-campaign 英国の大学生向け AI キャリアプラットフォームの 7 日間ローンチキャンペーンを構築する。
```

```
/marketing-campaign copy landing-page
```

```
/marketing-campaign review .claude/campaigns/the-key/landing-page.md
```

## エージェントへの委譲

このコマンドは以下を呼び出す:
- `marketing-agent` — キャンペーン計画とコピー制作
- `brand-voice` — 複数の出力をまたぐトーンを固める必要がある場合の声のキャプチャ
- `content-engine` — プラットフォームネイティブなソーシャルコンテンツ制作
- `crosspost` — マルチプラットフォームの配信
- `market-research` — 深いオーディエンスまたは競合インテリジェンス

## 関連コマンド

- `/plan` — キャンペーン前の戦略計画
- `/plan-prd` — キャンペーンのブリーフィング前のプロダクト要件ドキュメント
- `/code-review` — ランディングページ実装の背後にあるコードのレビュー

---

*[Everything Claude Code](https://github.com/affaan-m/everything-claude-code) の一部*
