---
name: configure-ecc
description: 在 Claude Code、Codex 或 Kimi 内引导 ECC 安装、更新或重新配置，同时严格遵守各家工具真实的插件、范围和 Hook 能力。
metadata:
  origin: ECC
---

# 配置 Everything Claude Code

在当前工具内运行对话式向导：先检查，只收集受支持的选项，预览，只确认
一次，以非交互方式执行，验证，最后才显示欢迎信息。不要把 ECC 克隆到
临时目录，也不要手动复制插件组件。

在用户自己操作的终端中，规范入口是 `ecc setup` 和 `npx ecc-universal setup`。
在工具内请改用下方参数完整的非交互命令。

## 按当前工具分流

- Claude Code：使用下面完整的范围与 Hook 向导。
- Codex：使用 Codex 原生插件生命周期；不要提供 Claude 范围，也不要映射
  Claude 的四种 ECC Hook 配置。
- Kimi：把项目表面安装到 `./.kimi-code`；Kimi 不支持 ECC 的 Claude 生命周期
  Hook 配置。
- 无法确定工具时，先说明检测依据，再询问要配置哪一个，不要直接修改。

此技能是安装后的重新配置路径，无法拦截或取代提供商内置的首次安装界面。

## Claude Code：运行完整对话式向导

### 1. 只读检查

运行以下两条命令，总结 ECC 的安装范围、启用状态和 marketplace 来源：

```bash
claude plugin list --json
claude plugin marketplace list --json
```

只有一个现有 `ecc@ecc` 时，将本次视为重新配置。不要把 Claude 提供商所有的
“Open home page”控件当作安装证据。若 setup 报告多个 ECC 范围、旧版或手动
安装、配置损坏或 marketplace 冲突，请停止并原样报告恢复建议，不要猜测要删除哪个。

### 2. 只收集两个选择

只询问一次安装范围，并要求且仅要求一个值：

- `user | project | local`
- `user` 对当前用户全局可用。
- `project` 通过仓库设置共享。
- `local` 仅当前项目私有。

界面中只能把选中的一个范围显示为已选或正在安装。如果用户从唯一现有范围
切换到另一范围，说明这是范围迁移，并在下方命令中加入 `--move-scope`。

只询问一次 Hook 模式，并要求且仅要求一个值：

- `off | minimal | standard | strict`
- `off` 保留技能和命令，但关闭 ECC Hook 自动化。
- `minimal` 只启用最轻量的生命周期和安全自动化。
- `standard` 平衡质量和安全自动化。
- `strict` 启用最严格的检查和提醒。

Hook 偏好是个人 Claude 插件配置，不会跟随所选安装范围。

### 3. 预览并只确认一次

优先使用插件自带的 setup 脚本。替换两个已选值，只在范围迁移时加入
`--move-scope`：

```bash
node "$CLAUDE_PLUGIN_ROOT/scripts/setup.js" --mode claude-plugin \
  --scope <scope> --hooks <hooks> [--move-scope] --dry-run --json
```

如果 `$CLAUDE_PLUGIN_ROOT` 不可用，使用已发布的 npm 包：

```bash
npx --yes --package ecc-universal ecc setup --mode claude-plugin \
  --scope <scope> --hooks <hooks> [--move-scope] --dry-run --json
```

只显示一次确认摘要，内容包含计划操作、唯一范围、唯一 Hook 模式、marketplace 操作和
任何从来源到目标的迁移。只问一个是/否问题。不要通过工具的 Shell 调用不带参数的
交互式 `ecc setup`，因为该 Shell 通常不是 TTY。

### 4. 应用明确选择

确认后，使用同一路径但去掉 `--dry-run`。保留每个明确选择，并请求 JSON：

```bash
node "$CLAUDE_PLUGIN_ROOT/scripts/setup.js" --mode claude-plugin \
  --scope <scope> --hooks <hooks> [--move-scope] --yes --json
```

备用命令：

```bash
npx --yes --package ecc-universal ecc setup --mode claude-plugin \
  --scope <scope> --hooks <hooks> [--move-scope] --yes --json
```

### 5. 先验证，再显示欢迎信息

必须得到零退出状态，且 setup 结果中的 `scope` 和 `hooks` 必须等于所选值。然后独立运行：

```bash
claude plugin list --json
```

只有在所选范围中恰好存在一个已启用的 `ecc@ecc` 条目时才继续。如果
`$CLAUDE_PLUGIN_ROOT` 可用，把成功 setup 的 `action`（`installed`、`updated`、
`migrated`、`resumed` 或 `already-migrated`）传给内置渲染器：

调用前必须确认提供方报告的版本匹配 `scripts/lib/terminal-welcome.js` 中的
`ECC_VERSION_PATTERN`。异常版本文本应被拒绝，不得插入 shell 命令。

```bash
node -e 'const { renderTerminalWelcome } = require(process.env.CLAUDE_PLUGIN_ROOT + "/scripts/lib/terminal-welcome"); process.stdout.write(renderTerminalWelcome({ action: process.argv[1], version: process.argv[2], color: process.stdout.isTTY }));' "<action>" "<installed-version>"
```

欢迎信息只渲染一次。失败、预览、取消、范围或 Hook 不匹配、无法验证时都不显示；
改为报告错误和恢复方法。验证完成后，提醒用户运行 `/reload-plugins` 或重启 Claude Code。

## Codex：使用原生插件生命周期

使用 `codex plugin marketplace list --json` 和 `codex plugin list --available --json` 检查。
Codex 的原生插件命令没有 Claude 式 `user | project | local` 选择器。不要询问 Claude 范围或
Hook 四档模式。Codex 原生插件支持提供商专用 Hook，但 Codex 会要求用户明确信任。让 Codex
显示该信任决定；不要声称 Claude 的四种配置可以映射到 Codex。

如果缺少 ECC marketplace，请添加；否则刷新快照：

```bash
codex plugin marketplace add affaan-m/ECC
codex plugin marketplace upgrade ecc --json
```

只确认一次，然后安装或幂等刷新已安装缓存，并验证：

```bash
codex plugin add ecc@ecc --json
codex plugin list --json
```

只有 JSON 报告 ECC 已安装并提供 `installedPath` 时才继续，然后渲染已验证组合包的欢迎信息：

`installedPath` 只能使用 Codex JSON 返回的原始绝对路径，并拒绝控制字符。工具 API
支持时使用 argument array 调用 Node，不得拼接用户提供的路径或版本。版本必须通过
`ECC_VERSION_PATTERN` 验证。

```bash
node "<installedPath>/scripts/welcome.js" --action configured --version "<installed-version>"
```

绝不要声称 Claude 的 `off | minimal | standard | strict` 配置已应用到 Codex。

## Kimi：安装项目表面

确认前说明能力摘要：目标为 `./.kimi-code`；ECC 生命周期 Hook 为 `hooks=unsupported`。
不要询问 Claude 范围或 Hook 模式。先预览：

```bash
npx --yes --package ecc-universal ecc install --profile core --target kimi --dry-run
```

只针对该项目目标确认一次，然后执行去掉 `--dry-run` 的同一命令。使用以下命令验证：

```bash
npx --yes --package ecc-universal ecc doctor --target kimi
```

只有 doctor 成功，且已安装的指令和技能仍位于 `./.kimi-code` 内时才运行：

```bash
npx --yes --package ecc-universal ecc welcome --action configured
```

不要声称 Kimi 已安装或配置 ECC 生命周期 Hook。
