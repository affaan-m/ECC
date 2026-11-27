# 插件与市场

插件扩展了 Claude Code 的功能，为其添加新工具和能力。本指南仅涵盖安装部分 - 关于何时以及为何使用插件，请参阅[完整文章](https://x.com/affaanmustafa/status/2012378465664745795)。

***

## 市场

市场是可安装插件的存储库。

### 添加市场

```bash
# Add official Anthropic marketplace
claude plugin marketplace add https://github.com/anthropics/claude-plugins-official

# Add community marketplaces (mgrep by @mixedbread-ai)
claude plugin marketplace add https://github.com/mixedbread-ai/mgrep
```

### 推荐市场

| 市场 | 来源 |
|-------------|--------|
| claude-plugins-official | `anthropics/claude-plugins-official` |
| claude-code-plugins | `anthropics/claude-code` |
| Mixedbread-Grep (@mixedbread-ai) | `mixedbread-ai/mgrep` |

***

## 安装插件

```bash
# Open plugins browser
/plugins

# Or install directly
claude plugin install typescript-lsp@claude-plugins-official
```

### 推荐插件

**开发：**

* `typescript-lsp` - TypeScript 智能支持
* `pyright-lsp` - Python 类型检查
* `hookify` - 通过对话创建钩子
* `code-simplifier` - 代码重构

**代码质量：**

* `code-review` - 代码审查
* `pr-review-toolkit` - PR 自动化
* `security-guidance` - 安全检查

**搜索：**

* `mgrep` - 增强搜索（优于 ripgrep）
* `context7` - 实时文档查找

**工作流：**

* `commit-commands` - Git 工作流
* `frontend-patterns` - UI 模式
* `feature-dev` - 功能开发

***

## 快速设置

```bash
# Add marketplaces
claude plugin marketplace add https://github.com/anthropics/claude-plugins-official
claude plugin marketplace add https://github.com/mixedbread-ai/mgrep

# Open /plugins and install what you need
```

***

## 插件文件位置

```
~/.claude/plugins/
|-- cache/                    # 已下载的插件
|-- installed_plugins.json    # 已安装列表
|-- known_marketplaces.json   # 已添加的市场
|-- marketplaces/             # 市场数据
```
