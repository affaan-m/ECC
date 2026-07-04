# Git ワークフロー

## コミットメッセージフォーマット

```
<type>: <description>

<optional body>
```

タイプ: feat, fix, refactor, docs, test, chore, perf, ci

注記: コミットの共同作成者の属性を無効にするには、`~/.claude/settings.json` に `"includeCoAuthoredBy": false` を設定します。Claude Code は既定で `Co-Authored-By` を付与し、ECC はこの設定を同梱しません。

## Pull Request ワークフロー

PR を作成する際:
1. 完全なコミット履歴を分析（最新のコミットだけでなく）
2. `git diff [base-branch]...HEAD` を使用してすべての変更を確認
3. 包括的な PR サマリーを作成
4. TODO 付きのテスト計画を含める
5. 新しいブランチの場合は `-u` フラグで push

## 機能実装ワークフロー

1. **まず計画**
   - **planner** agent を使用して実装計画を作成
   - 依存関係とリスクを特定
   - フェーズに分割

2. **TDD アプローチ**
   - **tdd-guide** agent を使用
   - まずテストを書く（RED）
   - テストをパスするように実装（GREEN）
   - リファクタリング（IMPROVE）
   - 80%+ カバレッジを確認

3. **コードレビュー**
   - コード記述直後に **code-reviewer** agent を使用
   - CRITICAL と HIGH の問題に対処
   - 可能な限り MEDIUM の問題を修正

4. **コミット & プッシュ**
   - 詳細なコミットメッセージ
   - Conventional Commits フォーマットに従う
