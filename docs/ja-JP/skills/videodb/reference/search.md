# 検索とインデックスガイド

検索機能を使用すると、自然言語クエリ、正確なキーワード、またはビジュアルシーンの説明でビデオ内の特定のモーメントを見つけることができる。

## 前提条件

ビデオは検索の前に**インデックス化されている必要がある**。各インデックスタイプは各ビデオに対して1回だけ実行が必要。

## インデックス作成

### 音声単語インデックス

セマンティック検索とキーワード検索をサポートするためにビデオの転写音声コンテンツをインデックス化する：

```python
video = coll.get_video(video_id)

# force=True makes indexing idempotent — skips if already indexed
video.index_spoken_words(force=True)
```

この操作はオーディオトラックを転写し、音声コンテンツ上に検索可能なインデックスを構築する。セマンティック検索とキーワード検索に必要。

**パラメータ：**

| パラメータ | 型 | デフォルト | 説明 |
|-----------|------|---------|-------------|
| `language_code` | `str\|None` | `None` | ビデオの言語コード |
| `segmentation_type` | `SegmentationType` | `SegmentationType.sentence` | セグメンテーションタイプ（`sentence` または `llm`） |
| `force` | `bool` | `False` | `True` に設定すると既にインデックス化済みをスキップする（「既に存在」エラーを回避） |
| `callback_url` | `str\|None` | `None` | 非同期通知のWebhook URL |

### シーンインデックス

シーンのAI説明を生成することでビジュアルコンテンツをインデックス化する。音声単語インデックスと同様に、シーンインデックスが既に存在する場合はこの操作がエラーを発生させる。エラーメッセージから既存の `scene_index_id` を抽出する。

```python
import re
from videodb import SceneExtractionType

try:
    scene_index_id = video.index_scenes(
        extraction_type=SceneExtractionType.shot_based,
        prompt="Describe the visual content, objects, actions, and setting in this scene.",
    )
except Exception as e:
    match = re.search(r"id\s+([a-f0-9]+)", str(e))
    if match:
        scene_index_id = match.group(1)
    else:
        raise
```

**抽出タイプ：**

| タイプ | 説明 | 最適な用途 |
|------|-------------|----------|
| `SceneExtractionType.shot_based` | ビジュアルショット境界に基づいてセグメント化 | 汎用、アクションコンテンツ |
| `SceneExtractionType.time_based` | 固定間隔でセグメント化 | 均一なサンプリング、長い静的コンテンツ |
| `SceneExtractionType.transcript` | トランスクリプトセグメントに基づいてセグメント化 | 音声駆動のシーン境界 |

**`time_based` のパラメータ：**

```python
video.index_scenes(
    extraction_type=SceneExtractionType.time_based,
    extraction_config={"time": 5, "select_frames": ["first", "last"]},
    prompt="Describe what is happening in this scene.",
)
```

## 検索タイプ

### セマンティック検索

自然言語クエリを使用して音声コンテンツを照合する：

```python
from videodb import SearchType

results = video.search(
    query="explaining the benefits of machine learning",
    search_type=SearchType.semantic,
)
```

クエリとセマンティックに一致する音声コンテンツのランク付けされたクリップを返す。

### キーワード検索

転写された音声内で正確な用語照合を行う：

```python
results = video.search(
    query="artificial intelligence",
    search_type=SearchType.keyword,
)
```

正確なキーワードまたはフレーズを含むクリップを返す。

### シーン検索

ビジュアルコンテンツクエリをインデックス化されたシーンの説明と照合する。事前に `index_scenes()` の呼び出しが必要。

`index_scenes()` は `scene_index_id` を返す。`video.search()` に渡して特定のシーンインデックスを対象にする（ビデオに複数のシーンインデックスがある場合に特に重要）：

```python
from videodb import SearchType, IndexType
from videodb.exceptions import InvalidRequestError

# Search using semantic search against the scene index.
# Use score_threshold to filter low-relevance noise (recommended: 0.3+).
try:
    results = video.search(
        query="person writing on a whiteboard",
        search_type=SearchType.semantic,
        index_type=IndexType.scene,
        scene_index_id=scene_index_id,
        score_threshold=0.3,
    )
    shots = results.get_shots()
except InvalidRequestError as e:
    if "No results found" in str(e):
        shots = []
    else:
        raise
```

**重要な注意事項：**

* `SearchType.semantic` と `index_type=IndexType.scene` を組み合わせて使用する——これはすべてのプランで機能する最も信頼性の高い組み合わせ。
* `SearchType.scene` は存在するが、すべてのプラン（例：無料プラン）で利用可能ではない可能性がある。`IndexType.scene` と `SearchType.semantic` を使用することを推奨する。
* `scene_index_id` パラメータはオプション。省略すると、検索はビデオ上のすべてのシーンインデックスに対して実行される。特定のインデックスを対象にするためにこのパラメータを渡す。
* 各ビデオに対して複数のシーンインデックスを作成し（異なるプロンプトや抽出タイプを使用して）、`scene_index_id` を使用して独立して検索できる。

### メタデータフィルター付きシーン検索

カスタムメタデータでシーンをインデックス化する場合、セマンティック検索とメタデータフィルターを組み合わせて使用できる：

```python
from videodb import SearchType, IndexType

results = video.search(
    query="a skillful chasing scene",
    search_type=SearchType.semantic,
    index_type=IndexType.scene,
    scene_index_id=scene_index_id,
    filter=[{"camera_view": "road_ahead"}, {"action_type": "chasing"}],
)
```

カスタムメタデータインデックスとフィルター検索の完全な例については、[scene\_level\_metadata\_indexing 例](https://github.com/video-db/videodb-cookbook/blob/main/quickstart/scene_level_metadata_indexing.ipynb) を参照。

## 結果の処理

### クリップを取得する

個々の結果クリップにアクセスする：

```python
results = video.search("your query")

for shot in results.get_shots():
    print(f"Video: {shot.video_id}")
    print(f"Start: {shot.start:.2f}s")
    print(f"End: {shot.end:.2f}s")
    print(f"Text: {shot.text}")
    print("---")
```

### コンパイルされた結果を再生する

すべての一致するクリップを単一のコンパイルされたビデオとしてストリーミング再生する：

```python
results = video.search("your query")
stream_url = results.compile()
results.play()  # opens compiled stream in browser
```

### クリップを抽出する

特定の結果クリップをダウンロードまたはストリーミングする：

```python
for shot in results.get_shots():
    stream_url = shot.generate_stream()
    print(f"Clip: {stream_url}")
```

## コレクション横断検索

コレクション内のすべてのビデオを横断して検索する：

```python
coll = conn.get_collection()

# Search across all videos in the collection
results = coll.search(
    query="product demo",
    search_type=SearchType.semantic,
)

for shot in results.get_shots():
    print(f"Video: {shot.video_id} [{shot.start:.1f}s - {shot.end:.1f}s]")
```

> **注意：** コレクションレベルの検索は `SearchType.semantic` のみをサポートする。`SearchType.keyword` または `SearchType.scene` を `coll.search()` と組み合わせると `NotImplementedError` が発生する。キーワードやシーン検索には代わりに個々のビデオで `video.search()` を使用する。

## 検索 + コンパイル

一致するクリップをインデックス化、検索し、単一の再生可能なストリームにコンパイルする：

```python
video.index_spoken_words(force=True)
results = video.search(query="your query", search_type=SearchType.semantic)
stream_url = results.compile()
print(stream_url)
```

## ヒント

* **一度インデックス化、何度も検索**：インデックス作成は高コストな操作。一度インデックスが作成されれば、検索は速くなる。
* **インデックスタイプを組み合わせる**：音声単語とシーンの両方をインデックス化して、同じビデオですべての検索タイプを有効にする。
* **クエリの最適化**：セマンティック検索は単一のキーワードではなく説明的な自然言語フレーズで最もよく機能する。
* **精度向上のためにキーワード検索を使用**：正確な用語照合が必要なときは、キーワード検索でセマンティックドリフトを避けられる。
* **「結果なし」の処理**：一致するものがない場合、`video.search()` は `InvalidRequestError` を発生させる。常に検索呼び出しをtry/exceptで包み、`"No results found"` を空の結果セットとして扱うこと。
* **シーン検索ノイズのフィルタリング**：あいまいなクエリの場合、セマンティックシーン検索は低関連性の結果を返す可能性がある。ノイズをフィルタリングするために `score_threshold=0.3`（またはより高い値）を使用する。
* **べき等なインデックス作成**：`index_spoken_words(force=True)` を使用すると安全に再インデックス化できる。`index_scenes()` には `force` パラメータがない——try/exceptで包み、`re.search(r"id\s+([a-f0-9]+)", str(e))` を使用してエラーメッセージから既存の `scene_index_id` を抽出する。
