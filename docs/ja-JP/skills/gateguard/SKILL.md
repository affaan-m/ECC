---
name: gateguard
description: API、エージェント、およびLLMエンドポイントのアクセス制御と認可パターン。
origin: community
---

# GateGuard — Fact-Forcing Pre-Action Gate

A PreToolUse hook that forces Claude to investigate before editing. Instead of self-evaluation ("are you sure?"), it demands concrete facts. The act of investigation creates awareness that self-evaluation never did.

## When to Activate

- Working on any codebase where file edits affect multiple modules
- Projects with data files that have specific schemas or date formats
- Teams where AI-generated code must match existing patterns
- Any workflow where Claude tends to guess instead of investigating

## Core Concept

LLM self-evaluation doesn't work. Ask "did you violate any policies?" and the answer is always "no." This is verified experimentally.

But asking "list every file that imports this module" forces the LLM to run Grep and Read. The investigation itself creates context that changes the output.

**Three-stage gate:**

```
1. DENY  — block the first Edit/Write/Bash attempt
2. FORCE — tell the model exactly which facts to gather
3. ALLOW — permit retry after facts are presented
```

No competitor does all three. Most stop at deny.

## Evidence

Two independent A/B tests, identical agents, same task:

| Task | Gated | Ungated | Gap |
| --- | --- | --- | --- |
| Analytics module | 8.0/10 | 6.5/10 | +1.5 |
| Webhook validator | 10.0/10 | 7.0/10 | +3.0 |
| **Average** | **9.0** | **6.75** | **+2.25** |

Both agents produce code that runs and passes tests. The difference is design depth.

## Gate Types

### Edit / MultiEdit Gate (first edit per file)

MultiEdit is handled identically — each file in the batch is gated individually.

NotebookEdit は `notebook_path` への Edit として扱われます（同じクラス・チェック済みキー・クレジット・上限の規則。セル内容は読まないため常に完全な質問になり、コメントのみの通過はありません）。

質問内容は対象ファイルのクラスによって変わります（[対象クラス別の質問](#対象クラス別の質問)を参照）。以下は **code** クラスの Edit ゲートの質問です。

```
Before editing {file_path}, present these facts:

1. List ALL files that import/require this file (search the tree — Glob/Grep, or find/grep via Bash)
2. List the public functions/classes affected by this change
3. If this file reads/writes data files, show field names, structure,
   and date format (use redacted or synthetic values, not raw production data)
4. Quote the user's current instruction verbatim
```

### Write Gate (first new file creation)

以下は **code** クラスの Write ゲートの質問です。

```
Before creating {file_path}, present these facts:

1. Name the file(s) and line(s) that will call this new file
2. Confirm no existing file serves the same purpose (search the tree — Glob/Grep, or find/grep via Bash)
3. If this file reads/writes data files, show field names, structure,
   and date format (use redacted or synthetic values, not raw production data)
4. Quote the user's current instruction verbatim
```

### 対象クラス別の質問

初回の Edit/Write ゲートは対象ファイルを分類し、最初に一致したクラスの質問を使います。分類にはプロジェクトルート（`CLAUDE_PROJECT_DIR`、次にペイロードの `cwd`、次にプロセスのディレクトリ）からの相対パスを使うため、`~/work/tests/` のような場所にあるプロジェクトでも全ファイルが test になることはありません。先頭の `.claude/worktrees/<name>/` は `<root>/.claude/worktrees/<name>/.git` が存在する場合にだけ取り除きます。Windows 形式のパスでは末尾のドット・空白と `:stream` 接尾辞を除いてから分類します（`CLAUDE.md.` や `CLAUDE.md::$DATA` は `CLAUDE.md` として扱います）。ルート外の対象は絶対パスで分類します。パスは小文字化・`/` 区切りで、次の順に判定します。

1. **instruction** — `CLAUDE.md`、`AGENTS.md`、`AGENT.md`、`GEMINI.md`、`SKILL.md`、`copilot-instructions.md`、`.cursorrules`、`.windsurfrules`、任意の `.mdc`、`.claude`、`agents`、`commands`、`skills`、`rules`、`hooks`、`.cursor`、`.codex`、`.opencode` ディレクトリ配下の `.md`/`.mdx`/`.txt`、または `.github/` 配下の `*instructions*.md`
2. **test** — `*.test.*`、`*.spec.*`、`test_*.py`、`*_test.py`、`*_test.go`、または `tests`、`test`、`__tests__` 配下
3. **prose** — `.md`、`.mdx`、`.txt`、`.rst`、`.adoc`
4. **config** — `.json`、`.jsonc`、`.yaml`、`.yml`、`.toml`、`.ini`、またはコード拡張子で終わらない `.env` / `.env.*`（`.env.local` は config、`.env.example.ts` と `.envrc` は code）
5. **code** — 上記以外（上に示した質問）

どのクラスも最後に「ユーザーの現在の指示を原文のまま引用する」項目が付きます。質問文（英語、hook の出力そのまま）は次のとおりです。*(search)* は "(search the tree — Glob/Grep, or find/grep via Bash)" の略です。

| クラス | 質問 |
|---|---|
| instruction | Name the harness/loader that reads this file (Claude Code, Codex, Cursor, OpenCode, …) and when it loads it · Describe what agent behaviour changes as a result · Confirm no existing instruction, skill, or agent file already covers this *(search)* |
| test | Name what behaviour is under test and which module/function it exercises · Name the existing test file(s) covering this module, or confirm none exist *(search)* |
| prose (Write) | Name any existing doc this supersedes or duplicates *(search)* · State where it will be linked or referenced from · Explain why a new file rather than editing an existing one |
| prose (Edit) | List other docs or code that reference the section being changed *(search)* · State what the change corrects or adds |
| config | Name which process/tool reads this file and when · Describe the effect of the change · Confirm no secrets or credentials are being written in plain text |

code クラスでは変更内容も読み、公開宣言に触れない Edit には importer/公開 API の代わりに「このファイルまたはモジュール内で変更された振る舞いに依存する呼び出し箇所」を尋ね、データを扱わない変更ではデータ形式の質問を省きます（未対応の拡張子、64 KiB 超などの判定不能な変更と機密対象では従来の 4 問のままです）。

メッセージの文面以外でクラスが影響するのは兄弟ファイル集約だけです（集約できるクラスと、同じクラス同士でのみ集約されること）。

### Destructive Bash Gate (every destructive command)

Triggers on: `rm -rf`, `git reset --hard`, `git push --force`, `drop table`, etc.

```
1. List all files/data this command will modify or delete
2. Write a one-line rollback procedure
3. Quote the user's current instruction verbatim
```

### Routine Bash Gate (once per session)

```
1. The current user request in one sentence
2. What this specific command verifies or produces
```

このゲートが発火するまでは、読み取り専用のコマンド（`ls`、`cat`、`rg`、`git status`/`log`/`diff`、`Get-ChildItem` など。リダイレクト、置換、`tee`、`xargs`、未知のコマンドを含まないもの）はゲートを消費せずに通過し `routine_readonly_passes` に数えます。セッション ID またはトランスクリプトパスで識別される状態は 8 時間、プロジェクトディレクトリによるフォールバックは 30 分の無操作で失効し、サブエージェントでも機密対象はパスごとに 1 回拒否されます（親のゲートは解除されません）。

## すでに済んでいるとみなされるもの

調査がすでに行われたことがトランスクリプトから確認できる場合、または前回の拒否と同じ回答になる場合、ゲートは拒否の代わりに注記（`additionalContext`）付きで通過させます。判断が曖昧な場合は常に従来どおり拒否します。

- **事前検索のクレジット:** 現在の人間のターン内で、`Glob`、`Grep`、`LS`、または `rg`/`grep`/`git grep`/`git ls-files`/`find`/`fd`/`ls`/`tree`/`Get-ChildItem`/`Select-String` などで始まる Bash/PowerShell コマンドが完了していれば、初回タッチを満たしたとみなします。**`Read` は対象外です。**
  - **ターン:** 最新の実際のユーザーメッセージ、またはコンパクション（compact summary レコードや `compact_boundary`）から始まります。コンパクション前の検索は数えません。読むのはトランスクリプト末尾（256 KiB / 2000 行）だけで、ターン開始がその範囲より前にある場合は範囲全体を現在のターンとみなします。ターン開始がまったくないトランスクリプトではクレジットしません。
  - **結果:** エラーでない `tool_result` が必要です（`is_error` が `true`/`"true"`、または内容が `<tool_use_error>` で始まるものはエラー）。同じ tool_use id が複数回現れる検索は数えません。
  - **同一バッチの除外:** ゲート対象の呼び出しと同じアシスタントメッセージ内の検索は数えません。`tool_use_id` がない、またはトランスクリプトに見つからない場合は、ターン内の最新のアシスタントメッセージを除外します。message id のない検索は数えません。
  - **語幹一致:** ファイル名の語幹（4 文字以上、`index`・`utils`・`config` などの汎用名は除外）が、英数字以外の文字または端で区切られた単語として検索文字列に現れる必要があります（`payment.py` は `payment` や `payment_service` の検索で一致し、`payments` では一致しません）。テスト対象では先にテストの接辞を 1 つ外します（`.test`、`.spec`、Python と Go の `test_`/`_test`）。`rg tokenizer src tests` は `tests/tokenizer.test.js` をクレジットしますが、`index.test.js` は汎用名 `index` になるため一致しません。
  - **除外は数えない:** Grep の `glob` はトップレベルのカンマで分割し、`!` で始まるものは除外です。シェルでは `rg -g`/`--glob`/`--iglob` の `!` 値、`grep --exclude`/`--exclude-dir`、`fd -E`、`ls -I`、`tree -I`、`git ls-files -x`、git の `:!x` パススペック、`-not`/`!` 付きまたは `-prune` が続く `find -name`/`-path`、PowerShell の `-Exclude` が除外です。除外は語幹の出どころになりません。除外が対象（ファイル名またはパス上のディレクトリ、または語幹）に当たる検索はその対象を一切クレジットしません（`rg -g '!widget.py' TODO .` は `widget.py` をクレジットせず、`rg -g '!*.md' widget .` はクレジットします）。`--exclude-from`/`--ignore-file` を含むセグメントはクレジットしません。`*.py`・`--include`・`find -name` などのファイル名グロブで絞った検索は、対象のファイル名に一致する場合だけ語幹一致を数えます。
  - **範囲:** `Glob`/`Grep`/`LS` は検索したディレクトリ（`path`、なければツールの `cwd`、Glob はパターンのリテラル部分を加える）の内側にある対象だけをクレジットします。対象自体を読むだけのシェルセグメント（例: `ls src/a.py`）や、パス引数がなく再帰でもない・パイプで stdin を読むセグメントは検索とみなしません。`$( )`、バッククォート、`<( )`、`>( )`、ヒアドキュメントを含むコマンドは対象外です。シェルセグメントは、パス引数（なければ `cwd`）の内側にある対象だけをクレジットします（`rg payment docs` は `src/payment.py` をクレジットしません）。引数より前の入力リダイレクト（`rg payment < file`）は stdin とみなし、別の呼び出しで `cd` した後の相対パス引数は数えません。
  - **ディレクトリ一致:** まだ存在しないファイルを作成する Write だけが、対象のディレクトリそのものを指す検索でも一致します（Glob の `path` とリテラル接頭辞、Grep/LS の `path`、シェルのパス引数）。シェル引数では grep 系のパターン引数や値を取るフラグの値を除き、今実在するディレクトリだけを数えます。ターン内のいずれかの Bash/PowerShell 呼び出しに `cd`/`pushd`/`Set-Location` などがあれば、そのターンのシェルのディレクトリ一致は無効です。Edit、MultiEdit、既存ファイルを上書きする Write は語幹一致のみです。
  - 相対パスはツールの `cwd`、次に `CLAUDE_PROJECT_DIR`、次にプロセスのディレクトリを基準に解決します。トランスクリプトが読めない等の問題があれば拒否に戻ります。
  - 機密でない対象が拒否され、ターン内にそのファイルに触れたがクレジットにならなかった呼び出しがある場合、拒否に「Closest search this turn did not count (...)」の 1 行を加え、最も近いものとその理由（同一バッチ、除外、範囲外、stdin、検索ではない `Read` 等、汎用すぎる名前）を示します（詳細はサニタイズして 60 文字まで）。
- **同一ターンの兄弟ファイル作成の集約:** まだ存在しないファイルへの Write（code、test、prose クラスのみ）が拒否された後、**同じクラス・同じディレクトリ**への新規ファイル Write は、同じターン内であれば注記付きで許可されます。ターン ID はターン開始レコード自身の `promptId`、なければその `uuid`、なければそのハッシュです（末尾範囲にターン開始がない場合は、範囲内のユーザーレコードの `promptId` がすべて一致するときだけ使います）。120 秒ルールはトランスクリプトのパスがまったくない場合に限られ、トランスクリプトが存在しない・読めない・ターン ID が得られない場合は集約されません。config・instruction ファイル、`.` で始まるセグメント（ドットファイルとすべてのドットディレクトリ）や 8.3 短縮名を含むパスは集約されません。ディレクトリはシンボリックリンクを解決した実体でも同じ判定を行い、実体のディレクトリをキーにします。Edit/MultiEdit も集約されません。
- **コメント・空白のみの Edit:** 対応言語の機密でない code/test/prose ファイルに対し、コメントと空白だけが変わる Edit（MultiEdit はそのファイルの全エントリ）は注記付きで通過し、`trivial_allows` に数えます。チェック済みにはしないため、コードを変える次の変更は通常どおりゲートされます（Write、Python のインデント変更、複数行文字列などを含む変更は対象外）。
- **正規化パスキー:** 相対パスはツールの `cwd` を基準に解決され、`a.py`、`./a.py`、絶対パスは同じファイルとして扱われ、初回タッチは 1 回だけです。
- **セッション内カウンター:** 状態ファイルに `fact_force_credited`、`denials_by_class`、`credited_by_class`、`sibling_allows`、`dir_gates`、`cap_allows` を記録します（クラス名のみ記録し、パスは記録しません。`dir_gates` はサニタイズ済みの最初のファイル名のみ保持、最大 50 件）。
- **拒否の上限（オプトイン）:** `GATEGUARD_FACT_FORCE_MAX_DENIALS` を設定すると、セッション内の初回タッチ拒否がその回数に達した後の新しいパスは拒否されずに通過します（`cap_allows` に記録）。`GATEGUARD_FACT_FORCE_FULL_DENIALS` はメッセージの詳しさ（メッセージ予算）だけを変えますが、こちらはブロックするかどうか（拒否予算）を変えます。事前検索のクレジットと兄弟ファイル集約が先に判定され、上限を消費しません。不正な値は上限なしとして扱い、stderr に 1 回警告します。
- **機密対象:** `.env`/`.env.*`、`*.pem`・`*.key`・`*.p12`・`*.pfx`、`id_rsa*`・`id_ed25519*`・`id_ecdsa*`・`id_dsa*`・`.netrc`・`.pgpass`・`credentials*`・`secrets.*`、パスセグメントが `auth`・`authn`・`authz`・`security`・`secrets`・`payment`・`payments`・`billing`・`migrations` のいずれかと完全一致するもの、`.github/workflows/` 配下は、クレジット・集約・上限のいずれも適用されず、初回タッチで必ず拒否されます。判定は字句上のパスとシンボリックリンクを解決した実体の両方で行い（`src/tools -> ../auth` なら `src/tools/login.py` も機密）、実体を解決できない場合は機密とみなします。判定順は exempt → subagent → checked → 機密またはハードリンク? → クレジット → 兄弟集約 → 上限 → 拒否です。`GATEGUARD_EXEMPT_GLOBS` による除外は最優先で、機密対象やハードリンク対象にも適用されます。
- **ハードリンク対象:** リンク数が 2 以上のファイル（またはそれを指すシンボリックリンク）は別名から到達できるため、機密対象と同じくクレジット・変更プロファイル・コメントのみの通過・兄弟集約・上限・サブエージェントの通過が適用されません。拒否には機密の行の代わりに「Hard-linked target: ...」の行が付きます。存在しない新規ファイル以外の stat エラーはハードリンクとみなします。
- **判定メトリクス（オプトイン）:** `GATEGUARD_METRICS=1` で各判定を `<GATEGUARD_STATE_DIR>/metrics.jsonl` に 1 行ずつ記録します（パス・コマンド・内容は記録せず、1 MiB で `.1` にローテーション）。集計は `node scripts/gateguard-report.js [--dir <path>] [--json]` です。
- **互換性:** 新しい環境変数はオプトインの `GATEGUARD_FACT_FORCE_MAX_DENIALS` と `GATEGUARD_METRICS` のみです。サブエージェントによる機密・ハードリンク対象への初回タッチと、各ノートブックへの最初の NotebookEdit（以前はゲート対象外）を除き、以前許可されていた操作が拒否されることはありません。
- **信頼の限界:** クレジットはローカルのトランスクリプトを読むため、エージェントが理論上それを書き換えられます。検証するのは行動（検索が実行され結果が返ったこと）であり、意図ではありません。

## Quick Start

### Option A: Use the ECC hook (zero install)

The hook at `scripts/hooks/gateguard-fact-force.js` is included in this plugin. Enable it via hooks.json.

If GateGuard blocks setup or repair work, start the session with
`ECC_GATEGUARD=off`. For hook-level control, keep using
`ECC_DISABLED_HOOKS` with the GateGuard hook ID.

### Option B: Full package with config

```bash
pip install gateguard-ai
gateguard init
```

This adds `.gateguard.yml` for per-project configuration (custom messages, ignore paths, gate toggles).

## Anti-Patterns

- **Don't use self-evaluation instead.** "Are you sure?" always gets "yes." This is experimentally verified.
- **Don't skip the data schema check.** Both A/B test agents assumed ISO-8601 dates when real data used `%Y/%m/%d %H:%M`. Checking data structure (with redacted values) prevents this entire class of bugs.
- **Don't gate every single Bash command.** Routine bash gates once per session. Destructive bash gates every time. This balance avoids slowdown while catching real risks.

## Best Practices

- Let the gate fire naturally. Don't try to pre-answer the gate questions — the investigation itself is what improves quality.
- Customize gate messages for your domain. If your project has specific conventions, add them to the gate prompts.
- Use `.gateguard.yml` to ignore paths like `.venv/`, `node_modules/`, `.git/`.

## Related Skills

- `safety-guard` — Runtime safety checks (complementary, not overlapping)
- `code-reviewer` — Post-edit review (GateGuard is pre-edit investigation)
