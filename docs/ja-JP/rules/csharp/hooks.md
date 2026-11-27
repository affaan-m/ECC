---
paths:
  - "**/*.cs"
  - "**/*.csx"
  - "**/*.csproj"
  - "**/*.sln"
  - "**/Directory.Build.props"
  - "**/Directory.Build.targets"
---
# C# フック

> このファイルは [common/hooks.md](../common/hooks.md) を C# 固有のコンテンツで拡張します。

## PostToolUse フック

`~/.claude/settings.json` で設定する:

- **dotnet format**: 編集した C# ファイルを自動フォーマットし、アナライザーの修正を適用する
- **dotnet build**: 編集後もソリューションやプロジェクトがコンパイルできることを確認する
- **dotnet test --no-build**: 動作変更後に最も近い関連テストプロジェクトを再実行する

## ストップフック

- 広範な C# 変更を含むセッションを終了する前に最終的な `dotnet build` を実行する
- 変更された `appsettings*.json` ファイルについてシークレットがコミットされないよう警告する
