---
name: security-scan
description: 使用AgentShield扫描您的Claude代码配置（.claude/目录），以发现安全漏洞、配置错误和注入风险。检查CLAUDE.md、settings.json、MCP服务器、钩子和代理定义。
origin: ECC
---

# 安全扫描技能

使用 [AgentShield](https://github.com/affaan-m/agentshield) 审计您的 Claude Code 配置中的安全问题。

## 何时激活

* 设置新的 Claude Code 项目时
* 修改 `.claude/settings.json`、`CLAUDE.md` 或 MCP 配置后
* 提交配置更改前
* 加入具有现有 Claude Code 配置的新代码库时
* 定期进行安全卫生检查时

## 扫描内容

| 文件 | 检查项 |
|------|--------|
| `CLAUDE.md` | 硬编码的密钥、自动运行指令、提示词注入模式 |
| `settings.json` | 过于宽松的允许列表、缺失的拒绝列表、危险的绕过标志 |
| `mcp.json` | 有风险的 MCP 服务器、硬编码的环境变量密钥、npx 供应链风险 |
| `hooks/` | 通过 `${file}` 插值导致的命令注入、数据泄露、静默错误抑制 |
| `agents/*.md` | 无限制的工具访问、提示词注入攻击面、缺失的模型规格 |

## 先决条件

必须安装 AgentShield。检查并在需要时安装：

```bash
# Check if installed
npx ecc-agentshield --version

# Install globally (recommended)
npm install -g ecc-agentshield

# Or run directly via npx (no install needed)
npx ecc-agentshield scan .
```

## 使用方法

### 基础扫描

针对当前项目的 `.claude/` 目录运行：

```bash
# Scan current project
npx ecc-agentshield scan

# Scan a specific path
npx ecc-agentshield scan --path /path/to/.claude

# Scan with minimum severity filter
npx ecc-agentshield scan --min-severity medium
```

### 输出格式

```bash
# Terminal output (default) — colored report with grade
npx ecc-agentshield scan

# JSON — for CI/CD integration
npx ecc-agentshield scan --format json

# Markdown — for documentation
npx ecc-agentshield scan --format markdown

# HTML — self-contained dark-theme report
npx ecc-agentshield scan --format html > security-report.html
```

### 自动修复

自动应用安全的修复（仅修复标记为可自动修复的问题）：

```bash
npx ecc-agentshield scan --fix
```

这将：

* 用环境变量引用替换硬编码的密钥
* 将通配符权限收紧为作用域明确的替代方案
* 绝不修改仅限手动修复的建议

### Opus 4.6 深度分析

运行对抗性的三智能体流程以进行更深入的分析：

```bash
# Requires ANTHROPIC_API_KEY
export ANTHROPIC_API_KEY=your-key
npx ecc-agentshield scan --opus --stream
```

这将运行：

1. **攻击者（红队）** — 寻找攻击向量
2. **防御者（蓝队）** — 建议加固措施
3. **审计员（最终裁决）** — 综合双方观点

### 初始化安全配置

从头开始搭建一个新的安全 `.claude/` 配置：

```bash
npx ecc-agentshield init
```

创建：

* 具有作用域权限和拒绝列表的 `settings.json`
* 遵循安全最佳实践的 `CLAUDE.md`
* `mcp.json` 占位符

### GitHub Action

添加到您的 CI 流水线中：

```yaml
- uses: affaan-m/agentshield@v1
  with:
    path: '.'
    min-severity: 'medium'
    fail-on-findings: true
```

## 严重性等级

| 等级 | 分数 | 含义 |
|-------|-------|---------|
| A | 90-100 | 安全配置 |
| B | 75-89 | 轻微问题 |
| C | 60-74 | 需要注意 |
| D | 40-59 | 显著风险 |
| F | 0-39 | 严重漏洞 |

## 结果解读

### 关键发现（立即修复）

* 配置文件中硬编码的 API 密钥或令牌
* 允许列表中存在 `Bash(*)`（无限制的 shell 访问）
* 钩子中通过 `${file}` 插值导致的命令注入
* 运行 shell 的 MCP 服务器

### 高优先级发现（生产前修复）

* CLAUDE.md 中的自动运行指令（提示词注入向量）
* 权限配置中缺少拒绝列表
* 具有不必要 Bash 访问权限的代理

### 中优先级发现（建议修复）

* 钩子中的静默错误抑制（`2>/dev/null`、`|| true`）
* 缺少 PreToolUse 安全钩子
* MCP 服务器配置中的 `npx -y` 自动安装

### 信息性发现（了解情况）

* MCP 服务器缺少描述信息
* 正确标记为良好实践的限制性指令

## 链接

* **GitHub**: [github.com/affaan-m/agentshield](https://github.com/affaan-m/agentshield)
* **npm**: [npmjs.com/package/ecc-agentshield](https://www.npmjs.com/package/ecc-agentshield)
