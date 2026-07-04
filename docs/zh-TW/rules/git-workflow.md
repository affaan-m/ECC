# Git 工作流程

## Commit 訊息格式

```
<type>: <description>

<optional body>
```

類型：feat、fix、refactor、docs、test、chore、perf、ci

注意：若要停用共同作者歸屬，請在 `~/.claude/settings.json` 中設定 `"includeCoAuthoredBy": false`；Claude Code 預設會附加 `Co-Authored-By`，而 ECC 不會隨附這個設定。

## Pull Request 工作流程

建立 PR 時：
1. 分析完整 commit 歷史（不只是最新 commit）
2. 使用 `git diff [base-branch]...HEAD` 查看所有變更
3. 起草全面的 PR 摘要
4. 包含帶 TODO 的測試計畫
5. 如果是新分支，使用 `-u` flag 推送

## 功能實作工作流程

1. **先規劃**
   - 使用 **planner** Agent 建立實作計畫
   - 識別相依性和風險
   - 拆解為階段

2. **TDD 方法**
   - 使用 **tdd-guide** Agent
   - 先撰寫測試（RED）
   - 實作使測試通過（GREEN）
   - 重構（IMPROVE）
   - 驗證 80%+ 覆蓋率

3. **程式碼審查**
   - 撰寫程式碼後立即使用 **code-reviewer** Agent
   - 處理關鍵和高優先問題
   - 盡可能修復中優先問題

4. **Commit 與推送**
   - 詳細的 commit 訊息
   - 遵循 conventional commits 格式
