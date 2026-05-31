---
name: instinct-import
description: チームメイト、Skill Creator、その他のソースからインスティンクトをインポート
command: true
---

# インスティンクトインポートコマンド

## Implementation

Run the instinct CLI after resolving the active ECC root (`CLAUDE_PLUGIN_ROOT`, standard install, plugin roots, plugin cache, then `~/.claude`) so stale manual installs cannot mask the active plugin (#2037):

```bash
ECC_ROOT="${CLAUDE_PLUGIN_ROOT:-$(node -e "var r=(()=>{var e=process.env.CLAUDE_PLUGIN_ROOT;if(e&&e.trim())return e.trim();var p=require('path'),f=require('fs'),h=require('os').homedir(),d=p.join(h,'.claude'),q=p.join('scripts','lib','utils.js');if(f.existsSync(p.join(d,q)))return d;for(var s of [['ecc'],['ecc@ecc'],['marketplace','ecc'],['everything-claude-code'],['everything-claude-code@everything-claude-code'],['marketplace','everything-claude-code']]){var l=p.join(d,'plugins',...s);if(f.existsSync(p.join(l,q)))return l}try{for(var g of ['ecc','everything-claude-code']){var b=p.join(d,'plugins','cache',g);for(var o of f.readdirSync(b,{withFileTypes:true})){if(!o.isDirectory())continue;for(var v of f.readdirSync(p.join(b,o.name),{withFileTypes:true})){if(!v.isDirectory())continue;var c=p.join(b,o.name,v.name);if(f.existsSync(p.join(c,q)))return c}}}}catch(x){}return d})();console.log(r)")}"
python3 "$ECC_ROOT/skills/continuous-learning-v2/scripts/instinct-cli.py" import <file-or-url> [--dry-run] [--force] [--min-confidence 0.7]
```

以下のソースからインスティンクトをインポートできます:
- チームメイトのエクスポート
- Skill Creator（リポジトリ分析）
- コミュニティコレクション
- 以前のマシンのバックアップ

## 使用方法

```
/instinct-import team-instincts.yaml
/instinct-import https://github.com/org/repo/instincts.yaml
/instinct-import --from-skill-creator acme/webapp
```

## 実行内容

1. インスティンクトファイルを取得（ローカルパスまたはURL）
2. 形式を解析して検証
3. 既存のインスティンクトとの重複をチェック
4. 新しいインスティンクトをマージまたは追加
5. `~/.claude/homunculus/instincts/inherited/` に保存

## インポートプロセス

```
 instinctsをインポート中: team-instincts.yaml
================================================

12件のinstinctsが見つかりました。

競合を分析中...

## 新規instincts (8)
以下が追加されます:
  ✓ use-zod-validation (confidence: 0.7)
  ✓ prefer-named-exports (confidence: 0.65)
  ✓ test-async-functions (confidence: 0.8)
  ...

## 重複instincts (3)
類似のinstinctsが既に存在:
  WARNING: prefer-functional-style
     ローカル: 信頼度0.8, 12回の観測
     インポート: 信頼度0.7
     → ローカルを保持 (信頼度が高い)

  WARNING: test-first-workflow
     ローカル: 信頼度0.75
     インポート: 信頼度0.9
     → インポートに更新 (信頼度が高い)

## 競合instincts (1)
ローカルのinstinctsと矛盾:
  FAIL: use-classes-for-services
     競合: avoid-classes
     → スキップ (手動解決が必要)

---
8件を新規追加、1件を更新、3件をスキップしますか?
```

## マージ戦略

### 重複の場合
既存のインスティンクトと一致するインスティンクトをインポートする場合:
- **高い信頼度が優先**: より高い信頼度を持つ方を保持
- **証拠をマージ**: 観察回数を結合
- **タイムスタンプを更新**: 最近検証されたものとしてマーク

### 競合の場合
既存のインスティンクトと矛盾するインスティンクトをインポートする場合:
- **デフォルトでスキップ**: 競合するインスティンクトはインポートしない
- **レビュー用にフラグ**: 両方を注意が必要としてマーク
- **手動解決**: ユーザーがどちらを保持するか決定

## ソーストラッキング

インポートされたインスティンクトは以下のようにマークされます:
```yaml
source: "inherited"
imported_from: "team-instincts.yaml"
imported_at: "2025-01-22T10:30:00Z"
original_source: "session-observation"  # or "repo-analysis"
```

## Skill Creator統合

Skill Creatorからインポートする場合:

```
/instinct-import --from-skill-creator acme/webapp
```

これにより、リポジトリ分析から生成されたインスティンクトを取得します:
- ソース: `repo-analysis`
- 初期信頼度が高い（0.7以上）
- ソースリポジトリにリンク

## フラグ

- `--dry-run`: インポートせずにプレビュー
- `--force`: 競合があってもインポート
- `--merge-strategy <higher|local|import>`: 重複の処理方法
- `--from-skill-creator <owner/repo>`: Skill Creator分析からインポート
- `--min-confidence <n>`: 閾値以上のインスティンクトのみをインポート

## 出力

インポート後:
```
PASS: インポート完了!

追加: 8件のinstincts
更新: 1件のinstinct
スキップ: 3件のinstincts (2件の重複, 1件の競合)

新規instinctsの保存先: ~/.claude/homunculus/instincts/inherited/

/instinct-statusを実行してすべてのinstinctsを確認できます。
```
