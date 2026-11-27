---
name: agent-eval
description: カスタムタスクでコーディングエージェント（Claude Code、Aider、Codex など）をヘッドツーヘッドで比較し、合格率、コスト、時間、一貫性のメトリクスを測定します
origin: ECC
tools: Read, Write, Edit, Bash, Grep, Glob
---

# エージェント評価スキル

再現可能なタスクでコーディングエージェントをヘッドツーヘッドで比較するための軽量 CLI ツールです。「どのコーディングエージェントが最適か？」という比較はすべて感覚に頼りがちです — このツールはそれを体系化します。

## 起動タイミング

- 自分のコードベースでコーディングエージェント（Claude Code、Aider、Codex など）を比較する
- 新しいツールやモデルを採用する前にエージェントパフォーマンスを測定する
- エージェントがモデルやツールを更新した際にリグレッションチェックを実行する
- チームにデータに基づいたエージェント選択の判断を提供する

## インストール

> **注意:** agent-eval はソースを確認した後、リポジトリからインストールしてください。

## コアコンセプト

### YAML タスク定義

タスクを宣言的に定義します。各タスクは何をするか、どのファイルを操作するか、成功をどう判定するかを指定します：

```yaml
name: add-retry-logic
description: Add exponential backoff retry to the HTTP client
repo: ./my-project
files:
  - src/http_client.py
prompt: |
  Add retry logic with exponential backoff to all HTTP requests.
  Max 3 retries. Initial delay 1s, max delay 30s.
judge:
  - type: pytest
    command: pytest tests/test_http_client.py -v
  - type: grep
    pattern: "exponential_backoff|retry"
    files: src/http_client.py
commit: "abc1234"  # 再現性のために特定コミットに固定
```

### Git ワークツリー分離

各エージェント実行は独自の git ワークツリーを取得します — Docker 不要。これにより再現性の分離が提供され、エージェントが互いに干渉したりベースリポジトリを破壊したりしません。

### 収集メトリクス

| メトリクス | 測定内容 |
|--------|-----------------|
| 合格率 | エージェントはジャッジをパスするコードを生成できたか？ |
| コスト | タスクあたりの API 費用（利用可能な場合） |
| 時間 | 完了までのウォールクロック秒数 |
| 一貫性 | 繰り返し実行での合格率（例：3/3 = 100%） |

## ワークフロー

### 1. タスクの定義

タスクごとに 1 つの YAML ファイルを持つ `tasks/` ディレクトリを作成します：

```bash
mkdir tasks
# タスク定義を作成（上記のテンプレートを参照）
```

### 2. エージェントの実行

タスクに対してエージェントを実行します：

```bash
agent-eval run --task tasks/add-retry-logic.yaml --agent claude-code --agent aider --runs 3
```

各実行：
1. 指定されたコミットから新しい git ワークツリーを作成
2. エージェントにプロンプトを渡す
3. ジャッジ基準を実行
4. 合格・不合格、コスト、時間を記録

### 3. 結果の比較

比較レポートを生成します：

```bash
agent-eval report --format table
```

```
Task: add-retry-logic (3 runs each)
┌──────────────┬───────────┬────────┬────────┬─────────────┐
│ Agent        │ Pass Rate │ Cost   │ Time   │ Consistency │
├──────────────┼───────────┼────────┼────────┼─────────────┤
│ claude-code  │ 3/3       │ $0.12  │ 45s    │ 100%        │
│ aider        │ 2/3       │ $0.08  │ 38s    │  67%        │
└──────────────┴───────────┴────────┴────────┴─────────────┘
```

## ジャッジタイプ

### コードベース（決定論的）

```yaml
judge:
  - type: pytest
    command: pytest tests/ -v
  - type: command
    command: npm run build
```

### パターンベース

```yaml
judge:
  - type: grep
    pattern: "class.*Retry"
    files: src/**/*.py
```

### モデルベース（LLM-as-judge）

```yaml
judge:
  - type: llm
    prompt: |
      Does this implementation correctly handle exponential backoff?
      Check for: max retries, increasing delays, jitter.
```

## ベストプラクティス

- **3〜5 タスクから始める** — おもちゃの例ではなく、実際のワークロードを代表するタスク
- **エージェントごとに少なくとも 3 試行実行する** — エージェントは非決定論的なので分散を把握する
- **タスク YAML でコミットを固定する** — 日や週をまたいで結果が再現可能になる
- **タスクごとに少なくとも 1 つの決定論的ジャッジを含める**（テスト、ビルド）— LLM ジャッジはノイズを加える
- **合格率と一緒にコストを追跡する** — 10 倍のコストで 95% のエージェントが正しい選択でない場合もある
- **タスク定義をバージョン管理する** — それらはテストフィクスチャであり、コードとして扱う

## リンク

- リポジトリ: [github.com/joaquinhuigomez/agent-eval](https://github.com/joaquinhuigomez/agent-eval)
