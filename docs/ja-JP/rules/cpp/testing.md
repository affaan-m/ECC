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
# C++ テスト

> このファイルは [common/testing.md](../common/testing.md) を C++ 固有のコンテンツで拡張します。

## フレームワーク

**CMake/CTest** と組み合わせた **GoogleTest**（gtest/gmock）を使用する。

## テストの実行

```bash
cmake --build build && ctest --test-dir build --output-on-failure
```

## カバレッジ

```bash
cmake -DCMAKE_CXX_FLAGS="--coverage" -DCMAKE_EXE_LINKER_FLAGS="--coverage" ..
cmake --build .
ctest --output-on-failure
lcov --capture --directory . --output-file coverage.info
```

## サニタイザー

CI では常にサニタイザーを使用してテストを実行する:

```bash
cmake -DCMAKE_CXX_FLAGS="-fsanitize=address,undefined" ..
```

## 参考

詳細な C++ テストパターン、TDD ワークフロー、GoogleTest/GMock の使用方法についてはスキル: `cpp-testing` を参照。
