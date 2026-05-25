---
description: Show learned instincts (project + global) with confidence
agent: everything-claude-code:build
---

# Instinct Status Command

Show instinct status from continuous-learning-v2: $ARGUMENTS

## Your Task

Resolve the active ECC plugin root with the same walker `hooks/hooks.json`
uses (env var → standard install → known plugin roots → plugin cache →
fallback), then run the instinct CLI. This avoids reading a stale legacy
`~/.claude/skills/continuous-learning-v2/` install when the plugin is
active under `~/.claude/plugins/cache/...` (#2037).

```bash
ECC_ROOT="${CLAUDE_PLUGIN_ROOT:-$(node -e "var r=(()=>{var e=process.env.CLAUDE_PLUGIN_ROOT;if(e&&e.trim())return e.trim();var p=require('path'),f=require('fs'),h=require('os').homedir(),d=p.join(h,'.claude'),q=p.join('scripts','lib','utils.js');if(f.existsSync(p.join(d,q)))return d;for(var s of [['ecc'],['ecc@ecc'],['marketplaces','ecc'],['everything-claude-code'],['everything-claude-code@everything-claude-code'],['marketplaces','everything-claude-code']]){var l=p.join(d,'plugins',...s);if(f.existsSync(p.join(l,q)))return l}try{for(var g of ['ecc','everything-claude-code']){var b=p.join(d,'plugins','cache',g);for(var o of f.readdirSync(b,{withFileTypes:true})){if(!o.isDirectory())continue;for(var v of f.readdirSync(p.join(b,o.name),{withFileTypes:true})){if(!v.isDirectory())continue;var c=p.join(b,o.name,v.name);if(f.existsSync(p.join(c,q)))return c}}}}catch(x){}return d})();console.log(r)")}"
python3 "$ECC_ROOT/skills/continuous-learning-v2/scripts/instinct-cli.py" status
```

## Behavior Notes

- Output includes both project-scoped and global instincts.
- Project instincts override global instincts when IDs conflict.
- Output is grouped by domain with confidence bars.
- This command does not support extra filters in v2.1.
