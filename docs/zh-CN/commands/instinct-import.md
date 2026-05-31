---
name: instinct-import
description: 从文件或URL导入本能到项目/全局作用域
command: true
---

# 本能导入命令

## Implementation

Run the instinct CLI after resolving the active ECC root (`CLAUDE_PLUGIN_ROOT`, standard install, plugin roots, plugin cache, then `~/.claude`) so stale manual installs cannot mask the active plugin (#2037):

```bash
ECC_ROOT="${CLAUDE_PLUGIN_ROOT:-$(node -e "var r=(()=>{var e=process.env.CLAUDE_PLUGIN_ROOT;if(e&&e.trim())return e.trim();var p=require('path'),f=require('fs'),h=require('os').homedir(),d=p.join(h,'.claude'),q=p.join('scripts','lib','utils.js');if(f.existsSync(p.join(d,q)))return d;for(var s of [['ecc'],['ecc@ecc'],['marketplace','ecc'],['everything-claude-code'],['everything-claude-code@everything-claude-code'],['marketplace','everything-claude-code']]){var l=p.join(d,'plugins',...s);if(f.existsSync(p.join(l,q)))return l}try{for(var g of ['ecc','everything-claude-code']){var b=p.join(d,'plugins','cache',g);for(var o of f.readdirSync(b,{withFileTypes:true})){if(!o.isDirectory())continue;for(var v of f.readdirSync(p.join(b,o.name),{withFileTypes:true})){if(!v.isDirectory())continue;var c=p.join(b,o.name,v.name);if(f.existsSync(p.join(c,q)))return c}}}}catch(x){}return d})();console.log(r)")}"
python3 "$ECC_ROOT/skills/continuous-learning-v2/scripts/instinct-cli.py" import <file-or-url> [--dry-run] [--force] [--min-confidence 0.7] [--scope project|global]
```

从本地文件路径或 HTTP(S) URL 导入本能。

## 用法

```
/instinct-import team-instincts.yaml
/instinct-import https://github.com/org/repo/instincts.yaml
/instinct-import team-instincts.yaml --dry-run
/instinct-import team-instincts.yaml --scope global --force
```

## 执行步骤

1. 获取本能文件（本地路径或 URL）
2. 解析并验证格式
3. 检查与现有本能的重复项
4. 合并或添加新本能
5. 保存到继承的本能目录：
   * 项目范围：`~/.claude/homunculus/projects/<project-id>/instincts/inherited/`
   * 全局范围：`~/.claude/homunculus/instincts/inherited/`

## 导入过程

```
 从 team-instincts.yaml 导入本能
================================================

发现 12 个待导入的本能。

正在分析冲突...

## 新本能 (8)
这些将被添加：
  ✓ use-zod-validation (置信度: 0.7)
  ✓ prefer-named-exports (置信度: 0.65)
  ✓ test-async-functions (置信度: 0.8)
  ...

## 重复本能 (3)
已存在类似本能：
  WARNING: prefer-functional-style
     本地: 0.8 置信度, 12 次观察
     导入: 0.7 置信度
     → 保留本地 (置信度更高)

  WARNING: test-first-workflow
     本地: 0.75 置信度
     导入: 0.9 置信度
     → 更新为导入 (置信度更高)

导入 8 个新的，更新 1 个？
```

## 合并行为

当导入一个已存在 ID 的本能时：

* 置信度更高的导入会成为更新候选
* 置信度相等或更低的导入将被跳过
* 除非使用 `--force`，否则需要用户确认

## 来源追踪

导入的本能被标记为：

```yaml
source: inherited
scope: project
imported_from: "team-instincts.yaml"
project_id: "a1b2c3d4e5f6"
project_name: "my-project"
```

## 标志

* `--dry-run`：仅预览而不导入
* `--force`：跳过确认提示
* `--min-confidence <n>`：仅导入高于阈值的本能
* `--scope <project|global>`：选择目标范围（默认：`project`）

## 输出

导入后：

```
PASS: 导入完成！

新增：8 项本能
更新：1 项本能
跳过：3 项本能（已存在同等或更高置信度的版本）

新本能已保存至：~/.claude/homunculus/instincts/inherited/

运行 /instinct-status 以查看所有本能。
```
