---
description: Comprehensive Go code review for idiomatic patterns, concurrency safety, error handling, and security. Invokes the go-reviewer agent.
---

# Go 程式碼審查

此指令呼叫 **go-reviewer** Agent 進行全面的 Go 特定程式碼審查。

## 此指令的功能

1. **識別 Go 變更**：透過 `git diff` 找出修改的 `.go` 檔案
2. **執行靜態分析**：執行 `go vet`、`staticcheck` 和 `golangci-lint`
3. **安全性掃描**：檢查 SQL 注入、命令注入、競態條件
4. **並行審查**：分析 goroutine 安全性、channel 使用、mutex 模式
5. **慣用 Go 檢查**：驗證程式碼遵循 Go 慣例和最佳實務
6. **產生報告**：依嚴重性分類問題

## 何時使用

在以下情況使用 `/go-review`：
- 撰寫或修改 Go 程式碼後
- 提交 Go 變更前
- 審查包含 Go 程式碼的 PR
- 加入新的 Go 程式碼庫時
- 學習慣用 Go 模式

## 審查類別

### 關鍵（必須修復）
- SQL/命令注入弱點
- 沒有同步的競態條件
- Goroutine 洩漏
- 寫死的憑證
- 不安全的指標使用
- 關鍵路徑中忽略錯誤

### 高（應該修復）
- 缺少帶上下文的錯誤包裝
- 用 Panic 取代 Error 回傳
- Context 未傳遞
- 無緩衝 channel 導致死鎖
- 介面未滿足錯誤
- 缺少 mutex 保護

### 中（考慮）
- 非慣用程式碼模式
- 匯出項目缺少 godoc 註解
- 低效的字串串接
- Slice 未預分配
- 未使用表格驅動測試

## 執行的自動化檢查

```bash
# 靜態分析
go vet ./...

# 進階檢查（如果已安裝）
staticcheck ./...
golangci-lint run

# 競態偵測
go build -race ./...

# 安全性弱點
govulncheck ./...
```

## 批准標準

| 狀態 | 條件 |
|------|------|
| PASS: 批准 | 沒有關鍵或高優先問題 |
| WARNING: 警告 | 只有中優先問題（謹慎合併）|
| FAIL: 阻擋 | 發現關鍵或高優先問題 |

## 與其他指令的整合

- 先使用 `/go-test` 確保測試通過
- 如果發生建置錯誤，使用 `/go-build`
- 提交前使用 `/go-review`
- 對非 Go 特定問題使用 `/code-review`

## 相關

- Agent：`agents/go-reviewer.md`
- 技能：`skills/golang-patterns/`、`skills/golang-testing/`
