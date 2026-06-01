<!-- markdownlint-disable MD007 -->
コーディングエージェント（Claude Code）向けのスキル/ルールファイルを分析します。
タスク: そのスキルが有効なときにエージェントが従うべき**観察可能な動作シーケンス**を抽出してください。

各ステップは自然言語で記述してください。正規表現パターンは使用しないこと。

以下の正確なフォーマットで有効なYAMLのみを出力してください（Markdownのコードフェンス・コメント不要）:

id: <kebab-case-id>
name: <人間が読みやすい名前>
source_rule: <提供されたファイルパス>
version: "1.0"

steps:
  - id: <snake_case>
    description: <エージェントが行うべきこと>
    required: true|false
    detector:
      description: <探すべきツール呼び出しの自然言語による説明>
      after_step: <このステップの前に来るべきstep_id（任意 — 不要な場合は省略）>
      before_step: <このステップの後に来るべきstep_id（任意 — 不要な場合は省略）>

scoring:
  threshold_promote_to_hook: 0.6

ルール:
- detector.description はパターンではなく、ツール呼び出しの「意味」を説明すること
  良い例: "テストファイル（実装ファイルではない）への Write または Edit"
  悪い例: "Write|Edit で入力が test.*\\.py にマッチする"
- 順序が重要なスキル（例: TDD: テストを実装より先に行う）には before_step/after_step を使用すること
- 存在するかどうかのみが重要なスキルには順序制約を省略すること
- スキルに「任意で」または「該当する場合は」と記載がある場合のみ required: false とすること
- 理想は3〜7ステップ。過度に細分化しないこと
- 重要: コロンを含むYAML文字列値はすべてダブルクォートで囲むこと
  良い例: description: "Use conventional commit format (type: description)"
  悪い例: description: Use conventional commit format (type: description)

分析対象のスキルファイル:

---
{skill_content}
---
