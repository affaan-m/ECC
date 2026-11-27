---
description: Enforce test-driven development workflow. Scaffold interfaces, generate tests FIRST, then implement minimal code to pass. Ensure 80%+ coverage.
---

# TDD 指令

此指令呼叫 **tdd-guide** Agent 來強制執行測試驅動開發方法論。

## 此指令的功能

1. **建立介面骨架** - 先定義類型/介面
2. **先產生測試** - 撰寫失敗的測試（RED）
3. **實作最小程式碼** - 撰寫剛好足以通過的程式碼（GREEN）
4. **重構** - 在測試保持綠色的同時改進程式碼（REFACTOR）
5. **驗證覆蓋率** - 確保 80% 以上測試覆蓋率

## 何時使用

在以下情況使用 `/tdd`：
- 實作新功能
- 新增新函式/元件
- 修復 Bug（先撰寫重現 bug 的測試）
- 重構現有程式碼
- 建構關鍵商業邏輯

## 運作方式

tdd-guide Agent 會：

1. **定義介面**用於輸入/輸出
2. **撰寫會失敗的測試**（因為程式碼還不存在）
3. **執行測試**並驗證它們因正確的原因失敗
4. **撰寫最小實作**使測試通過
5. **執行測試**並驗證它們通過
6. **重構**程式碼，同時保持測試通過
7. **檢查覆蓋率**，如果低於 80% 則新增更多測試

## TDD 循環

```
RED → GREEN → REFACTOR → REPEAT

RED:      撰寫失敗的測試
GREEN:    撰寫最小程式碼使其通過
REFACTOR: 改進程式碼，保持測試通過
REPEAT:   下一個功能/情境
```

## TDD 最佳實務

**應該做：**
- PASS: 在任何實作前先撰寫測試
- PASS: 在實作前執行測試並驗證它們失敗
- PASS: 撰寫最小程式碼使測試通過
- PASS: 只在測試通過後才重構
- PASS: 新增邊界情況和錯誤情境
- PASS: 目標 80% 以上覆蓋率（關鍵程式碼 100%）

**不應該做：**
- FAIL: 在測試之前撰寫實作
- FAIL: 跳過每次變更後執行測試
- FAIL: 一次撰寫太多程式碼
- FAIL: 忽略失敗的測試
- FAIL: 測試實作細節（測試行為）
- FAIL: Mock 所有東西（優先使用整合測試）

## 覆蓋率要求

- **所有程式碼至少 80%**
- **以下類型需要 100%：**
  - 財務計算
  - 驗證邏輯
  - 安全關鍵程式碼
  - 核心商業邏輯

## 重要提醒

**強制要求**：測試必須在實作之前撰寫。TDD 循環是：

1. **RED** - 撰寫失敗的測試
2. **GREEN** - 實作使其通過
3. **REFACTOR** - 改進程式碼

絕不跳過 RED 階段。絕不在測試之前撰寫程式碼。

## 與其他指令的整合

- 先使用 `/plan` 理解要建構什麼
- 使用 `/tdd` 帶著測試實作
- 如果發生建置錯誤，使用 `/build-fix`
- 使用 `/code-review` 審查實作
- 使用 `/test-coverage` 驗證覆蓋率

## 相關 Agent

此指令呼叫位於以下位置的 `tdd-guide` Agent：
`~/.claude/agents/tdd-guide.md`

並可參考位於以下位置的 `tdd-workflow` 技能：
`~/.claude/skills/tdd-workflow/`
