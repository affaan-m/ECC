---
description: メモリ安全性、モダンC++イディオム、並行性、セキュリティの包括的C++コードレビュー。cpp-reviewerエージェントを呼び出します。
---

# C++コードレビュー

このコマンドは**cpp-reviewer**エージェントを呼び出し、C++固有の包括的なコードレビューを行います。

## このコマンドの動作

1. **C++の変更を特定**: `git diff`で変更された`.cpp`、`.hpp`、`.cc`、`.h`ファイルを検索
2. **静的解析を実行**: `clang-tidy`と`cppcheck`を実行
3. **メモリ安全性スキャン**: 生のnew/delete、バッファオーバーフロー、use-after-freeをチェック
4. **並行性レビュー**: スレッド安全性、mutex使用、データ競合を分析
5. **モダンC++チェック**: コードがC++17/20の規約とベストプラクティスに従っているか検証
6. **レポート生成**: 問題を重大度別に分類

## 使用するタイミング

`/cpp-review`を使用するのは:
- C++コードを書いたり修正した後
- C++の変更をコミットする前
- C++コードを含むプルリクエストをレビューする時
- 新しいC++コードベースにオンボーディングする時
- メモリ安全性の問題をチェックする時

## レビューカテゴリ

### CRITICAL（修正必須）
- RAIIなしの生の`new`/`delete`
- バッファオーバーフローとuse-after-free
- 同期なしのデータ競合
- `system()`によるコマンドインジェクション
- 未初期化変数の読み取り
- ヌルポインタデリファレンス

### HIGH（修正すべき）
- Rule of Five違反
- `std::lock_guard` / `std::scoped_lock`の欠如
- 適切なライフタイム管理なしのデタッチされたスレッド
- `static_cast`/`dynamic_cast`の代わりのCスタイルキャスト
- `const`正確性の欠如

### MEDIUM（検討）
- 不要なコピー（`const&`の代わりに値渡し）
- 既知のサイズのコンテナでの`reserve()`の欠如
- ヘッダでの`using namespace std;`
- 重要な戻り値での`[[nodiscard]]`の欠如
- 過度に複雑なテンプレートメタプログラミング

## 実行される自動チェック

```bash
# 静的解析
clang-tidy --checks='*,-llvmlibc-*' src/*.cpp -- -std=c++17

# 追加分析
cppcheck --enable=all --suppress=missingIncludeSystem src/

# 警告付きビルド
cmake --build build -- -Wall -Wextra -Wpedantic
```

## 承認基準

| ステータス | 条件 |
|-----------|------|
| 承認 | CRITICALまたはHIGHの問題なし |
| 警告 | MEDIUMの問題のみ（注意してマージ） |
| ブロック | CRITICALまたはHIGHの問題あり |

## 他のコマンドとの統合

- テストが通ることを確認するためにまず`/cpp-test`を使用
- ビルドエラーが発生した場合は`/cpp-build`を使用
- コミット前に`/cpp-review`を使用
- C++固有でない懸念には`/code-review`を使用

## 関連

- エージェント: `agents/cpp-reviewer.md`
- スキル: `skills/cpp-coding-standards/`、`skills/cpp-testing/`
