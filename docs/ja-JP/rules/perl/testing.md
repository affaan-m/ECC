---
paths:
  - "**/*.pl"
  - "**/*.pm"
  - "**/*.t"
  - "**/*.psgi"
  - "**/*.cgi"
---
# Perl テスト

> このファイルは [common/testing.md](../common/testing.md) を Perl 固有のコンテンツで拡張します。

## フレームワーク

新規プロジェクトには **Test2::V0** を使用する（Test::More ではない）:

```perl
use Test2::V0;

is($result, 42, 'answer is correct');

done_testing;
```

## ランナー

```bash
prove -l t/              # lib/ を @INC に追加
prove -lr -j8 t/         # 再帰的、8並列ジョブ
```

`lib/` を `@INC` に含めるため、常に `-l` を使用する。

## カバレッジ

**Devel::Cover** を使用する — 80% 以上を目標:

```bash
cover -test
```

## モック

- **Test::MockModule** — 既存モジュールのメソッドをモック
- **Test::MockObject** — ゼロからテストダブルを作成

## 注意点

- テストファイルは常に `done_testing` で終了する
- `prove` で `-l` フラグを忘れない

## リファレンス

スキル: `perl-testing` で Test2::V0、prove、Devel::Cover を使った詳細な Perl TDD パターンを参照してください。
