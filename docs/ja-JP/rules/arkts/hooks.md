---
paths:
  - "**/*.ets"
  - "**/*.ts"
  - "**/module.json5"
  - "**/oh-package.json5"
---
# HarmonyOS / ArkTS フック

> このファイルは [common/hooks.md](../common/hooks.md) を HarmonyOS 固有のビルドおよび検証フックで拡張します。

## ビルドコマンド

### HAP パッケージのビルド

```bash
# HAP パッケージをビルドする（グローバル hvigor 環境）
hvigorw assembleHap -p product=default

# 特定のモジュールでビルドする
hvigorw assembleHap -p module=entry -p product=default

# クリーンビルド
hvigorw clean
```

### DevEco Studio CLI

```bash
# プロジェクト構造を確認する
hvigorw --version

# 依存関係をインストールする
ohpm install

# 依存関係を更新する
ohpm update
```

## 推奨 PostToolUse フック

### .ets/.ts ファイル編集後

ArkTS のコンパイルエラーを確認するために hvigor ビルドを実行する:

```json
{
  "type": "PostToolUse",
  "matcher": {
    "tool": ["Edit", "Write"],
    "filePath": ["**/*.ets", "**/*.ts"]
  },
  "hooks": [
    {
      "command": "hvigorw assembleHap -p product=default 2>&1 | tail -20",
      "async": true,
      "timeout": 60000
    }
  ]
}
```

### module.json5 編集後

パーミッションとアビリティの宣言を検証する:

```json
{
  "type": "PostToolUse",
  "matcher": {
    "tool": "Edit",
    "filePath": "**/module.json5"
  },
  "hooks": [
    {
      "command": "echo '[HarmonyOS] module.json5 modified - verify permissions and abilities'",
      "async": false
    }
  ]
}
```

### oh-package.json5 編集後

依存関係を再インストールする:

```json
{
  "type": "PostToolUse",
  "matcher": {
    "tool": "Edit",
    "filePath": "**/oh-package.json5"
  },
  "hooks": [
    {
      "command": "ohpm install 2>&1 | tail -10",
      "async": true,
      "timeout": 30000
    }
  ]
}
```

## PreToolUse フック

### V1 デコレーターガード

コードに V1 状態管理デコレーターが含まれている場合に警告する:

```json
{
  "type": "PreToolUse",
  "matcher": {
    "tool": ["Write", "Edit"],
    "filePath": "**/*.ets"
  },
  "hooks": [
    {
      "command": "echo '[HarmonyOS] Reminder: Use @ComponentV2 / @Local / @Param - V1 decorators (@State, @Prop, @Link) are prohibited'"
    }
  ]
}
```

## 検証チェックリスト

各実装サイクルの後、以下を確認する:

- [ ] `hvigorw assembleHap` がエラーなしで完了する
- [ ] 新規または変更した `.ets` ファイルに V1 デコレーターがない
- [ ] 新規または変更したファイルに `@ohos.router` のインポートがない
- [ ] すべての API パーミッションが `module.json5` に宣言されている
- [ ] すべての依存関係が `oh-package.json5` に記載されている
- [ ] リソース文字列がすべての i18n ディレクトリに追加されている
- [ ] 新しいカラーリソースにダークテーマのカラーが提供されている
