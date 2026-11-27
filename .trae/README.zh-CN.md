# ECC for Trae

为 Trae IDE 带来 ECC 工作流。此仓库提供自定义命令、智能体、技能和规则，可以通过单个命令安装到任何 Trae 项目中。

## 快速开始

### 方式一：本地安装到 `.trae` 目录（默认环境）

```bash
# 安装到当前项目的 .trae 目录
cd /path/to/your/project
.trae/install.sh
```

这将在您的项目目录中创建 `.trae/`。

### 方式二：本地安装到 `.trae-cn` 目录（CN 环境）

```bash
# 安装到当前项目的 .trae-cn 目录
cd /path/to/your/project
TRAE_ENV=cn .trae/install.sh
```

这将在您的项目目录中创建 `.trae-cn/`。

### 方式三：全局安装到 `~/.trae` 目录（默认环境）

```bash
# 全局安装到 ~/.trae/
cd /path/to/your/project
.trae/install.sh ~
```

这将创建 `~/.trae/`，适用于所有 Trae 项目。

### 方式四：全局安装到 `~/.trae-cn` 目录（CN 环境）

```bash
# 全局安装到 ~/.trae-cn/
cd /path/to/your/project
TRAE_ENV=cn .trae/install.sh ~
```

这将创建 `~/.trae-cn/`，适用于所有 Trae 项目。

安装程序使用非破坏性复制 - 它不会覆盖您现有的文件。

## 安装模式

### 本地安装

安装到当前项目的 `.trae` 或 `.trae-cn` 目录：

```bash
# 安装到当前项目的 .trae 目录（默认）
cd /path/to/your/project
.trae/install.sh

# 安装到当前项目的 .trae-cn 目录（CN 环境）
cd /path/to/your/project
TRAE_ENV=cn .trae/install.sh
```

### 全局安装

安装到您主目录的 `.trae` 或 `.trae-cn` 目录（适用于所有 Trae 项目）：

```bash
# 全局安装到 ~/.trae/（默认）
.trae/install.sh ~

# 全局安装到 ~/.trae-cn/（CN 环境）
TRAE_ENV=cn .trae/install.sh ~
```

**注意**：全局安装适用于希望在所有项目之间维护单个 ECC 副本的场景。

## 环境支持

- **默认**：使用 `.trae` 目录
- **CN 环境**：使用 `.trae-cn` 目录（通过 `TRAE_ENV=cn` 设置）

### 强制指定环境

```bash
# 从项目根目录强制使用 CN 环境
TRAE_ENV=cn .trae/install.sh

# 进入 .trae 目录后使用默认环境
cd .trae
./install.sh
```

**注意**：`TRAE_ENV` 是一个全局环境变量，适用于整个安装会话。

## 卸载

卸载程序使用清单文件（`.ecc-manifest`）跟踪已安装的文件，确保安全删除：

```bash
# 从当前目录卸载（如果已经在 .trae 或 .trae-cn 目录中）
cd .trae-cn
./uninstall.sh

# 或者从项目根目录卸载
cd /path/to/your/project
TRAE_ENV=cn .trae/uninstall.sh

# 从主目录全局卸载
TRAE_ENV=cn .trae/uninstall.sh ~

# 卸载前会询问确认
```

### 卸载行为

- **安全删除**：仅删除清单中跟踪的文件（由 ECC 安装的文件）
- **保留用户文件**：您手动添加的任何文件都会被保留
- **非空目录**：包含用户添加文件的目录会被跳过
- **基于清单**：需要 `.ecc-manifest` 文件（在安装时创建）

### 环境支持

卸载程序遵循与安装程序相同的 `TRAE_ENV` 环境变量：

```bash
# 从 .trae-cn 卸载（CN 环境）
TRAE_ENV=cn ./uninstall.sh

# 从 .trae 卸载（默认环境）
./uninstall.sh
```

**注意**：如果找不到清单文件（旧版本安装），卸载程序将询问是否删除整个目录。

## 包含的内容

### 命令

命令是通过 Trae 聊天中的 `/` 菜单调用的按需工作流。所有命令都直接复用自项目根目录的 `commands/` 文件夹。

### 智能体

智能体是具有特定工具配置的专门 AI 助手。所有智能体都直接复用自项目根目录的 `agents/` 文件夹。

### 技能

技能是通过聊天中的 `/` 菜单调用的按需工作流。所有技能都直接复用自项目的 `skills/` 文件夹。

### 规则

规则提供始终适用的规则和上下文，塑造智能体处理代码的方式。所有规则都直接复用自项目根目录的 `rules/` 文件夹。

## 使用方法

1. 在聊天中输入 `/` 以打开命令菜单
2. 选择一个命令或技能
3. 智能体将通过具体说明和检查清单指导您完成工作流

## 项目结构

```
.trae/ (或 .trae-cn/)
├── commands/           # 命令文件（复用自项目根目录）
├── agents/             # 智能体文件（复用自项目根目录）
├── skills/             # 技能文件（复用自 skills/）
├── rules/              # 规则文件（复用自项目根目录）
├── install.sh          # 安装脚本
├── uninstall.sh        # 卸载脚本
└── README.md           # 此文件
```

## 自定义

安装后，所有文件都归您修改。安装程序永远不会覆盖现有文件，因此您的自定义在重新安装时是安全的。

**注意**：安装时会自动将 `install.sh` 和 `uninstall.sh` 脚本复制到目标目录，这样您可以在项目本地直接运行这些命令。

## 推荐的工作流

1. **从计划开始**：使用 `/plan` 命令分解复杂功能
2. **先写测试**：在实现之前调用 `/tdd` 命令
3. **审查您的代码**：编写代码后使用 `/code-review`
4. **检查安全性**：对于身份验证、API 端点或敏感数据处理，再次使用 `/code-review`
5. **修复构建错误**：如果有构建错误，使用 `/build-fix`

## 下一步

- 在 Trae 中打开您的项目
- 输入 `/` 以查看可用命令
- 享受 ECC 工作流！
