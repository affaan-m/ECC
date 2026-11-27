---
name: eval-harness
description: Claude Codeセッションの正式な評価フレームワークで、評価駆動開発（EDD）の原則を実装します
tools: Read, Write, Edit, Bash, Grep, Glob
---

# Eval Harnessスキル

Claude Codeセッションの正式な評価フレームワークで、評価駆動開発（EDD）の原則を実装します。

## 哲学

評価駆動開発は評価を「AI開発のユニットテスト」として扱います：
- 実装前に期待される動作を定義
- 開発中に継続的に評価を実行
- 変更ごとにリグレッションを追跡
- 信頼性測定にpass@kメトリクスを使用

## 評価タイプ

### 能力評価
Claudeが以前できなかったことができるようになったかをテスト：
```markdown
[CAPABILITY EVAL: feature-name]
タスク: Claudeが達成すべきことの説明
成功基準:
  - [ ] 基準1
  - [ ] 基準2
  - [ ] 基準3
期待される出力: 期待される結果の説明
```

### リグレッション評価
変更が既存の機能を破壊しないことを確認：
```markdown
[REGRESSION EVAL: feature-name]
ベースライン: SHAまたはチェックポイント名
テスト:
  - existing-test-1: PASS/FAIL
  - existing-test-2: PASS/FAIL
  - existing-test-3: PASS/FAIL
結果: X/Y 成功（以前は Y/Y）
```

## 評価者タイプ

### 1. コードベース評価者
コードを使用した決定論的チェック：
```bash
# ファイルに期待されるパターンが含まれているかチェック
grep -q "export function handleAuth" src/auth.ts && echo "PASS" || echo "FAIL"

# テストが成功するかチェック
npm test -- --testPathPattern="auth" && echo "PASS" || echo "FAIL"

# ビルドが成功するかチェック
npm run build && echo "PASS" || echo "FAIL"
```

### 2. モデルベース評価者
Claudeを使用して自由形式の出力を評価：
```markdown
[MODEL GRADER PROMPT]
次のコード変更を評価してください：
1. 記述された問題を解決していますか？
2. 構造化されていますか？
3. エッジケースは処理されていますか？
4. エラー処理は適切ですか？

スコア: 1-5（1=不良、5=優秀）
理由: [説明]
```

### 3. 人間評価者
手動レビューのためにフラグを立てる：
```markdown
[HUMAN REVIEW REQUIRED]
変更内容: 何が変更されたかの説明
理由: 人間のレビューが必要な理由
リスクレベル: LOW/MEDIUM/HIGH
```

## メトリクス

### pass@k
「k回の試行で少なくとも1回成功」
- pass@1: 最初の試行での成功率
- pass@3: 3回以内の成功
- 一般的な目標: pass@3 > 90%

### pass^k
「k回の試行すべてが成功」
- より高い信頼性の基準
- pass^3: 3回連続成功
- クリティカルパスに使用

## 評価ワークフロー

### 1. 定義（コーディング前）
```markdown
## 評価定義: feature-xyz

### 能力評価
1. 新しいユーザーアカウントを作成できる
2. メール形式を検証できる
3. パスワードを安全にハッシュ化できる

### リグレッション評価
1. 既存のログインが引き続き機能する
2. セッション管理が変更されていない
3. ログアウトフローが維持されている

### 成功メトリクス
- 能力評価で pass@3 > 90%
- リグレッション評価で pass^3 = 100%
```

### 2. 実装
定義された評価に合格するコードを書く。

### 3. 評価
```bash
# 能力評価を実行
[各能力評価を実行し、PASS/FAILを記録]

# リグレッション評価を実行
npm test -- --testPathPattern="existing"

# レポートを生成
```

### 4. レポート
```markdown
評価レポート: feature-xyz
========================

能力評価:
  create-user:     PASS (pass@1)
  validate-email:  PASS (pass@2)
  hash-password:   PASS (pass@1)
  全体:            3/3 成功

リグレッション評価:
  login-flow:      PASS
  session-mgmt:    PASS
  logout-flow:     PASS
  全体:            3/3 成功

メトリクス:
  pass@1: 67% (2/3)
  pass@3: 100% (3/3)

ステータス: レビュー準備完了
```

## 統合パターン

### 実装前
```
/eval define feature-name
```
`.claude/evals/feature-name.md`に評価定義ファイルを作成

### 実装中
```
/eval check feature-name
```
現在の評価を実行してステータスを報告

### 実装後
```
/eval report feature-name
```
完全な評価レポートを生成

## 評価の保存

プロジェクト内に評価を保存：
```
.claude/
  evals/
    feature-xyz.md      # 評価定義
    feature-xyz.log     # 評価実行履歴
    baseline.json       # リグレッションベースライン
```

## ベストプラクティス

1. **コーディング前に評価を定義** - 成功基準について明確に考えることを強制
2. **頻繁に評価を実行** - リグレッションを早期に検出
3. **時間経過とともにpass@kを追跡** - 信頼性のトレンドを監視
4. **可能な限りコード評価者を使用** - 決定論的 > 確率的
5. **セキュリティは人間レビュー** - セキュリティチェックを完全に自動化しない
6. **評価を高速に保つ** - 遅い評価は実行されない
7. **コードと一緒に評価をバージョン管理** - 評価はファーストクラスの成果物

## 例：認証の追加

```markdown
## EVAL: add-authentication

### フェーズ 1: 定義（10分）
能力評価:
- [ ] ユーザーはメール/パスワードで登録できる
- [ ] ユーザーは有効な資格情報でログインできる
- [ ] 無効な資格情報は適切なエラーで拒否される
- [ ] セッションはページリロード後も持続する
- [ ] ログアウトはセッションをクリアする

リグレッション評価:
- [ ] 公開ルートは引き続きアクセス可能
- [ ] APIレスポンスは変更されていない
- [ ] データベーススキーマは互換性がある

### フェーズ 2: 実装（可変）
[コードを書く]

### フェーズ 3: 評価
Run: /eval check add-authentication

### フェーズ 4: レポート
評価レポート: add-authentication
==============================
能力: 5/5 成功（pass@3: 100%）
リグレッション: 3/3 成功（pass^3: 100%）
ステータス: 出荷可能
```
