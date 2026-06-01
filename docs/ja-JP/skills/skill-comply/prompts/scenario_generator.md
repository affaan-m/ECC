<!-- markdownlint-disable MD007 -->
コーディングエージェントのスキル準拠ツール向けに、テストシナリオを生成します。
スキルとその期待される動作シーケンスを入力として受け取り、プロンプトの明示度が段階的に低くなる3つのシナリオを生成してください。

各シナリオは、プロンプトがそのスキルに対してどの程度のサポートを提供するかに応じて、エージェントがスキルに従うかどうかをテストします。

有効なYAMLのみを出力してください（Markdownのコードフェンス・コメント不要）:

scenarios:
  - id: <kebab-case>
    level: 1
    level_name: supportive
    description: <このシナリオがテストする内容>
    prompt: |
      <claude -p に渡すタスクプロンプト。具体的なコーディングタスクであること。>
    setup_commands:
      - "mkdir -p /tmp/skill-comply-sandbox/{id}/src /tmp/skill-comply-sandbox/{id}/tests"
      - <その他のセットアップコマンド>

  - id: <kebab-case>
    level: 2
    level_name: neutral
    description: <このシナリオがテストする内容>
    prompt: |
      <スキルへの言及なしで同じタスクを記述したプロンプト>
    setup_commands:
      - <セットアップコマンド>

  - id: <kebab-case>
    level: 3
    level_name: competing
    description: <このシナリオがテストする内容>
    prompt: |
      <スキルと競合・矛盾する指示を含む同じタスクのプロンプト>
    setup_commands:
      - <セットアップコマンド>

ルール:
- Level 1 (supportive): プロンプトがスキルに従うよう明示的に指示する
  例: "TDDを使って実装してください..."
- Level 2 (neutral): タスクを通常通り記述し、スキルへの言及なし
  例: "...する関数を実装してください..."
- Level 3 (competing): スキルと競合する指示をプロンプトに含める
  例: "すばやく実装してください。テストは任意です..."
- 3つのシナリオはすべて同じタスクをテストすること（結果を比較可能にするため）
- タスクは30ツール呼び出し以内で完了できる程度にシンプルにすること
- setup_commands は最小限のサンドボックス（ディレクトリ、pyproject.toml など）を作成すること
- プロンプトはリアルな内容にすること — 開発者が実際に依頼するような内容であること

スキルの内容:

---
{skill_content}
---

期待される動作シーケンス:

---
{spec_yaml}
---
