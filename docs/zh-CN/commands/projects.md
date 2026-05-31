---
name: projects
description: 列出已知项目及其本能统计数据
command: true
---

# 项目命令

列出项目注册条目以及每个项目的本能/观察计数，适用于 continuous-learning-v2。

## Implementation

Run the instinct CLI after resolving the active ECC root (`CLAUDE_PLUGIN_ROOT`, standard install, plugin roots, plugin cache, then `~/.claude`) so stale manual installs cannot mask the active plugin (#2037):

```bash
ECC_ROOT="${CLAUDE_PLUGIN_ROOT:-$(node -e "var r=(()=>{var e=process.env.CLAUDE_PLUGIN_ROOT;if(e&&e.trim())return e.trim();var p=require('path'),f=require('fs'),h=require('os').homedir(),d=p.join(h,'.claude'),q=p.join('scripts','lib','utils.js');if(f.existsSync(p.join(d,q)))return d;for(var s of [['ecc'],['ecc@ecc'],['marketplace','ecc'],['everything-claude-code'],['everything-claude-code@everything-claude-code'],['marketplace','everything-claude-code']]){var l=p.join(d,'plugins',...s);if(f.existsSync(p.join(l,q)))return l}try{for(var g of ['ecc','everything-claude-code']){var b=p.join(d,'plugins','cache',g);for(var o of f.readdirSync(b,{withFileTypes:true})){if(!o.isDirectory())continue;for(var v of f.readdirSync(p.join(b,o.name),{withFileTypes:true})){if(!v.isDirectory())continue;var c=p.join(b,o.name,v.name);if(f.existsSync(p.join(c,q)))return c}}}}catch(x){}return d})();console.log(r)")}"
python3 "$ECC_ROOT/skills/continuous-learning-v2/scripts/instinct-cli.py" projects
```

## 用法

```bash
/projects
```

## 操作步骤

1. 读取 `~/.claude/homunculus/projects.json`
2. 对于每个项目，显示：
   * 项目名称、ID、根目录、远程地址
   * 个人和继承的本能计数
   * 观察事件计数
   * 最后看到的时间戳
3. 同时显示全局本能总数
