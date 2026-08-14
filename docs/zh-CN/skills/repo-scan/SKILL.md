---
name: repo-scan
description: 用于从固定且可审查的提交安装外部 repo-scan 技能的引导指针。在运行跨栈源代码资产审计前需要安装 repo-scan 时使用；此 ECC 指针本身不执行审计。
origin: community
---

# repo-scan

> 每个生态系统都有自己的依赖管理器，但没有工具能跨 C++、Android、iOS 和 Web 告诉你：有多少代码真正属于你，哪些是第三方代码，哪些是冗余负担。

## 适用场景

* 接手大型遗留代码库，需要了解整体结构
* 重大重构前——识别核心代码、重复代码和废弃代码
* 审计直接嵌入源码（而非通过包管理器声明）的第三方依赖
* 为单体仓库重组准备架构决策记录

## 安装

```bash
# Clone first so the pinned commit can be reviewed before installation
set -euo pipefail

REPO_SCAN_COMMIT=2742664ebcad1450c208eda0ae45d3c17fad5dd8
REPO_SCAN_INSTALL_DIR="${CLAUDE_CONFIG_DIR:-$HOME/.claude}/skills/repo-scan"
REPO_SCAN_INSTALL_PARENT="$(dirname "$REPO_SCAN_INSTALL_DIR")"
mkdir -p "$REPO_SCAN_INSTALL_PARENT"
REPO_SCAN_TMP="$(mktemp -d "$REPO_SCAN_INSTALL_PARENT/.repo-scan-install.XXXXXX")"
REPO_SCAN_TOKEN="${REPO_SCAN_TMP##*.}"
REPO_SCAN_STAGE="$REPO_SCAN_TMP/stage-$REPO_SCAN_TOKEN"
REPO_SCAN_BACKUP="$REPO_SCAN_TMP/backup-$REPO_SCAN_TOKEN"
REPO_SCAN_LOCK="$REPO_SCAN_INSTALL_PARENT/.repo-scan-install.lock"
REPO_SCAN_KEEP_TMP=0
REPO_SCAN_LOCK_HELD=0
REPO_SCAN_MV_HAS_NO_TARGET=0
cleanup_repo_scan_install() {
  if [ "$REPO_SCAN_KEEP_TMP" -eq 0 ]; then
    rm -rf -- "$REPO_SCAN_TMP"
  fi
  if [ "$REPO_SCAN_LOCK_HELD" -eq 1 ] && ! rmdir -- "$REPO_SCAN_LOCK"; then
    printf 'Could not release installation lock at %s\n' "$REPO_SCAN_LOCK" >&2
  fi
}
trap cleanup_repo_scan_install EXIT
mkdir "$REPO_SCAN_TMP/mv-probe-source"
if mv -T -- "$REPO_SCAN_TMP/mv-probe-source" \
  "$REPO_SCAN_TMP/mv-probe-destination" 2>/dev/null; then
  REPO_SCAN_MV_HAS_NO_TARGET=1
  rmdir "$REPO_SCAN_TMP/mv-probe-destination"
else
  rmdir "$REPO_SCAN_TMP/mv-probe-source"
fi
move_repo_scan_dir() {
  REPO_SCAN_MOVE_SOURCE=$1
  REPO_SCAN_MOVE_DESTINATION=$2
  REPO_SCAN_MOVE_NAME=${REPO_SCAN_MOVE_SOURCE##*/}
  if [ -e "$REPO_SCAN_MOVE_DESTINATION" ] || [ -L "$REPO_SCAN_MOVE_DESTINATION" ]; then
    return 1
  fi
  if [ "$REPO_SCAN_MV_HAS_NO_TARGET" -eq 1 ]; then
    mv -T -- "$REPO_SCAN_MOVE_SOURCE" "$REPO_SCAN_MOVE_DESTINATION"
    return
  fi
  if ! mv -- "$REPO_SCAN_MOVE_SOURCE" "$REPO_SCAN_MOVE_DESTINATION"; then
    return 1
  fi
  if [ -e "$REPO_SCAN_MOVE_DESTINATION/$REPO_SCAN_MOVE_NAME" ] || \
    [ -L "$REPO_SCAN_MOVE_DESTINATION/$REPO_SCAN_MOVE_NAME" ]; then
    if ! mv -- "$REPO_SCAN_MOVE_DESTINATION/$REPO_SCAN_MOVE_NAME" \
      "$REPO_SCAN_MOVE_SOURCE"; then
      REPO_SCAN_KEEP_TMP=1
      printf 'Move conflict recovery failed; staged data remains at %s\n' \
        "$REPO_SCAN_MOVE_DESTINATION/$REPO_SCAN_MOVE_NAME" >&2
    fi
    return 1
  fi
}

git clone --filter=blob:none --no-checkout \
  https://github.com/haibindev/repo-scan.git "$REPO_SCAN_TMP/source"
git -C "$REPO_SCAN_TMP/source" checkout --detach "$REPO_SCAN_COMMIT"
mkdir -p "$REPO_SCAN_STAGE"
git -C "$REPO_SCAN_TMP/source" archive "$REPO_SCAN_COMMIT" | \
  tar -xf - -C "$REPO_SCAN_STAGE"

# Review "$REPO_SCAN_TMP/source" before approving installation.
printf 'Type install to replace %s after reviewing the pinned source: ' \
  "$REPO_SCAN_INSTALL_DIR" >&2
read -r REPO_SCAN_CONFIRM
if [ "$REPO_SCAN_CONFIRM" != install ]; then
  printf 'Installation cancelled.\n' >&2
  exit 1
fi
if ! mkdir -- "$REPO_SCAN_LOCK" 2>/dev/null; then
  printf 'Another repo-scan installation holds the lock at %s\n' \
    "$REPO_SCAN_LOCK" >&2
  exit 1
fi
REPO_SCAN_LOCK_HELD=1

if [ -e "$REPO_SCAN_INSTALL_DIR" ] || [ -L "$REPO_SCAN_INSTALL_DIR" ]; then
  move_repo_scan_dir "$REPO_SCAN_INSTALL_DIR" "$REPO_SCAN_BACKUP"
fi
if ! move_repo_scan_dir "$REPO_SCAN_STAGE" "$REPO_SCAN_INSTALL_DIR"; then
  if [ -e "$REPO_SCAN_BACKUP" ] || [ -L "$REPO_SCAN_BACKUP" ]; then
    if [ -e "$REPO_SCAN_INSTALL_DIR" ] || [ -L "$REPO_SCAN_INSTALL_DIR" ]; then
      REPO_SCAN_KEEP_TMP=1
      printf 'Replacement failed and target was recreated; previous installation preserved at %s\n' \
        "$REPO_SCAN_BACKUP" >&2
    elif ! move_repo_scan_dir "$REPO_SCAN_BACKUP" "$REPO_SCAN_INSTALL_DIR"; then
      REPO_SCAN_KEEP_TMP=1
      printf 'Replacement and rollback failed; previous installation preserved at %s\n' \
        "$REPO_SCAN_BACKUP" >&2
    fi
  fi
  exit 1
fi
```

> 安装任何代理技能前，请先审查源码。

安装后，请重新加载智能体运行环境，然后再次调用 `repo-scan`。此 ECC 指针仅安装外部技能，本身不会执行扫描。

## 核心能力

| 能力 | 描述 |
|---|---|
| **跨技术栈扫描** | 一次扫描 C/C++、Java/Android、iOS（OC/Swift）、Web（TS/JS/Vue） |
| **文件分类** | 每个文件标记为项目代码、第三方代码或构建产物 |
| **库检测** | 识别 50+ 已知库（FFmpeg、Boost、OpenSSL…）并提取版本号 |
| **四级判定** | 核心资产 / 提取合并 / 重建 / 废弃 |
| **HTML 报告** | 交互式深色主题页面，支持逐层下钻导航 |
| **单体仓库支持** | 分层扫描，提供摘要 + 子项目报告 |

## 分析深度级别

| 级别 | 读取文件数 | 适用场景 |
|---|---|---|
| `fast` | 每模块 1-2 个 | 快速盘点大型目录 |
| `standard` | 每模块 2-5 个 | 默认审计，含完整依赖 + 架构检查 |
| `deep` | 每模块 5-10 个 | 增加线程安全、内存管理、API 一致性检查 |
| `full` | 所有文件 | 合并前全面审查 |

## 工作原理

1. **分类仓库表面**：枚举文件，将每个文件标记为项目代码、嵌入的第三方代码或构建产物。
2. **检测嵌入的库**：检查目录名、头文件、许可证文件和版本标记，识别捆绑的依赖及其可能版本。
3. **为每个模块评分**：按模块或子系统分组文件，根据所有权、重复度和维护成本分配四种判定之一。
4. **突出结构风险**：指出冗余产物、重复的封装器、过时的供应商代码，以及应提取、重建或废弃的模块。
5. **生成报告**：返回简洁摘要及交互式 HTML 输出，支持按模块下钻，便于异步审查审计结果。

## 示例

在一个 50,000 文件的 C++ 单体仓库中：

* 发现仍在使用 FFmpeg 2.x（2015 年版本）
* 发现同一 SDK 封装器重复了 3 次
* 识别出 636 MB 已提交的 Debug/ipch/obj 构建产物
* 分类结果：3 MB 项目代码 vs 596 MB 第三方代码

## 最佳实践

* 首次审计时从 `standard` 深度开始
* 对包含 100+ 模块的单体仓库使用 `fast` 快速盘点
* 对标记为需重构的模块增量运行 `deep`
* 审查跨模块分析结果，检测子项目间的重复代码

## 链接

* [GitHub 仓库](https://github.com/haibindev/repo-scan)
