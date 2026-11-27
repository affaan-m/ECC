---
description: Claude DevFleet を使って並列 Claude Code エージェントをオーケストレーションします — 自然言語でプロジェクトを計画し、隔離されたワークツリーにエージェントをディスパッチし、進捗を監視し、構造化レポートを読み取ります。
---

# DevFleet — マルチエージェントオーケストレーション

Claude DevFleet を使って並列の Claude Code エージェントをオーケストレーションします。各エージェントは隔離された git worktree 内で動作し、完全なツールチェーンを備えています。

DevFleet MCP サーバーが必要です：`claude mcp add devfleet --transport http http://localhost:18801/mcp`

## フロー

```
ユーザーがプロジェクトを説明
  → plan_project(prompt) → タスク DAG と依存関係
  → 計画を表示し、承認を取得
  → dispatch_mission(M1) → エージェントがワークスペースで生成
  → M1 完了 → 自動マージ → M2 が自動ディスパッチ（M1 に依存）
  → M2 完了 → 自動マージ
  → get_report(M2) → ファイル変更、完了内容、エラー、次のステップ
  → ユーザーにサマリーをレポート
```

## ワークフロー

1. **ユーザーの説明に基づいてプロジェクトを計画する**：

```
mcp__devfleet__plan_project(prompt="<ユーザーの説明>")
```

これはチェーン状のタスクを含むプロジェクトを返します。ユーザーに以下を表示します：

* プロジェクト名と ID
* 各タスク：タイトル、タイプ、依存関係
* 依存関係 DAG（どのタスクがどのタスクをブロックしているか）

2. **ディスパッチ前にユーザーの承認を待つ**。計画を明確に表示します。

3. **最初のタスクをディスパッチする**（`depends_on` が空のタスク）：

```
mcp__devfleet__dispatch_mission(mission_id="<first_mission_id>")
```

残りのタスクは依存関係が完了すると自動的にディスパッチされます（`plan_project` が `auto_dispatch=true` でタスクを作成するため）。`create_mission` を使ってタスクを手動作成する場合は、この動作を有効にするために `auto_dispatch=true` を明示的に設定する必要があります。

4. **進捗を監視する** — 実行中の内容を確認：

```
mcp__devfleet__get_dashboard()
```

または特定のタスクを確認：

```
mcp__devfleet__get_mission_status(mission_id="<id>")
```

長時間実行するタスクには、`wait_for_mission` ではなく `get_mission_status` によるポーリングを優先し、ユーザーが進捗の更新を確認できるようにします。

5. **完了した各タスクのレポートを読む**：

```
mcp__devfleet__get_report(mission_id="<mission_id>")
```

終了状態に達した各タスクに対してこのツールを呼び出します。レポートには files\_changed、what\_done、what\_open、what\_tested、what\_untested、next\_steps、errors\_encountered が含まれます。

## 利用可能なすべてのツール

| ツール | 用途 |
|------|---------|
| `plan_project(prompt)` | AI が説明を `auto_dispatch=true` のチェーン状タスクに分解する |
| `create_project(name, path?, description?)` | プロジェクトを手動作成し、`project_id` を返す |
| `create_mission(project_id, title, prompt, depends_on?, auto_dispatch?)` | タスクを追加する。`depends_on` はタスク ID 文字列のリスト |
| `dispatch_mission(mission_id, model?, max_turns?)` | エージェントを起動する |
| `cancel_mission(mission_id)` | 実行中のエージェントを停止する |
| `wait_for_mission(mission_id, timeout_seconds?)` | 完了までブロックする（長いタスクにはポーリングを優先） |
| `get_mission_status(mission_id)` | ノンブロッキングで進捗を確認する |
| `get_report(mission_id)` | 構造化レポートを読む |
| `get_dashboard()` | システム概要 |
| `list_projects()` | プロジェクトを参照する |
| `list_missions(project_id, status?)` | タスクを一覧表示する |

## ガイドライン

* ユーザーが明示的に「始めてください」と言わない限り、ディスパッチ前に必ず計画を確認する
* ステータスをレポートする際はタスクのタイトルと ID を含める
* タスクが失敗した場合、再試行前にそのレポートを読んでエラーを把握する
* エージェントの同時実行数は設定可能（デフォルト：3）。超過したタスクはキューに入れられ、スロットが空くと自動的にディスパッチされる。スロットの可用性は `get_dashboard()` で確認する
* 依存関係は DAG を形成する — 循環依存は絶対に作成しない
* 各エージェントは完了時に自動的に worktree をマージする。マージ競合が発生した場合、変更は手動解決のために worktree ブランチに保持される
