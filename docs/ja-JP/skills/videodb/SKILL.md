---
name: videodb
description: VideoDBのセットアップおよびVideoDB Python SDKを使用したコード作成。「setup videodb」や「/videodb setup」、チャットの回答ではなくPythonコード、スクリプト、ノートブックが必要な場合、メディアの一括アップロードやインデックス作成、オープンウェイトモデルによるサンドボックスコンピュート、およびその他の動画タスク全般で使用します。
origin: ECC
allowed-tools: Read Grep Glob Bash(python:*)
argument-hint: "[task description]"
---

# VideoDB: セットアップとPython SDK

VideoDBはサーバー側で動画処理を実行します：取り込み、理解、インデックス作成、検索、クリップ作成、字幕、合成、ストリーミング。本スキルではセットアップとPython SDKを扱います。

## 有効化のタイミング (When to Activate)

- VideoDBのセットアップ（「setup videodb」または「/videodb setup」）
- VideoDB Python SDKを使用したコード作成（スクリプト、ノートブック、パイプライン）
- メディアライブラリに対する一括アップロードや検索可能なインデックスの構築
- オープンウェイトモデル（Gemma、Qwen、Whisper、FLUX）を使用したサンドボックスコンピュート
- プログラマティックな動画タスク全般（検索、文字起こし、クリッピング、トランスコード、配信、リアルタイムアラート）

## どのパスを使用するか (Which path)

1. **VideoDBコネクタツールが存在する場合**（`upload_media`, `search_video`, `generate_clip` など）：これらを直接使用します。Web、デスクトップ、モバイルのClaudeチャットおよびCoworkでの標準パスです。インストールやAPIキーは不要です。
2. **VideoDBツールはないがシェルがある場合**（Claude Code、Cowork、Pythonを実行できるエージェント）：VideoDBのAPIキーを一行で尋ねます（https://console.videodb.io で無料取得可能、$20クレジット付属、クレカ不要）。ユーザーがキーを入力したら、プロジェクトの `.env` に保存し（後述のセットアップ参照）、キーを表示することなくSDKの利用を続行します。Claude Codeでは `/mcp` からバンドルされたvideodbサーバーを承認することでも動作します。
3. **VideoDBツールもシェルもない場合**：Claudeチャット環境です。「VideoDBがまだ接続されていません。設定 → コネクタ を開き、VideoDBを見つけて接続・ログイン（無料、クレカ不要）してください。その後、このリクエストを再度送信してください。」と案内します。

## 出力 (Outputs)

- **ストリームURL**：`https://console.videodb.io/player?url={STREAM_URL}` で再生可能（コネクタツールは `player_url` も返します）
- タイムスタンプと再生可能な証拠付きの検索結果
- 生成されたアセット：字幕、オーディオ、画像、クリップ
- ライブストリーム向けのイベントおよびアラートペイロード
- デスクトップセッションのサマリーと検索可能なタイムライン

## Pythonコードの実行 (Running Python code)

**重要:** Pythonコードを実行する前に、必ずユーザーのプロジェクトディレクトリに `cd` してください。これにより `load_dotenv(".env")` が正しい `.env` ファイルを読み込めます。

```python
from dotenv import load_dotenv
load_dotenv(".env")

import videodb
conn = videodb.connect()
```

キーが見つからない場合、`videodb.connect()` は自動的に `AuthenticationError` を発生させます。

短いインラインコマンドで済む場合にスクリプトファイルを作成しないでください。

インラインPython（`python -c "..."`）を実行する場合は、適切にフォーマットされたコードを使用してください。3文以上になる場合は、ヒアドキュメントを使用します：

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

## セットアップ (Setup)

ユーザーが「setup videodb」などを要求した場合：

### 1. SDKのインストール

```bash
pip install "videodb[capture]>=0.5.0" python-dotenv
```

Linux環境で `videodb[capture]` のインストールが失敗した場合は、capture extraなしでインストールします：

```bash
pip install "videodb>=0.5.0" python-dotenv
```

`>=0.5.0` の指定は重要です（understand/index/ask/aggregate APIはこれ以前のバージョンには存在しません）。

### 2. APIキーの設定

VideoDBのAPIキーを一行で尋ねます：https://console.videodb.io で無料取得可能（$20の無料クレジット、クレカ不要）。入力されたら保存して続行します：

- プロジェクトの `.env` に `VIDEO_DB_API_KEY=<key>` を書き込み、`.env` が `.gitignore` に含まれていることを確認します。
- キーを画面に出力、echo、ログ記録、コミットしないでください。
- ユーザーが自身で設定することを好む場合は、ターミナルで `export VIDEO_DB_API_KEY=<key>` を実行しても動作します。

### 3. ホスト型MCPサーバーの承認（Claude Codeプラグインのみ）

プラグインには `https://mcp.videodb.io/mcp` のホスト型MCPサーバーがバンドルされています。ユーザーに `/mcp` を実行し、**videodb** を選択してブラウザでの認証を完了するよう伝えます。

## クイックリファレンス (Quick Reference)

### メディアのアップロード

```python
# URL
video = coll.upload(url="https://example.com/video.mp4")

# YouTube
video = coll.upload(url="https://www.youtube.com/watch?v=VIDEO_ID")

# ローカルファイル
video = coll.upload(file_path="/path/to/video.mp4")
```

### 理解 → インデックス → 検索（デフォルトパス）

```python
import time

# 1. 理解（Understand）
understanding = video.understand(
    analyzers=[
        {"type": "spoken_words", "name": "transcript"},
        {"type": "vlm", "name": "scene",
         "config": {"prompt": "Describe the scene and any on-screen text."}},
    ],
    segmentation={"type": "shot", "threshold": 30},
)

deadline = time.time() + 3600
while time.time() < deadline:
    analyzers = understanding.refresh().list_analyzers()
    if analyzers and all(a.is_complete for a in analyzers):
        break
    time.sleep(15)

# 2. 成功した各成果物のインデックス作成
for analyzer in understanding.list_analyzers():
    if analyzer.is_successful:
        video.index(source=analyzer, name=analyzer.name).wait_until_complete()

# 3. 検索（Retrieve）
response = video.search("discussion about pricing")
for shot in response.shots:
    print(f"[{shot.start:.1f}s - {shot.end:.1f}s] {shot.text}")
if response.response_type in ("shots", "deepsearch") and len(response):
    stream_url = response.compile()
```

### 検索と取得

```python
# 特定のインデックスを対象にし、関連性スコアの閾値を設定
video.semantic_search("a customer holding the product", index_names=["scene"], score_threshold=0.7)

# フィールドの完全一致フィルター
video.query(index_name="objects",
            filter=[{"field": "frames.detections.label", "op": "contains", "value": "car"}])

# 集計・カウント
video.aggregate(index_name="objects", group_by="frames.detections.label", metric="count")

# 質問応答（タイムスタンプ付き）
answer = video.ask("What did they say about pricing?", include_sources=True)
```

### 文字起こし + 字幕

```python
video.generate_transcript()
text = video.get_transcript_text()
stream_url = video.add_subtitle()
```

### タイムライン編集

```python
from videodb.editor import Timeline, Track, Clip, VideoAsset, AudioAsset

timeline = Timeline(conn)
timeline.resolution = "1280x720"

video_track = Track()
video_track.add_clip(0, Clip(asset=VideoAsset(id=video.id, start=10), duration=20))

audio_track = Track()
audio_track.add_clip(0, Clip(asset=AudioAsset(id=music.id, volume=0.2), duration=20))

timeline.add_track(video_track)
timeline.add_track(audio_track)
stream_url = timeline.generate_stream()
```

### アスペクト比のリフレーム（SNS向け）

```python
from videodb import ReframeMode

reframed = video.reframe(start=0, end=60, target="vertical", mode=ReframeMode.smart)
```

### サンドボックスコンピュート（オープンウェイトモデルの実行）

```python
from videodb import SandboxTier, SandboxModel

sandbox = conn.create_sandbox(
    tier=SandboxTier.medium,
    models=[SandboxModel.GEMMA_4_31B.value],
)
sandbox.wait_for_ready(timeout=300, interval=5)

understanding = video.understand(analyzers=[{
    "type": "vlm", "name": "scene",
    "config": {"model": "google/gemma-4-31B-it", "sandbox_id": sandbox.id,
               "prompt": "Describe the scene."},
}])

sandbox.stop()
sandbox.wait_for_stop()
```

## エラーハンドリング (Error handling)

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

## アンチパターン (Anti-Patterns)

- VideoDBがサーバー側でサポートしている操作に対して、ffmpegやmoviepyなどのローカルエンコードツールを使用しないでください。
- `VIDEO_DB_API_KEY` を出力、コミット、公開しないでください。
- 新規プロジェクトでレガシーなv1インデックス作成（`index_spoken_words()`, `index_scenes()`）を使用しないでください。v2の `understand() -> index() -> retrieve()` パイプラインを使用します。
- 一部のアナライザー実行に対して `wait_until_complete()` を盲目的に呼び出さないでください。個別のアナライザー状態をポーリングします。
- 時間のかかる処理中に再書き込みを実行しないでください。完了するまで指定されたURLでポーリングします。

## 追加ドキュメント (Additional docs)

詳細なドキュメントは `reference/` ディレクトリにあります：

- [reference/api-reference.md](reference/api-reference.md) - 完全なVideoDB Python SDK APIリファレンス
- [reference/indexing.md](reference/indexing.md) - 理解 → インデックスパイプラインガイド
- [reference/search.md](reference/search.md) - 検索・取得ガイド
- [reference/editor.md](reference/editor.md) - タイムライン編集ワークフロー
- [reference/sandbox.md](reference/sandbox.md) - サンドボックスコンピュートガイド
- [reference/capture.md](reference/capture.md) - デスクトップキャプチャワークフロー
