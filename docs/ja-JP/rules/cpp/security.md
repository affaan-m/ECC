---
paths:
  - "**/*.cpp"
  - "**/*.hpp"
  - "**/*.cc"
  - "**/*.hh"
  - "**/*.cxx"
  - "**/*.h"
  - "**/CMakeLists.txt"
---
# C++ セキュリティ

> このファイルは [common/security.md](../common/security.md) を C++ 固有のコンテンツで拡張します。

## メモリ安全性

- 生の `new`/`delete` は絶対に使用しない — スマートポインタを使用する
- C スタイルの配列は絶対に使用しない — `std::array` または `std::vector` を使用する
- `malloc`/`free` は絶対に使用しない — C++ のアロケーションを使用する
- 絶対に必要な場合を除き `reinterpret_cast` を避ける

## バッファオーバーフロー

- `char*` の代わりに `std::string` を使用する
- 安全性が重要な場合の境界チェック付きアクセスには `.at()` を使用する
- `strcpy`、`strcat`、`sprintf` は絶対に使用しない — `std::string` または `fmt::format` を使用する

## 未定義動作

- 変数を必ず初期化する
- 符号付き整数のオーバーフローを避ける
- NULL または dangling ポインタのデリファレンスを絶対に行わない
- CI でサニタイザーを使用する:
  ```bash
  cmake -DCMAKE_CXX_FLAGS="-fsanitize=address,undefined" ..
  ```

## 静的解析

- 自動チェックには **clang-tidy** を使用する:
  ```bash
  clang-tidy --checks='*' src/*.cpp
  ```
- 追加の解析には **cppcheck** を使用する:
  ```bash
  cppcheck --enable=all src/
  ```

## 参考

詳細なセキュリティガイドラインについてはスキル: `cpp-coding-standards` を参照。
