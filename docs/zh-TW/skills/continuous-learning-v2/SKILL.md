---
name: continuous-learning-v2
description: Instinct-based learning system that observes sessions via hooks, creates atomic instincts with confidence scoring, and evolves them into skills/commands/agents.
version: 2.0.0
---

# 持續學習 v2 - 基於本能的架構

進階學習系統，透過原子「本能」（帶信心評分的小型學習行為）將你的 Claude Code 工作階段轉化為可重用知識。

## v2 的新功能

| 功能 | v1 | v2 |
|------|----|----|
| 觀察 | Stop hook（工作階段結束） | PreToolUse/PostToolUse（100% 可靠） |
| 分析 | 主要上下文 | 背景 agent（Haiku） |
| 粒度 | 完整技能 | 原子「本能」 |
| 信心 | 無 | 0.3-0.9 加權 |
| 演化 | 直接到技能 | 本能 → 聚類 → 技能/指令/agent |
| 分享 | 無 | 匯出/匯入本能 |

## 本能模型

本能是一個小型學習行為：

```yaml
---
id: prefer-functional-style
trigger: "when writing new functions"
confidence: 0.7
domain: "code-style"
source: "session-observation"
---

# 偏好函式風格

## 動作
適當時使用函式模式而非類別。

## 證據
- 觀察到 5 次函式模式偏好
- 使用者在 2025-01-15 將基於類別的方法修正為函式
```

**屬性：**
- **原子性** — 一個觸發器，一個動作
- **信心加權** — 0.3 = 試探性，0.9 = 近乎確定
- **領域標記** — code-style、testing、git、debugging、workflow 等
- **證據支持** — 追蹤建立它的觀察

## 運作方式

```
工作階段活動
      │
      │ Hooks 捕獲提示 + 工具使用（100% 可靠）
      ▼
┌─────────────────────────────────────────┐
│         observations.jsonl              │
│   （提示、工具呼叫、結果）               │
└─────────────────────────────────────────┘
      │
      │ Observer agent 讀取（背景、Haiku）
      ▼
┌─────────────────────────────────────────┐
│          模式偵測                        │
│   • 使用者修正 → 本能                   │
│   • 錯誤解決 → 本能                     │
│   • 重複工作流程 → 本能                 │
└─────────────────────────────────────────┘
      │
      │ 建立/更新
      ▼
┌─────────────────────────────────────────┐
│         instincts/personal/             │
│   • prefer-functional.md (0.7)          │
│   • always-test-first.md (0.9)          │
│   • use-zod-validation.md (0.6)         │
└─────────────────────────────────────────┘
      │
      │ /evolve 聚類
      ▼
┌─────────────────────────────────────────┐
│              evolved/                   │
│   • commands/new-feature.md             │
│   • skills/testing-workflow.md          │
│   • agents/refactor-specialist.md       │
└─────────────────────────────────────────┘
```

## 快速開始

### 1. 啟用觀察 Hooks

**如果作為外掛安裝**（建議）：

不需要在 `~/.claude/settings.json` 中額外加入 hook。Claude Code v2.1+ 會自動載入外掛的 `hooks/hooks.json`，其中已經註冊了 `observe.sh`。

如果你之前把 `observe.sh` 複製到 `~/.claude/settings.json`，請移除重複的 `PreToolUse` / `PostToolUse` 區塊。重複註冊會造成重複執行，並觸發 `${CLAUDE_PLUGIN_ROOT}` 解析錯誤；這個變數只會在外掛自己的 `hooks/hooks.json` 中展開。

**如果手動安裝到 `~/.claude/skills`**，新增到你的 `~/.claude/settings.json`：

```json
{
  "hooks": {
    "PreToolUse": [{
      "matcher": "*",
      "hooks": [{
        "type": "command",
        "command": "~/.claude/skills/continuous-learning-v2/hooks/observe.sh"
      }]
    }],
    "PostToolUse": [{
      "matcher": "*",
      "hooks": [{
        "type": "command",
        "command": "~/.claude/skills/continuous-learning-v2/hooks/observe.sh"
      }]
    }]
  }
}
```

### 2. 初始化目錄結構

```bash
mkdir -p ~/.claude/homunculus/{instincts/{personal,inherited},evolved/{agents,skills,commands}}
touch ~/.claude/homunculus/observations.jsonl
```

### 3. 執行 Observer Agent（可選）

觀察者可以在背景執行並分析觀察：

```bash
# 啟動背景觀察者
~/.claude/skills/continuous-learning-v2/agents/start-observer.sh
```

## 指令

| 指令 | 描述 |
|------|------|
| `/instinct-status` | 顯示所有學習本能及其信心 |
| `/evolve` | 將相關本能聚類為技能/指令 |
| `/instinct-export` | 匯出本能以分享 |
| `/instinct-import <file>` | 從他人匯入本能 |

## 設定

編輯 `config.json`：

```json
{
  "version": "2.0",
  "observation": {
    "enabled": true,
    "store_path": "~/.claude/homunculus/observations.jsonl",
    "max_file_size_mb": 10,
    "archive_after_days": 7
  },
  "instincts": {
    "personal_path": "~/.claude/homunculus/instincts/personal/",
    "inherited_path": "~/.claude/homunculus/instincts/inherited/",
    "min_confidence": 0.3,
    "auto_approve_threshold": 0.7,
    "confidence_decay_rate": 0.05
  },
  "observer": {
    "enabled": true,
    "model": "haiku",
    "run_interval_minutes": 5,
    "patterns_to_detect": [
      "user_corrections",
      "error_resolutions",
      "repeated_workflows",
      "tool_preferences"
    ]
  },
  "evolution": {
    "cluster_threshold": 3,
    "evolved_path": "~/.claude/homunculus/evolved/"
  }
}
```

## 檔案結構

```
~/.claude/homunculus/
├── identity.json           # 你的個人資料、技術水平
├── observations.jsonl      # 當前工作階段觀察
├── observations.archive/   # 已處理觀察
├── instincts/
│   ├── personal/           # 自動學習本能
│   └── inherited/          # 從他人匯入
└── evolved/
    ├── agents/             # 產生的專業 agents
    ├── skills/             # 產生的技能
    └── commands/           # 產生的指令
```

## 與 Skill Creator 整合

當你使用 [Skill Creator GitHub App](https://skill-creator.app) 時，它現在產生**兩者**：
- 傳統 SKILL.md 檔案（用於向後相容）
- 本能集合（用於 v2 學習系統）

從倉庫分析的本能有 `source: "repo-analysis"` 並包含來源倉庫 URL。

## 信心評分

信心隨時間演化：

| 分數 | 意義 | 行為 |
|------|------|------|
| 0.3 | 試探性 | 建議但不強制 |
| 0.5 | 中等 | 相關時應用 |
| 0.7 | 強烈 | 自動批准應用 |
| 0.9 | 近乎確定 | 核心行為 |

**信心增加**當：
- 重複觀察到模式
- 使用者不修正建議行為
- 來自其他來源的類似本能同意

**信心減少**當：
- 使用者明確修正行為
- 長期未觀察到模式
- 出現矛盾證據

## 為何 Hooks vs Skills 用於觀察？

> "v1 依賴技能進行觀察。技能是機率性的——它們根據 Claude 的判斷觸發約 50-80% 的時間。"

Hooks **100% 的時間**確定性地觸發。這意味著：
- 每個工具呼叫都被觀察
- 無模式被遺漏
- 學習是全面的

## 向後相容性

v2 完全相容 v1：
- 現有 `~/.claude/skills/learned/` 技能仍可運作
- Stop hook 仍執行（但現在也餵入 v2）
- 漸進遷移路徑：兩者並行執行

## 隱私

- 觀察保持在你的機器**本機**
- 只有**本能**（模式）可被匯出
- 不會分享實際程式碼或對話內容
- 你控制匯出內容

## 相關

- [Skill Creator](https://skill-creator.app) - 從倉庫歷史產生本能
- Homunculus - 啟發 v2 架構的社區專案（原子觀察、信心評分、本能演化管線）
- [Longform Guide](https://x.com/affaanmustafa/status/2014040193557471352) - 持續學習章節

---

*基於本能的學習：一次一個觀察，教導 Claude 你的模式。*
