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
# Resolve the ECC root the same way /instinct-status does.
ECC_ROOT="$(node -e "var r=(function(){var p=require('path'),f=require('fs'),o=require('os');var e=process.env.CLAUDE_PLUGIN_ROOT;if(e&&e.trim())return e.trim();var d=(process.env.CLAUDE_CONFIG_DIR||'').trim()||p.join(o.homedir(),'.claude');if(d==='~')d=o.homedir();else if(d.charAt(0)==='~'&&(d.charAt(1)==='/'||d.charCodeAt(1)===92))d=p.join(o.homedir(),d.slice(2));try{if(o.platform()==='linux'){var v=f.readFileSync('/proc/version','utf8').toLowerCase();if(v.includes('microsoft')){var b=String.fromCharCode(92),m=d.match(/^([A-Za-z]):/);if(m&&(d.charAt(2)==='/'||d.charAt(2)===b)){var dl=m[1].toLowerCase();d='/mnt/'+dl+d.slice(2).split(b).join('/')}}}}catch(_){}d=p.resolve(d);function L(x){try{return require(p.join(x,'scripts','lib','resolve-ecc-root')).resolveEccRoot({probe:p.join('scripts','harness-audit.js')})}catch(_){return null}}var r=L(d);if(r)return r;var s=['ecc','ecc@ecc','marketplaces/ecc','everything-claude-code','everything-claude-code@everything-claude-code','marketplaces/everything-claude-code'];for(var i=0;i<s.length;i++){r=L(p.join(d,'plugins',s[i]));if(r)return r}function D(x){try{return f.readdirSync(x,{withFileTypes:true}).filter(function(z){return z.isDirectory()}).map(function(z){return z.name})}catch(e){if(e.code==='ENOENT')return [];throw e}}var g=['ecc','everything-claude-code'];for(var j=0;j<g.length;j++){var c=p.join(d,'plugins','cache',g[j]);var O=D(c);for(var k=0;k<O.length;k++){var q=p.join(c,O[k]);var V=D(q);for(var m=0;m<V.length;m++){r=L(p.join(q,V[m]));if(r)return r}}}return d})();console.log(r)")" &&
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
