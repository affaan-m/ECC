---
name: instinct-export
description: チームメイトや他のプロジェクトと共有するためにインスティンクトをエクスポート
command: /instinct-export
---

# インスティンクトエクスポートコマンド

インスティンクトを共有可能な形式でエクスポートします。以下の用途に最適です:
- チームメイトとの共有
- 新しいマシンへの転送
- プロジェクト規約への貢献

## 使用方法

```
/instinct-export                           # すべての個人インスティンクトをエクスポート
/instinct-export --domain testing          # テスト関連のインスティンクトのみをエクスポート
/instinct-export --min-confidence 0.7      # 高信頼度のインスティンクトのみをエクスポート
/instinct-export --output team-instincts.yaml
```

## 実行内容

1. `~/.claude/homunculus/instincts/personal/` からインスティンクトを読み込む
2. フラグに基づいてフィルタリング
3. 機密情報を除外:
   - セッションIDを削除
   - ファイルパスを削除（パターンのみ保持）
   - 「先週」より古いタイムスタンプを削除
4. エクスポートファイルを生成

## 出力形式

YAMLファイルを作成します:

```yaml
# Instincts Export
# Generated: 2025-01-22
# Source: personal
# Count: 12 instincts

version: "2.0"
exported_by: "continuous-learning-v2"
export_date: "2025-01-22T10:30:00Z"

instincts:
  - id: prefer-functional-style
    trigger: "when writing new functions"
    action: "Use functional patterns over classes"
    confidence: 0.8
    domain: code-style
    observations: 8

  - id: test-first-workflow
    trigger: "when adding new functionality"
    action: "Write test first, then implementation"
    confidence: 0.9
    domain: testing
    observations: 12

  - id: grep-before-edit
    trigger: "when modifying code"
    action: "Search with Grep, confirm with Read, then Edit"
    confidence: 0.7
    domain: workflow
    observations: 6
```

## プライバシーに関する考慮事項

エクスポートに含まれる内容:
- PASS: トリガーパターン
- PASS: アクション
- PASS: 信頼度スコア
- PASS: ドメイン
- PASS: 観察回数

エクスポートに含まれない内容:
- FAIL: 実際のコードスニペット
- FAIL: ファイルパス
- FAIL: セッション記録
- FAIL: 個人識別情報

## フラグ

- `--domain <name>`: 指定されたドメインのみをエクスポート
- `--min-confidence <n>`: 最小信頼度閾値（デフォルト: 0.3）
- `--output <file>`: 出力ファイルパス（デフォルト: instincts-export-YYYYMMDD.yaml）
- `--format <yaml|json|md>`: 出力形式（デフォルト: yaml）
- `--include-evidence`: 証拠テキストを含める（デフォルト: 除外）
