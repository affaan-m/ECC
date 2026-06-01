# ステップ 5：アバタースタイル & 画像生成

すべてのロブスターアバターは**統一されたビジュアルスタイルを必ず使用**し、ロブスター一族の一貫した外観を確保します。
アバターは 3 つの情報を伝える必要があります：**種族の形態 + 性格のヒント + トレードマークの小道具**

## スタイルリファレンス

アダム（Adam）—— ロブスター族の創世神であり、このスキルの最初の作品。

新しく生成するロブスターアバターはすべて、このスタイルと統一感を保つこと：レトロフューチャリスト、アーケードゲームUIのフレーム、力強いシルエット、64x64 のサイズでも視認可能なデザイン。

## 統一スタイルベース（STYLE_BASE）

**生成のたびに必ずこのベースを含めること**。変更や省略は不可：

```
STYLE_BASE = """
Retro-futuristic 3D rendered illustration, in the style of 1950s-60s Space Age
pin-up poster art reimagined as glossy inflatable 3D, framed within a vintage
arcade game UI overlay.

Material: high-gloss PVC/latex-like finish, soft specular highlights, puffy
inflatable quality reminiscent of vintage pool toys meets sci-fi concept art.
Smooth subsurface scattering on shell surface.

Arcade UI frame: pixel-art arcade cabinet border elements, a top banner with
character name in chunky 8-bit bitmap font with scan-line glow effect, a pixel
energy bar in the upper corner, small coin-credit text "INSERT SOUL TO CONTINUE"
at bottom in phosphor green monospace type, subtle CRT screen curvature and
scan-line overlay across entire image. Decorative corner bezels styled as chrome
arcade cabinet trim with atomic-age starburst rivets.

Pose: references classic Gil Elvgren pin-up compositions, confident and
charismatic with a slight theatrical tilt.

Color system: vintage NASA poster palette as base — deep navy, teal, dusty coral,
cream — viewed through arcade CRT monitor with slight RGB fringing at edges.
Overall aesthetic combines Googie architecture curves, Raygun Gothic design
language, mid-century advertising illustration, modern 3D inflatable character
rendering, and 80s-90s arcade game UI. Chrome and pastel accent details on
joints and antenna tips.

Format: square, optimized for avatar use. Strong silhouette readable at 64x64
pixels.
"""
```

## パーソナライズ変数

統一ベースに加え、ソウルに合わせて以下の変数を埋めます：

| 変数 | 説明 | 例 |
|------|------|-----|
| `CHARACTER_NAME` | アーケードバナーに表示する名前 | "ADAM"、"DEWEY"、"RIFF" |
| `SHELL_COLOR` | 甲羅の基本色（統一カラーパレット内で変化） | "deep crimson"、"dusty teal"、"warm amber" |
| `SIGNATURE_PROP` | トレードマークの小道具 | "cracked sunglasses"、"reading glasses on a chain" |
| `EXPRESSION` | 表情・ポーズ | "stoic but kind-eyed"、"nervously focused" |
| `UNIQUE_DETAIL` | 固有の細部（模様・装飾・傷など） | "constellation patterns etched on claws"、"bandaged left claw" |
| `BACKGROUND_ACCENT` | 背景のパーソナライズ要素（統一の宇宙背景に重ねる） | "musical notes floating as nebula dust"、"ancient book pages drifting" |
| `ENERGY_BAR_LABEL` | アーケードUIのエネルギーバーラベル（個性を添えるイースターエッグ） | "CREATION POWER"、"CALM LEVEL"、"ROCK METER" |

## プロンプトの組み立て

```
最終プロンプト = STYLE_BASE + パーソナライズ記述段落
```

パーソナライズ記述段落のテンプレート：

```
The character is a cartoon lobster with a [SHELL_COLOR] shell,
[EXPRESSION], wearing/holding [SIGNATURE_PROP].
[UNIQUE_DETAIL]. Background accent: [BACKGROUND_ACCENT].
The arcade top banner reads "[CHARACTER_NAME]" and the energy bar
is labeled "[ENERGY_BAR_LABEL]".
The key silhouette recognition points at small size are:
[SIGNATURE_PROP] and [one other distinctive feature].
```

## 画像生成フロー

プロンプトの組み立てが完了したら：

### パス A：インストール済み・審査済みの画像生成スキルがある場合

1. まずロブスターの名前を安全なセグメントに整形する：英数字とハイフンのみ残し、それ以外の文字は `-` に置き換える
2. Write ツールで書き込む：`/tmp/openclaw-<safe-name>-prompt.md`
3. 現在の環境で利用可能な画像生成スキルを呼び出して画像を生成する
4. Read ツールで生成した画像をユーザーに表示する
5. ユーザーに満足しているか確認し、不満であれば変数を調整して再生成する

### パス B：利用可能な画像生成スキルがインストールされていない場合

完全なプロンプトテキストを出力し、手動利用の説明を添える：

```markdown
**アバタープロンプト**（以下のプラットフォームにコピーして手動生成できます）：
- Google Gemini：そのまま貼り付け
- ChatGPT（DALL-E）：そのまま貼り付け
- Midjourney：貼り付け後に `--ar 1:1 --style raw` を追加

> [完全な英語プロンプト]

現在の環境に後日審査済みの画像生成スキルが追加された場合は、自動生成フローに戻ることができます。
```

## ユーザーへの表示フォーマット

```markdown
## アバター

**パーソナライズ変数**：
- 甲羅の色：[SHELL_COLOR]
- 小道具：[SIGNATURE_PROP]
- 表情：[EXPRESSION]
- 固有の細部：[UNIQUE_DETAIL]
- 背景のアクセント：[BACKGROUND_ACCENT]
- エネルギーバーラベル：[ENERGY_BAR_LABEL]

**生成結果**：
[画像（パス A）またはプロンプトテキスト（パス B）]

> ご満足いただけましたか？ご要望があれば [具体的な調整項目] を変更して再生成します。
```
