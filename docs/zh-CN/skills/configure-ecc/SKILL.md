---
name: configure-ecc
description: 通过明确的安装范围和个人 Hook 偏好，安装、更新或重新配置 ECC Claude 插件。
metadata:
  origin: ECC
---

# 配置 Everything Claude Code

当用户希望为 Claude Code 安装、更新或配置 ECC 时，请使用此技能。

## 使用规范的设置命令

在 ECC 仓库或 npm 安装环境中运行：

```bash
ecc setup
```

如果尚未安装 `ecc`，可通过 npm 启动同一个命令：

```bash
npx --yes --package ecc-universal ecc setup
```

非交互式自动化必须明确提供所有选项：

```bash
ecc setup \
  --mode claude-plugin \
  --scope user \
  --hooks standard \
  --yes
```

不要把 ECC 克隆到临时目录，也不要手动复制插件组件。设置命令会先检查
当前安装，再添加或刷新官方 marketplace，最后安装或更新 `ecc@ecc`。

## 解释安装范围

执行新安装前，请说明 Claude 的三个原生范围：

- `user` — 当前用户全局可用，适用于所有项目。
- `project` — 通过仓库设置与协作者共享。
- `local` — 仅当前项目私有使用，不提交该选择。

新的非交互式安装必须提供 `--scope`。重复运行时可检测唯一的现有范围并
在原范围更新。切换范围必须使用独立的范围迁移流程，普通设置不会创建重复安装。

## 解释 Hook 偏好

Hook 偏好属于个人 Claude 插件配置，不随插件安装范围变化：

- `off` — 保留 ECC 技能和命令，但不运行 ECC Hook。
- `minimal` — 只运行最轻量的生命周期和安全自动化。
- `standard` — 平衡质量和安全自动化。
- `strict` — 使用最严格的检查和提醒。

以后可使用 `--hooks off|minimal|standard|strict` 修改偏好。命令会保留
其他 Claude 设置以及未知的插件配置。

## 安全行为

遇到以下情况时，设置会在修改前停止：

- 旧版 Everything Claude Code 插件；
- 多个范围中的 `ecc@ecc`；
- 手动安装的 ECC 插件布局；
- 占用 `ecc` 名称的非官方 marketplace；
- 损坏的 Claude 设置或清单；
- 与插件技能、命令或 Hook 重叠的托管 ECC 内容。

使用 `--dry-run --json` 获取只读检查结果。安装或更新后，请重启
Claude Code 或运行 `/reload-plugins`。
