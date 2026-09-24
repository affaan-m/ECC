---
name: cost-aware-llm-pipeline
description: LLM APIの使用量のコスト最適化パターン — タスクの複雑さによるモデルルーティング、予算追跡、リトライロジック、プロンプトキャッシング。
origin: ECC
---

# コスト認識LLMパイプライン

品質を維持しながらLLM APIのコストをコントロールするためのパターン。モデルルーティング、予算追跡、リトライロジック、プロンプトキャッシングを組み合わせた合成可能なパイプライン。

## 起動条件

- LLM APIを呼び出すアプリケーションの構築（Claude、GPTなど）
- 複雑さが異なるアイテムのバッチ処理
- API支出の予算内に収める必要がある場合
- 複雑なタスクの品質を犠牲にせずにコストを最適化する場合

## コアコンセプト

### 1. タスクの複雑さによるモデルルーティング

シンプルなタスクには自動的に安価なモデルを選択し、複雑なタスクのために高価なモデルを予約します。

```python
MODEL_SONNET = "claude-sonnet-4-6"
MODEL_HAIKU = "claude-haiku-4-5-20251001"

_SONNET_TEXT_THRESHOLD = 10_000  # 文字数
_SONNET_ITEM_THRESHOLD = 30     # アイテム数

def select_model(
    text_length: int,
    item_count: int,
    force_model: str | None = None,
) -> str:
    """タスクの複雑さに基づいてモデルを選択。"""
    if force_model is not None:
        return force_model
    if text_length >= _SONNET_TEXT_THRESHOLD or item_count >= _SONNET_ITEM_THRESHOLD:
        return MODEL_SONNET  # 複雑なタスク
    return MODEL_HAIKU  # シンプルなタスク（3〜4倍安価）
```

### 2. 不変のコスト追跡

凍結データクラスで累積支出を追跡します。各API呼び出しは新しいトラッカーを返します — 状態を変更しません。

```python
from dataclasses import dataclass

@dataclass(frozen=True, slots=True)
class CostRecord:
    model: str
    input_tokens: int
    output_tokens: int
    cost_usd: float

@dataclass(frozen=True, slots=True)
class CostTracker:
    budget_limit: float = 1.00
    records: tuple[CostRecord, ...] = ()

    def add(self, record: CostRecord) -> "CostTracker":
        """追加されたレコードで新しいトラッカーを返す（selfは変更しない）。"""
        return CostTracker(
            budget_limit=self.budget_limit,
            records=(*self.records, record),
        )

    @property
    def total_cost(self) -> float:
        return sum(r.cost_usd for r in self.records)

    @property
    def over_budget(self) -> bool:
        return self.total_cost > self.budget_limit
```

### 3. 狭いリトライロジック

一時的なエラーのみリトライします。認証やリクエストエラーでは素早く失敗します。

```python
from anthropic import (
    APIConnectionError,
    InternalServerError,
    RateLimitError,
)

_RETRYABLE_ERRORS = (APIConnectionError, RateLimitError, InternalServerError)
_MAX_RETRIES = 3

def call_with_retry(func, *, max_retries: int = _MAX_RETRIES):
    """一時的なエラーのみリトライし、それ以外はすぐに失敗する。"""
    for attempt in range(max_retries):
        try:
            return func()
        except _RETRYABLE_ERRORS:
            if attempt == max_retries - 1:
                raise
            time.sleep(2 ** attempt)  # 指数バックオフ
    # AuthenticationError、BadRequestErrorなど → 即座に例外発生
```

### 4. プロンプトキャッシング

長いシステムプロンプトをキャッシュして、リクエストごとに再送信しないようにします。

```python
messages = [
    {
        "role": "user",
        "content": [
            {
                "type": "text",
                "text": system_prompt,
                "cache_control": {"type": "ephemeral"},  # これをキャッシュ
            },
            {
                "type": "text",
                "text": user_input,  # 可変部分
            },
        ],
    }
]
```

## 合成

4つのテクニックすべてを単一のパイプライン関数に組み合わせます：

```python
def process(text: str, config: Config, tracker: CostTracker) -> tuple[Result, CostTracker]:
    # 1. モデルをルーティング
    model = select_model(len(text), estimated_items, config.force_model)

    # 2. 予算を確認
    if tracker.over_budget:
        raise BudgetExceededError(tracker.total_cost, tracker.budget_limit)

    # 3. リトライ + キャッシングで呼び出し
    response = call_with_retry(lambda: client.messages.create(
        model=model,
        messages=build_cached_messages(system_prompt, text),
    ))

    # 4. コストを追跡（不変）
    record = CostRecord(model=model, input_tokens=..., output_tokens=..., cost_usd=...)
    tracker = tracker.add(record)

    return parse_result(response), tracker
```

## 価格リファレンス（2025〜2026年）

| モデル | 入力（$/1Mトークン） | 出力（$/1Mトークン） | 相対コスト |
|-------|---------------------|----------------------|---------------|
| Haiku 4.5 | $0.80 | $4.00 | 1x |
| Sonnet 4.6 | $3.00 | $15.00 | 約4x |
| Opus 4.5 | $15.00 | $75.00 | 約19x |

## ベストプラクティス

- **最も安価なモデルから始める**、複雑さの閾値が満たされた場合にのみ高価なモデルにルーティングする
- **バッチ処理の前に明示的な予算制限を設定する** — 過剰支出より早期に失敗する
- **モデル選択の決定をログに記録する**、実際のデータに基づいて閾値を調整できるように
- **1024トークンを超えるシステムプロンプトにはプロンプトキャッシングを使用する** — コストとレイテンシーの両方を節約
- **認証またはバリデーションエラーではリトライしない** — 一時的な失敗のみ（ネットワーク、レート制限、サーバーエラー）

## 避けるべきアンチパターン

- 複雑さに関わらずすべてのリクエストに最も高価なモデルを使用すること
- すべてのエラーでリトライすること（永続的な失敗で予算を無駄にする）
- コスト追跡の状態を変更すること（デバッグと監査が困難になる）
- コードベース全体にモデル名をハードコードすること（定数または設定を使用する）
- 繰り返しのシステムプロンプトでプロンプトキャッシングを無視すること

## 使用すべき場合

- Claude、OpenAI、または同様のLLM APIを呼び出すすべてのアプリケーション
- コストが積み上がるバッチ処理パイプライン
- インテリジェントルーティングが必要なマルチモデルアーキテクチャ
- 予算ガードレールが必要な本番システム
