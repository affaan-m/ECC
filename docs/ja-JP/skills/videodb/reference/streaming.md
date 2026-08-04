# ストリーミングと再生

VideoDBはオンデマンドでストリーミングを生成し、任意の標準ビデオプレーヤーで即時再生できるHLS互換のURLを返す。レンダリング時間やエクスポート待ちは不要——編集、検索、合成されたコンテンツは即座にストリーミングできる。

## 前提条件

ビデオはストリーミングを生成するために**コレクションにアップロードされている必要がある**。検索ベースのストリーミングには、ビデオも**インデックス化されている必要がある**（音声単語および/またはシーン）。インデックス作成の詳細については [search.md](search.md) を参照。

## コアコンセプト

### ストリーミング生成

VideoDBのすべてのビデオ、検索結果、タイムラインは**ストリームURL**を生成できる。このURLはオンデマンドでコンパイルされるHLS（HTTPライブストリーミング）マニフェストを指す。

```python
# From a video
stream_url = video.generate_stream()

# From a timeline
stream_url = timeline.generate_stream()

# From search results
stream_url = results.compile()
```

## 単一ビデオのストリーミング

### 基本再生

```python
import videodb

conn = videodb.connect()
coll = conn.get_collection()
video = coll.get_video("your-video-id")

# Generate stream URL
stream_url = video.generate_stream()
print(f"Stream: {stream_url}")

# Open in default browser
video.play()
```

### 字幕付き

```python
# Index and add subtitles first
video.index_spoken_words(force=True)
stream_url = video.add_subtitle()

# Returned URL already includes subtitles
print(f"Subtitled stream: {stream_url}")
```

### 特定のセグメント

タイムスタンプ範囲のタイムラインを渡すことでビデオの一部のみをストリーミングする：

```python
# Stream seconds 10-30 and 60-90
stream_url = video.generate_stream(timeline=[(10, 30), (60, 90)])
print(f"Segment stream: {stream_url}")
```

## タイムラインコンポジションのストリーミング

マルチアセットコンポジションを構築してリアルタイムでストリーミングする：

```python
import videodb
from videodb.timeline import Timeline
from videodb.asset import VideoAsset, AudioAsset, ImageAsset, TextAsset, TextStyle

conn = videodb.connect()
coll = conn.get_collection()

video = coll.get_video(video_id)
music = coll.get_audio(music_id)

timeline = Timeline(conn)

# Main video content
timeline.add_inline(VideoAsset(asset_id=video.id))

# Background music overlay (starts at second 0)
timeline.add_overlay(0, AudioAsset(asset_id=music.id))

# Text overlay at the beginning
timeline.add_overlay(0, TextAsset(
    text="Live Demo",
    duration=3,
    style=TextStyle(fontsize=48, fontcolor="white", boxcolor="#000000"),
))

# Generate the composed stream
stream_url = timeline.generate_stream()
print(f"Composed stream: {stream_url}")
```

**重要な注意事項：** `add_inline()` は `VideoAsset` のみを受け入れる。`AudioAsset`、`ImageAsset`、`TextAsset` には `add_overlay()` を使用する。

詳細なタイムライン編集については [editor.md](editor.md) を参照。

## 検索結果のストリーミング

すべての一致するクリップを含む単一のストリームに検索結果をコンパイルする：

```python
from videodb import SearchType
from videodb.exceptions import InvalidRequestError

video.index_spoken_words(force=True)
try:
    results = video.search("key announcement", search_type=SearchType.semantic)

    # Compile all matching shots into one stream
    stream_url = results.compile()
    print(f"Search results stream: {stream_url}")

    # Or play directly
    results.play()
except InvalidRequestError as exc:
    if "No results found" in str(exc):
        print("No matching announcement segments were found.")
    else:
        raise
```

### 個別の検索結果をストリーミングする

```python
from videodb.exceptions import InvalidRequestError

try:
    results = video.search("product demo", search_type=SearchType.semantic)
    for i, shot in enumerate(results.get_shots()):
        stream_url = shot.generate_stream()
        print(f"Hit {i+1} [{shot.start:.1f}s-{shot.end:.1f}s]: {stream_url}")
except InvalidRequestError as exc:
    if "No results found" in str(exc):
        print("No product demo segments matched the query.")
    else:
        raise
```

## オーディオ再生

オーディオコンテンツの署名付き再生URLを取得する：

```python
audio = coll.get_audio(audio_id)
playback_url = audio.generate_url()
print(f"Audio URL: {playback_url}")
```

## 完全なワークフロー例

### 検索からストリーミングへのパイプライン

単一のワークフローで検索、タイムラインコンポジション、ストリーミングを組み合わせる：

```python
import videodb
from videodb import SearchType
from videodb.exceptions import InvalidRequestError
from videodb.timeline import Timeline
from videodb.asset import VideoAsset, TextAsset, TextStyle

conn = videodb.connect()
coll = conn.get_collection()
video = coll.get_video("your-video-id")

video.index_spoken_words(force=True)

# Search for key moments
queries = ["introduction", "main demo", "Q&A"]
timeline = Timeline(conn)
timeline_offset = 0.0

for query in queries:
    try:
        results = video.search(query, search_type=SearchType.semantic)
        shots = results.get_shots()
    except InvalidRequestError as exc:
        if "No results found" in str(exc):
            shots = []
        else:
            raise

    if not shots:
        continue

    # Add the section label where this batch starts in the compiled timeline
    timeline.add_overlay(timeline_offset, TextAsset(
        text=query.title(),
        duration=2,
        style=TextStyle(fontsize=36, fontcolor="white", boxcolor="#222222"),
    ))

    for shot in shots:
        timeline.add_inline(
            VideoAsset(asset_id=shot.video_id, start=shot.start, end=shot.end)
        )
        timeline_offset += shot.end - shot.start

stream_url = timeline.generate_stream()
print(f"Dynamic compilation: {stream_url}")
```

### マルチビデオストリーム

異なるビデオからのクリップを単一のストリームに組み合わせる：

```python
import videodb
from videodb.timeline import Timeline
from videodb.asset import VideoAsset

conn = videodb.connect()
coll = conn.get_collection()

video_clips = [
    {"id": "vid_001", "start": 0, "end": 15},
    {"id": "vid_002", "start": 10, "end": 30},
    {"id": "vid_003", "start": 5, "end": 25},
]

timeline = Timeline(conn)
for clip in video_clips:
    timeline.add_inline(
        VideoAsset(asset_id=clip["id"], start=clip["start"], end=clip["end"])
    )

stream_url = timeline.generate_stream()
print(f"Multi-video stream: {stream_url}")
```

### 条件付きストリーミングアセンブリ

検索結果の可用性に基づいてストリームを動的に構築する：

```python
import videodb
from videodb import SearchType
from videodb.exceptions import InvalidRequestError
from videodb.timeline import Timeline
from videodb.asset import VideoAsset, TextAsset, TextStyle

conn = videodb.connect()
coll = conn.get_collection()
video = coll.get_video("your-video-id")

video.index_spoken_words(force=True)

timeline = Timeline(conn)

# Try to find specific content; fall back to full video
topics = ["opening remarks", "technical deep dive", "closing"]

found_any = False
timeline_offset = 0.0
for topic in topics:
    try:
        results = video.search(topic, search_type=SearchType.semantic)
        shots = results.get_shots()
    except InvalidRequestError as exc:
        if "No results found" in str(exc):
            shots = []
        else:
            raise

    if shots:
        found_any = True
        timeline.add_overlay(timeline_offset, TextAsset(
            text=topic.title(),
            duration=2,
            style=TextStyle(fontsize=32, fontcolor="white", boxcolor="#1a1a2e"),
        ))
        for shot in shots:
            timeline.add_inline(
                VideoAsset(asset_id=shot.video_id, start=shot.start, end=shot.end)
            )
            timeline_offset += shot.end - shot.start

if found_any:
    stream_url = timeline.generate_stream()
    print(f"Curated stream: {stream_url}")
else:
    # Fall back to full video stream
    stream_url = video.generate_stream()
    print(f"Full video stream: {stream_url}")
```

### ライブイベントのリキャップ

イベント録音を複数のセクションを持つストリーミング可能なリキャップに処理する：

```python
import videodb
from videodb import SearchType
from videodb.exceptions import InvalidRequestError
from videodb.timeline import Timeline
from videodb.asset import VideoAsset, AudioAsset, ImageAsset, TextAsset, TextStyle

conn = videodb.connect()
coll = conn.get_collection()

# Upload event recording
event = coll.upload(url="https://example.com/event-recording.mp4")
event.index_spoken_words(force=True)

# Generate background music
music = coll.generate_music(
    prompt="upbeat corporate background music",
    duration=120,
)

# Generate title image
title_img = coll.generate_image(
    prompt="modern event recap title card, dark background, professional",
    aspect_ratio="16:9",
)

# Build the recap timeline
timeline = Timeline(conn)
timeline_offset = 0.0

# Main video segments from search
try:
    keynote = event.search("keynote announcement", search_type=SearchType.semantic)
    keynote_shots = keynote.get_shots()[:5]
except InvalidRequestError as exc:
    if "No results found" in str(exc):
        keynote_shots = []
    else:
        raise
if keynote_shots:
    keynote_start = timeline_offset
    for shot in keynote_shots:
        timeline.add_inline(
            VideoAsset(asset_id=shot.video_id, start=shot.start, end=shot.end)
        )
        timeline_offset += shot.end - shot.start
else:
    keynote_start = None

try:
    demo = event.search("product demo", search_type=SearchType.semantic)
    demo_shots = demo.get_shots()[:5]
except InvalidRequestError as exc:
    if "No results found" in str(exc):
        demo_shots = []
    else:
        raise
if demo_shots:
    demo_start = timeline_offset
    for shot in demo_shots:
        timeline.add_inline(
            VideoAsset(asset_id=shot.video_id, start=shot.start, end=shot.end)
        )
        timeline_offset += shot.end - shot.start
else:
    demo_start = None

# Overlay title card image
timeline.add_overlay(0, ImageAsset(
    asset_id=title_img.id, width=100, height=100, x=80, y=20, duration=5
))

# Overlay section labels at the correct timeline offsets
if keynote_start is not None:
    timeline.add_overlay(max(5, keynote_start), TextAsset(
        text="Keynote Highlights",
        duration=3,
        style=TextStyle(fontsize=40, fontcolor="white", boxcolor="#0d1117"),
    ))
if demo_start is not None:
    timeline.add_overlay(max(5, demo_start), TextAsset(
        text="Demo Highlights",
        duration=3,
        style=TextStyle(fontsize=36, fontcolor="white", boxcolor="#0d1117"),
    ))

# Overlay background music
timeline.add_overlay(0, AudioAsset(
    asset_id=music.id, fade_in_duration=3
))

# Stream the final recap
stream_url = timeline.generate_stream()
print(f"Event recap: {stream_url}")
```

***

## ヒント

* **HLS互換性**：ストリームURLはHLSマニフェスト（`.m3u8`）を返す。Safariでネイティブに動作し、他のブラウザではhls.jsや類似のライブラリで動作する。
* **オンデマンドコンパイル**：ストリーミングはリクエスト時にサーバーサイドでコンパイルされる。初回再生には短いコンパイル遅延が発生する場合がある；同じコンポジションの後続再生はキャッシュされる。
* **キャッシング**：`video.generate_stream()`（引数なし）の2回目の呼び出しは再コンパイルせずにキャッシュされたストリームURLを返す。
* **セグメントストリーム**：`video.generate_stream(timeline=[(start, end)])` は完全な `Timeline` オブジェクトを構築せずに特定のクリップをストリーミングする最速の方法。
* **インラインとオーバーレイ**：`add_inline()` は `VideoAsset` のみを受け入れ、アセットをメイントラックに順番に配置する。`add_overlay()` は `AudioAsset`、`ImageAsset`、`TextAsset` を受け入れ、指定された開始時間にそれらを上にオーバーレイする。
* **TextStyleのデフォルト**：`TextStyle` のデフォルトは `font='Sans'`、`fontcolor='black'`。テキストの背景色には `boxcolor`（`bgcolor` ではない）を使用する。
* **生成との組み合わせ**：`coll.generate_music(prompt, duration)` と `coll.generate_image(prompt, aspect_ratio)` を使用してタイムラインコンポジションのアセットを作成する。
* **再生**：`.play()` はデフォルトのシステムブラウザでストリームURLを開く。プログラム的な使用には直接URLの文字列を処理する。
