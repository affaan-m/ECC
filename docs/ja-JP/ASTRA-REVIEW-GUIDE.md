# Astra Review ガイド

`/astra-review` は、Claude Code で書いたコードを **GPT-6-Astra**（OpenAI）に渡して、プロバイダーをまたいだ独立レビューを受けるコマンドです。書き込みは常に Claude が行い、Astra は構造化された判定だけを返します（パッチは返しません）。このガイドではセットアップ、日常の使い方、プッシュのゲート化、トラブルシューティングを扱います。コマンドの仕様は [`commands/astra-review.md`](./commands/astra-review.md) を参照してください。

## 仕組み

```text
Claude Code                       Codex CLI（読み取り専用サンドボックス）     OpenAI
-----------                       ------------------------------------      ------
git diff / ファイル内容  ------>  codex exec -m gpt-6-astra  -------------> GPT-6-Astra
ルーブリック + JSON スキーマ       Web 検索オフ、MCP オフ、
                                  ユーザー設定は読み込まない  <-------------  JSON 判定
Markdown レポート + 終了コード <-- --output-schema で形式を強制
Claude が CRITICAL/HIGH を修正して再実行（最大 3 ラウンド）、残りはユーザーへ
```

レビュアーが見るのは差分、ルーブリック、そして Codex の読み取り専用ツール越しのリポジトリだけです。Claude との会話は見えないので、書いた側の思い込みを共有しません。

## 前提条件

| 要件 | 確認方法 |
|------|----------|
| Codex CLI がインストール済み | `codex --version`（導入: `npm i -g @openai/codex`） |
| ChatGPT でログイン済み | 一度 `codex login`。`~/.codex/auth.json` に `"auth_mode": "chatgpt"` がある |
| アカウントで `gpt-6-astra` が使える | `codex` を開いてモデル選択に出るか確認。出なければ `ECC_ASTRA_MODEL` で別モデルを指定 |
| ECC の `commands-core` が入っている | コマンド一覧に `/ecc:astra-review` が出る |

OpenAI の API キーは不要です。環境変数に入っていてもレビュアーのプロセスには**渡しません**。

### プラグインの鮮度

Claude Code のプラグインキャッシュは ECC のバージョン番号で管理されるため、ECC のチェックアウトを編集してもインストール済みのコピーは更新されません。ECC を更新したあと `/ecc:astra-review` が unknown と言われる場合は、プラグインを入れ直して（または `.claude-plugin/plugin.json` のバージョンを上げて）セッションを再起動してください。

```bash
claude plugin uninstall ecc@ecc && claude plugin install ecc@ecc
```

## クイックスタート

```text
/ecc:astra-review                          # コミットされていない変更（staged + unstaged + 未追跡）
/ecc:astra-review --base main              # このブランチの main との差分すべて
/ecc:astra-review --commit HEAD            # 1 コミット
/ecc:astra-review SQL 層を重点的に見て      # 自由記述はレビュアーへの追加指示になる
```

プラグイン経由のコマンドには `ecc:` の接頭辞が付きます。手動インストールの場合は `/astra-review` です。

コマンドを実行することが、その差分を OpenAI に送ることへの同意になります。共有が許されないコードには使わないでください。何が外に出るかを事前に見たいときは、後述のスクリプトを `--dry-run` で実行します。

## 自分のプロジェクトでの日常の使い方

プロジェクトを ECC のチェックアウト配下に置く必要はありません。ECC はユーザースコープのプラグインなので `/ecc:astra-review` はどのディレクトリからでも使え、スクリプトは Claude Code を起動した git リポジトリをレビューします。ECC の差分と混ざらないよう、プロジェクトは ECC ツリーの外に置いてください。

### 0. 一度だけの準備（ECC のチェックアウトで）

```bash
# ECC のチェックアウトを更新したら、インストール済みプラグインを入れ直す
claude plugin uninstall ecc@ecc && claude plugin install ecc@ecc

# Codex CLI が入っていて ChatGPT でログイン済みか確認（未ログインなら codex login）
codex --version
grep auth_mode ~/.codex/auth.json
```

### 1. プロジェクトを作り、そこで Claude Code を起動する

```bash
mkdir -p ~/work/arm && cd ~/work/arm
git init          # 必須。レビューは git の差分を読む
claude            # このディレクトリがプロジェクトルートになる
```

プロジェクト用の `CLAUDE.md` が欲しければ Claude Code 内で `/init` を実行します。ECC の hooks とコマンドはユーザースコープで入っているので、ここでもそのまま効きます。

### 2. いつも通り実装する

Claude Code に変更を依頼するか、`/ecc:plan` から始めます。テスト先行で進めたいときは `/ecc:tdd-workflow`（`/ecc:plan` が出した `*.plan.md` を渡すこともできます）を実行するか、「TDD で進めて」と頼みます。`/ecc:go-test` や `/ecc:react-test` など言語別の入口もあります。

### 3. Astra にレビューを頼む

```text
/ecc:astra-review                        # コミットされていない変更
/ecc:astra-review --base main            # PR 前にブランチ全体
/ecc:astra-review 割り込み処理を重点的に   # 追加指示
```

Claude は確認できた CRITICAL/HIGH を修正して再実行し、最大 3 ラウンド回します。送らずに送信内容だけ確認するには次を実行します。

```bash
node ~/.claude/plugins/cache/ecc/ecc/<version>/scripts/astra-review.js --dry-run | less
```

（`<version>` は `claude plugin list` に表示されるプラグインのバージョンで、例えば `2.2.1` です。コマンド内では同じパスを `${CLAUDE_PLUGIN_ROOT}/scripts/astra-review.js` で参照します。）

### 4. 判定が PASS になったらコミットする

Claude Code にコミットを頼むか、自分で `git commit` します。

### 5. 必要ならプッシュをゲートする

```bash
node ~/.claude/plugins/cache/ecc/ecc/<version>/scripts/astra-review.js --consent-to-openai --base main && git push
```

注意: コマンド名には `ecc:` の接頭辞が付きます。実行するたびに差分が OpenAI に送られ、数分かかります。プラグインのキャッシュはバージョンが変わったときしか更新されないので、ECC を更新するごとに手順 0 をやり直してください。

## スコープ

| フラグ | レビュー対象 | 用途 |
|--------|--------------|------|
| （なし） | index と HEAD の差分、作業ツリーと index の差分、未追跡ファイル | コーディング中のデフォルト |
| `--base <branch>` | `<branch>` と HEAD のマージベース → 作業ツリー、加えて未追跡ファイル | PR 前にブランチ全体を見る |
| `--commit <rev>` | 1 コミットを第一親と比較（`HEAD~1`、`abc123`、マージ/ルートコミットも可） | 履歴の監査 |
| `--files <paths…>` | 指定ファイルの現在の内容 | 的を絞った質問 |
| `--files-from-commit <rev>` | `<rev>` が触った全パスの現在の内容。削除されたままのパスは削除として提示 | `--commit` レビュー後の修正ラウンド |

200 KB を超える差分は切り詰められます。その場合レビュアーには、そのリビジョンの省略部分を復元する git コマンドを渡すので、切り詰められても正しいコードを判定します。

## スクリプトを直接使う

コマンドは `scripts/astra-review.js`（プラグインルート配下、ECC リポジトリ内なら `./scripts/`）を包んだ薄いワークフローです。git がレビュー対象を見られるよう、対象プロジェクトのディレクトリで実行してください。

```bash
node "$ECC/scripts/astra-review.js" --dry-run                       # プロンプトを表示するだけ。送信しない
node "$ECC/scripts/astra-review.js" --consent-to-openai --base main # レビュー実行。Markdown を標準出力へ
node "$ECC/scripts/astra-review.js" --consent-to-openai --json \
  --output "$(mktemp -d)/astra.json"                                # ツール向け JSON。0600 で保存
```

| オプション | 意味 |
|------------|------|
| `--consent-to-openai` | 送信に必須（または `ECC_ASTRA_CONSENT=1`） |
| `--dry-run` | プロンプトを表示して Codex を呼ばずに終了（終了コード 0） |
| `--model <slug>` | レビュアーのモデル。既定は `gpt-6-astra`（または `ECC_ASTRA_MODEL`） |
| `--timeout-seconds <30-900>` | Codex のタイムアウト。既定 300 |
| `--instructions "<text>"` | ルーブリックに追加するレビュアーへの指示 |
| `--output <file>` | JSON 判定を `<file>` にも書く（アトミック、所有者のみ読める） |
| `--json` | Markdown の代わりに JSON を出力 |
| `--fix-findings <file>` | 修正モード: `<file>` の指摘を Astra が作業ツリー上で修正する（後述）。スコープ指定のフラグとは併用不可 |

終了コード: `0` は PASS またはレビュー対象なし、`1` は FAIL（CRITICAL か HIGH がある）、`2` は使い方またはランタイムのエラー。

## 判定の読み方

Markdown レポートには、重大度別の件数付き判定行、要約、指摘（重大度、`file:line`、タイトル、詳細、提案）、ルーブリック表が含まれます。JSON も同じ内容です。

```json
{
  "model": "gpt-6-astra",
  "scope": "uncommitted changes",
  "files": ["src/a.js"],
  "verdict": "FAIL",
  "review": {
    "verdict": "FAIL",
    "summary": "…",
    "checks": [{ "criterion": "Security", "result": "FAIL", "detail": "…" }],
    "findings": [{ "severity": "HIGH", "file": "src/a.js", "line": 12, "title": "…", "detail": "…", "suggestion": "…" }]
  }
}
```

ルーブリックは Correctness、Security、Error handling、Input validation、Completeness、No regressions、Tests、Maintainability の 8 項目です。項目が欠けた応答や形式不正の応答は拒否され、PASS 扱いにはなりません。レビュアーが `PASS` と書いていても、CRITICAL か HIGH の指摘があればゲートは `FAIL` です。

## 修正ループ

1. Claude が CRITICAL と HIGH の指摘をすべて表示し、コードと照合します。Astra が間違うこともあるので、誤検知は理由を一行添えてスキップします。
2. 確認できた指摘だけを修正し、テストを実行します。
3. 新しいレビュアーで再実行します。デフォルトと `--base` のスコープは修正を自動的に含みます。`--commit` レビューの後は `--files-from-commit <rev>` で修正ラウンドを回します。
4. 3 ラウンド経っても CRITICAL/HIGH が残る場合はループを止め、一覧をユーザーに渡します。プッシュはしません。

### 修正の書き手

コマンドは Opus で動きます。Opus がすべての指摘の検証、すべての差分の確認、テストの実行を担当し、修正そのものは書き手に任せます。

| 状況 | 書き手 |
|------|--------|
| 通常 | Fable のサブエージェント（`model: "fable"`） |
| Fable の Agent 呼び出しが種別 `rate_limit` または HTTP 429 の API エラーで失敗（成功した結果の中の語句は対象外） | Astra（`astra-review.js --fix-findings <confirmed.json>`、`workspace-write` サンドボックス） |
| それ以外の理由で Fable が失敗 | Opus が直接修正 |

切り替えは自動で、以降そのセッションでは Fable を再試行しません。修正モードの Astra もレビューと同じ隔離（Web 検索オフ、ネットワークなし、MCP 無効、ユーザー設定を読まない、API キーを渡さない）で動きますが、リポジトリ内のファイルは編集できます。`/tmp` と `$TMPDIR` は書き込み先から除外します。コミットやプッシュはしません。書き手が動く前に Opus が `git diff --binary HEAD` と未追跡ファイルの一覧をスナップショットとして保存するので、書き手の変更とあなた自身の未コミットの作業を区別でき、戻すのは書き手の変更だけです。修正レポートには修正済みとスキップした指摘が並びますが、Opus はそれを主張として扱い、テストと次のレビューの前にスナップショットと差分を照合します。

```bash
node "$ECC/scripts/astra-review.js" --fix-findings confirmed.json --dry-run           # 修正用プロンプトを表示
node "$ECC/scripts/astra-review.js" --consent-to-openai --fix-findings confirmed.json  # Astra に修正させる
```

`confirmed.json` には `--output` の JSON、`{"findings": [...]}`、指摘の配列のいずれかを渡せます。

Astra はラウンドを重ねるほど、実在するがより狭いエッジケースを見つけ続ける傾向があります。3 ラウンド目の一覧は、延々と回し続ける理由ではなく、自分で判断するための材料として扱ってください。

## プッシュをゲートする

プッシュ前にレビューを実行し、終了コード 1 なら止めます。

```bash
node "$ECC/scripts/astra-review.js" --consent-to-openai --base main && git push
```

`pre-push` フックにする場合（コードを OpenAI に送り数分かかるので、必ず明示的に有効化してください）:

```bash
#!/usr/bin/env sh
ECC="${CLAUDE_PLUGIN_ROOT:-$HOME/.claude}"
exec node "$ECC/scripts/astra-review.js" --consent-to-openai --base "$(git rev-parse --abbrev-ref origin/HEAD | sed 's#origin/##')"
```

独立したレビュアーを 2 つ（Claude Opus と Astra）使いたい場合は `/santa-loop` を使います。

## 外に出るもの、出ないもの

OpenAI に送られるもの: スコープ内の差分またはファイル内容、ファイル一覧、ルーブリック、追加指示。加えて Codex は読み取り専用ツールでリポジトリ内のファイルを読むことがあります。

出ないもの:

- PATH/HOME 系以外の環境変数（`OPENAI_API_KEY` やトークン類は渡しません）。
- MCP サーバー: `codex mcp list` が報告するサーバーをすべて名前指定で無効化（無害なトランスポートを添えて）し、ユーザーレベルの Codex 設定は読み込みません。空の `mcp_servers` テーブルでは継承したサーバーを消せないため、個別に名前を挙げています。
- Web 検索（レビュアー側で無効）。
- リポジトリ外のファイル: シンボリックリンクは追わずに `(symlink -> target)` として表現し、解決後の親ディレクトリがリポジトリ外に出るパスは拒否します。
- 書き込み: レビューのサンドボックスは読み取り専用で、承認要求も発生しません。`workspace-write` を使うのは Fable 上限時の修正モードだけで、`/tmp`、`$TMPDIR`、ネットワークを除外するので、書き込めるのはリポジトリだけです。

差分は `--no-ext-diff --no-textconv` 付きで取得するので、外部 diff ツールの設定で中身が空になることはありません。

## トラブルシューティング

| 症状 | 原因と対処 |
|------|------------|
| `Unknown command: /astra-review` | プラグインのコマンドには名前空間が付きます。`/ecc:astra-review` を使ってください。それも unknown なら、インストール済みプラグインがこのコマンドより古いので入れ直します（「プラグインの鮮度」参照）。 |
| `Codex CLI is not installed` | `@openai/codex` を入れて `codex` を PATH に通します。Windows では npm のシムから JavaScript のエントリポイントを自動で解決します。 |
| `Codex review failed: … model …` | アカウントで `gpt-6-astra` が使えません。`ECC_ASTRA_MODEL` か `--model` で別モデルを指定してください。 |
| `cannot isolate MCP server name "a.b"` | 名前にドットを含むサーバーは Codex 側で無効化できません。Codex の設定で名前を変えるか、そこで無効化してください。 |
| `Codex review timed out` | `--timeout-seconds` を上げる（最大 900）か、スコープを狭めてください。 |
| `Nothing to review` | スコープが空です。変更をステージまたは保存するか、別のスコープを選んでください。 |
| `MCP servers could not be listed` | `codex mcp list` が失敗したため隔離を保証できず、レビューを拒否しています。Codex の設定を直してから再実行してください。 |
| 差分は完全と言われるのにファイルが足りない | 未追跡のネストしたリポジトリ（`dir/`）は一覧に載りますが差分は取りません。そのリポジトリの中からレビューしてください。 |

## 制限

- 1 回の実行で使えるレビュアーモデルは 1 つです。Claude と Astra 以外のモデル多様性が必要なら `/santa-loop` や `/council` を使ってください。
- レビューには数分かかり、Codex 側で ChatGPT の利用枠を消費します。
- Windows 対応（npm シム、`Path`、ネイティブパス）は実装済みですが、テストでの検証のみで実機では未確認です。
