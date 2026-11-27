---
description: KotlinのTDDワークフローを強制します。最初にKotestテストを書き、その後実装します。Koverで80%以上のカバレッジを検証します。
---

# Kotlin TDDコマンド

このコマンドはKotest、MockK、Koverを使用したKotlinコードのテスト駆動開発方法論を強制します。

## このコマンドの動作

1. **型/インターフェースを定義**: 関数のシグネチャを先にスキャフォールド
2. **Kotestテストを書く**: 包括的なテストスペックを作成（RED）
3. **テストを実行**: テストが正しい理由で失敗することを検証
4. **コードを実装**: テストを通す最小限のコードを書く（GREEN）
5. **リファクタリング**: テストをグリーンに保ちながら改善
6. **カバレッジをチェック**: Koverで80%以上のカバレッジを確保

## 使用するタイミング

`/kotlin-test`を使用するのは:
- 新しいKotlinの関数やクラスを実装する時
- 既存のKotlinコードにテストカバレッジを追加する時
- バグを修正する時（失敗するテストを最初に書く）
- 重要なビジネスロジックを構築する時
- KotlinでTDDワークフローを学ぶ時

## TDDサイクル

```
RED     -> 失敗するKotestテストを書く
GREEN   -> テストを通す最小限のコードを実装
REFACTOR -> コードを改善、テストはグリーンのまま
REPEAT  -> 次のテストケースへ
```

## セッション例

````text
User: /kotlin-test ユーザー登録リクエストをバリデートする関数が必要です

Agent:
# TDDセッション: 登録バリデーター

## ステップ 1: インターフェース定義

```kotlin
// validator/RegistrationValidator.kt
package com.example.validator

data class RegistrationRequest(
    val name: String,
    val email: String,
    val password: String,
)

sealed class ValidationResult {
    data object Valid : ValidationResult()
    data class Invalid(val errors: List<String>) : ValidationResult()
}

fun validateRegistration(request: RegistrationRequest): ValidationResult {
    TODO("not implemented")
}
```

## ステップ 2: Kotestテストを書く（RED）

```kotlin
// validator/RegistrationValidatorTest.kt
package com.example.validator

import io.kotest.core.spec.style.FunSpec
import io.kotest.matchers.shouldBe
import io.kotest.matchers.types.shouldBeInstanceOf

class RegistrationValidatorTest : FunSpec({
    test("valid registration returns Valid") {
        val request = RegistrationRequest(
            name = "Alice",
            email = "alice@example.com",
            password = "SecureP@ss1",
        )

        val result = validateRegistration(request)

        result.shouldBeInstanceOf<ValidationResult.Valid>()
    }

    test("blank name returns Invalid") {
        val request = RegistrationRequest(
            name = "",
            email = "alice@example.com",
            password = "SecureP@ss1",
        )

        val result = validateRegistration(request)

        val invalid = result.shouldBeInstanceOf<ValidationResult.Invalid>()
        invalid.errors shouldBe listOf("Name is required")
    }

    test("invalid email returns Invalid") {
        val request = RegistrationRequest(
            name = "Alice",
            email = "not-an-email",
            password = "SecureP@ss1",
        )

        val result = validateRegistration(request)

        val invalid = result.shouldBeInstanceOf<ValidationResult.Invalid>()
        invalid.errors shouldBe listOf("Invalid email format")
    }

    test("short password returns Invalid") {
        val request = RegistrationRequest(
            name = "Alice",
            email = "alice@example.com",
            password = "short",
        )

        val result = validateRegistration(request)

        val invalid = result.shouldBeInstanceOf<ValidationResult.Invalid>()
        invalid.errors shouldBe listOf("Password must be at least 8 characters")
    }

    test("multiple errors returns all errors") {
        val request = RegistrationRequest(
            name = "",
            email = "bad",
            password = "short",
        )

        val result = validateRegistration(request)

        val invalid = result.shouldBeInstanceOf<ValidationResult.Invalid>()
        invalid.errors.size shouldBe 3
    }
})
```

## ステップ 3: テスト実行 - FAIL確認

```bash
$ ./gradlew test

RegistrationValidatorTest > valid registration returns Valid FAILED
  kotlin.NotImplementedError: An operation is not implemented

FAILED (5 tests, 0 passed, 5 failed)
```

✓ テストが期待通りに失敗（NotImplementedError）。

## ステップ 4: 最小限のコードを実装（GREEN）

```kotlin
// validator/RegistrationValidator.kt
package com.example.validator

private val EMAIL_REGEX = Regex("^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}$")
private const val MIN_PASSWORD_LENGTH = 8

fun validateRegistration(request: RegistrationRequest): ValidationResult {
    val errors = buildList {
        if (request.name.isBlank()) add("Name is required")
        if (!EMAIL_REGEX.matches(request.email)) add("Invalid email format")
        if (request.password.length < MIN_PASSWORD_LENGTH) add("Password must be at least $MIN_PASSWORD_LENGTH characters")
    }

    return if (errors.isEmpty()) ValidationResult.Valid
    else ValidationResult.Invalid(errors)
}
```

## ステップ 5: テスト実行 - PASS確認

```bash
$ ./gradlew test

RegistrationValidatorTest > valid registration returns Valid PASSED
RegistrationValidatorTest > blank name returns Invalid PASSED
RegistrationValidatorTest > invalid email returns Invalid PASSED
RegistrationValidatorTest > short password returns Invalid PASSED
RegistrationValidatorTest > multiple errors returns all errors PASSED

PASSED (5 tests, 5 passed, 0 failed)
```

✓ 全テスト通過！

## ステップ 6: カバレッジチェック

```bash
$ ./gradlew koverHtmlReport

Coverage: 100.0% of statements
```

✓ カバレッジ: 100%

## TDD完了！
````

## テストパターン

### StringSpec（最もシンプル）

```kotlin
class CalculatorTest : StringSpec({
    "add two positive numbers" {
        Calculator.add(2, 3) shouldBe 5
    }
})
```

### BehaviorSpec（BDD）

```kotlin
class OrderServiceTest : BehaviorSpec({
    Given("a valid order") {
        When("placed") {
            Then("should be confirmed") { /* ... */ }
        }
    }
})
```

### データ駆動テスト

```kotlin
class ParserTest : FunSpec({
    context("valid inputs") {
        withData("2026-01-15", "2026-12-31", "2000-01-01") { input ->
            parseDate(input).shouldNotBeNull()
        }
    }
})
```

### コルーチンテスト

```kotlin
class AsyncServiceTest : FunSpec({
    test("concurrent fetch completes") {
        runTest {
            val result = service.fetchAll()
            result.shouldNotBeEmpty()
        }
    }
})
```

## カバレッジコマンド

```bash
# カバレッジ付きでテスト実行
./gradlew koverHtmlReport

# カバレッジ閾値を検証
./gradlew koverVerify

# CI用XMLレポート
./gradlew koverXmlReport

# HTMLレポートを開く
open build/reports/kover/html/index.html

# 特定のテストクラスを実行
./gradlew test --tests "com.example.UserServiceTest"

# 詳細出力で実行
./gradlew test --info
```

## カバレッジ目標

| コードの種類 | 目標 |
|-------------|------|
| 重要なビジネスロジック | 100% |
| パブリックAPI | 90%以上 |
| 一般コード | 80%以上 |
| 生成コード | 除外 |

## TDDベストプラクティス

**すべきこと:**
- 実装の前にテストを先に書く
- 各変更後にテストを実行
- 表現力のあるアサーションにKotestマッチャーを使用
- サスペンド関数にはMockKの`coEvery`/`coVerify`を使用
- 実装の詳細ではなく動作をテスト
- エッジケースを含める（空、null、最大値）

**すべきでないこと:**
- テストの前に実装を書く
- RED段階をスキップ
- プライベート関数を直接テスト
- コルーチンテストで`Thread.sleep()`を使用
- フレイキーなテストを無視

## 関連コマンド

- `/kotlin-build` — ビルドエラーを修正
- `/kotlin-review` — 実装後にコードをレビュー
- `verification-loop`スキル — 完全な検証ループを実行

## 関連

- スキル: `skills/kotlin-testing/`
- スキル: `skills/tdd-workflow/`
