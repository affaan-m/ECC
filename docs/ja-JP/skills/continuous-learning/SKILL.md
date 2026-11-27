---
name: continuous-learning
description: Claude Codeセッションから再利用可能なパターンを自動的に抽出し、将来の使用のために学習済みスキルとして保存します。
---

# 継続学習スキル

Claude Codeセッションを終了時に自動的に評価し、学習済みスキルとして保存できる再利用可能なパターンを抽出します。

## 動作原理

このスキルは各セッション終了時に**Stopフック**として実行されます:

1. **セッション評価**: セッションに十分なメッセージがあるか確認(デフォルト: 10以上)
2. **パターン検出**: セッションから抽出可能なパターンを識別
3. **スキル抽出**: 有用なパターンを`~/.claude/skills/learned/`に保存

## 設定

`config.json`を編集してカスタマイズ:

```json
{
  "min_session_length": 10,
  "extraction_threshold": "medium",
  "auto_approve": false,
  "learned_skills_path": "~/.claude/skills/learned/",
  "patterns_to_detect": [
    "error_resolution",
    "user_corrections",
    "workarounds",
    "debugging_techniques",
    "project_specific"
  ],
  "ignore_patterns": [
    "simple_typos",
    "one_time_fixes",
    "external_api_issues"
  ]
}
```

## パターンの種類

| パターン | 説明 |
|---------|-------------|
| `error_resolution` | 特定のエラーの解決方法 |
| `user_corrections` | ユーザー修正からのパターン |
| `workarounds` | フレームワーク/ライブラリの癖への解決策 |
| `debugging_techniques` | 効果的なデバッグアプローチ |
| `project_specific` | プロジェクト固有の規約 |

## フック設定

`~/.claude/settings.json`に追加:

```json
{
  "hooks": {
    "Stop": [{
      "matcher": "*",
      "hooks": [{
        "type": "command",
        "command": "~/.claude/skills/continuous-learning/evaluate-session.sh"
      }]
    }]
  }
}
```

## Stopフックを使用する理由

- **軽量**: セッション終了時に1回だけ実行
- **ノンブロッキング**: すべてのメッセージにレイテンシを追加しない
- **完全なコンテキスト**: セッション全体のトランスクリプトにアクセス可能

## 関連項目

- [The Longform Guide](https://x.com/affaanmustafa/status/2014040193557471352) - 継続学習に関するセクション
- `/learn`コマンド - セッション中の手動パターン抽出

---

## 比較ノート (調査: 2025年1月)

### vs Homunculus

Homunculus v2はより洗練されたアプローチを採用:

| 機能 | このアプローチ | Homunculus v2 |
|---------|--------------|---------------|
| 観察 | Stopフック(セッション終了時) | PreToolUse/PostToolUseフック(100%信頼性) |
| 分析 | メインコンテキスト | バックグラウンドエージェント(Haiku) |
| 粒度 | 完全なスキル | 原子的な「本能」 |
| 信頼度 | なし | 0.3-0.9の重み付け |
| 進化 | 直接スキルへ | 本能 → クラスタ → スキル/コマンド/エージェント |
| 共有 | なし | 本能のエクスポート/インポート |

**homunculusからの重要な洞察:**
> "v1はスキルに観察を依存していました。スキルは確率的で、発火率は約50-80%です。v2は観察にフック(100%信頼性)を使用し、学習された振る舞いの原子単位として本能を使用します。"

### v2の潜在的な改善

1. **本能ベースの学習** - 信頼度スコアリングを持つ、より小さく原子的な振る舞い
2. **バックグラウンド観察者** - 並行して分析するHaikuエージェント
3. **信頼度の減衰** - 矛盾した場合に本能の信頼度が低下
4. **ドメインタグ付け** - コードスタイル、テスト、git、デバッグなど
5. **進化パス** - 関連する本能をスキル/コマンドにクラスタ化

詳細: `docs/continuous-learning-v2-spec.md`を参照。
