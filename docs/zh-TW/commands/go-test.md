---
description: Enforce TDD workflow for Go. Write table-driven tests first, then implement. Verify 80%+ coverage with go test -cover.
---

# Go TDD 指令

此指令強制執行 Go 程式碼的測試驅動開發方法論，使用慣用的 Go 測試模式。

## 此指令的功能

1. **定義類型/介面**：先建立函式簽名骨架
2. **撰寫表格驅動測試**：建立全面的測試案例（RED）
3. **執行測試**：驗證測試因正確的原因失敗
4. **實作程式碼**：撰寫最小程式碼使其通過（GREEN）
5. **重構**：在測試保持綠色的同時改進
6. **檢查覆蓋率**：確保 80% 以上覆蓋率

## 何時使用

在以下情況使用 `/go-test`：
- 實作新的 Go 函式
- 為現有程式碼新增測試覆蓋率
- 修復 Bug（先撰寫失敗的測試）
- 建構關鍵商業邏輯
- 學習 Go 中的 TDD 工作流程

## TDD 循環

```
RED     → 撰寫失敗的表格驅動測試
GREEN   → 實作最小程式碼使其通過
REFACTOR → 改進程式碼，測試保持綠色
REPEAT  → 下一個測試案例
```

## 測試模式

### 表格驅動測試
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
        // 斷言
    })
}
```

### 平行測試
```go
for _, tt := range tests {
    tt := tt // 擷取
    t.Run(tt.name, func(t *testing.T) {
        t.Parallel()
        // 測試內容
    })
}
```

### 測試輔助函式
```go
func setupTestDB(t *testing.T) *sql.DB {
    t.Helper()
    db := createDB()
    t.Cleanup(func() { db.Close() })
    return db
}
```

## 覆蓋率指令

```bash
# 基本覆蓋率
go test -cover ./...

# 覆蓋率 profile
go test -coverprofile=coverage.out ./...

# 在瀏覽器檢視
go tool cover -html=coverage.out

# 依函式顯示覆蓋率
go tool cover -func=coverage.out

# 帶競態偵測
go test -race -cover ./...
```

## 覆蓋率目標

| 程式碼類型 | 目標 |
|-----------|------|
| 關鍵商業邏輯 | 100% |
| 公開 API | 90%+ |
| 一般程式碼 | 80%+ |
| 產生的程式碼 | 排除 |

## TDD 最佳實務

**應該做：**
- 在任何實作前先撰寫測試
- 每次變更後執行測試
- 使用表格驅動測試以獲得全面覆蓋
- 測試行為，不是實作細節
- 包含邊界情況（空值、nil、最大值）

**不應該做：**
- 在測試之前撰寫實作
- 跳過 RED 階段
- 直接測試私有函式
- 在測試中使用 `time.Sleep`
- 忽略不穩定的測試

## 相關指令

- `/go-build` - 修復建置錯誤
- `/go-review` - 實作後審查程式碼
- `/verify` - 執行完整驗證迴圈

## 相關

- 技能：`skills/golang-testing/`
- 技能：`skills/tdd-workflow/`
