# キャプチャリファレンス

VideoDBキャプチャセッションのコードレベルの詳細。ワークフローガイドは [capture.md](capture.md) を参照。

***

## WebSocketイベント

キャプチャセッションとAIパイプラインからのリアルタイムイベント。WebhookやポーリングLiveEventを使用しない。

[scripts/ws\_listener.py](../../../../../skills/videodb/scripts/ws_listener.py) を使用して接続し、イベントを `${VIDEODB_EVENTS_DIR:-$HOME/.local/state/videodb}/videodb_events.jsonl` にダンプする。

### イベントチャネル

| チャネル | ソース | コンテンツ |
|---------|--------|---------|
| `capture_session` | セッションライフサイクル | 状態変更 |
| `transcript` | `start_transcript()` | 音声テキスト変換 |
| `visual_index` / `scene_index` | `index_visuals()` | ビジュアル分析 |
| `audio_index` | `index_audio()` | オーディオ分析 |
| `alert` | `create_alert()` | アラート通知 |

### セッションライフサイクルイベント

| イベント | 状態 | 主要データ |
|-------|--------|----------|
| `capture_session.created` | `created` | — |
| `capture_session.starting` | `starting` | — |
| `capture_session.active` | `active` | `rtstreams[]` |
| `capture_session.stopping` | `stopping` | — |
| `capture_session.stopped` | `stopped` | — |
| `capture_session.exported` | `exported` | `exported_video_id`, `stream_url`, `player_url` |
| `capture_session.failed` | `failed` | `error` |

### イベント構造

**転写イベント：**

```json
{
  "channel": "transcript",
  "rtstream_id": "rts-xxx",
  "rtstream_name": "mic:default",
  "data": {
    "text": "Let's schedule the meeting for Thursday",
    "is_final": true,
    "start": 1710000001234,
    "end": 1710000002345
  }
}
```

**ビジュアルインデックスイベント：**

```json
{
  "channel": "visual_index",
  "rtstream_id": "rts-xxx",
  "rtstream_name": "display:1",
  "data": {
    "text": "User is viewing a Slack conversation with 3 unread messages",
    "start": 1710000012340,
    "end": 1710000018900
  }
}
```

**オーディオインデックスイベント：**

```json
{
  "channel": "audio_index",
  "rtstream_id": "rts-xxx",
  "rtstream_name": "mic:default",
  "data": {
    "text": "Discussion about scheduling a team meeting",
    "start": 1710000021500,
    "end": 1710000029200
  }
}
```

**セッションアクティブイベント：**

```json
{
  "event": "capture_session.active",
  "capture_session_id": "cap-xxx",
  "status": "active",
  "data": {
    "rtstreams": [
      { "rtstream_id": "rts-1", "name": "mic:default", "media_types": ["audio"] },
      { "rtstream_id": "rts-2", "name": "system_audio:default", "media_types": ["audio"] },
      { "rtstream_id": "rts-3", "name": "display:1", "media_types": ["video"] }
    ]
  }
}
```

**セッションエクスポートイベント：**

```json
{
  "event": "capture_session.exported",
  "capture_session_id": "cap-xxx",
  "status": "exported",
  "data": {
    "exported_video_id": "v_xyz789",
    "stream_url": "https://stream.videodb.io/...",
    "player_url": "https://console.videodb.io/player?url=..."
  }
}
```

> 最新の詳細については [VideoDB リアルタイムコンテキストドキュメント](https://docs.videodb.io/pages/ingest/capture-sdks/realtime-context.md) を参照。

***

## イベント永続化

`ws_listener.py` を使用してすべてのWebSocketイベントをJSONLファイルにダンプして後で分析する。

### リスナーを起動してWebSocket IDを取得する

```bash
# Start with --clear to clear old events (recommended for new sessions)
python scripts/ws_listener.py --clear &

# Append to existing events (for reconnects)
python scripts/ws_listener.py &
```

またはカスタム出力ディレクトリを指定する：

```bash
python scripts/ws_listener.py --clear /path/to/output &
# Or via environment variable:
VIDEODB_EVENTS_DIR=/path/to/output python scripts/ws_listener.py --clear &
```

スクリプトは最初の行に `WS_ID=<connection_id>` を出力し、その後無限にリッスンする。

**ws\_idを取得する：**

```bash
cat "${VIDEODB_EVENTS_DIR:-$HOME/.local/state/videodb}/videodb_ws_id"
```

**リスナーを停止する：**

```bash
kill "$(cat "${VIDEODB_EVENTS_DIR:-$HOME/.local/state/videodb}/videodb_ws_pid")"
```

**`ws_connection_id` を受け入れる関数：**

| 関数 | 目的 |
|----------|---------|
| `conn.create_capture_session()` | セッションライフサイクルイベント |
| RTStreamメソッド | [rtstream-reference.md](rtstream-reference.md) を参照 |

**出力ファイル**（出力ディレクトリ内、デフォルトは `${XDG_STATE_HOME:-$HOME/.local/state}/videodb`）：

* `videodb_ws_id` - WebSocket接続ID
* `videodb_events.jsonl` - すべてのイベント
* `videodb_ws_pid` - 停止用のプロセスID

**機能：**

* 起動時にイベントファイルをクリアするための `--clear` フラグ（新しいセッション用）
* 接続が切れた場合の指数バックオフによる自動再接続
* SIGINT/SIGTERMでのグレースフルシャットダウン
* 接続状態のログ記録

### JSONLフォーマット

各行はタイムスタンプが付加されたJSONオブジェクト：

```json
{"ts": "2026-03-02T10:15:30.123Z", "unix_ts": 1772446530.123, "channel": "visual_index", "data": {"text": "..."}}
{"ts": "2026-03-02T10:15:31.456Z", "unix_ts": 1772446531.456, "event": "capture_session.active", "capture_session_id": "cap-xxx"}
```

### イベントの読み取り

```python
import json
import time
from pathlib import Path

events_path = Path.home() / ".local" / "state" / "videodb" / "videodb_events.jsonl"
transcripts = []
recent = []
visual = []

cutoff = time.time() - 600
with events_path.open(encoding="utf-8") as handle:
    for line in handle:
        event = json.loads(line)
        if event.get("channel") == "transcript":
            transcripts.append(event)
        if event.get("unix_ts", 0) > cutoff:
            recent.append(event)
        if (
            event.get("channel") == "visual_index"
            and "code" in event.get("data", {}).get("text", "").lower()
        ):
            visual.append(event)
```

***

## WebSocket接続

転写とインデックスパイプラインからリアルタイムのAI結果を受信するために接続する。

```python
ws_wrapper = conn.connect_websocket()
ws = await ws_wrapper.connect()
ws_id = ws.connection_id
```

| 属性 / メソッド | 型 | 説明 |
|-------------------|------|-------------|
| `ws.connection_id` | `str` | 一意の接続ID（AIパイプラインメソッドに渡す） |
| `ws.receive()` | `AsyncIterator[dict]` | リアルタイムメッセージを生成する非同期イテレータ |

***

## CaptureSession

### 接続メソッド

| メソッド | 戻り値 | 説明 |
|--------|---------|-------------|
| `conn.create_capture_session(end_user_id, collection_id, ws_connection_id, metadata)` | `CaptureSession` | 新しいキャプチャセッションを作成する |
| `conn.get_capture_session(capture_session_id)` | `CaptureSession` | 既存のキャプチャセッションを取得する |
| `conn.generate_client_token()` | `str` | クライアント認証トークンを生成する |

### キャプチャセッションの作成

```python
from pathlib import Path

ws_id = (Path.home() / ".local" / "state" / "videodb" / "videodb_ws_id").read_text().strip()

session = conn.create_capture_session(
    end_user_id="user-123",  # required
    collection_id="default",
    ws_connection_id=ws_id,
    metadata={"app": "my-app"},
)
print(f"Session ID: {session.id}")
```

> **注意：** `end_user_id` は必須で、キャプチャを開始するユーザーを識別するために使用される。テストやデモ目的には任意の一意の文字列識別子が有効（例：`"demo-user"`、`"test-123"`）。

### CaptureSession属性

| 属性 | 型 | 説明 |
|----------|------|-------------|
| `session.id` | `str` | 一意のキャプチャセッションID |

### CaptureSessionメソッド

| メソッド | 戻り値 | 説明 |
|--------|---------|-------------|
| `session.get_rtstream(type)` | `list[RTStream]` | タイプ別にRTStreamを取得：`"mic"`、`"screen"`、または `"system_audio"` |

### クライアントトークンの生成

```python
token = conn.generate_client_token()
```

***

## CaptureClient

クライアントはユーザーのマシン上で動作し、権限、チャネルの発見、ストリーミングを処理する。

```python
from videodb.capture import CaptureClient

client = CaptureClient(client_token=token)
```

### CaptureClientメソッド

| メソッド | 戻り値 | 説明 |
|--------|---------|-------------|
| `await client.request_permission(type)` | `None` | デバイスの権限をリクエストする（`"microphone"`、`"screen_capture"`） |
| `await client.list_channels()` | `Channels` | 利用可能なオーディオ/ビデオチャネルを発見する |
| `await client.start_capture_session(capture_session_id, channels, primary_video_channel_id)` | `None` | 選択したチャネルのストリーミングを開始する |
| `await client.stop_capture()` | `None` | キャプチャセッションをグレースフルに停止する |
| `await client.shutdown()` | `None` | クライアントリソースをクリーンアップする |

### 権限のリクエスト

```python
await client.request_permission("microphone")
await client.request_permission("screen_capture")
```

### セッションの開始

```python
selected_channels = [c for c in [mic, display, system_audio] if c]
await client.start_capture_session(
    capture_session_id=session.id,
    channels=selected_channels,
    primary_video_channel_id=display.id if display else None,
)
```

### セッションの停止

```python
await client.stop_capture()
await client.shutdown()
```

***

## チャネル

`client.list_channels()` によって返される。利用可能なデバイスをタイプ別にグループ化する。

```python
channels = await client.list_channels()
for ch in channels.all():
    print(f"  {ch.id} ({ch.type}): {ch.name}")

mic = channels.mics.default
display = channels.displays.default
system_audio = channels.system_audio.default
```

### チャネルグループ

| 属性 | 型 | 説明 |
|----------|------|-------------|
| `channels.mics` | `ChannelGroup` | 利用可能なマイク |
| `channels.displays` | `ChannelGroup` | 利用可能な画面ディスプレイ |
| `channels.system_audio` | `ChannelGroup` | 利用可能なシステムオーディオソース |

### ChannelGroupメソッドと属性

| メンバー | 型 | 説明 |
|--------|------|-------------|
| `group.default` | `Channel` | グループのデフォルトチャネル（または `None`） |
| `group.all()` | `list[Channel]` | グループのすべてのチャネル |

### チャネル属性

| 属性 | 型 | 説明 |
|----------|------|-------------|
| `ch.id` | `str` | 一意のチャネルID |
| `ch.type` | `str` | チャネルタイプ（`"mic"`、`"display"`、`"system_audio"`） |
| `ch.name` | `str` | 人間が読めるチャネル名 |
| `ch.store` | `bool` | 録画を永続化するかどうか（保存するには `True` に設定） |

`store = True` がない場合、ストリームはリアルタイムで処理されるが保存されない。

***

## RTStreamとAIパイプライン

セッションがアクティブになったら、`session.get_rtstream()` を使用してRTStreamオブジェクトを取得する。

RTStreamメソッド（インデックス作成、転写、アラート、バッチ設定）については [rtstream-reference.md](rtstream-reference.md) を参照。

***

## セッションライフサイクル

```
  create_capture_session()
          │
          v
  ┌───────────────┐
  │    created     │
  └───────┬───────┘
          │  client.start_capture_session()
          v
  ┌───────────────┐     WebSocket: capture_session.starting
  │   starting     │ ──> Capture channels connect
  └───────┬───────┘
          │
          v
  ┌───────────────┐     WebSocket: capture_session.active
  │    active      │ ──> Start AI pipelines
  └───────┬──────────────┐
          │              │
          │              v
          │      ┌───────────────┐     WebSocket: capture_session.failed
          │      │    failed      │ ──> Inspect error payload and retry setup
          │      └───────────────┘
          │      unrecoverable capture error
          │
          │  client.stop_capture()
          v
  ┌───────────────┐     WebSocket: capture_session.stopping
  │   stopping     │ ──> Finalize streams
  └───────┬───────┘
          │
          v
  ┌───────────────┐     WebSocket: capture_session.stopped
  │   stopped      │ ──> All streams finalized
  └───────┬───────┘
          │  (if store=True)
          v
  ┌───────────────┐     WebSocket: capture_session.exported
  │   exported     │ ──> Access video_id, stream_url, player_url
  └───────────────┘
```
