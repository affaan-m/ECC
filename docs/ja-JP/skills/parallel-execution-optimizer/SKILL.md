---
name: parallel-execution-optimizer
description: 並列作業、並行エージェント、バッチツール呼び出し、分離されたワークツリー、または多数の独立した検証レーンによって正確性を損なうことなくタスクを大幅に高速化したい場合に使用する。
origin: ECC
tools: Read, Write, Edit, Bash, Grep, Glob
---

# 並列実行オプティマイザー

リポジトリの検査、ファイルの読み取り、APIチェック、ブラウザチェック、ビルド/テストレーン、デプロイリードバック、またはマルチワークツリーの実装パスなど、独立した作業を同時に行うことで速度を向上させる場合に、このスキルを使用する。

## コアパターン

行動する前に緊急性を依存関係グラフに変換する。

1. 目標と完了シグナルを定義する。
2. 作業をレーンに分割する。
3. 各レーンを並列、順次、またはゲートとしてマークする。
4. 独立した読み取り/チェックを一緒に実行する。
5. ファイル、ワークツリー、ブランチ、サービス、またはデータセットで書き込みを分離する。
6. レーンが互換性があることを証拠が示した後にのみマージする。
7. あいまいな速度の主張ではなく、検証テーブルで終了する。

## レーンマトリクス

大規模なプッシュの前に、コンパクトなマトリクスを記載する：

```text
Lane | Can run in parallel? | Write surface | Risk | Verification
Repo scan | yes | none | low | rg/git status outputs
Backend patch | maybe | src/api | medium | unit tests
Frontend patch | maybe | app/components | medium | browser screenshot
Deploy readback | after build | remote service | high | live URL + logs
```

書き込みサーフェスが衝突しない場合にのみ、レーンを並列で実行すること。

## 実行ルール

- ファイルの読み取り、検索、ステータスチェック、メタデータクエリをバッチ処理する。
- 大規模な無関係の実装レーンには分離されたワークツリーを使用する。
- 長時間実行されるテスト、ビルド、バックフィル、デプロイは別セッションで開始し、意図的にポーリングする。
- レーンが計画を変更するブロッカーを発見した場合は、依存するレーンを一時停止してマトリクスを更新する。
- ユーザーが継続的なサービスを明示的に要求した場合を除き、バックグラウンドプロセスをターンを越えて生き続けさせないこと。
- 明示的なゲートなしに、破壊的なコマンド、マイグレーション、同じテーブルへの書き込み、または顧客影響のあるデプロイを並列化しないこと。

## 出力形式

報告時はこちらを使用する：

```text
Parallel execution result:
- Lanes run: 5
- Lanes completed: 4
- Blocked lane: deploy readback, waiting on DNS propagation
- Fast path found: batched repo scan + focused tests
- Verification: lint pass, unit pass, live smoke pass
```

## 失敗パターン

- 競合する編集を生み出す過剰な並行性。
- タスクではなくツールをベンチマークすること。
- 正確性が証明される前に「速い」を完了と見なすこと。
- 実行中のセッションのポーリングを忘れること。
- スキップされたチェックを成功サマリーの背後に隠すこと。
