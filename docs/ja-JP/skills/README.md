# スキル

スキルは Claude Code が文脈に基づいて読み込む知識モジュールです。ワークフロー定義とドメイン知識を含みます。

## スキルカテゴリ

### 言語別パターン
- `python-patterns/` - Python 設計パターン
- `golang-patterns/` - Go 設計パターン
- `frontend-patterns/` - React/Next.js パターン
- `backend-patterns/` - API とデータベースパターン

### 言語別テスト
- `python-testing/` - Python テスト戦略
- `golang-testing/` - Go テスト戦略
- `cpp-testing/` - C++ テスト

### フレームワーク
- `django-patterns/` - Django ベストプラクティス
- `django-tdd/` - Django テスト駆動開発
- `django-security/` - Django セキュリティ
- `quarkus-patterns/` - Quarkus アーキテクチャ、Camel、CDI、Panache パターン
- `quarkus-security/` - Quarkus セキュリティ: JWT/OIDC、RBAC、バリデーション
- `quarkus-tdd/` - Quarkus テスト駆動開発
- `quarkus-verification/` - Quarkus 検証ループ
- `springboot-patterns/` - Spring Boot パターン
- `springboot-tdd/` - Spring Boot テスト
- `springboot-security/` - Spring Boot セキュリティ

### データベース
- `postgres-patterns/` - PostgreSQL パターン
- `jpa-patterns/` - JPA/Hibernate パターン

### セキュリティ
- `security-review/` - セキュリティチェックリスト
- `security-scan/` - セキュリティスキャン

### ワークフロー
- `tdd-workflow/` - テスト駆動開発ワークフロー
- `continuous-learning/` - 継続的学習

### ドメイン特定
- `eval-harness/` - 評価ハーネス
- `iterative-retrieval/` - 反復的検索

## スキル構造

各スキルは自分のディレクトリに SKILL.md ファイルを含みます：

```
skills/
├── python-patterns/
│   └── SKILL.md          # 実装パターン、例、ベストプラクティス
├── golang-testing/
│   └── SKILL.md
├── django-patterns/
│   └── SKILL.md
...
```

## スキルを使用します

Claude Code はコンテキストに基づいてスキルを自動的に読み込みます。例：

- Python ファイルを編集している場合 → `python-patterns` と `python-testing` が読み込まれる
- Django プロジェクトの場合 → `django-*` スキルが読み込まれる
- テスト駆動開発をしている場合 → `tdd-workflow` が読み込まれる

## スキルの作成

新しいスキルを作成するには：

1. `skills/your-skill-name/` ディレクトリを作成
2. `SKILL.md` ファイルを追加
3. テンプレート：

```markdown
---
name: your-skill-name
description: Brief description shown in skill list
---

# Your Skill Title

Brief overview.

## Core Concepts

Key patterns and guidelines.

## Code Examples

\`\`\`language
// Practical, tested examples
\`\`\`

## Best Practices

- Actionable guideline 1
- Actionable guideline 2

## When to Use

Describe scenarios where this skill applies.
```

---

**覚えておいてください**：スキルは参照資料です。実装ガイダンスを提供し、ベストプラクティスを示します。スキルとルールを一緒に使用して、高品質なコードを確認してください。
