---
name: projects
description: 既知のプロジェクトとその本能統計を一覧表示する
command: true
---

# プロジェクト コマンド

continuous-learning-v2 のプロジェクト登録エントリと各プロジェクトの本能/観察カウントを一覧表示します。

## 実装

プラグインルートパスを使って本能 CLI を実行します：

```bash
python3 "${CLAUDE_PLUGIN_ROOT}/skills/continuous-learning-v2/scripts/instinct-cli.py" projects
```

または `CLAUDE_PLUGIN_ROOT` が設定されていない場合（手動インストール）：

```bash
python3 ~/.claude/skills/continuous-learning-v2/scripts/instinct-cli.py projects
```

## 使い方

```bash
/projects
```

## 操作手順

1. `~/.claude/homunculus/projects.json` を読み取る
2. 各プロジェクトについて以下を表示する：
   * プロジェクト名、ID、ルートディレクトリ、リモートアドレス
   * 個人および継承された本能カウント
   * 観察イベントカウント
   * 最終確認タイムスタンプ
3. グローバル本能の合計も表示する
