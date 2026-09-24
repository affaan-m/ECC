# タイムライン編集ガイド

VideoDBは、複数のクリップからビデオを合成し、テキストや画像のオーバーレイを追加し、オーディオトラックをミックスし、クリップをトリミングするための非破壊的なタイムラインエディターを提供する——すべてサーバーサイドで、再エンコードやローカルツールは不要。トリミング、クリップのマージ、ビデオへのオーディオ/音楽のオーバーレイ、字幕の追加、テキストや画像のオーバーレイに使用できる。

## 前提条件

ビデオ、オーディオ、画像は、タイムラインアセットとして使用するために**コレクションにアップロードされている必要がある**。字幕オーバーレイには、ビデオも**音声単語のインデックスが作成されている必要がある**。

## コアコンセプト

### タイムライン

`Timeline` は仮想合成レイヤーである。アセットはタイムラインに**インライン**（メイントラックに順番に配置）または**オーバーレイ**（特定のタイムスタンプにレイヤーとして配置）として配置できる。元のメディアは変更されない；最終ストリームはオンデマンドでコンパイルされる。

```python
from videodb.timeline import Timeline

timeline = Timeline(conn)
```

### アセット

タイムライン上の各要素は**アセット**である。VideoDBは5種類のアセットタイプを提供する：

| アセット | インポート | 主な用途 |
|-------|--------|-------------|
| `VideoAsset` | `from videodb.asset import VideoAsset` | ビデオクリップ（トリミング、順序付け） |
| `AudioAsset` | `from videodb.asset import AudioAsset` | 音楽、効果音、ナレーション |
| `ImageAsset` | `from videodb.asset import ImageAsset` | ロゴ、サムネイル、オーバーレイ |
| `TextAsset` | `from videodb.asset import TextAsset, TextStyle` | タイトル、字幕、ローワーサード |
| `CaptionAsset` | `from videodb.editor import CaptionAsset` | 自動レンダリング字幕（エディターAPI） |

## タイムラインの構築

### ビデオクリップをインラインで追加する

インラインアセットはメインビデオトラックに順番に再生される。`add_inline` メソッドは `VideoAsset` のみを受け入れる：

```python
from videodb.asset import VideoAsset

video_a = coll.get_video(video_id_a)
video_b = coll.get_video(video_id_b)

timeline = Timeline(conn)
timeline.add_inline(VideoAsset(asset_id=video_a.id))
timeline.add_inline(VideoAsset(asset_id=video_b.id))

stream_url = timeline.generate_stream()
```

### トリミング / サブクリップ

`VideoAsset` の `start` と `end` を使用して一部を抽出する：

```python
# Take only seconds 10–30 from the source video
clip = VideoAsset(asset_id=video.id, start=10, end=30)
timeline.add_inline(clip)
```

### VideoAssetのパラメータ

| パラメータ | 型 | デフォルト | 説明 |
|-----------|------|---------|-------------|
| `asset_id` | `str` | 必須 | ビデオメディアID |
| `start` | `float` | `0` | トリミング開始時間（秒） |
| `end` | `float\|None` | `None` | トリミング終了時間（`None` = 完全なビデオ） |

> **警告：** SDKは負のタイムスタンプを検証しない。`start=-5` を渡すと静かに受け入れられるが、破損したまたは予期しない出力を生成する。`VideoAsset` を作成する前に常に `start >= 0`、`start < end`、`end <= video.length` を確認すること。

## テキストオーバーレイ

タイムラインの任意の点にタイトル、ローワーサード、またはアノテーションを追加する：

```python
from videodb.asset import TextAsset, TextStyle

title = TextAsset(
    text="Welcome to the Demo",
    duration=5,
    style=TextStyle(
        fontsize=36,
        fontcolor="white",
        boxcolor="black",
        alpha=0.8,
        font="Sans",
    ),
)

# Overlay the title at the very start (t=0)
timeline.add_overlay(0, title)
```

### TextStyleのパラメータ

| パラメータ | 型 | デフォルト | 説明 |
|-----------|------|---------|-------------|
| `fontsize` | `int` | `24` | フォントサイズ（ピクセル） |
| `fontcolor` | `str` | `"black"` | CSSカラー名または16進数値 |
| `fontcolor_expr` | `str` | `""` | 動的フォントカラー式 |
| `alpha` | `float` | `1.0` | テキストの不透明度（0.0〜1.0） |
| `font` | `str` | `"Sans"` | フォントファミリー |
| `box` | `bool` | `True` | 背景ボックスを有効にする |
| `boxcolor` | `str` | `"white"` | 背景ボックスカラー |
| `boxborderw` | `str` | `"10"` | ボックスの境界線幅 |
| `boxw` | `int` | `0` | ボックス幅のオーバーライド |
| `boxh` | `int` | `0` | ボックス高さのオーバーライド |
| `line_spacing` | `int` | `0` | 行間隔 |
| `text_align` | `str` | `"T"` | ボックス内のテキスト整列 |
| `y_align` | `str` | `"text"` | 垂直整列の基準 |
| `borderw` | `int` | `0` | テキスト境界線幅 |
| `bordercolor` | `str` | `"black"` | テキスト境界線カラー |
| `expansion` | `str` | `"normal"` | テキスト展開モード |
| `basetime` | `int` | `0` | 時間ベースの式の基準時間 |
| `fix_bounds` | `bool` | `False` | テキスト境界を固定する |
| `text_shaping` | `bool` | `True` | テキストシェーピングを有効にする |
| `shadowcolor` | `str` | `"black"` | シャドウカラー |
| `shadowx` | `int` | `0` | シャドウXオフセット |
| `shadowy` | `int` | `0` | シャドウYオフセット |
| `tabsize` | `int` | `4` | タブサイズ（スペース数） |
| `x` | `str` | `"(main_w-text_w)/2"` | 水平位置の式 |
| `y` | `str` | `"(main_h-text_h)/2"` | 垂直位置の式 |

## オーディオオーバーレイ

バックグラウンドミュージック、効果音、またはナレーションをメインビデオトラックの上にオーバーレイする：

```python
from videodb.asset import AudioAsset

music = coll.get_audio(music_id)

audio_layer = AudioAsset(
    asset_id=music.id,
    disable_other_tracks=False,
    fade_in_duration=2,
    fade_out_duration=2,
)

# Start the music at t=0, overlaid on the video track
timeline.add_overlay(0, audio_layer)
```

### AudioAssetのパラメータ

| パラメータ | 型 | デフォルト | 説明 |
|-----------|------|---------|-------------|
| `asset_id` | `str` | 必須 | オーディオメディアID |
| `start` | `float` | `0` | トリミング開始時間（秒） |
| `end` | `float\|None` | `None` | トリミング終了時間（`None` = 完全なオーディオ） |
| `disable_other_tracks` | `bool` | `True` | Trueの場合、他のオーディオトラックをミュートする |
| `fade_in_duration` | `float` | `0` | フェードイン秒数（最大5） |
| `fade_out_duration` | `float` | `0` | フェードアウト秒数（最大5） |

## 画像オーバーレイ

ロゴ、ウォーターマーク、または生成された画像をオーバーレイとして追加する：

```python
from videodb.asset import ImageAsset

logo = coll.get_image(logo_id)

logo_overlay = ImageAsset(
    asset_id=logo.id,
    duration=10,
    width=120,
    height=60,
    x=20,
    y=20,
)

timeline.add_overlay(0, logo_overlay)
```

### ImageAssetのパラメータ

| パラメータ | 型 | デフォルト | 説明 |
|-----------|------|---------|-------------|
| `asset_id` | `str` | 必須 | 画像メディアID |
| `width` | `int\|str` | `100` | 表示幅 |
| `height` | `int\|str` | `100` | 表示高さ |
| `x` | `int` | `80` | 水平位置（左からのピクセル） |
| `y` | `int` | `20` | 垂直位置（上からのピクセル） |
| `duration` | `float\|None` | `None` | 表示時間（秒） |

## 字幕オーバーレイ

ビデオに字幕を追加する方法は2つある。

### 方法1：字幕ワークフロー（最もシンプル）

`video.add_subtitle()` を使用してビデオストリームに字幕を直接バーンインする。これは内部で `videodb.timeline.Timeline` を使用する：

```python
from videodb import SubtitleStyle

# Video must have spoken words indexed first (force=True skips if already done)
video.index_spoken_words(force=True)

# Add subtitles with default styling
stream_url = video.add_subtitle()

# Or customise the subtitle style
stream_url = video.add_subtitle(style=SubtitleStyle(
    font_name="Arial",
    font_size=22,
    primary_colour="&H00FFFFFF",
    bold=True,
))
```

### 方法2：エディターAPI（高度）

エディターAPI（`videodb.editor`）は、`CaptionAsset`、`Clip`、`Track`、独自の `Timeline` を持つトラックベースの合成システムを提供する。これは上記で使用した `videodb.timeline.Timeline` とは独立したAPIである。

```python
from videodb.editor import (
    CaptionAsset,
    Clip,
    Track,
    Timeline as EditorTimeline,
    FontStyling,
    BorderAndShadow,
    Positioning,
    CaptionAnimation,
)

# Video must have spoken words indexed first (force=True skips if already done)
video.index_spoken_words(force=True)

# Create a caption asset
caption = CaptionAsset(
    src="auto",
    font=FontStyling(name="Clear Sans", size=30),
    primary_color="&H00FFFFFF",
    back_color="&H00000000",
    border=BorderAndShadow(outline=1),
    position=Positioning(margin_v=30),
    animation=CaptionAnimation.box_highlight,
)

# Build an editor timeline with tracks and clips
editor_tl = EditorTimeline(conn)
track = Track()
track.add_clip(start=0, clip=Clip(asset=caption, duration=video.length))
editor_tl.add_track(track)
stream_url = editor_tl.generate_stream()
```

### CaptionAssetのパラメータ

| パラメータ | 型 | デフォルト | 説明 |
|-----------|------|---------|-------------|
| `src` | `str` | `"auto"` | 字幕ソース（`"auto"` またはbase64 ASS文字列） |
| `font` | `FontStyling\|None` | `FontStyling()` | フォントスタイリング（名前、サイズ、太字、斜体など） |
| `primary_color` | `str` | `"&H00FFFFFF"` | メインテキストカラー（ASSフォーマット） |
| `secondary_color` | `str` | `"&H000000FF"` | サブテキストカラー（ASSフォーマット） |
| `back_color` | `str` | `"&H00000000"` | 背景カラー（ASSフォーマット） |
| `border` | `BorderAndShadow\|None` | `BorderAndShadow()` | 境界線とシャドウのスタイル |
| `position` | `Positioning\|None` | `Positioning()` | 字幕の整列とマージン |
| `animation` | `CaptionAnimation\|None` | `None` | アニメーション効果（例：`box_highlight`、`reveal`、`karaoke`） |

## コンパイルとストリーミング

タイムラインを組み立てたら、ストリーミング可能なURLにコンパイルする。ストリームはオンザフライで生成される——レンダリングの待ち時間はない。

```python
stream_url = timeline.generate_stream()
print(f"Stream: {stream_url}")
```

追加のストリーミングオプション（セグメントストリーム、検索からストリーム、オーディオ再生）については [streaming.md](streaming.md) を参照。

## 完全なワークフロー例

### タイトルカード付きのハイライトリール

```python
import videodb
from videodb import SearchType
from videodb.exceptions import InvalidRequestError
from videodb.timeline import Timeline
from videodb.asset import VideoAsset, TextAsset, TextStyle

conn = videodb.connect()
coll = conn.get_collection()
video = coll.get_video("your-video-id")

# 1. Search for key moments
video.index_spoken_words(force=True)
try:
    results = video.search("product announcement", search_type=SearchType.semantic)
    shots = results.get_shots()
except InvalidRequestError as exc:
    if "No results found" in str(exc):
        shots = []
    else:
        raise

# 2. Build timeline
timeline = Timeline(conn)

# Title card
title = TextAsset(
    text="Product Launch Highlights",
    duration=4,
    style=TextStyle(fontsize=48, fontcolor="white", boxcolor="#1a1a2e", alpha=0.95),
)
timeline.add_overlay(0, title)

# Append each matching clip
for shot in shots:
    asset = VideoAsset(asset_id=shot.video_id, start=shot.start, end=shot.end)
    timeline.add_inline(asset)

# 3. Generate stream
stream_url = timeline.generate_stream()
print(f"Highlight reel: {stream_url}")
```

### バックグラウンドミュージック付きロゴオーバーレイ

```python
import videodb
from videodb.timeline import Timeline
from videodb.asset import VideoAsset, AudioAsset, ImageAsset

conn = videodb.connect()
coll = conn.get_collection()

main_video = coll.get_video(main_video_id)
music = coll.get_audio(music_id)
logo = coll.get_image(logo_id)

timeline = Timeline(conn)

# Main video track
timeline.add_inline(VideoAsset(asset_id=main_video.id))

# Background music — disable_other_tracks=False to mix with video audio
timeline.add_overlay(
    0,
    AudioAsset(asset_id=music.id, disable_other_tracks=False, fade_in_duration=3),
)

# Logo in top-right corner for first 10 seconds
timeline.add_overlay(
    0,
    ImageAsset(asset_id=logo.id, duration=10, x=1140, y=20, width=120, height=60),
)

stream_url = timeline.generate_stream()
print(f"Final video: {stream_url}")
```

### 複数のビデオからのマルチクリップモンタージュ

```python
import videodb
from videodb.timeline import Timeline
from videodb.asset import VideoAsset, TextAsset, TextStyle

conn = videodb.connect()
coll = conn.get_collection()

clips = [
    {"video_id": "vid_001", "start": 5, "end": 15, "label": "Scene 1"},
    {"video_id": "vid_002", "start": 0, "end": 20, "label": "Scene 2"},
    {"video_id": "vid_003", "start": 30, "end": 45, "label": "Scene 3"},
]

timeline = Timeline(conn)
timeline_offset = 0.0

for clip in clips:
    # Add a label as an overlay on each clip
    label = TextAsset(
        text=clip["label"],
        duration=2,
        style=TextStyle(fontsize=32, fontcolor="white", boxcolor="#333333"),
    )
    timeline.add_inline(
        VideoAsset(asset_id=clip["video_id"], start=clip["start"], end=clip["end"])
    )
    timeline.add_overlay(timeline_offset, label)
    timeline_offset += clip["end"] - clip["start"]

stream_url = timeline.generate_stream()
print(f"Montage: {stream_url}")
```

## 2つのタイムラインAPI

VideoDBには2つの独立したタイムラインシステムがある。それらは**互換性がない**：

| | `videodb.timeline.Timeline` | `videodb.editor.Timeline`（エディターAPI） |
|---|---|---|
| **インポート** | `from videodb.timeline import Timeline` | `from videodb.editor import Timeline as EditorTimeline` |
| **アセット** | `VideoAsset`、`AudioAsset`、`ImageAsset`、`TextAsset` | `CaptionAsset`、`Clip`、`Track` |
| **メソッド** | `add_inline()`、`add_overlay()` | `add_track()` と `Track` / `Clip` の組み合わせ |
| **最適な用途** | ビデオ合成、オーバーレイ、マルチクリップ編集 | アニメーション付き字幕/キャプションスタイリング |

一方のAPIのアセットをもう一方に混在させない。`CaptionAsset` はエディターAPIのみで機能する。`VideoAsset` / `AudioAsset` / `ImageAsset` / `TextAsset` は `videodb.timeline.Timeline` のみで機能する。

## 制限と制約

タイムラインエディターは**非破壊的な線形合成**向けに設計されている。以下の操作は**サポートされていない**：

### サポートされていない操作

| 制限 | 詳細 |
|---|---|
| **トランジションやエフェクトなし** | クリップ間のクロスフェード、ワイプ、ディゾルブ、トランジションはない。すべてのカットはハードカット。 |
| **ビデオへのビデオオーバーレイなし（ピクチャーインピクチャー）** | `add_inline()` は `VideoAsset` のみを受け入れる。別のビデオストリームの上に1つのビデオストリームをオーバーレイすることはできない。画像オーバーレイは静的なピクチャーインピクチャーを近似できるが、ライブビデオではない。 |
| **速度や再生制御なし** | スローモーション、早送り、逆再生、タイムリマッピングはない。`VideoAsset` には `speed` パラメータがない。 |
| **クロップ、ズーム、パンなし** | ビデオフレームの領域をクロップしたり、ズームエフェクトを適用したり、フレームでパンすることはできない。`video.reframe()` はアスペクト比変換のみ。 |
| **ビデオフィルターやカラーグレーディングなし** | 輝度、コントラスト、彩度、色相、カラーコレクション調整はない。 |
| **アニメーションテキストなし** | `TextAsset` はその全持続時間にわたって静的。フェードイン/アウト、移動、アニメーションはない。アニメーション字幕にはエディターAPIで `CaptionAsset` を使用する。 |
| **混合テキストスタイルなし** | 単一の `TextAsset` は1つの `TextStyle` のみを持つ。単一のテキストブロック内で太字、斜体、カラーを混在させることはできない。 |
| **ブランクまたは単色クリップなし** | 単色フレーム、ブラックスクリーン、スタンドアロンタイトルカードを作成することはできない。テキストと画像のオーバーレイは、インライントラックに基礎として `VideoAsset` が必要。 |
| **オーディオ音量コントロールなし** | `AudioAsset` には `volume` パラメータがない。オーディオはフルボリュームか、`disable_other_tracks` でミュートかのどちらか。低音量でミックスすることはできない。 |
| **キーフレームアニメーションなし** | 時間をかけてオーバーレイプロパティを変更することはできない（例：画像を位置Aから位置Bに移動）。 |

### 制約

| 制約 | 詳細 |
|---|---|
| **オーディオフェードは最大5秒** | `fade_in_duration` と `fade_out_duration` はそれぞれ最大5秒。 |
| **オーバーレイの位置は絶対タイムライン基準** | オーバーレイはタイムライン開始からの絶対タイムスタンプを使用する。インラインクリップの再配置によってオーバーレイは移動しない。 |
| **インライントラックはビデオのみ** | `add_inline()` は `VideoAsset` のみを受け入れる。オーディオ、画像、テキストは `add_overlay()` を使用する必要がある。 |
| **オーバーレイはクリップにバインドされない** | オーバーレイは固定されたタイムラインタイムスタンプに配置される。オーバーレイを特定のインラインクリップに添付してそれと一緒に移動させることはできない。 |

## ヒント

* **非破壊的**：タイムラインはソースメディアを変更しない。同じアセットを使用して複数のタイムラインを作成できる。
* **オーバーレイスタッキング**：複数のオーバーレイを同じタイムスタンプで開始できる。オーディオオーバーレイはミックスされる；画像/テキストオーバーレイは追加された順にレイヤー化される。
* **インライントラックはVideoAssetのみ**：`add_inline()` は `VideoAsset` のみを受け入れる。`AudioAsset`、`ImageAsset`、`TextAsset` には `add_overlay()` を使用する。
* **クリップ精度**：`VideoAsset` と `AudioAsset` の `start`/`end` は秒単位。
* **ビデオオーディオのミュート**：音楽やナレーションをオーバーレイするときに元のビデオオーディオをミュートするために `AudioAsset` に `disable_other_tracks=True` を設定する。
* **フェード制限**：`AudioAsset` の `fade_in_duration` と `fade_out_duration` は最大5秒。
* **メディアの生成**：`coll.generate_music()`、`coll.generate_sound_effect()`、`coll.generate_voice()`、`coll.generate_image()` を使用してタイムラインアセットとしてすぐに使用できるメディアを作成する。
