---
paths:
  - "**/*.fs"
  - "**/*.fsx"
  - "**/*.fsproj"
  - "**/*.sln"
  - "**/*.slnx"
  - "**/Directory.Build.props"
  - "**/Directory.Build.targets"
---
# F# フック

> このファイルは [common/hooks.md](../common/hooks.md) を F# 固有のコンテンツで拡張します。

## PostToolUse フック

`~/.claude/settings.json` で設定する:

- **fantomas**: 編集された F# ファイルを自動フォーマット
- **dotnet build**: 編集後にソリューションまたはプロジェクトが引き続きコンパイルされることを確認する
- **dotnet test --no-build**: 動作の変更後に最も近い関連テストプロジェクトを再実行する

## Stop フック

- 広範な F# の変更を伴うセッションを終了する前に最終的な `dotnet build` を実行する
- 変更された `appsettings*.json` ファイルに対して警告を出し、シークレットがコミットされないようにする
