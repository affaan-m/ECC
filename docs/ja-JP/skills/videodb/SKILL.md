---
name: videodb
description: ビデオとオーディオの表示、理解、アクション。表示：ローカルファイル、URL、RTSP/ライブストリーム、またはリアルタイムのデスクトップ録画からコンテンツを取得し、リアルタイムコンテキストと再生可能なストリームリンクを返す。理解：フレームを抽出し、ビジュアル/セマンティック/時間的インデックスを構築し、タイムスタンプと自動クリップでモーメントを検索する。アクション：トランスコードと正規化（コーデック、フレームレート、解像度、アスペクト比）、タイムライン編集（字幕、テキスト/画像オーバーレイ、ブランディング、オーディオオーバーレイ、吹き替え、翻訳）、メディアアセットの生成（画像、オーディオ、ビデオ）、ライブストリームまたはデスクトップキャプチャされたイベントのリアルタイムアラートを実行する。
origin: ECC
allowed-tools: Read Grep Glob Bash(python:*)
argument-hint: "[task description]"
---

# VideoDBスキル

**ビデオ、ライブストリーム、デスクトップセッションのための知覚 + 記憶 + アクション。**

## ユースケース

### デスクトップ知覚

* **デスクトップセッション**を開始/停止し、**画面、マイク、システムオーディオ**をキャプチャする
* **リアルタイムコンテキスト**をストリーミングし、**セグメント化されたセッション記憶**を保存する
* 言われた内容と画面上で起きていることに対して**リアルタイムアラート/トリガー**を実行する
* **セッションサマリー**、検索可能なタイムライン、**再生可能な証拠リンク**を生成する

### ビデオ取り込み + ストリーミング

* **ファイルまたはURL**を取り込み、**再生可能なウェブストリームリンク**を返す
* トランスコード/正規化：**コーデック、ビットレート、フレームレート、解像度、アスペクト比**

### インデックス + 検索（タイムスタンプ + 証拠）

* **ビジュアル**、**音声**、**キーワード**インデックスを構築する
* **タイムスタンプ**と**再生可能な証拠**で正確なモーメントを検索して返す
* 検索結果から自動的に**クリップ**を作成する

### タイムライン編集 + 生成

* 字幕：**生成**、**翻訳**、**バーンイン**
* オーバーレイ：**テキスト/画像/ブランドロゴ**、動的キャプション
* オーディオ：**バックグラウンドミュージック**、**ナレーション**、**吹き替え**
* **タイムライン操作**によるプログラマティックなコンポジションとエクスポート

### ライブストリーム（RTSP）+ 監視

* **RTSP/ライブストリーム**に接続する
* **リアルタイムのビジュアルと音声理解**を実行し、監視ワークフロー向けに**イベント/アラート**を発する

## 仕組み

### 一般的な入力

* ローカル**ファイルパス**、公開**URL**、または**RTSP URL**
* デスクトップキャプチャリクエスト：**開始 / 停止 / セッションのサマリー作成**
* 目的のアクション：理解コンテキストの取得、トランスコード仕様、インデックス仕様、検索クエリ、クリップ範囲、タイムライン編集、アラートルール

### 一般的な出力

* **ストリームURL**
* **タイムスタンプ**と**証拠リンク**付きの検索結果
* 生成されたアセット：字幕、オーディオ、画像、クリップ
* ライブストリーム向け**イベント/アラートペイロード**
* デスクトップ**セッションサマリー**と記憶エントリ

### Pythonコードの実行

VideoDBコードを実行する前に、プロジェクトディレクトリに移動して環境変数をロードする：

```python
from dotenv import load_dotenv
load_dotenv(".env")

import videodb
conn = videodb.connect()
```

これにより以下から `VIDEO_DB_API_KEY` が読み込まれる：

1. 環境変数（エクスポートされている場合）
2. プロジェクトの現在のディレクトリにある `.env` ファイル

キーが欠けている場合、`videodb.connect()` は自動的に `AuthenticationError` を発生させる。

短いインラインコマンドで十分な場合はスクリプトファイルを書かない。

インラインPython (`python -c "..."`) を書く場合は、常に適切にフォーマットされたコードを使用する——セミコロンで文を区切り、読みやすくする。約3文以上の場合はheredocを使用する：

```bash
python << 'EOF'
from dotenv import load_dotenv
load_dotenv(".env")

import videodb
conn = videodb.connect()
coll = conn.get_collection()
print(f"Videos: {len(coll.get_videos())}")
EOF
```

### セットアップ

ユーザーが「videodbのセットアップ」などを要求した場合：

### 1. SDKのインストール

```bash
pip install "videodb[capture]" python-dotenv
```

Linuxで `videodb[capture]` が失敗する場合は、キャプチャ拡張なしでインストールする：

```bash
pip install videodb python-dotenv
```

### 2. APIキーの設定

ユーザーは**いずれかの**方法で `VIDEO_DB_API_KEY` を設定する必要がある：

* **ターミナルでエクスポート**（Claudeを起動する前に）：`export VIDEO_DB_API_KEY=your-key`
* **プロジェクトの `.env` ファイル**：プロジェクトの `.env` ファイルに `VIDEO_DB_API_KEY=your-key` を保存する

APIキーを無料で取得するには [console.videodb.io](https://console.videodb.io)（クレジットカード不要で50回の無料アップロード）を訪問する。

APIキーを自分で読み取り、書き込み、または処理**しない**。常にユーザーが設定するようにする。

### クイックリファレンス

### メディアのアップロード

```python
# URL
video = coll.upload(url="https://example.com/video.mp4")

# YouTube
video = coll.upload(url="https://www.youtube.com/watch?v=VIDEO_ID")

# Local file
video = coll.upload(file_path="/path/to/video.mp4")
```

### 転写 + 字幕

```python
# force=True skips the error if the video is already indexed
video.index_spoken_words(force=True)
text = video.get_transcript_text()
stream_url = video.add_subtitle()
```

### ビデオ内検索

```python
from videodb.exceptions import InvalidRequestError

video.index_spoken_words(force=True)

# search() raises InvalidRequestError when no results are found.
# Always wrap in try/except and treat "No results found" as empty.
try:
    results = video.search("product demo")
    shots = results.get_shots()
    stream_url = results.compile()
except InvalidRequestError as e:
    if "No results found" in str(e):
        shots = []
    else:
        raise
```

### シーン検索

```python
import re
from videodb import SearchType, IndexType, SceneExtractionType
from videodb.exceptions import InvalidRequestError

# index_scenes() has no force parameter — it raises an error if a scene
# index already exists. Extract the existing index ID from the error.
try:
    scene_index_id = video.index_scenes(
        extraction_type=SceneExtractionType.shot_based,
        prompt="Describe the visual content in this scene.",
    )
except Exception as e:
    match = re.search(r"id\s+([a-f0-9]+)", str(e))
    if match:
        scene_index_id = match.group(1)
    else:
        raise

# Use score_threshold to filter low-relevance noise (recommended: 0.3+)
try:
    results = video.search(
        query="person writing on a whiteboard",
        search_type=SearchType.semantic,
        index_type=IndexType.scene,
        scene_index_id=scene_index_id,
        score_threshold=0.3,
    )
    shots = results.get_shots()
    stream_url = results.compile()
except InvalidRequestError as e:
    if "No results found" in str(e):
        shots = []
    else:
        raise
```

### タイムライン編集

**重要：** タイムラインを構築する前に必ずタイムスタンプを検証する：

* `start` は >= 0 でなければならない（負の値は静かに受け入れられるが、破損した出力を生成する）
* `start` は `end` より小さくなければならない
* `end` は `video.length` 以下でなければならない

```python
from videodb.timeline import Timeline
from videodb.asset import VideoAsset, TextAsset, TextStyle

timeline = Timeline(conn)
timeline.add_inline(VideoAsset(asset_id=video.id, start=10, end=30))
timeline.add_overlay(0, TextAsset(text="The End", duration=3, style=TextStyle(fontsize=36)))
stream_url = timeline.generate_stream()
```

### ビデオのトランスコード（解像度/品質変更）

```python
from videodb import TranscodeMode, VideoConfig, AudioConfig

# Change resolution, quality, or aspect ratio server-side
job_id = conn.transcode(
    source="https://example.com/video.mp4",
    callback_url="https://example.com/webhook",
    mode=TranscodeMode.economy,
    video_config=VideoConfig(resolution=720, quality=23, aspect_ratio="16:9"),
    audio_config=AudioConfig(mute=False),
)
```

### アスペクト比の調整（ソーシャルプラットフォーム向け）

**警告：** `reframe()` は低速なサーバーサイド操作。長いビデオでは数分かかる場合があり、タイムアウトする可能性がある。ベストプラクティス：

* 可能な限り `start`/`end` を使用して短いセグメントに制限する
* フルレングスビデオには非同期処理のために `callback_url` を使用する
* まず `Timeline` でビデオをトリミングし、短い結果のアスペクト比を調整する

```python
from videodb import ReframeMode

# Always prefer reframing a short segment:
reframed = video.reframe(start=0, end=60, target="vertical", mode=ReframeMode.smart)

# Async reframe for full-length videos (returns None, result via webhook):
video.reframe(target="vertical", callback_url="https://example.com/webhook")

# Presets: "vertical" (9:16), "square" (1:1), "landscape" (16:9)
reframed = video.reframe(start=0, end=60, target="square")

# Custom dimensions
reframed = video.reframe(start=0, end=60, target={"width": 1280, "height": 720})
```

### 生成メディア

```python
image = coll.generate_image(
    prompt="a sunset over mountains",
    aspect_ratio="16:9",
)
```

## エラーハンドリング

```python
from videodb.exceptions import AuthenticationError, InvalidRequestError

try:
    conn = videodb.connect()
except AuthenticationError:
    print("Check your VIDEO_DB_API_KEY")

try:
    video = coll.upload(url="https://example.com/video.mp4")
except InvalidRequestError as e:
    print(f"Upload failed: {e}")
```

### よくある問題

| シナリオ | エラーメッセージ | 解決策 |
|----------|--------------|----------|
| 既にインデックスされたビデオのインデックス作成 | `Spoken word index for video already exists` | `video.index_spoken_words(force=True)` を使用してインデックス済みをスキップ |
| シーンインデックスが既に存在 | `Scene index with id XXXX already exists` | `re.search(r"id\s+([a-f0-9]+)", str(e))` を使用してエラーから既存の `scene_index_id` を抽出 |
| 検索結果なし | `InvalidRequestError: No results found` | 例外をキャッチして空の結果として扱う (`shots = []`) |
| アスペクト比調整タイムアウト | 長いビデオで無期限にブロック | `start`/`end` でセグメントを制限するか、非同期処理のために `callback_url` を渡す |
| タイムライン上の負のタイムスタンプ | 破損したストリームを静かに生成 | `VideoAsset` を作成する前に常に `start >= 0` を検証する |
| `generate_video()` / `create_collection()` の失敗 | `Operation not allowed` または `maximum limit` | プラン制限された機能——ユーザーにプラン制限を通知する |

## 例

### 標準的なプロンプト

* 「デスクトップキャプチャを開始し、パスワードフィールドが表示されたときにアラートを発する。」
* 「セッションを記録して終了時に実行可能なサマリーを生成する。」
* 「このファイルを取り込んで再生可能なストリームリンクを返す。」
* 「このフォルダをインデックス化して、人物がいるすべてのシーンを見つけ、タイムスタンプを返す。」
* 「字幕を生成してバーンインし、軽いバックグラウンドミュージックを追加する。」
* 「このRTSP URLに接続して、誰かがエリアに入ったときにアラートを発する。」

### スクリーンレコーディング（デスクトップキャプチャ）

`ws_listener.py` を使用して録画セッション中にWebSocketイベントをキャプチャする。デスクトップキャプチャは**macOS**のみサポート。

#### クイックスタート

1. **状態ディレクトリを選択**：`STATE_DIR="${VIDEODB_EVENTS_DIR:-$HOME/.local/state/videodb}"`
2. **リスナーを起動**：`VIDEODB_EVENTS_DIR="$STATE_DIR" python scripts/ws_listener.py --clear "$STATE_DIR" &`
3. **WebSocket IDを取得**：`cat "$STATE_DIR/videodb_ws_id"`
4. **キャプチャコードを実行**（完全なワークフローはreference/capture.mdを参照）
5. **イベントの書き込み先**：`$STATE_DIR/videodb_events.jsonl`

新しいキャプチャ実行を開始するときは常に `--clear` を使用して、古い転写とビジュアルイベントが新しいセッションに漏れないようにする。

#### イベントのクエリ

```python
import json
import os
import time
from pathlib import Path

events_dir = Path(os.environ.get("VIDEODB_EVENTS_DIR", Path.home() / ".local" / "state" / "videodb"))
events_file = events_dir / "videodb_events.jsonl"
events = []

if events_file.exists():
    with events_file.open(encoding="utf-8") as handle:
        for line in handle:
            try:
                events.append(json.loads(line))
            except json.JSONDecodeError:
                continue

transcripts = [e["data"]["text"] for e in events if e.get("channel") == "transcript"]
cutoff = time.time() - 300
recent_visual = [
    e for e in events
    if e.get("channel") == "visual_index" and e["unix_ts"] > cutoff
]
```

## 追加ドキュメント

参考ドキュメントはこのSKILL.mdファイルと同じディレクトリの `reference/` ディレクトリにある。必要に応じてGlobツールを使用して見つける。

* [reference/api-reference.md](reference/api-reference.md) - 完全なVideoDB Python SDK APIリファレンス
* [reference/search.md](reference/search.md) - ビデオ検索の詳細ガイド（音声とシーンベース）
* [reference/editor.md](reference/editor.md) - タイムライン編集、アセット、コンポジション
* [reference/streaming.md](reference/streaming.md) - HLSストリーミングと即時再生
* [reference/generative.md](reference/generative.md) - AI駆動のメディア生成（画像、ビデオ、オーディオ）
* [reference/rtstream.md](reference/rtstream.md) - ライブストリーム取り込みワークフロー（RTSP/RTMP）
* [reference/rtstream-reference.md](reference/rtstream-reference.md) - RTStream SDKメソッドとAIパイプライン
* [reference/capture.md](reference/capture.md) - デスクトップキャプチャワークフロー
* [reference/capture-reference.md](reference/capture-reference.md) - Capture SDKとWebSocketイベント
* [reference/use-cases.md](reference/use-cases.md) - 一般的なビデオ処理パターンと例

**VideoDBがその操作をサポートする場合、ffmpeg、moviepy、またはローカルエンコーディングツールを使用しない。** 以下のすべての操作はVideoDBによってサーバーサイドで処理される——トリミング、クリップのマージ、オーディオや音楽のオーバーレイ、字幕の追加、テキスト/画像オーバーレイ、トランスコード、解像度変更、アスペクト比変換、プラットフォーム要件へのリサイズ、転写、メディア生成。reference/editor.mdの「制限」セクションに記載されている操作（トランジション、速度変更、クロップ/ズーム、カラーグレーディング、音量ミキシング）の場合のみローカルツールにフォールバックする。

### 何を使うべきか

| 問題 | VideoDBソリューション |
|---------|-----------------|
| プラットフォームがビデオのアスペクト比または解像度を拒否 | `VideoConfig` を使用した `video.reframe()` または `conn.transcode()` |
| Twitter/Instagram/TikTok向けにビデオをリサイズする必要がある | `video.reframe(target="vertical")` または `target="square"` |
| 解像度を変更する必要がある（例：1080p → 720p） | `VideoConfig(resolution=720)` を使用した `conn.transcode()` |
| ビデオにオーディオ/音楽をオーバーレイする必要がある | `Timeline` で `AudioAsset` を使用 |
| 字幕を追加する必要がある | `video.add_subtitle()` または `CaptionAsset` |
| クリップをマージ/トリミングする必要がある | `Timeline` で `VideoAsset` を使用 |
| ナレーション、音楽、効果音を生成する必要がある | `coll.generate_voice()`、`generate_music()`、`generate_sound_effect()` |

## ソース

このスキルの参考資料は `skills/videodb/reference/` の下でローカルに提供されている。
実行時に外部リポジトリリンクをたどるのではなく、上記のローカルコピーを使用する。

**メンテナー：** [VideoDB](https://www.videodb.io/)
