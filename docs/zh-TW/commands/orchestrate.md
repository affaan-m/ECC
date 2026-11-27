# Orchestrate 指令

複雜任務的循序 Agent 工作流程。

## 使用方式

`/orchestrate [workflow-type] [task-description]`

## 工作流程類型

### feature
完整的功能實作工作流程：
```
planner -> tdd-guide -> code-reviewer -> security-reviewer
```

### bugfix
Bug 調查和修復工作流程：
```
planner -> tdd-guide -> code-reviewer
```

### refactor
安全重構工作流程：
```
architect -> code-reviewer -> tdd-guide
```

### security
以安全性為焦點的審查：
```
security-reviewer -> code-reviewer -> architect
```

## 執行模式

對工作流程中的每個 Agent：

1. **呼叫 Agent**，帶入前一個 Agent 的上下文
2. **收集輸出**作為結構化交接文件
3. **傳遞給下一個 Agent**
4. **彙整結果**為最終報告

## 交接文件格式

Agent 之間，建立交接文件：

```markdown
## 交接：[前一個 Agent] -> [下一個 Agent]

### 上下文
[完成事項的摘要]

### 發現
[關鍵發現或決策]

### 修改的檔案
[觸及的檔案列表]

### 開放問題
[下一個 Agent 的未解決項目]

### 建議
[建議的後續步驟]
```

## 最終報告格式

```
協調報告
====================
工作流程：feature
任務：新增使用者驗證
Agents：planner -> tdd-guide -> code-reviewer -> security-reviewer

摘要
-------
[一段摘要]

AGENT 輸出
-------------
Planner：[摘要]
TDD Guide：[摘要]
Code Reviewer：[摘要]
Security Reviewer：[摘要]

變更的檔案
-------------
[列出所有修改的檔案]

測試結果
------------
[測試通過/失敗摘要]

安全性狀態
---------------
[安全性發現]

建議
--------------
[發布 / 需要改進 / 阻擋]
```

## 平行執行

對於獨立的檢查，平行執行 Agents：

```markdown
### 平行階段
同時執行：
- code-reviewer（品質）
- security-reviewer（安全性）
- architect（設計）

### 合併結果
將輸出合併為單一報告
```

## 參數

$ARGUMENTS:
- `feature <description>` - 完整功能工作流程
- `bugfix <description>` - Bug 修復工作流程
- `refactor <description>` - 重構工作流程
- `security <description>` - 安全性審查工作流程
- `custom <agents> <description>` - 自訂 Agent 序列

## 自訂工作流程範例

```
/orchestrate custom "architect,tdd-guide,code-reviewer" "重新設計快取層"
```

## 提示

1. **複雜功能從 planner 開始**
2. **合併前總是包含 code-reviewer**
3. **對驗證/支付/PII 使用 security-reviewer**
4. **保持交接簡潔** - 專注於下一個 Agent 需要的內容
5. **如有需要，在 Agents 之間執行 verification**
