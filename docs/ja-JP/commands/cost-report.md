---
description: コストトラッカーSQLiteデータベースからローカルClaude Codeコストレポートを生成します。
argument-hint: [csv]
---

# コストレポート

ローカルのコスト追跡データベースにクエリを実行し、日別、プロジェクト別、ツール別、セッション別の支出レポートを表示します。このコマンドは、コスト追跡フックまたはプラグインが既に`~/.claude-cost-tracker/usage.db`に使用行を書き込んでいることを前提としています。

## このコマンドの動作

1. `sqlite3`が利用可能か確認する。
2. `~/.claude-cost-tracker/usage.db`が存在するか確認する。
3. `usage`テーブルに対して集計クエリを実行する。
4. コンパクトなレポートを表示するか、引数が`csv`の場合は最近の行をCSVとしてエクスポートする。

## 前提条件

データベースはローカルのコストトラッカーによって入力されている必要があります。ファイルが存在しない場合、トラッカーがセットアップされていないことをユーザーに伝え、信頼できるClaude Codeコスト追跡フック/プラグインのインストールまたは有効化を先に提案します。

```bash
test -f ~/.claude-cost-tracker/usage.db && echo "Database found" || echo "Database not found"
```

## サマリークエリ

```bash
sqlite3 -header -column ~/.claude-cost-tracker/usage.db "
  SELECT
    ROUND(COALESCE(SUM(CASE WHEN date(timestamp) = date('now') THEN cost_usd END), 0), 4) AS today_cost,
    ROUND(COALESCE(SUM(CASE WHEN date(timestamp) = date('now', '-1 day') THEN cost_usd END), 0), 4) AS yesterday_cost,
    ROUND(COALESCE(SUM(cost_usd), 0), 4) AS total_cost,
    COUNT(*) AS total_calls,
    COUNT(DISTINCT session_id) AS sessions
  FROM usage;
"
```

## プロジェクト別内訳

```bash
sqlite3 -header -column ~/.claude-cost-tracker/usage.db "
  SELECT project, ROUND(SUM(cost_usd), 4) AS cost, COUNT(*) AS calls
  FROM usage
  GROUP BY project
  ORDER BY cost DESC;
"
```

## ツール別内訳

```bash
sqlite3 -header -column ~/.claude-cost-tracker/usage.db "
  SELECT tool_name, ROUND(SUM(cost_usd), 4) AS cost, COUNT(*) AS calls
  FROM usage
  GROUP BY tool_name
  ORDER BY cost DESC;
"
```

## 直近7日間

```bash
sqlite3 -header -column ~/.claude-cost-tracker/usage.db "
  SELECT date(timestamp) AS date, ROUND(SUM(cost_usd), 4) AS cost, COUNT(*) AS calls
  FROM usage
  GROUP BY date(timestamp)
  ORDER BY date DESC
  LIMIT 7;
"
```

## CSVエクスポート

ユーザーが`/cost-report csv`を要求した場合、明示的なカラムリストで最新の使用行をエクスポート:

```bash
sqlite3 -csv -header ~/.claude-cost-tracker/usage.db "
  SELECT timestamp, project, tool_name, input_tokens, output_tokens, cost_usd, session_id, model
  FROM usage
  ORDER BY timestamp DESC
  LIMIT 100;
"
```

## レポートフォーマット

レスポンスを以下のフォーマットで整形:

1. サマリー: 今日、昨日、合計、呼び出し回数、セッション数。
2. プロジェクト別: 合計コスト順にランク付けされたプロジェクト。
3. ツール別: 合計コスト順にランク付けされたツール。
4. 直近7日間: 日付、コスト、呼び出し回数。

1ドル未満の金額は小数点以下4桁を使用する。このコマンドでは生のトークンから料金を見積もらない。トラッカーが書き込んだ事前計算済みの`cost_usd`値に依存する。

## ソース

`MayurBhavsar`氏の古いコミュニティPR #1304から復活。
