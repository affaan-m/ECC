---
paths:
  - "**/*.java"
  - "**/pom.xml"
  - "**/build.gradle"
  - "**/build.gradle.kts"
---
# Java フック

> このファイルは [common/hooks.md](../common/hooks.md) を Java 固有のコンテンツで拡張します。

## PostToolUse フック

`~/.claude/settings.json` で設定:

- **google-java-format**: 編集後に `.java` ファイルを自動フォーマット
- **checkstyle**: Java ファイル編集後にスタイルチェックを実行
- **./mvnw compile** または **./gradlew compileJava**: 変更後にコンパイルを検証
