---
name: springboot-verification
description: "Verification loop for Spring Boot projects: build, static analysis, tests with coverage, security scans, and diff review before release or PR."
---

# Spring Boot 検証ループ

PR前、大きな変更後、デプロイ前に実行します。

## フェーズ1: ビルド

```bash
mvn -T 4 clean verify -DskipTests
# または
./gradlew clean assemble -x test
```

ビルドが失敗した場合は、停止して修正します。

## フェーズ2: 静的解析

Maven（一般的なプラグイン）:
```bash
mvn -T 4 spotbugs:check pmd:check checkstyle:check
```

Gradle（設定されている場合）:
```bash
./gradlew checkstyleMain pmdMain spotbugsMain
```

## フェーズ3: テスト + カバレッジ

```bash
mvn -T 4 test
mvn jacoco:report   # 80%以上のカバレッジを確認
# または
./gradlew test jacocoTestReport
```

レポート:
- 総テスト数、合格/失敗
- カバレッジ%（行/分岐）

## フェーズ4: セキュリティスキャン

```bash
# 依存関係のCVE
mvn org.owasp:dependency-check-maven:check
# または
./gradlew dependencyCheckAnalyze

# シークレット（git）
git secrets --scan  # 設定されている場合
```

## フェーズ5: Lint/Format（オプションゲート）

```bash
mvn spotless:apply   # Spotlessプラグインを使用している場合
./gradlew spotlessApply
```

## フェーズ6: 差分レビュー

```bash
git diff --stat
git diff
```

チェックリスト:
- デバッグログが残っていない（`System.out`、ガードなしの `log.debug`）
- 意味のあるエラーとHTTPステータス
- 必要な場所にトランザクションと検証がある
- 設定変更が文書化されている

## 出力テンプレート

```
検証レポート
===================
ビルド:     [合格/不合格]
静的解析:   [合格/不合格] (spotbugs/pmd/checkstyle)
テスト:     [合格/不合格] (X/Y 合格, Z% カバレッジ)
セキュリティ: [合格/不合格] (CVE発見: N)
差分:       [X ファイル変更]

全体:       [準備完了 / 未完了]

修正が必要な問題:
1. ...
2. ...
```

## 継続モード

- 大きな変更があった場合、または長いセッションで30〜60分ごとにフェーズを再実行
- 短いループを維持: `mvn -T 4 test` + spotbugs で迅速なフィードバック

**注意**: 迅速なフィードバックは遅い驚きに勝ります。ゲートを厳格に保ち、本番システムでは警告を欠陥として扱います。
