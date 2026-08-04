# RTStreamガイド

## 概要

RTStreamはライブビデオストリーム（RTSP/RTMP）とデスクトップキャプチャセッションのリアルタイム取り込みをサポートする。接続後は、ライブフィードのコンテンツを録画、インデックス作成、検索、エクスポートできる。

コードレベルの詳細（SDKメソッド、パラメータ、例）については [rtstream-reference.md](rtstream-reference.md) を参照。

## ユースケース

* **セキュリティと監視**：RTSPカメラに接続し、イベントを検出し、アラートをトリガーする
* **ライブブロードキャスト**：RTMPストリームを取り込み、リアルタイムでインデックス化し、即時検索を実現する
* **会議録画**：デスクトップ画面とオーディオをキャプチャし、リアルタイムで転写し、録画をエクスポートする
* **イベント処理**：ライブビデオストリームを監視し、AI分析を実行し、検出されたコンテンツに応答する

## クイックスタート

1. **ライブストリームに接続する**（RTSP/RTMP URL）またはキャプチャセッションからRTStreamを取得する
2. **取り込みを開始する**ことでライブコンテンツの録画を始める
3. **AIパイプラインを起動する**ことでリアルタイムインデックス作成（オーディオ、ビジュアル、転写）を行う
4. **WebSocketでイベントを監視する**ことでリアルタイムAI結果とアラートを取得する
5. **完了したら取り込みを停止する**
6. **ビデオとしてエクスポートする**ことで永続ストレージとさらなる処理を行う
7. **録画を検索する**ことで特定のモーメントを見つける

## RTStreamソース

### RTSP/RTMPストリームから

ライブビデオフィードに直接接続する：

```python
rtstream = coll.connect_rtstream(
    url="rtmp://your-stream-server/live/stream-key",
    name="My Live Stream",
)
```

### キャプチャセッションから

デスクトップキャプチャ（マイク、画面、システムオーディオ）からRTStreamを取得する：

```python
session = conn.get_capture_session(session_id)

mics = session.get_rtstream("mic")
displays = session.get_rtstream("screen")
system_audios = session.get_rtstream("system_audio")
```

キャプチャセッションのワークフローについては [capture.md](capture.md) を参照。

***

## スクリプト

| スクリプト | 説明 |
|--------|-------------|
| `scripts/ws_listener.py` | リアルタイムAI結果のためのWebSocketイベントリスナー |
