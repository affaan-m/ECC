> このファイルは [common/hooks.md](../common/hooks.md) を Web 固有のフック推奨事項で拡張します。

# Web フック

## 推奨 PostToolUse フック

プロジェクトローカルのツールを優先する。リモートの使い捨てパッケージ実行にフックを接続しない。

### 保存時フォーマット

編集後にプロジェクトの既存フォーマッタエントリポイントを使用する:

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Write|Edit",
        "command": "pnpm prettier --write \"$FILE_PATH\"",
        "description": "Format edited frontend files"
      }
    ]
  }
}
```

`yarn prettier` や `npm exec prettier --` による同等のローカルコマンドも、リポジトリが所有する依存関係を使用する場合は問題ない。

### リントチェック

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Write|Edit",
        "command": "pnpm eslint --fix \"$FILE_PATH\"",
        "description": "Run ESLint on edited frontend files"
      }
    ]
  }
}
```

### 型チェック

`--incremental` を使用して再実行時に前回の `.tsbuildinfo` を再利用する（変更のないコードでは30-60秒ではなく1-3秒）。`timeout` でラップして、停止した tsc が OS によって回収されるようにする — これにより、編集が tsc の完了よりも速く発生した場合のマルチプロセス蓄積を防止する。

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Write|Edit",
        "command": "timeout 60 pnpm tsc --noEmit --pretty false --incremental --tsBuildInfoFile node_modules/.cache/tsc-hook.tsbuildinfo",
        "description": "Type-check after frontend edits (incremental + timeout-capped)"
      }
    ]
  }
}
```

**両方のフラグが重要な理由:**
- `--incremental` なしでは、すべての編集でプログラム全体をゼロから再チェックする。実際の Next.js プロジェクトでは、これが急速に積み重なる: 5-10秒間隔の編集 + 30-60秒の tsc 実行 = N個の並行 tsc プロセス。
- `timeout` なしでは、ハングした tsc（推移的依存関係の変更、再帰型で停止した型チェッカー）は終了せず、親シェルが終了したときに孤児になる。
- `--tsBuildInfoFile` が必要なのは、`--noEmit` が通常 buildinfo の書き込みを抑制するため。パスを明示的に指定することでインクリメンタルが機能し続ける。

Windows で GNU coreutils がない場合は、`timeout 60` を PowerShell ラッパーに置き換えるか、Stop/SessionEnd フックに頼って停滞した tsc プロセスを掃除する。

### CSS リント

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Write|Edit",
        "command": "pnpm stylelint --fix \"$FILE_PATH\"",
        "description": "Lint edited stylesheets"
      }
    ]
  }
}
```

## PreToolUse フック

### ファイルサイズガード

まだ存在しない可能性のあるファイルからではなく、ツール入力コンテンツからの巨大な書き込みをブロックする:

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Write",
        "command": "node -e \"let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{const i=JSON.parse(d);const c=i.tool_input?.content||'';const lines=c.split('\\n').length;if(lines>800){console.error('[Hook] BLOCKED: File exceeds 800 lines ('+lines+' lines)');console.error('[Hook] Split into smaller modules');process.exit(2)}console.log(d)})\"",
        "description": "Block writes that exceed 800 lines"
      }
    ]
  }
}
```

## Stop フック

### 最終ビルド検証

```json
{
  "hooks": {
    "Stop": [
      {
        "command": "pnpm build",
        "description": "Verify the production build at session end"
      }
    ]
  }
}
```

## 順序

推奨順序:
1. フォーマット
2. リント
3. 型チェック
4. ビルド検証
