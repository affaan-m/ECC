---
name: claude-devfleet
description: Claude DevFleet経由でマルチエージェントコーディングタスクをオーケストレーション — プロジェクトを計画し、分離された作業ツリー内で平行エージェントを派遣し、進捗を監視し、構造化レポートを読む。
origin: community
---

# Claude DevFleet マルチエージェント オーケストレーション

## 使用時期

このスキルは、複数のClaude Codeエージェントをコーディングタスクで並行して作業するように派遣する必要があるときに使用します。各エージェントは完全なツール機能を備えた分離されたgit作業ツリーで実行されます。

実行中のClaude DevFleetインスタンスが必要で、MCP経由で接続：
```bash
claude mcp add devfleet --transport http http://localhost:18801/mcp
```

## 動作方法

```
User → 「認証とテスト付きのREST APIを構築」
  ↓
plan_project(prompt) → project_id + mission DAG
  ↓
計画をユーザーに表示 → 承認を取得
  ↓
dispatch_mission(M1) → エージェント1は作業ツリーで生成
  ↓
M1完了 → 自動マージ → M2を自動派遣（M1に依存）
  ↓
M2完了 → 自動マージ
  ↓
get_report(M2) → files_changed、what_done、errors、next_steps
  ↓
ユーザーに報告する
```

### ツール

| Tool | Purpose |
|------|---------|
| `plan_project(prompt)` | AIが説明をミッションチェーン付きプロジェクトに分割 |
| `create_project(name, path?, description?)` | プロジェクトを手動で作成、`project_id`を返す |
| `create_mission(project_id, title, prompt, depends_on?, auto_dispatch?)` | ミッションを追加。`depends_on`はミッションIDの文字列のリスト。`auto_dispatch=true`で依存関係が満たされたとき自動開始。 |
| `dispatch_mission(mission_id, model?, max_turns?)` | ミッション上でエージェントを開始 |
| `cancel_mission(mission_id)` | 実行中のエージェントを停止 |
| `wait_for_mission(mission_id, timeout_seconds?)` | ミッション完了までブロック |
| `get_mission_status(mission_id)` | ブロックなしでミッション進捗をチェック |
| `get_report(mission_id)` | 構造化レポートを読む |
| `get_dashboard()` | システム概要：実行中のエージェント、統計 |
| `list_projects()` | すべてのプロジェクトをブラウザ |
| `list_missions(project_id, status?)` | プロジェクト内のミッションをリスト |

## ワークフロー

1. **計画**：`plan_project(prompt="...")`を呼び出す → `project_id` + ミッションリスト
2. **表示**：ユーザーにミッション計画を表示
3. **派遣**：最初のミッションで`dispatch_mission()`を呼び出す
4. **監視**：`get_mission_status()`で進捗をチェック
5. **報告**：`get_report()`で完了時の報告

## 例

### フル自動：計画と起動

1. `plan_project(prompt="...")`
2. 最初のミッションをDispatch
3. 残りのミッションは依存関係に基づいて自動Dispatch
4. 完了したらユーザーに報告
