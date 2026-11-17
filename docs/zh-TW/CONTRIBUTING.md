# 貢獻 ECC

感謝您想要貢獻。本儲存庫旨在成為 Claude Code 使用者的社群資源。

## 我們正在尋找什麼

### 代理程式（Agents）

能夠妥善處理特定任務的新代理程式：
- 特定語言審查員（Python、Go、Rust）
- 框架專家（Django、Rails、Laravel、Spring）
- DevOps 專家（Kubernetes、Terraform、CI/CD）
- 領域專家（ML 管線、資料工程、行動開發）

### 技能（Skills）

工作流程定義和領域知識：
- 語言最佳實務
- 框架模式
- 測試策略
- 架構指南
- 特定領域知識

### 指令（Commands）

調用實用工作流程的斜線指令：
- 部署指令
- 測試指令
- 文件指令
- 程式碼生成指令

### 鉤子（Hooks）

實用的自動化：
- Lint/格式化鉤子
- 安全檢查
- 驗證鉤子
- 通知鉤子

### 規則（Rules）

必須遵守的準則：
- 安全規則
- 程式碼風格規則
- 測試需求
- 命名慣例

### MCP 設定

新的或改進的 MCP 伺服器設定：
- 資料庫整合
- 雲端供應商 MCP
- 監控工具
- 通訊工具

---

## 如何貢獻

### 1. Fork 儲存庫

```bash
git clone https://github.com/YOUR_USERNAME/ECC.git
cd ECC
```

### 2. 建立分支

```bash
git checkout -b add-python-reviewer
```

### 3. 新增您的貢獻

將檔案放置在適當的目錄：
- `agents/` 用於新代理程式
- `skills/` 用於技能（可以是單一 .md 或目錄）
- `commands/` 用於斜線指令
- `rules/` 用於規則檔案
- `hooks/` 用於鉤子設定
- `mcp-configs/` 用於 MCP 伺服器設定

### 4. 遵循格式

**代理程式**應包含 frontmatter：

```markdown
---
name: agent-name
description: What it does
tools: Read, Grep, Glob, Bash
model: sonnet
---

Instructions here...
```

**技能**應清晰且可操作：

```markdown
# Skill Name

## When to Use

...

## How It Works

...

## Examples

...
```

**指令**應說明其功能：

```markdown
---
description: Brief description of command
---

# Command Name

Detailed instructions...
```

**鉤子**應包含描述：

```json
{
  "matcher": "...",
  "hooks": [...],
  "description": "What this hook does"
}
```

### 5. 測試您的貢獻

在提交前確保您的設定能與 Claude Code 正常運作。

### 6. 提交 PR

```bash
git add .
git commit -m "Add Python code reviewer agent"
git push origin add-python-reviewer
```

然後開啟一個 PR，包含：
- 您新增了什麼
- 為什麼它有用
- 您如何測試它

---

## 指南

### 建議做法

- 保持設定專注且模組化
- 包含清晰的描述
- 提交前先測試
- 遵循現有模式
- 記錄任何相依性

### 避免做法

- 包含敏感資料（API 金鑰、權杖、路徑）
- 新增過於複雜或小眾的設定
- 提交未測試的設定
- 建立重複的功能
- 新增需要特定付費服務但無替代方案的設定

---

## 檔案命名

- 使用小寫加連字號：`python-reviewer.md`
- 具描述性：`tdd-workflow.md` 而非 `workflow.md`
- 將代理程式/技能名稱與檔名對應

---

## 有問題？

開啟 issue 或在 X 上聯繫：[@affaanmustafa](https://x.com/affaanmustafa)

---

感謝您的貢獻。讓我們一起打造優質的資源。
