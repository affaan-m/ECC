---
name: opensource-pipeline
description: "オープンソースパイプライン: プライベートプロジェクトをフォーク、サニタイズし、安全な公開リリースのためにパッケージ化する。3つのエージェント（フォーカー、サニタイザー、パッケージャー）を連鎖させる。トリガー: '/opensource'、'open source this'、'make this public'、'prepare for open source'。"
origin: ECC
---

# オープンソースパイプラインスキル

3段階のパイプラインを通じて任意のプロジェクトを安全にオープンソース化する: **フォーク**（シークレット除去）→ **サニタイズ**（クリーンな状態を確認）→ **パッケージ**（CLAUDE.md + setup.sh + README）。

## アクティベートするタイミング

- ユーザーが「このプロジェクトをオープンソース化する」または「これを公開する」と言うとき
- ユーザーがプライベートリポジトリを公開リリースのために準備したいとき
- ユーザーがGitHubにプッシュする前にシークレットを除去する必要があるとき
- ユーザーが`/opensource fork`、`/opensource verify`、または`/opensource package`を呼び出すとき

## コマンド

| コマンド | アクション |
|---------|--------|
| `/opensource fork PROJECT` | 完全なパイプライン: フォーク + サニタイズ + パッケージ |
| `/opensource verify PROJECT` | 既存のリポジトリにサニタイザーを実行 |
| `/opensource package PROJECT` | CLAUDE.md + setup.sh + READMEを生成 |
| `/opensource list` | ステージングされたすべてのプロジェクトを表示 |
| `/opensource status PROJECT` | ステージングされたプロジェクトのレポートを表示 |

## プロトコル

### /opensource fork PROJECT

**完全なパイプライン — メインワークフロー。**

#### ステップ1: パラメータを収集する

プロジェクトパスを解決する。PROJECTに`/`が含まれる場合、パス（絶対または相対）として扱う。それ以外の場合: 現在の作業ディレクトリ、`$HOME/PROJECT`をチェックし、見つからない場合はユーザーに尋ねる。

```
SOURCE_PATH="<解決された絶対パス>"
STAGING_PATH="$HOME/opensource-staging/${PROJECT_NAME}"
```

ユーザーに尋ねる:
1. 「どのプロジェクト？」（見つからない場合）
2. 「ライセンス？（MIT / Apache-2.0 / GPL-3.0 / BSD-3-Clause）」
3. 「GitHubのorgまたはユーザー名？」（デフォルト: `gh api user -q .login`で検出）
4. 「GitHubリポジトリ名？」（デフォルト: プロジェクト名）
5. 「READMEの説明？」（提案のためにプロジェクトを分析）

#### ステップ2: ステージングディレクトリを作成する

```bash
mkdir -p $HOME/opensource-staging/
```

#### ステップ3: フォーカーエージェントを実行する

`opensource-forker`エージェントをスポーン:

```
Agent(
  description="Fork {PROJECT} for open-source",
  subagent_type="opensource-forker",
  prompt="""
Fork project for open-source release.

Source: {SOURCE_PATH}
Target: {STAGING_PATH}
License: {chosen_license}

Follow the full forking protocol:
1. Copy files (exclude .git, node_modules, __pycache__, .venv)
2. Strip all secrets and credentials
3. Replace internal references with placeholders
4. Generate .env.example
5. Clean git history
6. Generate FORK_REPORT.md in {STAGING_PATH}/FORK_REPORT.md
"""
)
```

完了を待つ。`{STAGING_PATH}/FORK_REPORT.md`を読む。

#### ステップ4: サニタイザーエージェントを実行する

`opensource-sanitizer`エージェントをスポーン:

```
Agent(
  description="Verify {PROJECT} sanitization",
  subagent_type="opensource-sanitizer",
  prompt="""
Verify sanitization of open-source fork.

Project: {STAGING_PATH}
Source (for reference): {SOURCE_PATH}

Run ALL scan categories:
1. Secrets scan (CRITICAL)
2. PII scan (CRITICAL)
3. Internal references scan (CRITICAL)
4. Dangerous files check (CRITICAL)
5. Configuration completeness (WARNING)
6. Git history audit

Generate SANITIZATION_REPORT.md inside {STAGING_PATH}/ with PASS/FAIL verdict.
"""
)
```

完了を待つ。`{STAGING_PATH}/SANITIZATION_REPORT.md`を読む。

**FAILの場合:** 結果をユーザーに表示する。「これらを修正して再スキャンしますか、それとも中止しますか？」と尋ねる。
- 修正する場合: 修正を適用し、サニタイザーを再実行する（最大3回の再試行 — 3回のFAIL後、すべての結果を提示しユーザーに手動で修正するよう依頼する）
- 中止する場合: ステージングディレクトリをクリーンアップする

**PASSまたはWARNINGS付きPASSの場合:** ステップ5に進む。

#### ステップ5: パッケージャーエージェントを実行する

`opensource-packager`エージェントをスポーン:

```
Agent(
  description="Package {PROJECT} for open-source",
  subagent_type="opensource-packager",
  prompt="""
Generate open-source packaging for project.

Project: {STAGING_PATH}
License: {chosen_license}
Project name: {PROJECT_NAME}
Description: {description}
GitHub repo: {github_repo}

Generate:
1. CLAUDE.md (commands, architecture, key files)
2. setup.sh (one-command bootstrap, make executable)
3. README.md (or enhance existing)
4. LICENSE
5. CONTRIBUTING.md
6. .github/ISSUE_TEMPLATE/ (bug_report.md, feature_request.md)
"""
)
```

#### ステップ6: 最終レビュー

ユーザーに提示する:
```
Open-Source Fork Ready: {PROJECT_NAME}

Location: {STAGING_PATH}
License: {license}
Files generated:
  - CLAUDE.md
  - setup.sh (executable)
  - README.md
  - LICENSE
  - CONTRIBUTING.md
  - .env.example ({N} variables)

Sanitization: {sanitization_verdict}

Next steps:
  1. Review: cd {STAGING_PATH}
  2. Create repo: gh repo create {github_org}/{github_repo} --public
  3. Push: git remote add origin ... && git push -u origin main

Proceed with GitHub creation? (yes/no/review first)
```

#### ステップ7: GitHubへの公開（ユーザーの承認後）

```bash
cd "{STAGING_PATH}"
gh repo create "{github_org}/{github_repo}" --public --source=. --push --description "{description}"
```

---

### /opensource verify PROJECT

サニタイザーを独立して実行する。パスを解決: PROJECTに`/`が含まれる場合、パスとして扱う。それ以外の場合は`$HOME/opensource-staging/PROJECT`、`$HOME/PROJECT`、現在のディレクトリを確認する。

```
Agent(
  subagent_type="opensource-sanitizer",
  prompt="Verify sanitization of: {resolved_path}. Run all 6 scan categories and generate SANITIZATION_REPORT.md."
)
```

---

### /opensource package PROJECT

パッケージャーを独立して実行する。「ライセンス？」と「説明？」を尋ねてから:

```
Agent(
  subagent_type="opensource-packager",
  prompt="Package: {resolved_path} ..."
)
```

---

### /opensource list

```bash
ls -d $HOME/opensource-staging/*/
```

FORK_REPORT.md、SANITIZATION_REPORT.md、CLAUDE.mdの存在でパイプラインの進捗を各プロジェクトと共に表示する。

---

### /opensource status PROJECT

```bash
cat $HOME/opensource-staging/${PROJECT}/SANITIZATION_REPORT.md
cat $HOME/opensource-staging/${PROJECT}/FORK_REPORT.md
```

## ステージングレイアウト

```
$HOME/opensource-staging/
  my-project/
    FORK_REPORT.md           # フォーカーエージェントから
    SANITIZATION_REPORT.md   # サニタイザーエージェントから
    CLAUDE.md                # パッケージャーエージェントから
    setup.sh                 # パッケージャーエージェントから
    README.md                # パッケージャーエージェントから
    .env.example             # フォーカーエージェントから
    ...                      # サニタイズされたプロジェクトファイル
```

## アンチパターン

- ユーザーの承認なしにGitHubにプッシュすることは**絶対にしない**
- サニタイザーをスキップすることは**絶対にしない** — これは安全ゲートである
- 重大な結果をすべて修正せずにサニタイザーのFAIL後に続行することは**絶対にしない**
- ステージングディレクトリに`.env`、`*.pem`、または`credentials.json`を残すことは**絶対にしない**

## ベストプラクティス

- 新しいリリースには常に完全なパイプライン（フォーク → サニタイズ → パッケージ）を実行する
- ステージングディレクトリは明示的にクリーンアップされるまで持続する — レビューに使用する
- 公開前に手動修正後にサニタイザーを再実行する
- 削除ではなくシークレットをパラメータ化する — プロジェクトの機能を維持する

## 関連スキル

サニタイザーが使用するシークレット検出パターンについては`security-review`を参照。
