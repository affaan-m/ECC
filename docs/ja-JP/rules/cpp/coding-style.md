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
# C++ コーディングスタイル

> このファイルは [common/coding-style.md](../common/coding-style.md) を C++ 固有のコンテンツで拡張します。

## モダン C++（C++17/20/23）

- C スタイルの構文よりも**モダン C++ の機能**を優先する
- コンテキストから型が明らかな場合は `auto` を使用する
- コンパイル時の定数には `constexpr` を使用する
- 構造化バインディングを使用する: `auto [key, value] = map_entry;`

## リソース管理

- **RAII を徹底する** — 手動での `new`/`delete` は禁止
- 独占的な所有権には `std::unique_ptr` を使用する
- 共有所有権が本当に必要な場合のみ `std::shared_ptr` を使用する
- 生の `new` の代わりに `std::make_unique` / `std::make_shared` を使用する

## 命名規則

- 型/クラス: `PascalCase`
- 関数/メソッド: `snake_case` または `camelCase`（プロジェクトの規約に従う）
- 定数: `kPascalCase` または `UPPER_SNAKE_CASE`
- 名前空間: `lowercase`
- メンバー変数: `snake_case_`（末尾アンダースコア）または `m_` プレフィックス

## フォーマット

- **clang-format** を使用する — スタイルの議論は不要
- コミット前に `clang-format -i <file>` を実行する

## 参考

包括的な C++ コーディング標準とガイドラインについてはスキル: `cpp-coding-standards` を参照。
