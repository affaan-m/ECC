---
description: 決定論的なリポジトリハーネス監査を実行し、優先順位付きスコアカードを返します。
---

# ハーネス監査コマンド

決定論的なリポジトリハーネス監査を実行し、優先順位付きスコアカードを返します。

## 使い方

`/harness-audit [scope] [--format text|json] [--root path]`

- `scope`（オプション）: `repo`（デフォルト）、`hooks`、`skills`、`commands`、`agents`
- `--format`: 出力スタイル（`text`がデフォルト、自動化には`json`）
- `--root`: 現在の作業ディレクトリの代わりに特定のパスを監査

## 決定論的エンジン

常に実行:

```bash
IFS= read -r ECC_ROOT <<'ECC_PLUGIN_ROOT_LITERAL'
${CLAUDE_PLUGIN_ROOT}
ECC_PLUGIN_ROOT_LITERAL
if [ -z "$ECC_ROOT" ] || [ "$ECC_ROOT" = '$''{CLAUDE_PLUGIN_ROOT}' ] || [ ! -f "$ECC_ROOT/scripts/harness-audit.js" ]; then
  ECC_ROOT="$(node -e "console.log((function(){var p=require('path'),f=require('fs'),o=require('os');var d=(process.env.CLAUDE_CONFIG_DIR||'').trim()||p.join(o.homedir(),'.claude');if(d==='~')d=o.homedir();else if(d.charAt(0)==='~'&&(d.charAt(1)==='/'||d.charCodeAt(1)===92))d=p.join(o.homedir(),d.slice(2));try{if(o.platform()==='linux'){var v=f.readFileSync('/proc/version','utf8').toLowerCase();if(v.includes('microsoft')){var b=String.fromCharCode(92),m=d.match(/^([A-Za-z]):/);if(m&&(d.charAt(2)==='/'||d.charAt(2)===b)){var dl=m[1].toLowerCase();d='/mnt/'+dl+d.slice(2).split(b).join('/')}}}}catch(_){}d=p.resolve(N(d));function N(x){if(o.platform()==='win32'&&x.charAt(0)==='/'&&x.charAt(1).match(/[A-Za-z]/)&&(x.length===2||x.charAt(2)==='/'))return x.charAt(1).toUpperCase()+':/'+x.slice(3);return x}function F(x){try{return f.statSync(x).isFile()}catch(_){return false}}function L(x){x=(x||'').trim();if(x==='')return null;x=p.resolve(N(x));return F(p.join(x,p.join('scripts','harness-audit.js')))?x:null}var r=L(process.env.CLAUDE_PLUGIN_ROOT)||L(process.env.ANTIGRAVITY_PLUGIN_ROOT)||L(process.env.GEMINI_PLUGIN_ROOT)||L(d)||L(p.join(o.homedir(),'.gemini','config','plugins','ecc'));if(r)return r;var s=['ecc','ecc@ecc','marketplaces/ecc','everything-claude-code','everything-claude-code@everything-claude-code','marketplaces/everything-claude-code'];for(var i=0;i<s.length;i++){r=L(p.join(d,'plugins',s[i]));if(r)return r}function D(x){try{return f.readdirSync(x,{withFileTypes:true}).filter(function(z){return z.isDirectory()}).map(function(z){return z.name})}catch(e){if(e.code==='ENOENT')return [];throw e}}var g=['ecc','everything-claude-code'];for(var j=0;j<g.length;j++){var c=p.join(d,'plugins','cache',g[j]);var O=D(c);for(var k=0;k<O.length;k++){var q=p.join(c,O[k]);var V=D(q);for(var m=0;m<V.length;m++){r=L(p.join(q,V[m]));if(r)return r}}}var x=(process.env.OPENCODE_CONFIG_DIR||'').trim(),z=N((process.env.XDG_CONFIG_HOME||'').trim());r=L(x||(z?p.join(z,'opencode'):p.join(o.homedir(),'.config','opencode')));if(r)return r;var a=N((process.env.CLAUDE_PROJECT_DIR||'').trim())||process.cwd(),q=p.join(a,'.claude');return F(p.join(q,'ecc','install-state.json'))||F(p.join(q,'scripts','lib','resolve-ecc-root.js'))?L(q)||'':''})())")" || exit 1
  if [ -z "$ECC_ROOT" ] &&
     [ -f .claude-plugin/plugin.json ] && [ -f scripts/lib/resolve-ecc-root.js ]; then
    ECC_ROOT="$PWD"
  fi
fi
if [ -z "$ECC_ROOT" ] || [ ! -f "$ECC_ROOT/scripts/harness-audit.js" ]; then
  echo 'ECC command script not found. Check the ECC plugin or install directory.' >&2
  exit 1
fi
node "$ECC_ROOT/scripts/harness-audit.js" <scope> --format <text|json> [--root <path>]
```

このスクリプトがスコアリングとチェックの信頼できるソースです。追加のディメンションやアドホックなポイントを作り出さないでください。

ルーブリックバージョン: `2026-03-30`。

スクリプトは7つの固定カテゴリ（各`0-10`正規化）を計算:

1. ツールカバレッジ
2. コンテキスト効率
3. 品質ゲート
4. メモリ永続性
5. 評価カバレッジ
6. セキュリティガードレール
7. コスト効率

スコアは明示的なファイル/ルールチェックから導出され、同じコミットに対して再現可能です。
スクリプトはデフォルトで現在の作業ディレクトリを監査し、対象がECCリポジトリ自体か、ECCを使用するコンシューマプロジェクトかを自動検出します。

## 出力契約

返却内容:

1. `overall_score` / `max_score`（`repo`の場合70、スコープ付き監査ではより小さい）
2. カテゴリスコアと具体的な所見
3. 正確なファイルパス付きの失敗チェック
4. 決定論的出力からのトップ3アクション（`top_actions`）
5. 次に適用すべき推奨ECCスキル

## チェックリスト

- スクリプト出力を直接使用。手動で再スコアリングしない。
- `--format json`が要求された場合、スクリプトJSONをそのまま返す。
- テキストが要求された場合、失敗チェックとトップアクションをサマリー。
- `checks[]`と`top_actions[]`からの正確なファイルパスを含める。

## 結果の例

```text
Harness Audit (repo): 66/70
- Tool Coverage: 10/10 (10/10 pts)
- Context Efficiency: 9/10 (9/10 pts)
- Quality Gates: 10/10 (10/10 pts)

Top 3 Actions:
1) [Security Guardrails] hooks/hooks.jsonにプロンプト/ツールプリフライトセキュリティガードを追加。(hooks/hooks.json)
2) [Tool Coverage] commands/harness-audit.mdと.opencode/commands/harness-audit.mdを同期。(.opencode/commands/harness-audit.md)
3) [Eval Coverage] scripts/hooks/lib全体の自動テストカバレッジを増加。(tests/)
```

## 引数

$ARGUMENTS:
- `repo|hooks|skills|commands|agents`（オプションのスコープ）
- `--format text|json`（オプションの出力形式）
