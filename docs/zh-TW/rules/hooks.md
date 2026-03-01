# Hook 系統

## Hook 類型

- **PreToolUse**：工具執行前（驗證、參數修改）
- **PostToolUse**：工具執行後（自動格式化、檢查）
- **Stop**：工作階段結束時（最終驗證）

## 目前 Hooks（在 ~/.claude/settings.json）

### PreToolUse
- **tmux 提醒**：建議對長時間執行的指令使用 tmux（npm、pnpm、yarn、cargo 等）
- **git push 審查**：推送前開啟 Zed 進行審查
- **文件阻擋器**：阻擋建立不必要的 .md/.txt 檔案

### PostToolUse
- **PR 建立**：記錄 PR URL 和 GitHub Actions 狀態
- **oxfmt**：編輯後自動格式化 JS/TS 檔案
- **TypeScript 檢查**：編輯 .ts/.tsx 檔案後執行 tsc
- **console.log 警告**：警告編輯檔案中的 console.log

### Stop
- **console.log 稽核**：工作階段結束前檢查所有修改檔案中的 console.log

## 自動接受權限

謹慎使用：
- 對受信任、定義明確的計畫啟用
- 對探索性工作停用
- 絕不使用 dangerously-skip-permissions flag
- 改為在 `~/.claude.json` 中設定 `allowedTools`

## TodoWrite 最佳實務

使用 TodoWrite 工具來：
- 追蹤多步驟任務的進度
- 驗證對指示的理解
- 啟用即時調整
- 顯示細粒度實作步驟

待辦清單揭示：
- 順序錯誤的步驟
- 缺少的項目
- 多餘的不必要項目
- 錯誤的粒度
- 誤解的需求
