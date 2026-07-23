---
name: verification-loop
description: A comprehensive verification system for Claude Code sessions.
metadata:
  origin: ECC
---

# 驗證循環技能

Claude Code 工作階段的完整驗證系統。

## 何時使用

在以下情況呼叫此技能：
- 完成功能或重大程式碼變更後
- 建立 PR 前
- 想確保品質門檻通過時
- 重構後

## 驗證階段

### 階段 1：建置驗證
```bash
# 檢查專案是否建置
npm run build 2>&1 | tail -20
# 或
pnpm build 2>&1 | tail -20
```

如果建置失敗，停止並在繼續前修復。

### 階段 2：型別檢查
```bash
# TypeScript 專案
npx tsc --noEmit 2>&1 | head -30

# Python 專案
pyright . 2>&1 | head -30
```

報告所有型別錯誤。繼續前修復關鍵錯誤。

### 階段 3：Lint 檢查
```bash
# JavaScript/TypeScript
npm run lint 2>&1 | head -30

# Python
ruff check . 2>&1 | head -30
```

### 階段 4：測試套件
```bash
# 執行帶覆蓋率的測試
npm run test -- --coverage 2>&1 | tail -50

# 檢查覆蓋率門檻
# 目標：最低 80%
```

報告：
- 總測試數：X
- 通過：X
- 失敗：X
- 覆蓋率：X%

### 階段 5：安全掃描
```bash
# 檢查密鑰
grep -rn "sk-" --include="*.ts" --include="*.js" . 2>/dev/null | head -10
grep -rn "api_key" --include="*.ts" --include="*.js" . 2>/dev/null | head -10

# 檢查 console.log
grep -rn "console.log" --include="*.ts" --include="*.tsx" src/ 2>/dev/null | head -10
```

### 階段 6：差異審查
```bash
# 顯示變更內容
git diff --stat
git diff HEAD~1 --name-only
```

審查每個變更的檔案：
- 非預期變更
- 缺少錯誤處理
- 潛在邊界案例

## 輸出格式

執行所有階段後，產生驗證報告：

```
驗證報告
==================

建置：     [PASS/FAIL]
型別：     [PASS/FAIL]（X 個錯誤）
Lint：     [PASS/FAIL]（X 個警告）
測試：     [PASS/FAIL]（X/Y 通過，Z% 覆蓋率）
安全性：   [PASS/FAIL]（X 個問題）
差異：     [X 個檔案變更]

整體：     [READY/NOT READY] for PR

待修復問題：
1. ...
2. ...
```

## 持續模式

對於長時間工作階段，每 15 分鐘或重大變更後執行驗證：

```markdown
設定心理檢查點：
- 完成每個函式後
- 完成元件後
- 移至下一個任務前

執行：/verify
```

## 與 Hooks 整合

此技能補充 PostToolUse hooks 但提供更深入的驗證。
Hooks 立即捕捉問題；此技能提供全面審查。
