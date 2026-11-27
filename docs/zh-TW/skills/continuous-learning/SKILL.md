---
name: continuous-learning
description: Automatically extract reusable patterns from Claude Code sessions and save them as learned skills for future use.
---

# 持續學習技能

自動評估 Claude Code 工作階段結束時的內容，提取可重用模式並儲存為學習技能。

## 運作方式

此技能作為 **Stop hook** 在每個工作階段結束時執行：

1. **工作階段評估**：檢查工作階段是否有足夠訊息（預設：10+ 則）
2. **模式偵測**：從工作階段識別可提取的模式
3. **技能提取**：將有用模式儲存到 `~/.claude/skills/learned/`

## 設定

編輯 `config.json` 以自訂：

```json
{
  "min_session_length": 10,
  "extraction_threshold": "medium",
  "auto_approve": false,
  "learned_skills_path": "~/.claude/skills/learned/",
  "patterns_to_detect": [
    "error_resolution",
    "user_corrections",
    "workarounds",
    "debugging_techniques",
    "project_specific"
  ],
  "ignore_patterns": [
    "simple_typos",
    "one_time_fixes",
    "external_api_issues"
  ]
}
```

## 模式類型

| 模式 | 描述 |
|------|------|
| `error_resolution` | 特定錯誤如何被解決 |
| `user_corrections` | 來自使用者修正的模式 |
| `workarounds` | 框架/函式庫怪異問題的解決方案 |
| `debugging_techniques` | 有效的除錯方法 |
| `project_specific` | 專案特定慣例 |

## Hook 設定

新增到你的 `~/.claude/settings.json`：

```json
{
  "hooks": {
    "Stop": [{
      "matcher": "*",
      "hooks": [{
        "type": "command",
        "command": "~/.claude/skills/continuous-learning/evaluate-session.sh"
      }]
    }]
  }
}
```

## 為什麼用 Stop Hook？

- **輕量**：工作階段結束時只執行一次
- **非阻塞**：不會為每則訊息增加延遲
- **完整上下文**：可存取完整工作階段記錄

## 相關

- [Longform Guide](https://x.com/affaanmustafa/status/2014040193557471352) - 持續學習章節
- `/learn` 指令 - 工作階段中手動提取模式

---

## 比較筆記（研究：2025 年 1 月）

### vs Homunculus

Homunculus v2 採用更複雜的方法：

| 功能 | 我們的方法 | Homunculus v2 |
|------|----------|---------------|
| 觀察 | Stop hook（工作階段結束） | PreToolUse/PostToolUse hooks（100% 可靠） |
| 分析 | 主要上下文 | 背景 agent（Haiku） |
| 粒度 | 完整技能 | 原子「本能」 |
| 信心 | 無 | 0.3-0.9 加權 |
| 演化 | 直接到技能 | 本能 → 聚類 → 技能/指令/agent |
| 分享 | 無 | 匯出/匯入本能 |

**來自 homunculus 的關鍵見解：**
> "v1 依賴技能進行觀察。技能是機率性的——它們觸發約 50-80% 的時間。v2 使用 hooks 進行觀察（100% 可靠），並以本能作為學習行為的原子單位。"

### 潛在 v2 增強

1. **基於本能的學習** - 較小的原子行為，帶信心評分
2. **背景觀察者** - Haiku agent 並行分析
3. **信心衰減** - 如果被矛盾則本能失去信心
4. **領域標記** - code-style、testing、git、debugging 等
5. **演化路徑** - 將相關本能聚類為技能/指令

參見：`docs/continuous-learning-v2-spec.md` 完整規格。
