---
name: regex-vs-llm-structured-text
description: 構造化テキストの解析に正規表現と大規模言語モデルのどちらを使うかを選択するための意思決定フレームワーク——まず正規表達式から始め、信頼度の低いエッジケースにのみ大規模言語モデルを追加する。
origin: ECC
---

# 構造化テキスト解析における正規表現 vs LLM

構造化テキスト（クイズ、フォーム、請求書、ドキュメント）を解析するための実用的な意思決定フレームワーク。核心的な洞察：正規表現は低コストかつ決定論的に95〜98%のケースを処理できる。コストのかかるLLM呼び出しは残りのエッジケースに留める。

## 使用場面

* 繰り返しパターンを持つ構造化テキスト（設問、フォーム、表）の解析
* テキスト抽出に正規表現とLLMのどちらを使うかの判断
* 両方のアプローチを組み合わせたハイブリッドパイプラインの構築
* テキスト処理におけるコスト/精度のトレードオフの最適化

## 意思決定フレームワーク

```
テキスト形式は一貫していて繰り返しがあるか？
├── はい (>90% が何らかのパターンに従う) → 正規表現から始める
│   ├── 正規表現が 95%+ を処理 → 完了、LLM は不要
│   └── 正規表現が <95% を処理 → エッジケースのみ LLM を追加
└── いいえ (自由形式、高度に可変) → LLM を直接使用
```

## アーキテクチャパターン

```
[正規表現パーサー] ─── 構造を抽出（95〜98% の精度）
    │
    ▼
[テキストクリーナー] ─── ノイズを除去（マーカー、ページ番号、アーティファクト）
    │
    ▼
[信頼度スコアラー] ─── 信頼度の低い抽出結果にフラグを立てる
    │
    ├── 高信頼度（≥0.95）→ 直接出力
    │
    └── 低信頼度（<0.95）→ [LLM バリデーター] → 出力
```

## 実装

### 1. 正規表現パーサー（大半のケースを処理）

```python
import re
from dataclasses import dataclass

@dataclass(frozen=True)
class ParsedItem:
    id: str
    text: str
    choices: tuple[str, ...]
    answer: str
    confidence: float = 1.0

def parse_structured_text(content: str) -> list[ParsedItem]:
    """Parse structured text using regex patterns."""
    pattern = re.compile(
        r"(?P<id>\d+)\.\s*(?P<text>.+?)\n"
        r"(?P<choices>(?:[A-D]\..+?\n)+)"
        r"Answer:\s*(?P<answer>[A-D])",
        re.MULTILINE | re.DOTALL,
    )
    items = []
    for match in pattern.finditer(content):
        choices = tuple(
            c.strip() for c in re.findall(r"[A-D]\.\s*(.+)", match.group("choices"))
        )
        items.append(ParsedItem(
            id=match.group("id"),
            text=match.group("text").strip(),
            choices=choices,
            answer=match.group("answer"),
        ))
    return items
```

### 2. 信頼度スコアリング

LLMによるレビューが必要かもしれない項目にフラグを立てる：

```python
@dataclass(frozen=True)
class ConfidenceFlag:
    item_id: str
    score: float
    reasons: tuple[str, ...]

def score_confidence(item: ParsedItem) -> ConfidenceFlag:
    """Score extraction confidence and flag issues."""
    reasons = []
    score = 1.0

    if len(item.choices) < 3:
        reasons.append("few_choices")
        score -= 0.3

    if not item.answer:
        reasons.append("missing_answer")
        score -= 0.5

    if len(item.text) < 10:
        reasons.append("short_text")
        score -= 0.2

    return ConfidenceFlag(
        item_id=item.id,
        score=max(0.0, score),
        reasons=tuple(reasons),
    )

def identify_low_confidence(
    items: list[ParsedItem],
    threshold: float = 0.95,
) -> list[ConfidenceFlag]:
    """Return items below confidence threshold."""
    flags = [score_confidence(item) for item in items]
    return [f for f in flags if f.score < threshold]
```

### 3. LLM バリデーター（エッジケースのみ）

```python
def validate_with_llm(
    item: ParsedItem,
    original_text: str,
    client,
) -> ParsedItem:
    """Use LLM to fix low-confidence extractions."""
    response = client.messages.create(
        model="claude-haiku-4-5-20251001",  # Cheapest model for validation
        max_tokens=500,
        messages=[{
            "role": "user",
            "content": (
                f"Extract the question, choices, and answer from this text.\n\n"
                f"Text: {original_text}\n\n"
                f"Current extraction: {item}\n\n"
                f"Return corrected JSON if needed, or 'CORRECT' if accurate."
            ),
        }],
    )
    # Parse LLM response and return corrected item...
    return corrected_item
```

### 4. ハイブリッドパイプライン

```python
def process_document(
    content: str,
    *,
    llm_client=None,
    confidence_threshold: float = 0.95,
) -> list[ParsedItem]:
    """Full pipeline: regex -> confidence check -> LLM for edge cases."""
    # Step 1: Regex extraction (handles 95-98%)
    items = parse_structured_text(content)

    # Step 2: Confidence scoring
    low_confidence = identify_low_confidence(items, confidence_threshold)

    if not low_confidence or llm_client is None:
        return items

    # Step 3: LLM validation (only for flagged items)
    low_conf_ids = {f.item_id for f in low_confidence}
    result = []
    for item in items:
        if item.id in low_conf_ids:
            result.append(validate_with_llm(item, content, llm_client))
        else:
            result.append(item)

    return result
```

## 実際のメトリクス

本番のクイズ解析パイプライン（410項目）より：

| メトリクス | 値 |
|--------|-------|
| 正規表現の成功率 | 98.0% |
| 低信頼度項目 | 8 (2.0%) |
| 必要なLLM呼び出し回数 | ~5 |
| 全件LLM比のコスト節約 | ~95% |
| テストカバレッジ | 93% |

## ベストプラクティス

* **正規表現から始める** — 不完全な正規表現でも改善のベースラインになる
* **信頼度スコアリングを使用**して、LLMの助けが必要なものをプログラムで特定する
* **最も安価なLLMを使用**して検証する（Haikuクラスのモデルで十分）
* **解析済み項目を変更しない** — クリーニング/検証ステップから新しいインスタンスを返す
* **TDDは解析器に効果的** — まず既知のパターンのテストを書き、次にエッジケースを書く
* **メトリクスを記録**（正規表現の成功率、LLM呼び出し回数）してパイプラインの健全性を追跡する

## 避けるべきアンチパターン

* 正規表現が95%以上を処理できる場合に全テキストをLLMに送る（コスト高・低速）
* 自由形式で高度に可変なテキストに正規表現を使用する（LLMの方が適切）
* 信頼度スコアリングをスキップして正規表現が「うまくいく」ことを期待する
* クリーニング/検証ステップで解析済みオブジェクトを変更する
* エッジケースをテストしない（不正な入力、欠損フィールド、エンコーディング問題）

## 適用場面

* クイズ/試験問題の解析
* フォームデータの抽出
* 請求書/レシートの処理
* ドキュメント構造の解析（見出し、セクション、表）
* 繰り返しパターンがあり、コストが重要なあらゆる構造化テキスト
