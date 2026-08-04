# HOOK-FIX-20260421 Addendum — v2.1.116 argv 重複バグ

朝セッションで commit 527c18b として修正済み。夜セッションで追加検証と、
朝fix でカバーしきれない Claude Code 固有のバグを特定したので補遺を記録する。

## 朝fixの形式

```json
"command": "C:/Users/sugig/.claude/skills/continuous-learning/hooks/observe-wrapper.sh pre"
```

`.sh` ファイルを直接 command にする形式。Git Bash が shebang 経由で実行する前提。

## 夜 追加検証で判明したこと

Node.js の `child_process.spawn` で `.sh` ファイルを直接実行すると Windows では
**EFTYPE** で失敗する：

```js
spawn('C:/Users/sugig/.claude/skills/continuous-learning/hooks/observe-wrapper.sh',
      ['post'], {stdio:['pipe','pipe','pipe']});
// → Error: spawn EFTYPE (errno -4028)
```

`shell:true` を付ければ cmd.exe 経由で実行できるが、Claude Code 側の実装
依存のリスクが残る。

## 夜 適用した追加 fix

第1トークンを `bash`（PATH 解決）に変えた明示的な呼び出しに更新：

```json
{
  "hooks": {
    "PreToolUse": [{
      "matcher": "*",
      "hooks": [{
        "type": "command",
        "command": "bash \"C:/Users/sugig/.claude/skills/continuous-learning/hooks/observe-wrapper.sh\" pre"
      }]
    }],
    "PostToolUse": [{
      "matcher": "*",
      "hooks": [{
        "type": "command",
        "command": "bash \"C:/Users/sugig/.claude/skills/continuous-learning/hooks/observe-wrapper.sh\" post"
      }]
    }]
  }
}
```

この形式は `~/.claude/hooks/hooks.json` 内の ECC 正規 observer 登録と
同じパターンで、現実にエラーなく動作している実績あり。

### Node spawn 検証

```js
spawn('bash "C:/Users/sugig/.claude/skills/continuous-learning/hooks/observe-wrapper.sh" post',
      [], {shell:true});
// exit=0 → observations.jsonl に正常追記
```

## Claude Code v2.1.116 の argv 重複バグ（詳細）

朝fix docの「Defect 2」として `bash.exe: bash.exe: cannot execute binary file` を
記録しているが、その根本メカニズムが特定できたので記す。

### 再現

```bash
"C:\Program Files\Git\bin\bash.exe" "C:\Program Files\Git\bin\bash.exe"
# stderr: "C:\Program Files\Git\bin\bash.exe: C:\Program Files\Git\bin\bash.exe: cannot execute binary file"
# exit: 126
```

bash は argv[1] を script とみなし読み込もうとする。argv[1] が bash.exe 自身なら
ELF/PE バイナリ検出で失敗 → exit 126。エラー文言は完全一致。

### Claude Code 側の挙動

hook command が `"C:\Program Files\Git\bin\bash.exe" "C:\Users\...\wrapper.sh"`
のとき、v2.1.116 は**第1トークン（= bash.exe フルパス）を argv[0] と argv[1] の
両方に渡す**と推定される。結果 bash は argv[1] = bash.exe を script として
読み込もうとして 126 で落ちる。

### 回避策

第1トークンを bash.exe のフルパス＋スペース付きパスにしないこと：
1. `OK:` `bash` （PATH 解決の単一トークン）— 夜fix / hooks.json パターン
2. `OK:` `.sh` 直接パス（Claude Code の .sh ハンドリングに依存）— 朝fix
3. `BAD:` `"C:\Program Files\Git\bin\bash.exe" "<path>"` — 1トークン目が quoted で空白込み

## 結論

朝fix（直接 .sh 指定）と夜fix（明示的 bash prefix）のどちらも argv 重複バグを
踏まないが、**夜fixの方が Claude Code の実装依存が少ない**ため推奨。

ただし朝fix commit 527c18b は既に docs/fixes/ に入っているため、この Addendum を
追記することで両論併記とする。次回 CLI 再起動時に夜fix の方が実運用に残る。

## 関連

- 朝 fix commit: 527c18b
- 朝 fix doc: docs/fixes/HOOK-FIX-20260421.md
- 朝 apply script: docs/fixes/apply-hook-fix.sh
- 夜 fix 記録（ローカル）: C:\Users\sugig\Documents\Claude\Projects\ECC作成\hook-fix-report-20260421.md
- 夜 fix 適用ファイル: C:\Users\sugig\.claude\settings.local.json
- 夜 backup: C:\Users\sugig\.claude\settings.local.json.bak-hook-fix-20260421
