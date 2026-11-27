# Orchestrateコマンド

複雑なタスクのための連続的なエージェントワークフロー。

## 使用方法

`/orchestrate [ワークフロータイプ] [タスク説明]`

## ワークフロータイプ

### feature
完全な機能実装ワークフロー:
```
planner -> tdd-guide -> code-reviewer -> security-reviewer
```

### bugfix
バグ調査と修正ワークフロー:
```
explorer -> tdd-guide -> code-reviewer
```

### refactor
安全なリファクタリングワークフロー:
```
architect -> code-reviewer -> tdd-guide
```

### security
セキュリティ重視のレビュー:
```
security-reviewer -> code-reviewer -> architect
```

## 実行パターン

ワークフロー内の各エージェントに対して:

1. 前のエージェントからのコンテキストで**エージェントを呼び出す**
2. 出力を構造化されたハンドオフドキュメントとして**収集**
3. チェーン内の**次のエージェントに渡す**
4. 結果を最終レポートに**集約**

## ハンドオフドキュメント形式

エージェント間でハンドオフドキュメントを作成します:

```markdown
## HANDOFF: [前のエージェント] -> [次のエージェント]

### コンテキスト
[実行された内容の要約]

### 発見事項
[重要な発見または決定]

### 変更されたファイル
[変更されたファイルのリスト]

### 未解決の質問
[次のエージェントのための未解決項目]

### 推奨事項
[推奨される次のステップ]
```

## 例: 機能ワークフロー

```
/orchestrate feature "Add user authentication"
```

以下を実行します:

1. **Plannerエージェント**
   - 要件を分析
   - 実装計画を作成
   - 依存関係を特定
   - 出力: `HANDOFF: planner -> tdd-guide`

2. **TDD Guideエージェント**
   - プランナーのハンドオフを読み込む
   - 最初にテストを記述
   - テストに合格するように実装
   - 出力: `HANDOFF: tdd-guide -> code-reviewer`

3. **Code Reviewerエージェント**
   - 実装をレビュー
   - 問題をチェック
   - 改善を提案
   - 出力: `HANDOFF: code-reviewer -> security-reviewer`

4. **Security Reviewerエージェント**
   - セキュリティ監査
   - 脆弱性チェック
   - 最終承認
   - 出力: 最終レポート

## 最終レポート形式

```
オーケストレーションレポート
====================
ワークフロー: feature
タスク: ユーザー認証の追加
エージェント: planner -> tdd-guide -> code-reviewer -> security-reviewer

サマリー
-------
[1段落の要約]

エージェント出力
-------------
Planner: [要約]
TDD Guide: [要約]
Code Reviewer: [要約]
Security Reviewer: [要約]

変更ファイル
-------------
[変更されたすべてのファイルをリスト]

テスト結果
------------
[テスト合格/不合格の要約]

セキュリティステータス
---------------
[セキュリティの発見事項]

推奨事項
--------------
[リリース可 / 要修正 / ブロック中]
```

## 並行実行

独立したチェックの場合、エージェントを並行実行します:

```markdown
### 並行フェーズ
同時に実行:
- code-reviewer (品質)
- security-reviewer (セキュリティ)
- architect (設計)

### 結果のマージ
出力を単一のレポートに結合
```

## 引数

$ARGUMENTS:
- `feature <説明>` - 完全な機能ワークフロー
- `bugfix <説明>` - バグ修正ワークフロー
- `refactor <説明>` - リファクタリングワークフロー
- `security <説明>` - セキュリティレビューワークフロー
- `custom <エージェント> <説明>` - カスタムエージェントシーケンス

## カスタムワークフローの例

```
/orchestrate custom "architect,tdd-guide,code-reviewer" "Redesign caching layer"
```

## ヒント

1. 複雑な機能には**plannerから始める**
2. マージ前に**常にcode-reviewerを含める**
3. 認証/決済/個人情報には**security-reviewerを使用**
4. **ハンドオフを簡潔に保つ** - 次のエージェントが必要とするものに焦点を当てる
5. 必要に応じて**エージェント間で検証を実行**
