---
description: "現在のブランチからプッシュされていないコミットでGitHub PRを作成 — テンプレートの検出、変更の分析、プッシュ"
argument-hint: "[base-branch]（デフォルト: main）"
---

# プルリクエストの作成

> PRPs-agentic-engのWirasmによる適応。PRPワークフローシリーズの一部。

**入力**: `$ARGUMENTS` — オプション。ベースブランチ名やフラグ（例: `--draft`）を含む場合があります。

**`$ARGUMENTS`のパース**:
- 認識されたフラグを抽出（`--draft`）
- 残りの非フラグテキストをベースブランチ名として扱う
- 指定がなければベースブランチのデフォルトは`main`

---

## フェーズ 1 — VALIDATE

前提条件をチェック:

```bash
git branch --show-current
git status --short
git log origin/<base>..HEAD --oneline
```

| チェック | 条件 | 失敗時のアクション |
|---|---|---|
| ベースブランチにいない | 現在のブランチ ≠ base | 停止: "まずフィーチャーブランチに切り替えてください。" |
| クリーンなワーキングディレクトリ | コミットされていない変更がない | 警告: "コミットされていない変更があります。コミットまたはスタッシュしてください。`/prp-commit`でコミットしてください。" |
| 先行コミットがある | `git log origin/<base>..HEAD`が空でない | 停止: "`<base>`より先行するコミットがありません。PRにする内容がありません。" |
| 既存のPRがない | `gh pr list --head <branch> --json number`が空 | 停止: "PRは既に存在: #<number>。`gh pr view <number> --web`で開いてください。" |

すべてのチェックが通れば続行。

---

## フェーズ 2 — DISCOVER

### PRテンプレート

PRテンプレートを順番に検索:

1. `.github/PULL_REQUEST_TEMPLATE/`ディレクトリ — 存在する場合、ファイルを一覧しユーザーに選択させる（またはdefault.mdを使用）
2. `.github/PULL_REQUEST_TEMPLATE.md`
3. `.github/pull_request_template.md`
4. `docs/pull_request_template.md`

見つかった場合、読み取ってPR本文の構造に使用。

### コミット分析

```bash
git log origin/<base>..HEAD --format="%h %s" --reverse
```

コミットを分析して以下を決定:
- **PRタイトル**: タイププレフィックス付きのconventional commitフォーマットを使用 — `feat: ...`、`fix: ...`など
  - 複数のタイプがある場合、支配的なものを使用
  - 単一コミットの場合、そのメッセージをそのまま使用
- **変更サマリー**: タイプ/領域別にコミットをグループ化

### ファイル分析

```bash
git diff origin/<base>..HEAD --stat
git diff origin/<base>..HEAD --name-only
```

変更ファイルをカテゴリ分類: ソース、テスト、ドキュメント、設定、マイグレーション。

### PRPアーティファクト

関連するPRPアーティファクトを確認:
- `.claude/PRPs/reports/` — 実装レポート
- `.claude/PRPs/plans/` — 実行された計画
- `.claude/PRPs/prds/` — 関連PRD

存在する場合、PR本文で参照。

---

## フェーズ 3 — PUSH

```bash
git push -u origin HEAD
```

ダイバージェンスによりプッシュが失敗した場合:
```bash
git fetch origin
git rebase origin/<base>
git push -u origin HEAD
```

リベースコンフリクトが発生した場合、停止してユーザーに通知。

---

## フェーズ 4 — CREATE

### テンプレートあり

フェーズ 2でPRテンプレートが見つかった場合、コミットとファイル分析を使用して各セクションを記入。テンプレートのすべてのセクションを保持 — 該当しないセクションは削除せず"N/A"とする。

### テンプレートなし

このデフォルトフォーマットを使用:

```markdown
## Summary

<このPRが何をしてなぜかの1-2文の説明>

## Changes

<領域別にグループ化された変更の箇条書きリスト>

## Files Changed

<変更タイプ付きの変更ファイルのテーブルまたはリスト: Added/Modified/Deleted>

## Testing

<変更のテスト方法の説明、または"Needs testing">

## Related Issues

<Closes/Fixes/Relates to #Nでリンクされたイシュー、または"None">
```

### PRの作成

```bash
gh pr create \
  --title "<PRタイトル>" \
  --base <base-branch> \
  --body "<PR本文>"
  # $ARGUMENTSから--draftフラグがパースされた場合は--draftを追加
```

---

## フェーズ 5 — VERIFY

```bash
gh pr view --json number,url,title,state,baseRefName,headRefName,additions,deletions,changedFiles
gh pr checks --json name,status,conclusion 2>/dev/null || true
```

---

## フェーズ 6 — OUTPUT

ユーザーへの報告:

```
PR #<number>: <title>
URL: <url>
Branch: <head> → <base>
Changes: +<additions> -<deletions> across <changedFiles> files

CI Checks: <ステータスサマリー or "pending" or "none configured">

Artifacts referenced:
  - <PR本文でリンクされたPRPレポート/計画>

Next steps:
  - gh pr view <number> --web   → ブラウザで開く
  - /code-review <number>       → PRをレビュー
  - gh pr merge <number>        → 準備ができたらマージ
```

---

## エッジケース

- **`gh` CLIがない**: 停止: "GitHub CLI (`gh`) が必要です。インストール: <https://cli.github.com/>"
- **未認証**: 停止: "まず `gh auth login` を実行してください。"
- **フォースプッシュが必要**: リモートがダイバージしてリベースが行われた場合、`git push --force-with-lease`を使用（`--force`は使わない）。
- **複数のPRテンプレート**: `.github/PULL_REQUEST_TEMPLATE/`に複数のファイルがある場合、一覧してユーザーに選択させる。
- **大きなPR（20ファイル超）**: PRサイズについて警告。変更が論理的に分離可能なら分割を提案。
