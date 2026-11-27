---
name: promote
description: プロジェクトスコープのインスティンクトをグローバルスコープにプロモート
command: true
---

# プロモートコマンド

continuous-learning-v2のインスティンクトをプロジェクトスコープからグローバルスコープにプロモートします。

## 実装

プラグインルートパスを使用してインスティンクトCLIを実行:

```bash
python3 "${CLAUDE_PLUGIN_ROOT}/skills/continuous-learning-v2/scripts/instinct-cli.py" promote [instinct-id] [--force] [--dry-run]
```

または`CLAUDE_PLUGIN_ROOT`が設定されていない場合（手動インストール）:

```bash
python3 ~/.claude/skills/continuous-learning-v2/scripts/instinct-cli.py promote [instinct-id] [--force] [--dry-run]
```

## 使い方

```bash
/promote                      # プロモーション候補を自動検出
/promote --dry-run            # 自動プロモーション候補をプレビュー
/promote --force              # プロンプトなしで全適格候補をプロモート
/promote grep-before-edit     # 現在のプロジェクトから1つの特定インスティンクトをプロモート
```

## 動作内容

1. 現在のプロジェクトを検出
2. `instinct-id`が提供された場合、そのインスティンクトのみをプロモート（現在のプロジェクトに存在する場合）
3. それ以外の場合、以下の条件を満たすクロスプロジェクト候補を検出:
   - 少なくとも2つのプロジェクトに存在
   - 信頼度閾値を満たす
4. プロモートされたインスティンクトを`~/.claude/homunculus/instincts/personal/`に`scope: global`で書き込み
