---
description: ~/.claude/session-data/ から最新のセッションファイルを読み込み、前回のセッションが終了した時点の完全なコンテキストを使って作業を再開します。
---

# セッション再開コマンド

最後に保存されたセッション状態を読み込み、作業を開始する前に完全に状況を把握します。
このコマンドは `/save-session` の対になるものです。

## 使用するタイミング

- 前日の作業を引き継いで新しいセッションを開始するとき
- コンテキストの上限に達して新しいセッションを開始した後
- 別のソースからセッションファイルを受け渡されたとき（ファイルパスを指定するだけです）
- セッションファイルがあり、Claude に作業を続行する前に完全に内容を把握させたいとき

## 使い方

```
/resume-session                                                      # ~/.claude/session-data/ の最新ファイルを読み込む
/resume-session 2024-01-15                                           # その日付の最新セッションを読み込む
/resume-session ~/.claude/session-data/2024-01-15-abc123de-session.tmp  # 現在の短縮IDセッションファイルを読み込む
/resume-session ~/.claude/sessions/2024-01-15-session.tmp               # レガシー形式の特定ファイルを読み込む
```

## プロセス

### ステップ 1: セッションファイルを見つける

引数が指定されていない場合:

1. `~/.claude/session-data/` を確認する
2. 最も新しく更新された `*-session.tmp` ファイルを選択する
3. フォルダが存在しないか、一致するファイルがない場合、ユーザーに以下を通知する:
   ```
   No session files found in ~/.claude/session-data/
   Run /save-session at the end of a session to create one.
   ```
   その後停止する。

引数が指定されている場合:

- 日付形式（`YYYY-MM-DD`）の場合、まず `~/.claude/session-data/` を検索し、次にレガシーの
  `~/.claude/sessions/` を検索して、`YYYY-MM-DD-session.tmp`（レガシー形式）または
  `YYYY-MM-DD-<shortid>-session.tmp`（現在の形式）に一致するファイルを探し、
  その日付で最も新しく更新されたものを読み込む
- ファイルパスの場合、そのファイルを直接読み取る
- 見つからない場合、明確に報告して停止する

### ステップ 2: セッションファイル全体を読み取る

ファイル全体を読み取る。まだ要約はしない。

### ステップ 3: 理解を確認する

以下の正確な形式で構造化されたブリーフィングを返答する:

```
SESSION LOADED: [ファイルへの実際の解決済みパス]
════════════════════════════════════════════════

PROJECT: [ファイルに記載されたプロジェクト名 / トピック]

WHAT WE'RE BUILDING:
[自分の言葉で2〜3文の要約]

CURRENT STATE:
PASS: Working: [数] 件確認済み
 In Progress: [進行中のファイル一覧]
 Not Started: [計画済みだが未着手の一覧]

WHAT NOT TO RETRY:
[失敗したアプローチとその理由をすべて列挙 -- これは非常に重要]

OPEN QUESTIONS / BLOCKERS:
[ブロッカーや未回答の質問を列挙]

NEXT STEP:
[ファイルに定義されている場合は正確な次のステップ]
[定義されていない場合: "No next step defined -- recommend reviewing 'What Has NOT Been Tried Yet' together before starting"]

════════════════════════════════════════════════
Ready to continue. What would you like to do?
```

### ステップ 4: ユーザーを待つ

自動的に作業を開始しない。ファイルに触れない。ユーザーの指示を待つ。

次のステップがセッションファイルに明確に定義されており、ユーザーが「続けて」「はい」などと言った場合、その正確な次のステップを実行する。

次のステップが定義されていない場合、どこから始めるかをユーザーに尋ね、必要に応じて「まだ試していないこと」セクションからアプローチを提案する。

---

## エッジケース

**同じ日付に複数のセッションがある場合** (`2024-01-15-session.tmp`, `2024-01-15-abc123de-session.tmp`):
レガシーのID無し形式か現在の短縮ID形式かに関係なく、その日付で最も新しく更新された一致ファイルを読み込む。

**セッションファイルが存在しないファイルを参照している場合:**
ブリーフィング中にこれを注記する -- "WARNING: `path/to/file.ts` referenced in session but not found on disk."

**セッションファイルが7日以上前のものである場合:**
間隔を注記する -- "WARNING: This session is from N days ago (threshold: 7 days). Things may have changed." -- その後通常通り進める。

**ユーザーがファイルパスを直接指定した場合（例: チームメイトから転送された場合）:**
それを読み取り、同じブリーフィングプロセスに従う -- ソースに関係なく形式は同じ。

**セッションファイルが空または不正な形式の場合:**
報告する: "Session file found but appears empty or unreadable. You may need to create a new one with /save-session."

---

## 出力例

```
SESSION LOADED: /Users/you/.claude/session-data/2024-01-15-abc123de-session.tmp
════════════════════════════════════════════════

PROJECT: my-app — JWT Authentication

WHAT WE'RE BUILDING:
User authentication with JWT tokens stored in httpOnly cookies.
Register and login endpoints are partially done. Route protection
via middleware hasn't been started yet.

CURRENT STATE:
PASS: Working: 3 items (register endpoint, JWT generation, password hashing)
 In Progress: app/api/auth/login/route.ts (token works, cookie not set yet)
 Not Started: middleware.ts, app/login/page.tsx

WHAT NOT TO RETRY:
FAIL: Next-Auth — conflicts with custom Prisma adapter, threw adapter error on every request
FAIL: localStorage for JWT — causes SSR hydration mismatch, incompatible with Next.js

OPEN QUESTIONS / BLOCKERS:
- Does cookies().set() work inside a Route Handler or only Server Actions?

NEXT STEP:
In app/api/auth/login/route.ts — set the JWT as an httpOnly cookie using
cookies().set('token', jwt, { httpOnly: true, secure: true, sameSite: 'strict' })
then test with Postman for a Set-Cookie header in the response.

════════════════════════════════════════════════
Ready to continue. What would you like to do?
```

---

## 注意事項

- セッションファイルを読み込む際に変更しない -- 読み取り専用の履歴記録である
- ブリーフィングの形式は固定 -- セクションが空であっても省略しない
- 「再試行してはいけないこと」は常に表示する。たとえ「なし」であっても -- 見落とすには重要すぎる
- 再開後、ユーザーは新しいセッションの終了時に `/save-session` を再度実行して、新しい日付のファイルを作成したい場合がある
