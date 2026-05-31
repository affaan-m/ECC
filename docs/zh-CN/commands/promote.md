---
name: promote
description: 将项目范围内的本能推广到全局范围
command: true
---

# 提升命令

在 continuous-learning-v2 中将本能从项目范围提升到全局范围。

## Implementation

Run the instinct CLI after resolving the active ECC root (`CLAUDE_PLUGIN_ROOT`, standard install, plugin roots, plugin cache, then `~/.claude`) so stale manual installs cannot mask the active plugin (#2037):

```bash
ECC_ROOT="${CLAUDE_PLUGIN_ROOT:-$(node -e "var r=(()=>{var e=process.env.CLAUDE_PLUGIN_ROOT;if(e&&e.trim())return e.trim();var p=require('path'),f=require('fs'),h=require('os').homedir(),d=p.join(h,'.claude'),q=p.join('scripts','lib','utils.js');if(f.existsSync(p.join(d,q)))return d;for(var s of [['ecc'],['ecc@ecc'],['marketplace','ecc'],['everything-claude-code'],['everything-claude-code@everything-claude-code'],['marketplace','everything-claude-code']]){var l=p.join(d,'plugins',...s);if(f.existsSync(p.join(l,q)))return l}try{for(var g of ['ecc','everything-claude-code']){var b=p.join(d,'plugins','cache',g);for(var o of f.readdirSync(b,{withFileTypes:true})){if(!o.isDirectory())continue;for(var v of f.readdirSync(p.join(b,o.name),{withFileTypes:true})){if(!v.isDirectory())continue;var c=p.join(b,o.name,v.name);if(f.existsSync(p.join(c,q)))return c}}}}catch(x){}return d})();console.log(r)")}"
python3 "$ECC_ROOT/skills/continuous-learning-v2/scripts/instinct-cli.py" promote [instinct-id] [--force] [--dry-run]
```

## 用法

```bash
/promote                      # Auto-detect promotion candidates
/promote --dry-run            # Preview auto-promotion candidates
/promote --force              # Promote all qualified candidates without prompt
/promote grep-before-edit     # Promote one specific instinct from current project
```

## 操作步骤

1. 检测当前项目
2. 如果提供了 `instinct-id`，则仅提升该本能（如果存在于当前项目中）
3. 否则，查找跨项目候选本能，这些本能：
   * 出现在至少 2 个项目中
   * 满足置信度阈值
4. 将提升后的本能写入 `~/.claude/homunculus/instincts/personal/`，并设置 `scope: global`
