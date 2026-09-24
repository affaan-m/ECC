# RTStreamリファレンス

RTStream操作のコードレベルの詳細。ワークフローガイドは [rtstream.md](rtstream.md) を参照。
使用ガイダンスとフロー選択については、[../SKILL.md](../SKILL.md) から始めること。

[docs.videodb.io](https://docs.videodb.io/pages/ingest/live-streams/realtime-apis.md) に基づく。

***

## CollectionのRTStreamメソッド

`Collection` 上でRTStreamを管理するメソッド：

| メソッド | 戻り値 | 説明 |
|--------|---------|-------------|
| `coll.connect_rtstream(url, name, ...)` | `RTStream` | RTSP/RTMP URLから新しいRTStreamを作成する |
| `coll.get_rtstream(id)` | `RTStream` | IDで既存のRTStreamを取得する |
| `coll.list_rtstreams(limit, offset, status, name, ordering)` | `List[RTStream]` | コレクション内のすべてのRTStreamをリストする |
| `coll.search(query, namespace="rtstream")` | `RTStreamSearchResult` | すべてのRTStreamで検索する |

### RTStreamへの接続

```python
import videodb

conn = videodb.connect()
coll = conn.get_collection()

rtstream = coll.connect_rtstream(
    url="rtmp://your-stream-server/live/stream-key",
    name="My Live Stream",
    media_types=["video"],  # or ["audio", "video"]
    sample_rate=30,         # optional
    store=True,             # enable recording storage for export
    enable_transcript=True, # optional
    ws_connection_id=ws_id, # optional, for real-time events
)
```

### 既存のRTStreamを取得する

```python
rtstream = coll.get_rtstream("rts-xxx")
```

### RTStreamをリストする

```python
rtstreams = coll.list_rtstreams(
    limit=10,
    offset=0,
    status="connected",  # optional filter
    name="meeting",      # optional filter
    ordering="-created_at",
)

for rts in rtstreams:
    print(f"{rts.id}: {rts.name} - {rts.status}")
```

### キャプチャセッションから取得する

キャプチャセッションがアクティブになったら、RTStreamオブジェクトを取得する：

```python
session = conn.get_capture_session(session_id)

mics = session.get_rtstream("mic")
displays = session.get_rtstream("screen")
system_audios = session.get_rtstream("system_audio")
```

または `capture_session.active` WebSocketイベントの `rtstreams` データを使用する：

```python
for rts in rtstreams:
    rtstream = coll.get_rtstream(rts["rtstream_id"])
```

***

## RTStreamメソッド

| メソッド | 戻り値 | 説明 |
|--------|---------|-------------|
| `rtstream.start()` | `None` | 取り込みを開始する |
| `rtstream.stop()` | `None` | 取り込みを停止する |
| `rtstream.generate_stream(start, end)` | `str` | 録画されたセグメントをストリーミングする（Unixタイムスタンプ） |
| `rtstream.export(name=None)` | `RTStreamExportResult` | 永続的なビデオとしてエクスポートする |
| `rtstream.index_visuals(prompt, ...)` | `RTStreamSceneIndex` | AI分析付きのビジュアルインデックスを作成する |
| `rtstream.index_audio(prompt, ...)` | `RTStreamSceneIndex` | LLMサマリー付きのオーディオインデックスを作成する |
| `rtstream.list_scene_indexes()` | `List[RTStreamSceneIndex]` | ストリーム上のすべてのシーンインデックスをリストする |
| `rtstream.get_scene_index(index_id)` | `RTStreamSceneIndex` | 特定のシーンインデックスを取得する |
| `rtstream.search(query, ...)` | `RTStreamSearchResult` | インデックス化されたコンテンツを検索する |
| `rtstream.start_transcript(ws_connection_id, engine)` | `dict` | リアルタイム転写を開始する |
| `rtstream.get_transcript(page, page_size, start, end, since)` | `dict` | 転写ページを取得する |
| `rtstream.stop_transcript(engine)` | `dict` | 転写を停止する |

***

## 開始と停止

```python
# Begin ingestion
rtstream.start()

# ... stream is being recorded ...

# Stop ingestion
rtstream.stop()
```

***

## ストリームの生成

秒数オフセットではなくUnixタイムスタンプを使用して録画から再生ストリームを生成する：

```python
import time

start_ts = time.time()
rtstream.start()

# Let it record for a while...
time.sleep(60)

end_ts = time.time()
rtstream.stop()

# Generate a stream URL for the recorded segment
stream_url = rtstream.generate_stream(start=start_ts, end=end_ts)
print(f"Recorded stream: {stream_url}")
```

***

## ビデオとしてエクスポートする

録画されたストリームをコレクション内の永続的なビデオとしてエクスポートする：

```python
export_result = rtstream.export(name="Meeting Recording 2024-01-15")

print(f"Video ID: {export_result.video_id}")
print(f"Stream URL: {export_result.stream_url}")
print(f"Player URL: {export_result.player_url}")
print(f"Duration: {export_result.duration}s")
```

### RTStreamExportResult属性

| 属性 | 型 | 説明 |
|----------|------|-------------|
| `video_id` | `str` | エクスポートされたビデオのID |
| `stream_url` | `str` | HLSストリームURL |
| `player_url` | `str` | Webプレーヤー URL |
| `name` | `str` | ビデオ名 |
| `duration` | `float` | 長さ（秒） |

***

## AIパイプライン

AIパイプラインはライブストリームを処理し、WebSocket経由で結果を送信する。

### RTStream AIパイプラインメソッド

| メソッド | 戻り値 | 説明 |
|--------|---------|-------------|
| `rtstream.index_audio(prompt, batch_config, ...)` | `RTStreamSceneIndex` | LLMサマリー付きのオーディオインデックスを開始する |
| `rtstream.index_visuals(prompt, batch_config, ...)` | `RTStreamSceneIndex` | 画面コンテンツのビジュアルインデックスを開始する |

### オーディオインデックス

一定間隔でオーディオコンテンツのLLMサマリーを生成する：

```python
audio_index = rtstream.index_audio(
    prompt="Summarize what is being discussed",
    batch_config={"type": "word", "value": 50},
    model_name=None,       # optional
    name="meeting_audio",  # optional
    ws_connection_id=ws_id,
)
```

**オーディオのbatch\_configオプション：**

| タイプ | 値 | 説明 |
|------|-------|-------------|
| `"word"` | count | N単語ごとにセグメント化 |
| `"sentence"` | count | N文ごとにセグメント化 |
| `"time"` | seconds | N秒ごとにセグメント化 |

例：

```python
{"type": "word", "value": 50}      # every 50 words
{"type": "sentence", "value": 5}   # every 5 sentences
{"type": "time", "value": 30}      # every 30 seconds
```

結果は `audio_index` WebSocketチャネル経由で届く。

### ビジュアルインデックス

ビジュアルコンテンツのAI説明を生成する：

```python
scene_index = rtstream.index_visuals(
    prompt="Describe what is happening on screen",
    batch_config={"type": "time", "value": 2, "frame_count": 5},
    model_name="basic",
    name="screen_monitor",  # optional
    ws_connection_id=ws_id,
)
```

**パラメータ：**

| パラメータ | 型 | 説明 |
|-----------|------|-------------|
| `prompt` | `str` | AIモデルへの指示（構造化JSON出力をサポート） |
| `batch_config` | `dict` | フレームサンプリングを制御する（以下を参照） |
| `model_name` | `str` | モデル層：`"mini"`、`"basic"`、`"pro"`、`"ultra"` |
| `name` | `str` | インデックス名（オプション） |
| `ws_connection_id` | `str` | 結果を受信するWebSocket接続ID |

**ビジュアルのbatch\_config：**

| キー | 型 | 説明 |
|-----|------|-------------|
| `type` | `str` | ビジュアルインデックスでは `"time"` のみサポート |
| `value` | `int` | ウィンドウサイズ（秒） |
| `frame_count` | `int` | 各ウィンドウで抽出するフレーム数 |

例：`{"type": "time", "value": 2, "frame_count": 5}` は2秒ごとに5フレームをサンプリングしてモデルに送信する。

**構造化JSON出力：**

構造化されたレスポンスを得るためにJSONフォーマットをリクエストするプロンプトを使用する：

```python
scene_index = rtstream.index_visuals(
    prompt="""Analyze the screen and return a JSON object with:
{
  "app_name": "name of the active application",
  "activity": "what the user is doing",
  "ui_elements": ["list of visible UI elements"],
  "contains_text": true/false,
  "dominant_colors": ["list of main colors"]
}
Return only valid JSON.""",
    batch_config={"type": "time", "value": 3, "frame_count": 3},
    model_name="pro",
    ws_connection_id=ws_id,
)
```

結果は `scene_index` WebSocketチャネル経由で届く。

***

## バッチ設定のサマリー

| インデックスタイプ | `type` オプション | `value` | 追加キー |
|---------------|----------------|---------|------------|
| **オーディオ** | `"word"`、`"sentence"`、`"time"` | words/sentences/seconds | - |
| **ビジュアル** | `"time"` のみ | seconds | `frame_count` |

例：

```python
# Audio: every 50 words
{"type": "word", "value": 50}

# Audio: every 30 seconds
{"type": "time", "value": 30}

# Visual: 5 frames every 2 seconds
{"type": "time", "value": 2, "frame_count": 5}
```

***

## 転写

WebSocket経由のリアルタイム転写：

```python
# Start live transcription
rtstream.start_transcript(
    ws_connection_id=ws_id,
    engine=None,  # optional, defaults to "assemblyai"
)

# Get transcript pages (with optional filters)
transcript = rtstream.get_transcript(
    page=1,
    page_size=100,
    start=None,   # optional: start timestamp filter
    end=None,     # optional: end timestamp filter
    since=None,   # optional: for polling, get transcripts after this timestamp
    engine=None,
)

# Stop transcription
rtstream.stop_transcript(engine=None)
```

転写結果は `transcript` WebSocketチャネル経由で届く。

***

## RTStreamSceneIndex

`index_audio()` または `index_visuals()` を呼び出すと、メソッドは `RTStreamSceneIndex` オブジェクトを返す。このオブジェクトは実行中のインデックスを表し、シーンとアラートを管理するためのメソッドを提供する。

```python
# index_visuals returns an RTStreamSceneIndex
scene_index = rtstream.index_visuals(
    prompt="Describe what is on screen",
    ws_connection_id=ws_id,
)

# index_audio also returns an RTStreamSceneIndex
audio_index = rtstream.index_audio(
    prompt="Summarize the discussion",
    ws_connection_id=ws_id,
)
```

### RTStreamSceneIndex属性

| 属性 | 型 | 説明 |
|----------|------|-------------|
| `rtstream_index_id` | `str` | インデックスの一意ID |
| `rtstream_id` | `str` | 親RTStreamのID |
| `extraction_type` | `str` | 抽出タイプ（`time` または `transcript`） |
| `extraction_config` | `dict` | 抽出設定 |
| `prompt` | `str` | 分析に使用するプロンプト |
| `name` | `str` | インデックス名 |
| `status` | `str` | 状態（`connected`、`stopped`） |

### RTStreamSceneIndexメソッド

| メソッド | 戻り値 | 説明 |
|--------|---------|-------------|
| `index.get_scenes(start, end, page, page_size)` | `dict` | インデックス化されたシーンを取得する |
| `index.start()` | `None` | インデックスを開始/再開する |
| `index.stop()` | `None` | インデックスを停止する |
| `index.create_alert(event_id, callback_url, ws_connection_id)` | `str` | イベント検出アラートを作成する |
| `index.list_alerts()` | `list` | このインデックスのすべてのアラートをリストする |
| `index.enable_alert(alert_id)` | `None` | アラートを有効にする |
| `index.disable_alert(alert_id)` | `None` | アラートを無効にする |

### シーンの取得

インデックスからインデックス化されたシーンをポーリングする：

```python
result = scene_index.get_scenes(
    start=None,      # optional: start timestamp
    end=None,        # optional: end timestamp
    page=1,
    page_size=100,
)

for scene in result["scenes"]:
    print(f"[{scene['start']}-{scene['end']}] {scene['text']}")

if result["next_page"]:
    # fetch next page
    pass
```

### シーンインデックスの管理

```python
# List all indexes on the stream
indexes = rtstream.list_scene_indexes()

# Get a specific index by ID
scene_index = rtstream.get_scene_index(index_id)

# Stop an index
scene_index.stop()

# Restart an index
scene_index.start()
```

***

## イベント

イベントは再利用可能な検出ルール。一度作成すれば、アラートを通じて任意のインデックスに添付できる。

### 接続イベントメソッド

| メソッド | 戻り値 | 説明 |
|--------|---------|-------------|
| `conn.create_event(event_prompt, label)` | `str` (event\_id) | 検出イベントを作成する |
| `conn.list_events()` | `list` | すべてのイベントをリストする |

### イベントの作成

```python
event_id = conn.create_event(
    event_prompt="User opened Slack application",
    label="slack_opened",
)
```

### イベントのリスト

```python
events = conn.list_events()
for event in events:
    print(f"{event['event_id']}: {event['label']}")
```

***

## アラート

アラートはイベントをインデックスに接続してリアルタイム通知を実現する。AIがイベントの説明に一致するコンテンツを検出すると、アラートが送信される。

### アラートの作成

```python
# Get the RTStreamSceneIndex from index_visuals
scene_index = rtstream.index_visuals(
    prompt="Describe what application is open on screen",
    ws_connection_id=ws_id,
)

# Create an alert on the index
alert_id = scene_index.create_alert(
    event_id=event_id,
    callback_url="https://your-backend.com/alerts",  # for webhook delivery
    ws_connection_id=ws_id,  # for WebSocket delivery (optional)
)
```

**注意：** `callback_url` は必須。WebSocket配信のみを使用する場合は空文字列 `""` を渡す。

### アラートの管理

```python
# List all alerts on an index
alerts = scene_index.list_alerts()

# Enable/disable alerts
scene_index.disable_alert(alert_id)
scene_index.enable_alert(alert_id)
```

### アラート配信

| 方法 | 遅延 | ユースケース |
|--------|---------|----------|
| WebSocket | リアルタイム | ダッシュボード、ライブUI |
| Webhook | < 1秒 | サーバー間、自動化 |

### WebSocketアラートイベント

```json
{
  "channel": "alert",
  "rtstream_id": "rts-xxx",
  "data": {
    "event_label": "slack_opened",
    "timestamp": 1710000012340,
    "text": "User opened Slack application"
  }
}
```

### Webhookペイロード

```json
{
  "event_id": "event-xxx",
  "label": "slack_opened",
  "confidence": 0.95,
  "explanation": "User opened the Slack application",
  "timestamp": "2024-01-15T10:30:45Z",
  "start_time": 1234.5,
  "end_time": 1238.0,
  "stream_url": "https://stream.videodb.io/v3/...",
  "player_url": "https://console.videodb.io/player?url=..."
}
```

***

## WebSocket統合

すべてのリアルタイムAI結果はWebSocket経由で配信される。以下に `ws_connection_id` を渡す：

* `rtstream.start_transcript()`
* `rtstream.index_audio()`
* `rtstream.index_visuals()`
* `scene_index.create_alert()`

### WebSocketチャネル

| チャネル | ソース | コンテンツ |
|---------|--------|---------|
| `transcript` | `start_transcript()` | リアルタイム音声テキスト変換 |
| `scene_index` | `index_visuals()` | ビジュアル分析結果 |
| `audio_index` | `index_audio()` | オーディオ分析結果 |
| `alert` | `create_alert()` | アラート通知 |

WebSocketイベント構造とws\_listenerの使用については [capture-reference.md](capture-reference.md) を参照。

***

## 完全なワークフロー

```python
import time
import videodb
from videodb.exceptions import InvalidRequestError

conn = videodb.connect()
coll = conn.get_collection()

# 1. Connect and start recording
rtstream = coll.connect_rtstream(
    url="rtmp://your-stream-server/live/stream-key",
    name="Weekly Standup",
    store=True,
)
rtstream.start()

# 2. Record for the duration of the meeting
start_ts = time.time()
time.sleep(1800)  # 30 minutes
end_ts = time.time()
rtstream.stop()

# Generate an immediate playback URL for the captured window
stream_url = rtstream.generate_stream(start=start_ts, end=end_ts)
print(f"Recorded stream: {stream_url}")

# 3. Export to a permanent video
export_result = rtstream.export(name="Weekly Standup Recording")
print(f"Exported video: {export_result.video_id}")

# 4. Index the exported video for search
video = coll.get_video(export_result.video_id)
video.index_spoken_words(force=True)

# 5. Search for action items
try:
    results = video.search("action items and next steps")
    stream_url = results.compile()
    print(f"Action items clip: {stream_url}")
except InvalidRequestError as exc:
    if "No results found" in str(exc):
        print("No action items were detected in the recording.")
    else:
        raise
```
