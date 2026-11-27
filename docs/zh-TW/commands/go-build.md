---
description: Fix Go build errors, go vet warnings, and linter issues incrementally. Invokes the go-build-resolver agent for minimal, surgical fixes.
---

# Go 建置與修復

此指令呼叫 **go-build-resolver** Agent，以最小變更增量修復 Go 建置錯誤。

## 此指令的功能

1. **執行診斷**：執行 `go build`、`go vet`、`staticcheck`
2. **解析錯誤**：依檔案分組並依嚴重性排序
3. **增量修復**：一次一個錯誤
4. **驗證每次修復**：每次變更後重新執行建置
5. **報告摘要**：顯示已修復和剩餘的問題

## 何時使用

在以下情況使用 `/go-build`：
- `go build ./...` 失敗並出現錯誤
- `go vet ./...` 報告問題
- `golangci-lint run` 顯示警告
- 模組相依性損壞
- 拉取破壞建置的變更後

## 執行的診斷指令

```bash
# 主要建置檢查
go build ./...

# 靜態分析
go vet ./...

# 擴展 linting（如果可用）
staticcheck ./...
golangci-lint run

# 模組問題
go mod verify
go mod tidy -v
```

## 常見修復的錯誤

| 錯誤 | 典型修復 |
|------|----------|
| `undefined: X` | 新增 import 或修正打字錯誤 |
| `cannot use X as Y` | 型別轉換或修正賦值 |
| `missing return` | 新增 return 陳述式 |
| `X does not implement Y` | 新增缺少的方法 |
| `import cycle` | 重組套件 |
| `declared but not used` | 移除或使用變數 |
| `cannot find package` | `go get` 或 `go mod tidy` |

## 修復策略

1. **建置錯誤優先** - 程式碼必須編譯
2. **Vet 警告次之** - 修復可疑構造
3. **Lint 警告第三** - 風格和最佳實務
4. **一次一個修復** - 驗證每次變更
5. **最小變更** - 不要重構，只修復

## 停止條件

Agent 會在以下情況停止並報告：
- 3 次嘗試後同樣錯誤仍存在
- 修復引入更多錯誤
- 需要架構變更
- 缺少外部相依性

## 相關指令

- `/go-test` - 建置成功後執行測試
- `/go-review` - 審查程式碼品質
- `/verify` - 完整驗證迴圈

## 相關

- Agent：`agents/go-build-resolver.md`
- 技能：`skills/golang-patterns/`
