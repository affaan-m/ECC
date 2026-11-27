# チェックポイントコマンド

ワークフロー内でチェックポイントを作成または検証します。

## 使用します方法

`/checkpoint [create|verify|list] [name]`

## チェックポイント作成

チェックポイントを作成する場合：

1. `/verify quick` を実行して現在の状態が clean であることを確認
2. チェックポイント名を使用して git stash またはコミットを作成
3. チェックポイントを `.claude/checkpoints.log` に記録：

```bash
echo "$(date +%Y-%m-%d-%H:%M) | $CHECKPOINT_NAME | $(git rev-parse --short HEAD)" >> .claude/checkpoints.log
```

4. チェックポイント作成を報告

## チェックポイント検証

チェックポイントに対して検証する場合：

1. ログからチェックポイントを読む

2. 現在の状態をチェックポイントと比較：
   * チェックポイント以降に追加されたファイル
   * チェックポイント以降に修正されたファイル
   * 現在のテスト成功率と時時の比較
   * 現在のカバレッジと時時の比較

3. レポート：

```
チェックポイント比較: $NAME
============================
変更されたファイル: X
テスト: +Y 合格 / -Z 失敗
カバレッジ: +X% / -Y%
ビルド: [PASS/FAIL]
```

## チェックポイント一覧表示

すべてのチェックポイントを以下を含めて表示：

* 名前
* タイムスタンプ
* Git SHA
* ステータス（current、behind、ahead）

## ワークフロー

一般的なチェックポイント流：

```
[開始] --> /checkpoint create "feature-start"
   |
[実装] --> /checkpoint create "core-done"
   |
[テスト] --> /checkpoint verify "core-done"
   |
[リファクタリング] --> /checkpoint create "refactor-done"
   |
[PR] --> /checkpoint verify "feature-start"
```

## 引数

$ARGUMENTS:

* `create <name>` - 指定の名前でチェックポイント作成
* `verify <name>` - 指定の名前のチェックポイントに対して検証
* `list` - すべてのチェックポイントを表示
* `clear` - 古いチェックポイント削除（最新 5 個を保持）
