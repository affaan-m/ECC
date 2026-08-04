---
description: "自然言語でファイルを指定するクイックコミット — 何をコミットするかを平易な言葉で記述"
argument-hint: "[ターゲットの説明]（空欄 = すべての変更）"
---

# スマートコミット

> PRPs-agentic-engのWirasmによる適応。PRPワークフローシリーズの一部。

**入力**: $ARGUMENTS

---

## フェーズ 1 — ASSESS

```bash
git status --short
```

出力が空の場合 → 停止: "コミットするものがありません。"

変更内容のサマリーをユーザーに表示（追加、変更、削除、未追跡）。

---

## フェーズ 2 — INTERPRET & STAGE

`$ARGUMENTS`を解釈してステージング対象を決定:

| 入力 | 解釈 | Gitコマンド |
|---|---|---|
| *（空 / 未入力）* | すべてをステージ | `git add -A` |
| `staged` | 既にステージ済みのものを使用 | *（git addなし）* |
| `*.ts`や`*.py`など | マッチするglobをステージ | `git add '*.ts'` |
| `except tests` | すべてステージ後、テストをアンステージ | `git add -A && git reset -- '**/*.test.*' '**/*.spec.*' '**/test_*' 2>/dev/null \|\| true` |
| `only new files` | 未追跡ファイルのみステージ | `git ls-files --others --exclude-standard \| grep . && git ls-files --others --exclude-standard \| xargs git add` |
| `the auth changes` | status/diffから解釈 — auth関連ファイルを検出 | `git add <matched files>` |
| 特定のファイル名 | それらのファイルをステージ | `git add <files>` |

自然言語入力（"the auth changes"など）の場合、`git status`出力と`git diff`を相互参照して関連ファイルを特定。どのファイルをなぜステージングするかをユーザーに表示。

```bash
git add <determined files>
```

ステージング後、検証:
```bash
git diff --cached --stat
```

ステージングされたものがなければ、停止: "説明に一致するファイルがありません。"

---

## フェーズ 3 — COMMIT

命令形で単一行のコミットメッセージを作成:

```
{type}: {description}
```

タイプ:
- `feat` — 新機能または能力
- `fix` — バグ修正
- `refactor` — 動作を変えないコード再構築
- `docs` — ドキュメント変更
- `test` — テストの追加または更新
- `chore` — ビルド、設定、依存関係
- `perf` — パフォーマンス改善
- `ci` — CI/CD変更

ルール:
- 命令形（"added feature"ではなく"add feature"）
- タイププレフィックスの後は小文字
- 末尾にピリオドなし
- 72文字以内
- HOWではなくWHATが変わったかを記述

```bash
git commit -m "{type}: {description}"
```

---

## フェーズ 4 — OUTPUT

ユーザーへの報告:

```
Committed: {hash_short}
Message:   {type}: {description}
Files:     {count} file(s) changed

Next steps:
  - git push           → リモートにプッシュ
  - /prp-pr            → プルリクエストを作成
  - /code-review       → プッシュ前にレビュー
```

---

## 例

| 入力 | 動作 |
|---|---|
| `/prp-commit` | すべてステージ、メッセージを自動生成 |
| `/prp-commit staged` | 既にステージ済みのもののみコミット |
| `/prp-commit *.ts` | すべてのTypeScriptファイルをステージしてコミット |
| `/prp-commit except tests` | テストファイル以外すべてをステージ |
| `/prp-commit the database migration` | statusからDBマイグレーションファイルを検出してステージ |
| `/prp-commit only new files` | 未追跡ファイルのみステージ |
