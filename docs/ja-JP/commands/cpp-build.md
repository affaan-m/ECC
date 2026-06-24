---
description: C++ビルドエラー、CMakeの問題、リンカーの問題をインクリメンタルに修正します。最小限の外科的修正のためにcpp-build-resolverエージェントを呼び出します。
---

# C++ビルドと修正

このコマンドは**cpp-build-resolver**エージェントを呼び出し、C++ビルドエラーを最小限の変更でインクリメンタルに修正します。

## このコマンドの動作

1. **診断を実行**: `cmake --build`、`clang-tidy`、`cppcheck`を実行
2. **エラーを解析**: ファイルごとにグループ化し、重大度でソート
3. **インクリメンタルに修正**: 一度に1つのエラー
4. **各修正を検証**: 各変更後にビルドを再実行
5. **サマリーを報告**: 修正されたものと残りを表示

## 使用するタイミング

`/cpp-build`を使用するのは:
- `cmake --build build`がエラーで失敗する場合
- リンカーエラー（未定義参照、多重定義）
- テンプレートインスタンシエーションの失敗
- インクルード/依存関係の問題
- ビルドを壊す変更をプルした後

## 実行される診断コマンド

```bash
# CMake設定
cmake -B build -S .

# ビルド
cmake --build build 2>&1 | head -100

# 静的解析（利用可能な場合）
clang-tidy src/*.cpp -- -std=c++17
cppcheck --enable=all src/
```

## 一般的に修正されるエラー

| エラー | 典型的な修正 |
|--------|------------|
| `undeclared identifier` | `#include`を追加またはタイプミスを修正 |
| `no matching function` | 引数の型を修正またはオーバーロードを追加 |
| `undefined reference` | ライブラリをリンクまたは実装を追加 |
| `multiple definition` | `inline`を使用または.cppに移動 |
| `incomplete type` | 前方宣言を`#include`に置換 |
| `no member named X` | メンバー名を修正またはinclude |
| `cannot convert X to Y` | 適切なキャストを追加 |
| `CMake Error` | CMakeLists.txt設定を修正 |

## 修正戦略

1. **コンパイルエラーを最初に** — コードがコンパイルできなければならない
2. **リンカーエラーを次に** — 未定義参照を解決
3. **警告を3番目に** — `-Wall -Wextra`で修正
4. **一度に1つの修正** — 各変更を検証
5. **最小限の変更** — リファクタリングせず、修正のみ

## 停止条件

エージェントは以下の場合に停止して報告する:
- 3回の試行後も同じエラーが持続
- 修正がより多くのエラーを導入
- アーキテクチャ変更が必要
- 外部依存関係が不足

## 関連コマンド

- `/cpp-test` — ビルド成功後にテストを実行
- `/cpp-review` — コード品質をレビュー
- `verification-loop`スキル — 完全な検証ループ

## 関連

- エージェント: `agents/cpp-build-resolver.md`
- スキル: `skills/cpp-coding-standards/`
