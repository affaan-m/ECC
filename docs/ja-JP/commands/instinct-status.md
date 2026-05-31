---
name: instinct-status
description: すべての学習済みインスティンクトと信頼度レベルを表示
command: true
---

# インスティンクトステータスコマンド

すべての学習済みインスティンクトを信頼度スコアとともに、ドメインごとにグループ化して表示します。

## 実装

`hooks/hooks.json` や他のスラッシュコマンドと同じ順序（`CLAUDE_PLUGIN_ROOT`、標準インストール、既知のプラグインルート、プラグインキャッシュ、最後に `~/.claude`）でアクティブな ECC ルートを解決してから、インスティンクト CLI を実行します。これにより、プラグインが有効でもスラッシュコマンドのシェルで `CLAUDE_PLUGIN_ROOT` が空の場合に、古い手動インストールを読んでしまう問題を避けます (#2037)。

```bash
ECC_ROOT="${CLAUDE_PLUGIN_ROOT:-$(node -e "var r=(()=>{var e=process.env.CLAUDE_PLUGIN_ROOT;if(e&&e.trim())return e.trim();var p=require('path'),f=require('fs'),h=require('os').homedir(),d=p.join(h,'.claude'),q=p.join('scripts','lib','utils.js');if(f.existsSync(p.join(d,q)))return d;for(var s of [["ecc"],["ecc@ecc"],["marketplace","ecc"],["everything-claude-code"],["everything-claude-code@everything-claude-code"],["marketplace","everything-claude-code"]]){var l=p.join(d,'plugins',...s);if(f.existsSync(p.join(l,q)))return l}try{for(var g of ["ecc","everything-claude-code"]){var b=p.join(d,'plugins','cache',g);for(var o of f.readdirSync(b,{withFileTypes:true})){if(!o.isDirectory())continue;for(var v of f.readdirSync(p.join(b,o.name),{withFileTypes:true})){if(!v.isDirectory())continue;var c=p.join(b,o.name,v.name);if(f.existsSync(p.join(c,q)))return c}}}}catch(x){}return d})();console.log(r)")}"
python3 "$ECC_ROOT/skills/continuous-learning-v2/scripts/instinct-cli.py" status
```

## 使用方法

```
/instinct-status
```

## 実行内容

1. 現在のプロジェクトコンテキスト（git remote / パスハッシュ）を検出する
2. `~/.claude/homunculus/projects/<project-id>/instincts/` からプロジェクトのインスティンクトを読み込む
3. `~/.claude/homunculus/instincts/` からグローバルインスティンクトを読み込む
4. 優先順位ルールで統合する（ID が衝突した場合はプロジェクト側がグローバル側を上書き）
5. ドメインごとにグループ化し、信頼度バーと観察統計を表示する

## 出力形式

```
 instinctステータス
==================

## コードスタイル (4 instincts)

### prefer-functional-style
トリガー: 新しい関数を書くとき
アクション: クラスより関数型パターンを使用
信頼度: ████████░░ 80%
ソース: session-observation | 最終更新: 2025-01-22

### use-path-aliases
トリガー: モジュールをインポートするとき
アクション: 相対インポートの代わりに@/パスエイリアスを使用
信頼度: ██████░░░░ 60%
ソース: repo-analysis (github.com/acme/webapp)

## テスト (2 instincts)

### test-first-workflow
トリガー: 新しい機能を追加するとき
アクション: テストを先に書き、次に実装
信頼度: █████████░ 90%
ソース: session-observation

## ワークフロー (3 instincts)

### grep-before-edit
トリガー: コードを変更するとき
アクション: Grepで検索、Readで確認、次にEdit
信頼度: ███████░░░ 70%
ソース: session-observation

---
合計: 9 instincts (4個人, 5継承)
オブザーバー: 実行中 (最終分析: 5分前)
```

## フラグ

現在の `status` サブコマンドには追加のフィルターフラグはありません。必要な場合は出力を確認してから、`/instinct-export` または `/promote` で対象を絞り込んでください。
