---
description: PEP 8準拠、型ヒント、セキュリティ、Pythonic慣用句についての包括的なPythonコードレビュー。python-reviewerエージェントを呼び出します。
---

# Python Code Review

このコマンドは、Python固有の包括的なコードレビューのために**python-reviewer**エージェントを呼び出します。

## このコマンドの機能

1. **Python変更の特定**: `git diff`で変更された`.py`ファイルを検出
2. **静的解析の実行**: `ruff`、`mypy`、`pylint`、`black --check`を実行
3. **セキュリティスキャン**: SQLインジェクション、コマンドインジェクション、安全でないデシリアライゼーションをチェック
4. **型安全性のレビュー**: 型ヒントとmypyエラーを分析
5. **Pythonicコードチェック**: コードがPEP 8とPythonベストプラクティスに従っていることを確認
6. **レポート生成**: 問題を重要度別に分類

## 使用するタイミング

以下の場合に`/python-review`を使用します:
- Pythonコードを作成または変更した後
- Python変更をコミットする前
- Pythonコードを含むプルリクエストのレビュー時
- 新しいPythonコードベースへのオンボーディング時
- Pythonicパターンと慣用句の学習時

## レビューカテゴリ

### CRITICAL(必須修正)
- SQL/コマンドインジェクションの脆弱性
- 安全でないeval/execの使用
- Pickleの安全でないデシリアライゼーション
- ハードコードされた資格情報
- YAMLの安全でないロード
- エラーを隠す素のexcept句

### HIGH(修正推奨)
- 公開関数での型ヒントの欠落
- 可変デフォルト引数
- 例外を静かに飲み込む
- リソースにコンテキストマネージャーを使用していない
- 内包表記の代わりにCスタイルループ
- isinstance()の代わりにtype()を使用
- ロックなしの競合状態

### MEDIUM(検討)
- PEP 8フォーマット違反
- 公開関数でのdocstringの欠落
- loggingの代わりにprint文
- 非効率的な文字列操作
- 名前付き定数のないマジックナンバー
- フォーマットにf-stringsを使用していない
- 不要なリスト作成

## 実行される自動チェック

```bash
# 型チェック
mypy .

# リンティングとフォーマット
ruff check .
black --check .
isort --check-only .

# セキュリティスキャン
bandit -r .

# 依存関係監査
pip-audit
safety check

# テスト
pytest --cov=app --cov-report=term-missing
```

## 使用例

```text
User: /python-review

Agent:
# Pythonコードレビューレポート

## レビューされたファイル
- app/routes/user.py (変更)
- app/services/auth.py (変更)

## 静的解析結果
✓ ruff: 問題なし
✓ mypy: エラーなし
WARNING: black: 2ファイルが再フォーマット必要
✓ bandit: セキュリティ問題なし

## 発見された問題

[CRITICAL] SQLインジェクション脆弱性
ファイル: app/routes/user.py:42
問題: ユーザー入力が直接SQLクエリに挿入されている
```python
query = f"SELECT * FROM users WHERE id = {user_id}"  # 悪い
```
修正: パラメータ化クエリを使用
```python
query = "SELECT * FROM users WHERE id = %s"  # 良い
cursor.execute(query, (user_id,))
```

[HIGH] 可変デフォルト引数
ファイル: app/services/auth.py:18
問題: 可変デフォルト引数が共有状態を引き起こす
```python
def process_items(items=[]):  # 悪い
    items.append("new")
    return items
```
修正: デフォルトにNoneを使用
```python
def process_items(items=None):  # 良い
    if items is None:
        items = []
    items.append("new")
    return items
```

[MEDIUM] 型ヒントの欠落
ファイル: app/services/auth.py:25
問題: 型アノテーションのない公開関数
```python
def get_user(user_id):  # 悪い
    return db.find(user_id)
```
修正: 型ヒントを追加
```python
def get_user(user_id: str) -> Optional[User]:  # 良い
    return db.find(user_id)
```

[MEDIUM] コンテキストマネージャーを使用していない
ファイル: app/routes/user.py:55
問題: 例外時にファイルがクローズされない
```python
f = open("config.json")  # 悪い
data = f.read()
f.close()
```
修正: コンテキストマネージャーを使用
```python
with open("config.json") as f:  # 良い
    data = f.read()
```

## サマリー
- CRITICAL: 1
- HIGH: 1
- MEDIUM: 2

推奨: FAIL: CRITICAL問題が修正されるまでマージをブロック

## フォーマット必要
実行: `black app/routes/user.py app/services/auth.py`
```

## 承認基準

| ステータス | 条件 |
|--------|-----------|
| PASS: 承認 | CRITICALまたはHIGH問題なし |
| WARNING: 警告 | MEDIUM問題のみ(注意してマージ) |
| FAIL: ブロック | CRITICALまたはHIGH問題が発見された |

## 他のコマンドとの統合

- まず`/python-test`を使用してテストが合格することを確認
- `/code-review`をPython固有でない問題に使用
- `/python-review`をコミット前に使用
- `/build-fix`を静的解析ツールが失敗した場合に使用

## フレームワーク固有のレビュー

### Djangoプロジェクト
レビューアは以下をチェックします:
- N+1クエリ問題(`select_related`と`prefetch_related`を使用)
- モデル変更のマイグレーション欠落
- ORMで可能な場合の生SQLの使用
- 複数ステップ操作での`transaction.atomic()`の欠落

### FastAPIプロジェクト
レビューアは以下をチェックします:
- CORSの誤設定
- リクエスト検証のためのPydanticモデル
- レスポンスモデルの正確性
- 適切なasync/awaitの使用
- 依存性注入パターン

### Flaskプロジェクト
レビューアは以下をチェックします:
- コンテキスト管理(appコンテキスト、requestコンテキスト)
- 適切なエラーハンドリング
- Blueprintの構成
- 設定管理

## 関連

- Agent: `agents/python-reviewer.md`
- Skills: `skills/python-patterns/`, `skills/python-testing/`

## 一般的な修正

### 型ヒントの追加
```python
# 変更前
def calculate(x, y):
    return x + y

# 変更後
from typing import Union

def calculate(x: Union[int, float], y: Union[int, float]) -> Union[int, float]:
    return x + y
```

### コンテキストマネージャーの使用
```python
# 変更前
f = open("file.txt")
data = f.read()
f.close()

# 変更後
with open("file.txt") as f:
    data = f.read()
```

### リスト内包表記の使用
```python
# 変更前
result = []
for item in items:
    if item.active:
        result.append(item.name)

# 変更後
result = [item.name for item in items if item.active]
```

### 可変デフォルトの修正
```python
# 変更前
def append(value, items=[]):
    items.append(value)
    return items

# 変更後
def append(value, items=None):
    if items is None:
        items = []
    items.append(value)
    return items
```

### f-stringsの使用(Python 3.6+)
```python
# 変更前
name = "Alice"
greeting = "Hello, " + name + "!"
greeting2 = "Hello, {}".format(name)

# 変更後
greeting = f"Hello, {name}!"
```

### ループ内の文字列連結の修正
```python
# 変更前
result = ""
for item in items:
    result += str(item)

# 変更後
result = "".join(str(item) for item in items)
```

## Pythonバージョン互換性

レビューアは、コードが新しいPythonバージョンの機能を使用する場合に通知します:

| 機能 | 最小Python |
|---------|----------------|
| 型ヒント | 3.5+ |
| f-strings | 3.6+ |
| セイウチ演算子(`:=`) | 3.8+ |
| 位置専用パラメータ | 3.8+ |
| Match文 | 3.10+ |
| 型ユニオン(&#96;x &#124; None&#96;) | 3.10+ |

プロジェクトの`pyproject.toml`または`setup.py`が正しい最小Pythonバージョンを指定していることを確認してください。
