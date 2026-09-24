# フック

フックはイベント駆動の自動化で、Claude Codeのツール実行の前後に起動します。コード品質を強制し、ミスを早期に検出し、繰り返しのチェックを自動化します。

## フックの仕組み

```
ユーザーリクエスト → Claudeがツールを選択 → PreToolUseフックが実行 → ツールが実行 → PostToolUseフックが実行
```

- **PreToolUse** フックはツール実行前に動作します。**ブロック**（終了コード2）または**警告**（stderrへの出力、ブロックなし）が可能です。
- **PostToolUse** フックはツール完了後に動作します。出力を分析できますが、ブロックはできません。
- **Stop** フックはClaudeの各レスポンス後に動作します。
- **SessionStart/SessionEnd** フックはセッションのライフサイクル境界で動作します。
- **PreCompact** フックはコンテキストのコンパクション前に動作し、状態の保存に役立ちます。

## このプラグインのフック

メモリ永続化ライフサイクルの定義は `hooks/memory-persistence/` にあります。
実行可能なフックグラフは `hooks/hooks.json` のままです。メモリ永続化ディレクトリは、SessionStart、PreCompact、観察、アクティビティ追跡、SessionEndの動作に関する安定したコントラクトです。

## これらのフックを手動でインストールする

Claude Codeを手動でインストールする場合、リポジトリの生の `hooks.json` を `~/.claude/settings.json` に貼り付けたり、`~/.claude/hooks/hooks.json` に直接コピーしたりしないでください。チェックインされたファイルはプラグイン/リポジトリ向けであり、ECCインストーラーを通じてインストールされるか、プラグインとして読み込まれることを想定しています。

代わりにインストーラーを使用することで、フックコマンドが実際のClaudeルートに対して書き換えられます：

```bash
bash ./install.sh --target claude --modules hooks-runtime
```

```powershell
pwsh -File .\install.ps1 --target claude --modules hooks-runtime
```

これにより解決済みのフックが `~/.claude/hooks/hooks.json` にインストールされます。Windowsでは、Claude設定ルートは `%USERPROFILE%\\.claude` です。

### PreToolUseフック

| フック | マッチャー | 動作 | 終了コード |
|------|---------|----------|-----------|
| **開発サーバーブロッカー** | `Bash` | tmux外での `npm run dev` などをブロック — ログアクセスを確保 | 2（ブロック） |
| **Tmuxリマインダー** | `Bash` | 長時間実行コマンド（npm test、cargo build、docker）にtmuxを提案 | 0（警告） |
| **Gitプッシュリマインダー** | `Bash` | `git push` 前に変更のレビューを促す | 0（警告） |
| **コミット前品質チェック** | `Bash` | `git commit` 前に品質チェックを実行：ステージされたファイルのリント、`-m/--message` で提供された場合のコミットメッセージ形式の検証、console.log/debugger/シークレットの検出 | 2（クリティカルをブロック） / 0（警告） |
| **ドキュメントファイル警告** | `Write` | 非標準の `.md`/`.txt` ファイルについて警告（README、CLAUDE、CONTRIBUTING、CHANGELOG、LICENSE、SKILL、docs/、skills/ は許可）；クロスプラットフォームのパス処理 | 0（警告） |
| **戦略的コンパクト** | `Edit\|Write` | 論理的な間隔（約50ツール呼び出しごと）で手動 `/compact` を提案 | 0（警告） |

### PostToolUseフック

| フック | マッチャー | 動作内容 |
|------|---------|-------------|
| **PRロガー** | `Bash` | `gh pr create` 後にPR URLとレビューコマンドをログ記録 |
| **ビルド解析** | `Bash` | ビルドコマンド後にバックグラウンドで解析（非同期、非ブロッキング） |
| **品質ゲート** | `Edit\|Write\|MultiEdit` | 編集後に高速品質チェックを実行 |
| **デザイン品質チェック** | `Edit\|Write\|MultiEdit` | フロントエンドの編集が汎用テンプレート風のUIに偏ったときに警告 |
| **Prettierフォーマット** | `Edit` | 編集後にJS/TSファイルをPrettierで自動フォーマット |
| **TypeScriptチェック** | `Edit` | `.ts`/`.tsx` ファイルの編集後に `tsc --noEmit` を実行 |
| **console.log警告** | `Edit` | 編集されたファイル内の `console.log` 文について警告 |

### ライフサイクルフック

| フック | イベント | 動作内容 |
|------|-------|-------------|
| **セッション開始** | `SessionStart` | 前回のコンテキストを読み込みパッケージマネージャーを検出 |
| **コンパクト前** | `PreCompact` | コンテキストコンパクション前に状態を保存 |
| **Console.log監査** | `Stop` | 各レスポンス後に変更されたすべてのファイルで `console.log` を確認 |
| **セッションサマリー** | `Stop` | トランスクリプトパスが利用可能な場合にセッション状態を永続化 |
| **パターン抽出** | `Stop` | 抽出可能なパターンのセッションを評価（継続的学習） |
| **コストトラッカー** | `Stop` | 軽量な実行コストのテレメトリマーカーを出力 |
| **デスクトップ通知** | `Stop` | タスクサマリー付きのmacOSデスクトップ通知を送信（standard+） |
| **セッション終了マーカー** | `SessionEnd` | ライフサイクルマーカーとクリーンアップログ |

## フックのカスタマイズ

### フックの無効化

`hooks.json` のフックエントリを削除またはコメントアウトします。プラグインとしてインストールされている場合は、`~/.claude/settings.json` でオーバーライドします：

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Write",
        "hooks": [],
        "description": "Override: allow all .md file creation"
      }
    ]
  }
}
```

### ランタイムフック制御（推奨）

`hooks.json` を編集せずに環境変数でフックの動作を制御します：

```bash
# minimal | standard | strict（デフォルト: standard）
export ECC_HOOK_PROFILE=standard

# 特定のフックIDを無効化（カンマ区切り）
export ECC_DISABLED_HOOKS="pre:bash:tmux-reminder,post:edit:typecheck"

# セットアップまたは復旧中にGateGuardのみを無効化
export ECC_GATEGUARD=off

# SessionStart追加コンテキストを制限（デフォルト: 8000文字）
export ECC_SESSION_START_MAX_CHARS=4000

# SessionStart追加コンテキストを完全に無効化
export ECC_SESSION_START_CONTEXT=off
```

プロファイル：
- `minimal` — 必須のライフサイクルフックと安全フックのみを保持。
- `standard` — デフォルト；品質と安全チェックのバランスが取れている。
- `strict` — 追加のリマインダーとより厳格なガードレールを有効化。

### 独自のフックを書く

フックはstdinでJSONとしてツール入力を受け取り、stdoutでJSONを出力するシェルコマンドです。

**基本構造：**

```javascript
// my-hook.js
let data = '';
process.stdin.on('data', chunk => data += chunk);
process.stdin.on('end', () => {
  const input = JSON.parse(data);

  // ツール情報にアクセス
  const toolName = input.tool_name;        // "Edit"、"Bash"、"Write" など
  const toolInput = input.tool_input;      // ツール固有のパラメータ
  const toolOutput = input.tool_output;    // PostToolUseのみ利用可能

  // 警告（非ブロッキング）：stderrに書き込む
  console.error('[Hook] Claudeに表示される警告メッセージ');

  // ブロック（PreToolUseのみ）：終了コード2で終了
  // process.exit(2);

  // 常にstdoutに元のデータを出力
  console.log(data);
});
```

**終了コード：**
- `0` — 成功（実行を継続）
- `2` — ツール呼び出しをブロック（PreToolUseのみ）
- その他の非ゼロ — エラー（ログに記録されるがブロックしない）

### フック入力スキーマ

```typescript
interface HookInput {
  tool_name: string;          // "Bash"、"Edit"、"Write"、"Read" など
  tool_input: {
    command?: string;         // Bash: 実行されるコマンド
    file_path?: string;       // Edit/Write/Read: 対象ファイル
    old_string?: string;      // Edit: 置換されるテキスト
    new_string?: string;      // Edit: 置換テキスト
    content?: string;         // Write: ファイルの内容
  };
  tool_output?: {             // PostToolUseのみ
    output?: string;          // コマンド/ツールの出力
  };
}
```

### 非同期フック

メインフローをブロックしないフック（例：バックグラウンド解析）の場合：

```json
{
  "type": "command",
  "command": "node my-slow-hook.js",
  "async": true,
  "timeout": 30
}
```

非同期フックはバックグラウンドで実行されます。ツールの実行をブロックすることはできません。

## よくあるフックのレシピ

### TODOコメントについて警告する

```json
{
  "matcher": "Edit",
  "hooks": [{
    "type": "command",
    "command": "node -e \"let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{const i=JSON.parse(d);const ns=i.tool_input?.new_string||'';if(/TODO|FIXME|HACK/.test(ns)){console.error('[Hook] New TODO/FIXME added - consider creating an issue')}console.log(d)})\""
  }],
  "description": "Warn when adding TODO/FIXME comments"
}
```

### 大きなファイルの作成をブロックする

```json
{
  "matcher": "Write",
  "hooks": [{
    "type": "command",
    "command": "node -e \"let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{const i=JSON.parse(d);const c=i.tool_input?.content||'';const lines=c.split('\\n').length;if(lines>800){console.error('[Hook] BLOCKED: File exceeds 800 lines ('+lines+' lines)');console.error('[Hook] Split into smaller, focused modules');process.exit(2)}console.log(d)})\""
  }],
  "description": "Block creation of files larger than 800 lines"
}
```

### ruffでPythonファイルを自動フォーマットする

```json
{
  "matcher": "Edit",
  "hooks": [{
    "type": "command",
    "command": "node -e \"let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{const i=JSON.parse(d);const p=i.tool_input?.file_path||'';if(/\\.py$/.test(p)){const{execFileSync}=require('child_process');try{execFileSync('ruff',['format',p],{stdio:'pipe'})}catch(e){}}console.log(d)})\""
  }],
  "description": "Auto-format Python files with ruff after edits"
}
```

### 新しいソースファイルと一緒にテストファイルを要求する

```json
{
  "matcher": "Write",
  "hooks": [{
    "type": "command",
    "command": "node -e \"const fs=require('fs');let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{const i=JSON.parse(d);const p=i.tool_input?.file_path||'';if(/src\\/.*\\.(ts|js)$/.test(p)&&!/\\.test\\.|\\.spec\\./.test(p)){const testPath=p.replace(/\\.(ts|js)$/,'.test.$1');if(!fs.existsSync(testPath)){console.error('[Hook] No test file found for: '+p);console.error('[Hook] Expected: '+testPath);console.error('[Hook] Consider writing tests first (/tdd)')}}console.log(d)})\""
  }],
  "description": "Remind to create tests when adding new source files"
}
```

## クロスプラットフォームの注意事項

フックのロジックはWindows、macOS、Linuxでのクロスプラットフォーム動作のためにNode.jsスクリプトで実装されています。継続的学習オブザーバーはNode-modeフックとして公開され、プロファイルゲート付きのランナーを通じて既存の `observe.sh` 実装に委譲し、Windowsセーフなフォールバック動作を持ちます。

## 関連リンク

- [rules/common/hooks.md](../rules/common/hooks.md) — フックアーキテクチャのガイドライン
- [skills/strategic-compact/](../skills/strategic-compact/) — 戦略的コンパクションのスキル
- [scripts/hooks/](../scripts/hooks/) — フックスクリプトの実装
