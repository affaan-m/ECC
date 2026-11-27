---
name: opensource-pipeline
description: "开源流水线：fork、清理并打包私有项目以安全公开发布。串联3个代理（fork代理、清理代理、打包代理）。触发词：'/opensource'、'open source this'、'make this public'、'prepare for open source'。"
origin: ECC
---

# 开源流水线技能

通过三阶段流水线安全地开源任何项目：**分叉**（剥离密钥）→ **净化**（验证清洁）→ **打包**（CLAUDE.md + setup.sh + README）。

## 何时激活

* 用户说"开源此项目"或"使其公开"
* 用户希望将私有仓库准备为公开发布
* 用户需要在推送到 GitHub 前剥离密钥
* 用户调用 `/opensource fork`、`/opensource verify` 或 `/opensource package`

## 命令

| 命令 | 操作 |
|---------|--------|
| `/opensource fork PROJECT` | 完整流水线：分叉 + 净化 + 打包 |
| `/opensource verify PROJECT` | 对现有仓库运行净化器 |
| `/opensource package PROJECT` | 生成 CLAUDE.md + setup.sh + README |
| `/opensource list` | 显示所有暂存项目 |
| `/opensource status PROJECT` | 显示暂存项目的报告 |

## 协议

### /opensource fork PROJECT

**完整流水线——主要工作流程。**

#### 步骤 1：收集参数

解析项目路径。如果 PROJECT 包含 `/`，则视为路径（绝对或相对）。否则检查：当前工作目录、`$HOME/PROJECT`，然后询问用户。

```
SOURCE_PATH="<resolved absolute path>"
STAGING_PATH="$HOME/opensource-staging/${PROJECT_NAME}"
```

询问用户：

1. "哪个项目？"（如果未找到）
2. "许可证？（MIT / Apache-2.0 / GPL-3.0 / BSD-3-Clause）"
3. "GitHub 组织或用户名？"（默认：通过 `gh api user -q .login` 检测）
4. "GitHub 仓库名称？"（默认：项目名称）
5. "README 的描述？"（分析项目以提供建议）

#### 步骤 2：创建暂存目录

```bash
mkdir -p $HOME/opensource-staging/
```

#### 步骤 3：运行分叉代理

生成 `opensource-forker` 代理：

```
Agent(
  description="将 {PROJECT} 分叉为开源项目",
  subagent_type="opensource-forker",
  prompt="""
将项目分叉以进行开源发布。

来源：{SOURCE_PATH}
目标：{STAGING_PATH}
许可证：{chosen_license}

遵循完整的分叉协议：
1. 复制文件（排除 .git、node_modules、__pycache__、.venv）
2. 清除所有机密和凭证
3. 将内部引用替换为占位符
4. 生成 .env.example
5. 清理 Git 历史记录
6. 在 {STAGING_PATH}/FORK_REPORT.md 中生成 FORK_REPORT.md
"""
)
```

等待完成。读取 `{STAGING_PATH}/FORK_REPORT.md`。

#### 步骤 4：运行净化代理

生成 `opensource-sanitizer` 代理：

```
Agent(
  description="验证 {PROJECT} 的脱敏处理",
  subagent_type="opensource-sanitizer",
  prompt="""
验证开源分支的脱敏处理。

项目：{STAGING_PATH}
源（供参考）：{SOURCE_PATH}

运行所有扫描类别：
1. 密钥扫描（严重）
2. 个人身份信息扫描（严重）
3. 内部引用扫描（严重）
4. 危险文件检查（严重）
5. 配置完整性（警告）
6. Git 历史审计

在 {STAGING_PATH}/ 目录下生成 SANITIZATION_REPORT.md 文件，并给出通过/未通过的判定结果。
"""
)
```

等待完成。读取 `{STAGING_PATH}/SANITIZATION_REPORT.md`。

**如果失败：** 向用户展示发现结果。询问："修复这些问题并重新扫描，还是中止？"

* 如果修复：应用修复，重新运行净化器（最多重试 3 次——3 次失败后，展示所有发现结果并请用户手动修复）
* 如果中止：清理暂存目录

**如果通过或带警告通过：** 继续步骤 5。

#### 步骤 5：运行打包代理

生成 `opensource-packager` 代理：

```
Agent(
  description="将项目 {PROJECT} 打包为开源项目",
  subagent_type="opensource-packager",
  prompt="""
为项目生成开源打包文件。

项目：{STAGING_PATH}
许可证：{chosen_license}
项目名称：{PROJECT_NAME}
描述：{description}
GitHub 仓库：{github_repo}

生成：
1. CLAUDE.md（命令、架构、关键文件）
2. setup.sh（一键引导脚本，设为可执行）
3. README.md（或增强现有文件）
4. LICENSE
5. CONTRIBUTING.md
6. .github/ISSUE_TEMPLATE/（bug_report.md、feature_request.md）
"""
)
```

#### 步骤 6：最终审查

向用户展示：

```
开源分支就绪：{PROJECT_NAME}

位置：{STAGING_PATH}
许可证：{license}
生成的文件：
  - CLAUDE.md
  - setup.sh（可执行文件）
  - README.md
  - LICENSE
  - CONTRIBUTING.md
  - .env.example（{N} 个变量）

清理：{sanitization_verdict}

后续步骤：
  1. 审查：cd {STAGING_PATH}
  2. 创建仓库：gh repo create {github_org}/{github_repo} --public
  3. 推送：git remote add origin ... && git push -u origin main

是否继续创建 GitHub 仓库？（是/否/先审查）
```

#### 步骤 7：GitHub 发布（用户批准后）

```bash
cd "{STAGING_PATH}"
gh repo create "{github_org}/{github_repo}" --public --source=. --push --description "{description}"
```

***

### /opensource verify PROJECT

独立运行净化器。解析路径：如果 PROJECT 包含 `/`，则视为路径。否则检查 `$HOME/opensource-staging/PROJECT`，然后 `$HOME/PROJECT`，最后当前目录。

```
Agent(
  subagent_type="opensource-sanitizer",
  prompt="验证以下路径的清理状态：{resolved_path}。运行全部6类扫描，并生成 SANITIZATION_REPORT.md 文件。"
)
```

***

### /opensource package PROJECT

独立运行打包器。询问"许可证？"和"描述？"，然后：

```
Agent(
  subagent_type="opensource-packager",
  prompt="Package: {resolved_path} ..."
)
```

***

### /opensource list

```bash
ls -d $HOME/opensource-staging/*/
```

显示每个项目及其流水线进度（FORK\_REPORT.md、SANITIZATION\_REPORT.md、CLAUDE.md 是否存在）。

***

### /opensource status PROJECT

```bash
cat $HOME/opensource-staging/${PROJECT}/SANITIZATION_REPORT.md
cat $HOME/opensource-staging/${PROJECT}/FORK_REPORT.md
```

## 暂存布局

```
$HOME/opensource-staging/
  my-project/
    FORK_REPORT.md           # 来自 forker 代理
    SANITIZATION_REPORT.md   # 来自 sanitizer 代理
    CLAUDE.md                # 来自 packager 代理
    setup.sh                 # 来自 packager 代理
    README.md                # 来自 packager 代理
    .env.example             # 来自 forker 代理
    ...                      # 清理后的项目文件
```

## 反模式

* **绝不**在未经用户批准的情况下推送到 GitHub
* **绝不**跳过净化器——它是安全门
* **绝不**在净化器失败且未修复所有关键发现后继续
* **绝不**在暂存目录中保留 `.env`、`*.pem` 或 `credentials.json`

## 最佳实践

* 对于新版本，始终运行完整流水线（分叉 → 净化 → 打包）
* 暂存目录会持续存在直到显式清理——用于审查
* 在发布前，任何手动修复后重新运行净化器
* 参数化密钥而非删除它们——保留项目功能

## 相关技能

参见 `security-review` 了解净化器使用的密钥检测模式。
