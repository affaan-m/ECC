---
description: アクティブなループの状態、進捗、障害シグナル、推奨される介入を検査します。
---

# ループステータスコマンド

アクティブなループの状態、進捗、障害シグナルを検査します。

このスラッシュコマンドは、現在のセッションがデキューした後にのみ実行できます。ウェッジしたセッションやシブリングセッションを検査する必要がある場合は、別のターミナルからパッケージ化されたCLIを実行してください:

```bash
npx --package ecc-universal ecc loop-status --json
```

CLIは`~/.claude/projects/**`配下のローカルClaudeトランスクリプトJSONLファイルをスキャンし、古い`ScheduleWakeup`コールやマッチする`tool_result`がない`Bash`ツールコールを報告します。

## 使い方

`/loop-status [--watch]`

## 報告内容

- アクティブなループパターン
- 現在のフェーズと最後の成功チェックポイント
- 失敗しているチェック（ある場合）
- 推定時間/コストのドリフト
- 推奨される介入（continue/pause/stop）

## クロスセッションCLI

- `ecc loop-status --json` 最近のローカルClaudeトランスクリプトの機械読み取り可能なステータスを出力。
- `ecc loop-status --home <dir>` 別のホームディレクトリをスキャン（別のローカルプロファイルやマウントされたワークスペースの検査時）。
- `ecc loop-status --transcript <session.jsonl>` 1つのトランスクリプトを直接検査。
- `ecc loop-status --bash-timeout-seconds 1800` 古いBashの閾値を調整。
- `ecc loop-status --exit-code` 古いループやツールシグナルが検出された場合に`2`で終了、トランスクリプトがスキャンできない場合は`1`で終了。
- `--exit-code`と`--watch`を併用する場合は`--watch-count`が必要（ウォッチドッグスクリプトがプロセス終了を永遠に待たないように）。
- `ecc loop-status --watch` 中断されるまでステータスを更新。
- `ecc loop-status --watch --watch-count 3 --exit-code` 限定回数更新し、確認された最高ステータスで終了。
- `ecc loop-status --watch --watch-count 3` スクリプトやハンドオフ用の限定ウォッチストリームを出力。
- `ecc loop-status --watch --write-dir ~/.claude/loops` シブリングターミナルやウォッチドッグスクリプト用に`index.json`とセッションごとのJSONスナップショットを維持。

## ウォッチモード

`--watch`が指定されている場合、定期的にステータスを更新します。`--json`併用時は、各更新が1行あたり1つのJSONオブジェクトとして出力され、別のターミナルやスクリプトがストリームを消費できます。

## スナップショットファイル

別のプロセスが現在のClaudeセッションの`/loop-status`デキューを待たずにループ状態を検査する必要がある場合は、`--write-dir <dir>`を使用します。CLIは以下を書き込みます:

- 検査されたセッションごとに1行の`index.json`。
- そのセッションの完全なステータスペイロードを含む`<session-id>.json`。

これらのファイルはローカルトランスクリプト分析のスナップショットです。Claude Codeランタイムのツールコールを制御したりタイムアウトさせたりするものではありません。

## 引数

$ARGUMENTS:
- `--watch` オプション
