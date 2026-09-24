# キャプチャガイド

## 概要

VideoDB CaptureはAI処理機能を備えたリアルタイムの画面とオーディオの録画をサポートする。デスクトップキャプチャは現在**macOS**のみサポートされている。

コードレベルの詳細（SDKメソッド、イベント構造、AIパイプライン）については [capture-reference.md](capture-reference.md) を参照。

## クイックスタート

1. **WebSocketリスナーを起動する**：`python scripts/ws_listener.py --clear &`
2. **キャプチャコードを実行する**（以下の完全なキャプチャワークフローを参照）
3. **イベントの書き込み先**：`/tmp/videodb_events.jsonl`

***

## 完全なキャプチャワークフロー

WebhookやポーリングLiveEventは不要。WebSocketがセッションライフサイクルイベントを含むすべてのイベントを配信する。

> **重要な注意事項：** `CaptureClient` はキャプチャ全体を通じて実行し続ける必要がある。ローカルレコーダーバイナリを実行し、画面/オーディオデータをVideoDBにストリーミングする。`CaptureClient` を作成したPythonプロセスが終了すると、レコーダーバイナリが終了し、キャプチャが静かに停止する。常にキャプチャコードを**長期実行バックグラウンドプロセス**として実行し（例：`nohup python capture_script.py &`）、明示的に停止するまで生き続けるようにシグナル処理（`asyncio.Event` + `SIGINT`/`SIGTERM`）を使用すること。

1. バックグラウンドで**WebSocketリスナーを起動する**。古いイベントをクリアするために `--clear` フラグを使用する。WebSocket IDファイルが作成されるまで待つ。

2. **WebSocket IDを読み取る**。このIDはキャプチャセッションとAIパイプラインに必要。

3. **キャプチャセッションを作成する**。デスクトップクライアント用のクライアントトークンを生成する。

4. トークンを使用して**CaptureClientを初期化する**。マイクと画面キャプチャの権限をリクエストする。

5. **チャネルをリストアップして選択する**（マイク、ディスプレイ、システムオーディオ）。ビデオとして永続化したいチャネルに `store = True` を設定する。

6. 選択したチャネルで**セッションを開始する**。

7. `capture_session.active` が見えるまでイベントを読み取ることで**セッションがアクティブになるまで待つ**。このイベントには `rtstreams` 配列が含まれる。セッション情報（セッションID、RTStream ID）をファイルに保存する（例：`/tmp/videodb_capture_info.json`）。他のスクリプトがそれを読み取れるようにする。

8. **プロセスを生かし続ける**。明示的に停止されるまでプロセスをブロックするために、`SIGINT`/`SIGTERM` のシグナルハンドラーで `asyncio.Event` を使用する。後で `kill $(cat /tmp/videodb_capture_pid)` でプロセスを停止できるようにPIDファイルを書く（例：`/tmp/videodb_capture_pid`）。PIDファイルは実行のたびに上書きして、再実行時に常に正しいPIDを持つようにする。

9. 各RTStreamの音声インデックスとビジュアルインデックスを作成する**AIパイプラインを起動する**（別のコマンド/スクリプトで）。保存されたセッション情報ファイルからRTStream IDを読み取る。

10. ユースケースに応じてリアルタイムイベントを読み取る**カスタムイベント処理ロジックを書く**（別のコマンド/スクリプトで）。例：
    * `visual_index` が「Slack」を言及したときにSlackアクティビティをログに記録する
    * `audio_index` イベントが到着したときに議論をサマリーする
    * `transcript` に特定のキーワードが現れたときにアラートをトリガーする
    * 画面の説明からアプリの使用状況を追跡する

11. **キャプチャを停止する** - 完了したら、キャプチャプロセスにSIGTERMを送信する。シグナルハンドラーで `client.stop_capture()` と `client.shutdown()` を呼び出すべき。

12. **エクスポートを待つ** - `capture_session.exported` が見えるまでイベントを読み取る。このイベントには `exported_video_id`、`stream_url`、`player_url` が含まれる。キャプチャを停止した後、これには数秒かかる場合がある。

13. **WebSocketリスナーを停止する** - エクスポートイベントを受信したら、`kill $(cat /tmp/videodb_ws_pid)` でクリーンに終了させる。

***

## シャットダウンシーケンス

すべてのイベントがキャプチャされることを確認するために、適切なシャットダウンシーケンスが重要：

1. **キャプチャセッションを停止する** — `client.stop_capture()` 次に `client.shutdown()`
2. **エクスポートイベントを待つ** — `capture_session.exported` を `/tmp/videodb_events.jsonl` でポーリングする
3. **WebSocketリスナーを停止する** — `kill $(cat /tmp/videodb_ws_pid)`

エクスポートイベントを受信する前にWebSocketリスナーを**停止しないこと**。そうしないと最終的なビデオURLを受け取れなくなる。

***

## スクリプト

| スクリプト | 説明 |
|--------|-------------|
| `scripts/ws_listener.py` | WebSocketイベントリスナー（JSONLにダンプ） |

### ws\_listener.pyの使用方法

```bash
# Start listener in background (append to existing events)
python scripts/ws_listener.py &

# Start listener with clear (new session, clears old events)
python scripts/ws_listener.py --clear &

# Custom output directory
python scripts/ws_listener.py --clear /path/to/events &

# Stop the listener
kill $(cat /tmp/videodb_ws_pid)
```

**オプション：**

* `--clear`：起動前にイベントファイルをクリアする。新しいキャプチャセッションを開始するときに使用する。

**出力ファイル：**

* `videodb_events.jsonl` - すべてのWebSocketイベント
* `videodb_ws_id` - WebSocket接続ID（`ws_connection_id` パラメータに使用）
* `videodb_ws_pid` - プロセスID（リスナーの停止に使用）

**機能：**

* 接続が切れた場合の指数バックオフによる自動再接続
* SIGINT/SIGTERMでのグレースフルシャットダウン
* プロセス管理のためのPIDファイル
* 接続状態のログ記録
