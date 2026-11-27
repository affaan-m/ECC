# Agent 協調

## 可用 Agents

位於 `~/.claude/agents/`：

| Agent | 用途 | 何時使用 |
|-------|------|----------|
| planner | 實作規劃 | 複雜功能、重構 |
| architect | 系統設計 | 架構決策 |
| tdd-guide | 測試驅動開發 | 新功能、Bug 修復 |
| code-reviewer | 程式碼審查 | 撰寫程式碼後 |
| security-reviewer | 安全性分析 | 提交前 |
| build-error-resolver | 修復建置錯誤 | 建置失敗時 |
| e2e-runner | E2E 測試 | 關鍵使用者流程 |
| refactor-cleaner | 無用程式碼清理 | 程式碼維護 |
| doc-updater | 文件 | 更新文件 |

## 立即使用 Agent

不需要使用者提示：
1. 複雜功能請求 - 使用 **planner** Agent
2. 剛撰寫/修改程式碼 - 使用 **code-reviewer** Agent
3. Bug 修復或新功能 - 使用 **tdd-guide** Agent
4. 架構決策 - 使用 **architect** Agent

## 平行任務執行

對獨立操作總是使用平行 Task 執行：

```markdown
# 好：平行執行
平行啟動 3 個 agents：
1. Agent 1：auth.ts 的安全性分析
2. Agent 2：快取系統的效能審查
3. Agent 3：utils.ts 的型別檢查

# 不好：不必要的循序
先 agent 1，然後 agent 2，然後 agent 3
```

## 多觀點分析

對於複雜問題，使用分角色子 agents：
- 事實審查者
- 資深工程師
- 安全專家
- 一致性審查者
- 冗餘檢查者
