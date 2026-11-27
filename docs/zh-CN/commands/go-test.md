---
description: 为Go强制执行TDD工作流程。首先编写表驱动测试，然后实现。使用go test -cover验证80%以上的覆盖率。
---

# Go TDD 命令

此命令使用惯用的 Go 测试模式，为 Go 代码强制执行测试驱动开发方法。

## 此命令的作用

1. **定义类型/接口**：首先搭建函数签名
2. **编写表驱动测试**：创建全面的测试用例（RED 阶段）
3. **运行测试**：验证测试因正确原因而失败
4. **实现代码**：编写最少的代码以通过测试（GREEN 阶段）
5. **重构**：改进代码，同时保持测试通过
6. **检查覆盖率**：确保 80% 以上的覆盖率

## 何时使用

在以下情况下使用 `/go-test`：

* 实现新的 Go 函数时
* 为现有代码添加测试覆盖率时
* 修复 bug 时（先编写失败的测试）
* 构建关键业务逻辑时
* 学习 Go 中的 TDD 工作流程时

## TDD 循环

```
RED     → 编写失败的表格驱动测试
GREEN   → 实现最小化代码以通过测试
REFACTOR → 改进代码，保持测试通过
REPEAT  → 下一个测试用例
```

## 示例会话

````
用户: /go-test 我需要一个验证电子邮箱地址的函数

代理:
# TDD 会话: 电子邮件验证器

## 步骤 1: 定义接口

```go
// validator/email.go
package validator

// ValidateEmail 检查给定的字符串是否为有效的电子邮件地址。
// 如果有效则返回 nil，否则返回描述问题的错误。
func ValidateEmail(email string) error {
    panic("not implemented")
}
```

## 步骤 2: 编写表驱动测试 (RED)

```go
// validator/email_test.go
package validator

import (
    "testing"
)

func TestValidateEmail(t *testing.T) {
    tests := []struct {
        name    string
        email   string
        wantErr bool
    }{
        // 有效邮箱
        {"simple email", "user@example.com", false},
        {"with subdomain", "user@mail.example.com", false},
        {"with plus", "user+tag@example.com", false},
        {"with dots", "first.last@example.com", false},

        // 无效邮箱
        {"empty string", "", true},
        {"no at sign", "userexample.com", true},
        {"no domain", "user@", true},
        {"no local part", "@example.com", true},
        {"double at", "user@@example.com", true},
        {"spaces", "user @example.com", true},
        {"no tld", "user@example", true},
    }

    for _, tt := range tests {
        t.Run(tt.name, func(t *testing.T) {
            err := ValidateEmail(tt.email)
            if tt.wantErr && err == nil {
                t.Errorf("ValidateEmail(%q) = nil; want error", tt.email)
            }
            if !tt.wantErr && err != nil {
                t.Errorf("ValidateEmail(%q) = %v; want nil", tt.email, err)
            }
        })
    }
}
```

## 步骤 3: 运行测试 - 验证失败

```bash
$ go test ./validator/...

--- FAIL: TestValidateEmail (0.00s)
    --- FAIL: TestValidateEmail/simple_email (0.00s)
        panic: not implemented

FAIL
```

✓ 测试按预期失败 (panic)。

## 步骤 4: 实现最小化代码 (GREEN)

```go
// validator/email.go
package validator

import (
    "errors"
    "regexp"
)

var emailRegex = regexp.MustCompile(`^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$`)

var (
    ErrEmailEmpty   = errors.New("email cannot be empty")
    ErrEmailInvalid = errors.New("email format is invalid")
)

func ValidateEmail(email string) error {
    if email == "" {
        return ErrEmailEmpty
    }
    if !emailRegex.MatchString(email) {
        return ErrEmailInvalid
    }
    return nil
}
```

## 步骤 5: 运行测试 - 验证通过

```bash
$ go test ./validator/...

PASS
ok      project/validator    0.003s
```

✓ 所有测试通过！

## 步骤 6: 检查覆盖率

```bash
$ go test -cover ./validator/...

PASS
coverage: 100.0% of statements
ok      project/validator    0.003s
```

✓ 覆盖率: 100%

## TDD 完成！
````

## 测试模式

### 表驱动测试

```go
tests := []struct {
    name     string
    input    InputType
    want     OutputType
    wantErr  bool
}{
    {"case 1", input1, want1, false},
    {"case 2", input2, want2, true},
}

for _, tt := range tests {
    t.Run(tt.name, func(t *testing.T) {
        got, err := Function(tt.input)
        // assertions
    })
}
```

### 并行测试

```go
for _, tt := range tests {
    tt := tt // Capture
    t.Run(tt.name, func(t *testing.T) {
        t.Parallel()
        // test body
    })
}
```

### 测试辅助函数

```go
func setupTestDB(t *testing.T) *sql.DB {
    t.Helper()
    db := createDB()
    t.Cleanup(func() { db.Close() })
    return db
}
```

## 覆盖率命令

```bash
# Basic coverage
go test -cover ./...

# Coverage profile
go test -coverprofile=coverage.out ./...

# View in browser
go tool cover -html=coverage.out

# Coverage by function
go tool cover -func=coverage.out

# With race detection
go test -race -cover ./...
```

## 覆盖率目标

| 代码类型 | 目标 |
|-----------|--------|
| 关键业务逻辑 | 100% |
| 公共 API | 90%+ |
| 通用代码 | 80%+ |
| 生成的代码 | 排除 |

## TDD 最佳实践

**应该做：**

* 先编写测试，再编写任何实现
* 每次更改后运行测试
* 使用表驱动测试以获得全面的覆盖率
* 测试行为，而非实现细节
* 包含边界情况（空值、nil、最大值）

**不应该做：**

* 在编写测试之前编写实现
* 跳过 RED 阶段
* 直接测试私有函数
* 在测试中使用 `time.Sleep`
* 忽略不稳定的测试

## 相关命令

* `/go-build` - 修复构建错误
* `/go-review` - 在实现后审查代码
* `/verify` - 运行完整的验证循环

## 相关

* 技能：`skills/golang-testing/`
* 技能：`skills/tdd-workflow/`
