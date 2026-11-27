# ECC for CodeBuddy

为 CodeBuddy IDE 带来 ECC 工作流。此仓库提供自定义命令、智能体、技能和规则，可以通过统一的 Target Adapter 架构安装到任何 CodeBuddy 项目中。

## 快速开始（推荐）

使用统一安装系统，获得完整的生命周期管理：

```bash
# 使用默认配置安装
node scripts/install-apply.js --target codebuddy --profile developer

# 使用完整配置安装（所有模块）
node scripts/install-apply.js --target codebuddy --profile full

# 预览模式查看变更
node scripts/install-apply.js --target codebuddy --profile full --dry-run
```

## 管理命令

```bash
# 检查安装健康状态
node scripts/doctor.js --target codebuddy

# 修复安装
node scripts/repair.js --target codebuddy

# 清洁卸载（通过 install-state 跟踪）
node scripts/uninstall.js --target codebuddy
```

## Shell 脚本（旧版）

旧版 Shell 脚本仍然可用于快速设置：

```bash
# 安装到当前项目
cd /path/to/your/project
.codebuddy/install.sh

# 全局安装
.codebuddy/install.sh ~
```

## 包含的内容

### 命令

命令是通过 CodeBuddy 聊天中的 `/` 菜单调用的按需工作流。所有命令都直接复用自项目根目录的 `commands/` 文件夹。

### 智能体

智能体是具有特定工具配置的专门 AI 助手。所有智能体都直接复用自项目根目录的 `agents/` 文件夹。

### 技能

技能是通过聊天中的 `/` 菜单调用的按需工作流。所有技能都直接复用自项目的 `skills/` 文件夹。

### 规则

规则提供始终适用的规则和上下文，塑造智能体处理代码的方式。规则会被扁平化为命名空间文件（如 `common-coding-style.md`）以兼容 CodeBuddy。

## 项目结构

```
.codebuddy/
├── commands/           # 命令文件（复用自项目根目录）
├── agents/             # 智能体文件（复用自项目根目录）
├── skills/             # 技能文件（复用自 skills/）
├── rules/              # 规则文件（从 rules/ 扁平化）
├── ecc-install-state.json  # 安装状态跟踪
├── install.sh          # 旧版安装脚本
├── uninstall.sh        # 旧版卸载脚本
└── README.zh-CN.md     # 此文件
```

## Target Adapter 安装的优势

- **安装状态跟踪**：安全卸载，仅删除 ECC 管理的文件
- **Doctor 检查**：验证安装健康状态并检测偏移
- **修复**：自动修复损坏的安装
- **选择性安装**：通过配置文件选择特定模块
- **跨平台**：基于 Node.js，支持 Windows/macOS/Linux

## 推荐的工作流

1. **从计划开始**：使用 `/plan` 命令分解复杂功能
2. **先写测试**：在实现之前调用 `/tdd` 命令
3. **审查您的代码**：编写代码后使用 `/code-review`
4. **检查安全性**：对于身份验证、API 端点或敏感数据处理，再次使用 `/code-review`
5. **修复构建错误**：如果有构建错误，使用 `/build-fix`

## 下一步

- 在 CodeBuddy 中打开您的项目
- 输入 `/` 以查看可用命令
- 享受 ECC 工作流！
