# 完全APIリファレンス

VideoDBスキルの参考資料。使用ガイドとワークフロー選択については、[../SKILL.md](../SKILL.md) から始めること。

## 接続

```python
import videodb

conn = videodb.connect(
    api_key="your-api-key",      # or set VIDEO_DB_API_KEY env var
    base_url=None,                # custom API endpoint (optional)
)
```

**戻り値：** `Connection` オブジェクト

### 接続メソッド

| メソッド | 戻り値 | 説明 |
|--------|---------|-------------|
| `conn.get_collection(collection_id="default")` | `Collection` | コレクションを取得する（IDなしの場合はデフォルトコレクションを取得） |
| `conn.get_collections()` | `list[Collection]` | すべてのコレクションを一覧表示する |
| `conn.create_collection(name, description, is_public=False)` | `Collection` | 新しいコレクションを作成する |
| `conn.update_collection(id, name, description)` | `Collection` | コレクションを更新する |
| `conn.check_usage()` | `dict` | アカウントの使用状況統計を取得する |
| `conn.upload(source, media_type, name, ...)` | `Video\|Audio\|Image` | デフォルトコレクションにアップロードする |
| `conn.record_meeting(meeting_url, bot_name, ...)` | `Meeting` | ミーティングを録画する |
| `conn.create_capture_session(...)` | `CaptureSession` | キャプチャセッションを作成する（[capture-reference.md](capture-reference.md)参照） |
| `conn.youtube_search(query, result_threshold, duration)` | `list[dict]` | YouTubeを検索する |
| `conn.transcode(source, callback_url, mode, ...)` | `str` | ビデオをトランスコードする（ジョブIDを返す） |
| `conn.get_transcode_details(job_id)` | `dict` | トランスコードジョブの状態と詳細を取得する |
| `conn.connect_websocket(collection_id)` | `WebSocketConnection` | WebSocketに接続する（[capture-reference.md](capture-reference.md)参照） |

### トランスコード

カスタム解像度、品質、オーディオ設定でURLからビデオをトランスコードする。処理はサーバーサイドで行われる——ローカルのffmpegは不要。

```python
from videodb import TranscodeMode, VideoConfig, AudioConfig

job_id = conn.transcode(
    source="https://example.com/video.mp4",
    callback_url="https://example.com/webhook",
    mode=TranscodeMode.economy,
    video_config=VideoConfig(resolution=720, quality=23),
    audio_config=AudioConfig(mute=False),
)
```

#### transcodeのパラメータ

| パラメータ | 型 | デフォルト | 説明 |
|-----------|------|---------|-------------|
| `source` | `str` | 必須 | トランスコードするビデオURL（ダウンロード可能なURLが望ましい） |
| `callback_url` | `str` | 必須 | トランスコード完了時にコールバックを受信するURL |
| `mode` | `TranscodeMode` | `TranscodeMode.economy` | トランスコード速度：`economy` または `lightning` |
| `video_config` | `VideoConfig` | `VideoConfig()` | ビデオエンコード設定 |
| `audio_config` | `AudioConfig` | `AudioConfig()` | オーディオエンコード設定 |

ジョブID (`str`) を返す。`conn.get_transcode_details(job_id)` を使用してジョブの状態を確認する。

```python
details = conn.get_transcode_details(job_id)
```

#### VideoConfig

```python
from videodb import VideoConfig, ResizeMode

config = VideoConfig(
    resolution=720,              # Target resolution height (e.g. 480, 720, 1080)
    quality=23,                  # Encoding quality (lower = better, default 23)
    framerate=30,                # Target framerate
    aspect_ratio="16:9",         # Target aspect ratio
    resize_mode=ResizeMode.crop, # How to fit: crop, fit, or pad
)
```

| フィールド | 型 | デフォルト | 説明 |
|-------|------|---------|-------------|
| `resolution` | `int\|None` | `None` | ターゲット解像度の高さ（ピクセル） |
| `quality` | `int` | `23` | エンコード品質（低いほど高品質） |
| `framerate` | `int\|None` | `None` | ターゲットフレームレート |
| `aspect_ratio` | `str\|None` | `None` | ターゲットアスペクト比（例：`"16:9"`, `"9:16"`） |
| `resize_mode` | `str` | `ResizeMode.crop` | リサイズ戦略：`crop`, `fit`, または `pad` |

#### AudioConfig

```python
from videodb import AudioConfig

config = AudioConfig(mute=False)
```

| フィールド | 型 | デフォルト | 説明 |
|-------|------|---------|-------------|
| `mute` | `bool` | `False` | オーディオトラックをミュートする |

## コレクション

```python
coll = conn.get_collection()
```

### コレクションメソッド

| メソッド | 戻り値 | 説明 |
|--------|---------|-------------|
| `coll.get_videos()` | `list[Video]` | すべてのビデオを一覧表示する |
| `coll.get_video(video_id)` | `Video` | 特定のビデオを取得する |
| `coll.get_audios()` | `list[Audio]` | すべてのオーディオを一覧表示する |
| `coll.get_audio(audio_id)` | `Audio` | 特定のオーディオを取得する |
| `coll.get_images()` | `list[Image]` | すべての画像を一覧表示する |
| `coll.get_image(image_id)` | `Image` | 特定の画像を取得する |
| `coll.upload(url=None, file_path=None, media_type=None, name=None)` | `Video\|Audio\|Image` | メディアをアップロードする |
| `coll.search(query, search_type, index_type, score_threshold, namespace, scene_index_id, ...)` | `SearchResult` | コレクション内を検索する（セマンティック検索のみ；キーワードとシーン検索は `NotImplementedError` を発生させる） |
| `coll.generate_image(prompt, aspect_ratio="1:1")` | `Image` | AIで画像を生成する |
| `coll.generate_video(prompt, duration=5)` | `Video` | AIでビデオを生成する |
| `coll.generate_music(prompt, duration=5)` | `Audio` | AIで音楽を生成する |
| `coll.generate_sound_effect(prompt, duration=2)` | `Audio` | 効果音を生成する |
| `coll.generate_voice(text, voice_name="Default")` | `Audio` | テキストから音声を生成する |
| `coll.generate_text(prompt, model_name="basic", response_type="text")` | `dict` | LLMテキスト生成——`["output"]` で結果にアクセス |
| `coll.dub_video(video_id, language_code)` | `Video` | ビデオを別の言語に吹き替える |
| `coll.record_meeting(meeting_url, bot_name, ...)` | `Meeting` | ライブミーティングを録画する |
| `coll.create_capture_session(...)` | `CaptureSession` | キャプチャセッションを作成する（[capture-reference.md](capture-reference.md)参照） |
| `coll.get_capture_session(...)` | `CaptureSession` | キャプチャセッションを取得する（[capture-reference.md](capture-reference.md)参照） |
| `coll.connect_rtstream(url, name, ...)` | `RTStream` | ライブストリームに接続する（[rtstream-reference.md](rtstream-reference.md)参照） |
| `coll.make_public()` | `None` | コレクションを公開にする |
| `coll.make_private()` | `None` | コレクションを非公開にする |
| `coll.delete_video(video_id)` | `None` | ビデオを削除する |
| `coll.delete_audio(audio_id)` | `None` | オーディオを削除する |
| `coll.delete_image(image_id)` | `None` | 画像を削除する |
| `coll.delete()` | `None` | コレクションを削除する |

### アップロードのパラメータ

```python
video = coll.upload(
    url=None,            # Remote URL (HTTP, YouTube)
    file_path=None,      # Local file path
    media_type=None,     # "video", "audio", or "image" (auto-detected if omitted)
    name=None,           # Custom name for the media
    description=None,    # Description
    callback_url=None,   # Webhook URL for async notification
)
```

## ビデオオブジェクト

```python
video = coll.get_video(video_id)
```

### ビデオ属性

| 属性 | 型 | 説明 |
|----------|------|-------------|
| `video.id` | `str` | 一意のビデオID |
| `video.collection_id` | `str` | 親コレクションID |
| `video.name` | `str` | ビデオ名 |
| `video.description` | `str` | ビデオの説明 |
| `video.length` | `float` | 長さ（秒） |
| `video.stream_url` | `str` | デフォルトのストリームURL |
| `video.player_url` | `str` | プレーヤー埋め込みURL |
| `video.thumbnail_url` | `str` | サムネイルURL |

### ビデオメソッド

| メソッド | 戻り値 | 説明 |
|--------|---------|-------------|
| `video.generate_stream(timeline=None)` | `str` | ストリームURLを生成する（オプションの `[(start, end)]` タプルタイムライン） |
| `video.play()` | `str` | ブラウザでストリームを開き、プレーヤーURLを返す |
| `video.index_spoken_words(language_code=None, force=False)` | `None` | 音声検索用にインデックスを作成する。既にインデックス済みの場合は `force=True` でスキップ。 |
| `video.index_scenes(extraction_type, prompt, extraction_config, metadata, model_name, name, scenes, callback_url)` | `str` | ビジュアルシーンをインデックス化する（scene\_index\_idを返す） |
| `video.index_visuals(prompt, batch_config, ...)` | `str` | ビジュアルコンテンツをインデックス化する（scene\_index\_idを返す） |
| `video.index_audio(prompt, model_name, ...)` | `str` | LLMを使用してオーディオをインデックス化する（scene\_index\_idを返す） |
| `video.get_transcript(start=None, end=None)` | `list[dict]` | タイムスタンプ付きのトランスクリプトを取得する |
| `video.get_transcript_text(start=None, end=None)` | `str` | 完全なトランスクリプトテキストを取得する |
| `video.generate_transcript(force=None)` | `dict` | トランスクリプトを生成する |
| `video.translate_transcript(language, additional_notes)` | `list[dict]` | トランスクリプトを翻訳する |
| `video.search(query, search_type, index_type, filter, **kwargs)` | `SearchResult` | ビデオ内を検索する |
| `video.add_subtitle(style=SubtitleStyle())` | `str` | 字幕を追加する（ストリームURLを返す） |
| `video.generate_thumbnail(time=None)` | `str\|Image` | サムネイルを生成する |
| `video.get_thumbnails()` | `list[Image]` | すべてのサムネイルを取得する |
| `video.extract_scenes(extraction_type, extraction_config)` | `SceneCollection` | シーンを抽出する |
| `video.reframe(start, end, target, mode, callback_url)` | `Video\|None` | ビデオのアスペクト比を調整する |
| `video.clip(prompt, content_type, model_name)` | `str` | プロンプトに基づいてクリップを生成する（ストリームURLを返す） |
| `video.insert_video(video, timestamp)` | `str` | タイムスタンプにビデオを挿入する |
| `video.download(name=None)` | `dict` | ビデオをダウンロードする |
| `video.delete()` | `None` | ビデオを削除する |

### アスペクト比の調整

ビデオを異なるアスペクト比に変換する。オプションでスマートオブジェクト追跡を使用。処理はサーバーサイドで行われる。

> **警告：** アスペクト比の調整は低速なサーバーサイド操作。長いビデオでは数分かかる場合があり、タイムアウトする可能性がある。常に `start`/`end` でセグメントを制限するか、非同期処理のために `callback_url` を渡すこと。

```python
from videodb import ReframeMode

# Always prefer short segments to avoid timeouts:
reframed = video.reframe(start=0, end=60, target="vertical", mode=ReframeMode.smart)

# Async reframe for full-length videos (returns None, result via webhook):
video.reframe(target="vertical", callback_url="https://example.com/webhook")

# Custom dimensions
reframed = video.reframe(start=0, end=60, target={"width": 1080, "height": 1080})
```

#### reframeのパラメータ

| パラメータ | 型 | デフォルト | 説明 |
|-----------|------|---------|-------------|
| `start` | `float\|None` | `None` | 開始時間（秒）（None = 開始） |
| `end` | `float\|None` | `None` | 終了時間（秒）（None = ビデオ終了） |
| `target` | `str\|dict` | `"vertical"` | プリセット文字列（`"vertical"`, `"square"`, `"landscape"`）または `{"width": int, "height": int}` |
| `mode` | `str` | `ReframeMode.smart` | `"simple"`（中央クロップ）または `"smart"`（オブジェクト追跡） |
| `callback_url` | `str\|None` | `None` | 非同期通知のWebhook URL |

`callback_url` が提供されない場合は `Video` オブジェクトを返し、そうでない場合は `None` を返す。

## オーディオオブジェクト

```python
audio = coll.get_audio(audio_id)
```

### オーディオ属性

| 属性 | 型 | 説明 |
|----------|------|-------------|
| `audio.id` | `str` | 一意のオーディオID |
| `audio.collection_id` | `str` | 親コレクションID |
| `audio.name` | `str` | オーディオ名 |
| `audio.length` | `float` | 長さ（秒） |

### オーディオメソッド

| メソッド | 戻り値 | 説明 |
|--------|---------|-------------|
| `audio.generate_url()` | `str` | 再生用の署名付きURLを生成する |
| `audio.get_transcript(start=None, end=None)` | `list[dict]` | タイムスタンプ付きのトランスクリプトを取得する |
| `audio.get_transcript_text(start=None, end=None)` | `str` | 完全なトランスクリプトテキストを取得する |
| `audio.generate_transcript(force=None)` | `dict` | トランスクリプトを生成する |
| `audio.delete()` | `None` | オーディオを削除する |

## 画像オブジェクト

```python
image = coll.get_image(image_id)
```

### 画像属性

| 属性 | 型 | 説明 |
|----------|------|-------------|
| `image.id` | `str` | 一意の画像ID |
| `image.collection_id` | `str` | 親コレクションID |
| `image.name` | `str` | 画像名 |
| `image.url` | `str\|None` | 画像URL（生成された画像の場合は `None` になる可能性がある——代わりに `generate_url()` を使用） |

### 画像メソッド

| メソッド | 戻り値 | 説明 |
|--------|---------|-------------|
| `image.generate_url()` | `str` | 署名付きURLを生成する |
| `image.delete()` | `None` | 画像を削除する |

## タイムラインとエディター

### タイムライン

```python
from videodb.timeline import Timeline

timeline = Timeline(conn)
```

| メソッド | 戻り値 | 説明 |
|--------|---------|-------------|
| `timeline.add_inline(asset)` | `None` | メイントラックに `VideoAsset` を順番に追加する |
| `timeline.add_overlay(start, asset)` | `None` | タイムスタンプに `AudioAsset`、`ImageAsset`、または `TextAsset` をオーバーレイする |
| `timeline.generate_stream()` | `str` | コンパイルしてストリームURLを取得する |

### アセットタイプ

#### VideoAsset

```python
from videodb.asset import VideoAsset

asset = VideoAsset(
    asset_id=video.id,
    start=0,              # trim start (seconds)
    end=None,             # trim end (seconds, None = full)
)
```

#### AudioAsset

```python
from videodb.asset import AudioAsset

asset = AudioAsset(
    asset_id=audio.id,
    start=0,
    end=None,
    disable_other_tracks=True,   # mute original audio when True
    fade_in_duration=0,          # seconds (max 5)
    fade_out_duration=0,         # seconds (max 5)
)
```

#### ImageAsset

```python
from videodb.asset import ImageAsset

asset = ImageAsset(
    asset_id=image.id,
    duration=None,        # display duration (seconds)
    width=100,            # display width
    height=100,           # display height
    x=80,                 # horizontal position (px from left)
    y=20,                 # vertical position (px from top)
)
```

#### TextAsset

```python
from videodb.asset import TextAsset, TextStyle

asset = TextAsset(
    text="Hello World",
    duration=5,
    style=TextStyle(
        fontsize=24,
        fontcolor="black",
        boxcolor="white",       # background box colour
        alpha=1.0,
        font="Sans",
        text_align="T",         # text alignment within box
    ),
)
```

#### CaptionAsset（エディターAPI）

CaptionAssetはエディターAPIに属し、独自のタイムライン、トラック、クリップシステムを持つ：

```python
from videodb.editor import CaptionAsset, FontStyling

asset = CaptionAsset(
    src="auto",                    # "auto" or base64 ASS string
    font=FontStyling(name="Clear Sans", size=30),
    primary_color="&H00FFFFFF",
)
```

完全なCaptionAssetの使用方法については、[editor.md](./editor.md#caption-overlays) のエディターAPIを参照。

## ビデオ検索パラメータ

```python
results = video.search(
    query="your query",
    search_type=SearchType.semantic,       # semantic, keyword, or scene
    index_type=IndexType.spoken_word,      # spoken_word or scene
    result_threshold=None,                 # max number of results
    score_threshold=None,                  # minimum relevance score
    dynamic_score_percentage=None,         # percentage of dynamic score
    scene_index_id=None,                   # target a specific scene index (pass via **kwargs)
    filter=[],                             # metadata filters for scene search
)
```

> **注意：** `filter` は `video.search()` の明示的な名前付きパラメータ。`scene_index_id` は `**kwargs` を通じてAPIに渡される。
>
> **重要：** `video.search()` は一致するものがない場合に `"No results found"` というメッセージとともに `InvalidRequestError` を発生させる。常に検索呼び出しをtry/exceptで包むこと。シーン検索には低関連性のノイズをフィルタリングするために `score_threshold=0.3` 以上を使用する。

シーン検索には `search_type=SearchType.semantic` を使用し `index_type=IndexType.scene` を設定する。特定のシーンインデックスを対象にする場合は `scene_index_id` を渡す。詳細は [search.md](search.md) を参照。

## SearchResultオブジェクト

```python
results = video.search("query", search_type=SearchType.semantic)
```

| メソッド | 戻り値 | 説明 |
|--------|---------|-------------|
| `results.get_shots()` | `list[Shot]` | 一致したクリップのリストを取得する |
| `results.compile()` | `str` | すべてのショットをストリームURLにコンパイルする |
| `results.play()` | `str` | ブラウザでコンパイルされたストリームを開く |

### Shot属性

| 属性 | 型 | 説明 |
|----------|------|-------------|
| `shot.video_id` | `str` | ソースビデオID |
| `shot.video_length` | `float` | ソースビデオの長さ |
| `shot.video_title` | `str` | ソースビデオのタイトル |
| `shot.start` | `float` | 開始時間（秒） |
| `shot.end` | `float` | 終了時間（秒） |
| `shot.text` | `str` | 一致したテキストコンテンツ |
| `shot.search_score` | `float` | 検索関連スコア |

| メソッド | 戻り値 | 説明 |
|--------|---------|-------------|
| `shot.generate_stream()` | `str` | この特定のショットをストリーミングする |
| `shot.play()` | `str` | ブラウザでショットストリームを開く |

## Meetingオブジェクト

```python
meeting = coll.record_meeting(
    meeting_url="https://meet.google.com/...",
    bot_name="Bot",
    callback_url=None,          # Webhook URL for status updates
    callback_data=None,         # Optional dict passed through to callbacks
    time_zone="UTC",            # Time zone for the meeting
)
```

### Meeting属性

| 属性 | 型 | 説明 |
|----------|------|-------------|
| `meeting.id` | `str` | 一意のミーティングID |
| `meeting.collection_id` | `str` | 親コレクションID |
| `meeting.status` | `str` | 現在の状態 |
| `meeting.video_id` | `str` | 録画ビデオID（完了後） |
| `meeting.bot_name` | `str` | ボット名 |
| `meeting.meeting_title` | `str` | ミーティングタイトル |
| `meeting.meeting_url` | `str` | ミーティングURL |
| `meeting.speaker_timeline` | `dict` | 発言者タイムラインデータ |
| `meeting.is_active` | `bool` | 初期化中または処理中の場合はtrue |
| `meeting.is_completed` | `bool` | 完了した場合はtrue |

### Meetingメソッド

| メソッド | 戻り値 | 説明 |
|--------|---------|-------------|
| `meeting.refresh()` | `Meeting` | サーバーからデータをリフレッシュする |
| `meeting.wait_for_status(target_status, timeout=14400, interval=120)` | `bool` | 指定された状態になるまでポーリングする |

## RTStreamとCapture

RTStream（ライブ取り込み、インデックス作成、転写）については [rtstream-reference.md](rtstream-reference.md) を参照。

キャプチャセッション（デスクトップ録画、CaptureClient、チャネル）については [capture-reference.md](capture-reference.md) を参照。

## 列挙型と定数

### SearchType

```python
from videodb import SearchType

SearchType.semantic    # Natural language semantic search
SearchType.keyword     # Exact keyword matching
SearchType.scene       # Visual scene search (may require paid plan)
SearchType.llm         # LLM-powered search
```

### SceneExtractionType

```python
from videodb import SceneExtractionType

SceneExtractionType.shot_based   # Automatic shot boundary detection
SceneExtractionType.time_based   # Fixed time interval extraction
SceneExtractionType.transcript   # Transcript-based scene extraction
```

### SubtitleStyle

```python
from videodb import SubtitleStyle

style = SubtitleStyle(
    font_name="Arial",
    font_size=18,
    primary_colour="&H00FFFFFF",
    bold=False,
    # ... see SubtitleStyle for all options
)
video.add_subtitle(style=style)
```

### SubtitleAlignmentとSubtitleBorderStyle

```python
from videodb import SubtitleAlignment, SubtitleBorderStyle
```

### TextStyle

```python
from videodb import TextStyle
# or: from videodb.asset import TextStyle

style = TextStyle(
    fontsize=24,
    fontcolor="black",
    boxcolor="white",
    font="Sans",
    text_align="T",
    alpha=1.0,
)
```

### その他の定数

```python
from videodb import (
    IndexType,          # spoken_word, scene
    MediaType,          # video, audio, image
    Segmenter,          # word, sentence, time
    SegmentationType,   # sentence, llm
    TranscodeMode,      # economy, lightning
    ResizeMode,         # crop, fit, pad
    ReframeMode,        # simple, smart
    RTStreamChannelType,
)
```

## 例外

```python
from videodb.exceptions import (
    AuthenticationError,     # Invalid or missing API key
    InvalidRequestError,     # Bad parameters or malformed request
    RequestTimeoutError,     # Request timed out
    SearchError,             # Search operation failure (e.g. not indexed)
    VideodbError,            # Base exception for all VideoDB errors
)
```

| 例外 | よくある原因 |
|-----------|-------------|
| `AuthenticationError` | 欠落または無効な `VIDEO_DB_API_KEY` |
| `InvalidRequestError` | 無効なURL、サポートされていないフォーマット、不正なパラメータ |
| `RequestTimeoutError` | サーバーの応答に時間がかかりすぎた |
| `SearchError` | インデックス化前の検索、無効な検索タイプ |
| `VideodbError` | サーバーエラー、ネットワーク問題、一般的な障害 |
