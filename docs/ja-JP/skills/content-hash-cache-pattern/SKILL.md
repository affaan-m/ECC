---
name: content-hash-cache-pattern
description: SHA-256コンテンツハッシュを使用して、高コストなファイル処理結果をキャッシュします — パス非依存、自動無効化、サービスレイヤーの分離。
origin: ECC
---

# コンテンツハッシュファイルキャッシュパターン

SHA-256コンテンツハッシュをキャッシュキーとして使用して、高コストなファイル処理結果（PDF解析、テキスト抽出、画像分析）をキャッシュします。パスベースのキャッシュとは異なり、このアプローチはファイルの移動/名前変更に対して生き残り、コンテンツが変更されたときに自動的に無効化されます。

## 起動条件

- ファイル処理パイプラインの構築（PDF、画像、テキスト抽出）
- 処理コストが高く、同じファイルが繰り返し処理される場合
- `--cache/--no-cache`CLIオプションが必要な場合
- 既存の純粋な関数を変更せずにキャッシュを追加したい場合

## コアパターン

### 1. コンテンツハッシュベースのキャッシュキー

パスではなくファイルコンテンツをキャッシュキーとして使用します：

```python
import hashlib
from pathlib import Path

_HASH_CHUNK_SIZE = 65536  # 大きなファイルには64KBチャンク

def compute_file_hash(path: Path) -> str:
    """ファイルコンテンツのSHA-256（大きなファイルにはチャンク処理）。"""
    if not path.is_file():
        raise FileNotFoundError(f"File not found: {path}")
    sha256 = hashlib.sha256()
    with open(path, "rb") as f:
        while True:
            chunk = f.read(_HASH_CHUNK_SIZE)
            if not chunk:
                break
            sha256.update(chunk)
    return sha256.hexdigest()
```

**なぜコンテンツハッシュ？** ファイルの名前変更/移動 = キャッシュヒット。コンテンツ変更 = 自動無効化。インデックスファイル不要。

### 2. キャッシュエントリの凍結データクラス

```python
from dataclasses import dataclass

@dataclass(frozen=True, slots=True)
class CacheEntry:
    file_hash: str
    source_path: str
    document: ExtractedDocument  # キャッシュされた結果
```

### 3. ファイルベースのキャッシュストレージ

各キャッシュエントリは`{hash}.json`として保存されます — ハッシュによるO(1)検索、インデックスファイル不要。

```python
import json
from typing import Any

def write_cache(cache_dir: Path, entry: CacheEntry) -> None:
    cache_dir.mkdir(parents=True, exist_ok=True)
    cache_file = cache_dir / f"{entry.file_hash}.json"
    data = serialize_entry(entry)
    cache_file.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")

def read_cache(cache_dir: Path, file_hash: str) -> CacheEntry | None:
    cache_file = cache_dir / f"{file_hash}.json"
    if not cache_file.is_file():
        return None
    try:
        raw = cache_file.read_text(encoding="utf-8")
        data = json.loads(raw)
        return deserialize_entry(data)
    except (json.JSONDecodeError, ValueError, KeyError):
        return None  # 破損をキャッシュミスとして扱う
```

### 4. サービスレイヤーラッパー（SRP）

処理関数を純粋に保ちます。キャッシュを別のサービスレイヤーとして追加します。

```python
def extract_with_cache(
    file_path: Path,
    *,
    cache_enabled: bool = True,
    cache_dir: Path = Path(".cache"),
) -> ExtractedDocument:
    """サービスレイヤー: キャッシュチェック -> 抽出 -> キャッシュ書き込み。"""
    if not cache_enabled:
        return extract_text(file_path)  # 純粋な関数、キャッシュの知識なし

    file_hash = compute_file_hash(file_path)

    # キャッシュを確認
    cached = read_cache(cache_dir, file_hash)
    if cached is not None:
        logger.info("Cache hit: %s (hash=%s)", file_path.name, file_hash[:12])
        return cached.document

    # キャッシュミス -> 抽出 -> 保存
    logger.info("Cache miss: %s (hash=%s)", file_path.name, file_hash[:12])
    doc = extract_text(file_path)
    entry = CacheEntry(file_hash=file_hash, source_path=str(file_path), document=doc)
    write_cache(cache_dir, entry)
    return doc
```

## 主要な設計上の決定

| 決定 | 根拠 |
|----------|-----------|
| SHA-256コンテンツハッシュ | パス非依存、コンテンツ変更で自動無効化 |
| `{hash}.json`ファイル命名 | O(1)検索、インデックスファイル不要 |
| サービスレイヤーラッパー | SRP: 抽出は純粋に保ち、キャッシュは別の関心事 |
| 手動JSONシリアル化 | 凍結データクラスのシリアル化を完全制御 |
| 破損は`None`を返す | グレースフルデグラデーション、次回の実行で再処理 |
| `cache_dir.mkdir(parents=True)` | 最初の書き込み時に遅延ディレクトリ作成 |

## ベストプラクティス

- **パスではなくコンテンツをハッシュ** — パスは変わるが、コンテンツのアイデンティティは変わらない
- **大きなファイルはチャンク処理でハッシュ** — ファイル全体をメモリに読み込まないようにする
- **処理関数を純粋に保つ** — キャッシュについて何も知らないようにする
- **切り捨てたハッシュでキャッシュヒット/ミスをログ記録** — デバッグのため
- **破損をグレースフルに処理** — 無効なキャッシュエントリはミスとして扱い、クラッシュしない

## 避けるべきアンチパターン

```python
# 悪い例: パスベースのキャッシュ（ファイルの移動/名前変更で壊れる）
cache = {"/path/to/file.pdf": result}

# 悪い例: 処理関数内にキャッシュロジックを追加（SRP違反）
def extract_text(path, *, cache_enabled=False, cache_dir=None):
    if cache_enabled:  # この関数は今や2つの責任を持っている
        ...

# 悪い例: ネストされた凍結データクラスでdataclasses.asdict()を使用
# （複雑なネストされた型で問題を引き起こす可能性がある）
data = dataclasses.asdict(entry)  # 代わりに手動シリアル化を使用
```

## 使用すべき場合

- ファイル処理パイプライン（PDF解析、OCR、テキスト抽出、画像分析）
- `--cache/--no-cache`オプションが有益なCLIツール
- 同じファイルが複数回にわたって現れるバッチ処理
- 既存の純粋な関数を変更せずにキャッシュを追加する場合

## 使用すべきでない場合

- 常に最新でなければならないデータ（リアルタイムフィード）
- 非常に大きなキャッシュエントリ（代わりにストリーミングを検討）
- ファイルコンテンツ以外のパラメータに依存する結果（例：異なる抽出設定）
