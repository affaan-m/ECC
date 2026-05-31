---
description: Analyze instincts and suggest or generate evolved structures
agent: everything-claude-code:build
---

# Evolve Command

Analyze and evolve instincts in continuous-learning-v2: $ARGUMENTS

## Your Task

Run after resolving the active ECC root so stale manual installs cannot mask the active plugin:

```bash
ECC_ROOT="${CLAUDE_PLUGIN_ROOT:-$(node -e "var r=(()=>{var e=process.env.CLAUDE_PLUGIN_ROOT;if(e&&e.trim())return e.trim();var p=require('path'),f=require('fs'),h=require('os').homedir(),d=p.join(h,'.claude'),q=p.join('scripts','lib','utils.js');if(f.existsSync(p.join(d,q)))return d;for(var s of [['ecc'],['ecc@ecc'],['marketplace','ecc'],['everything-claude-code'],['everything-claude-code@everything-claude-code'],['marketplace','everything-claude-code']]){var l=p.join(d,'plugins',...s);if(f.existsSync(p.join(l,q)))return l}try{for(var g of ['ecc','everything-claude-code']){var b=p.join(d,'plugins','cache',g);for(var o of f.readdirSync(b,{withFileTypes:true})){if(!o.isDirectory())continue;for(var v of f.readdirSync(p.join(b,o.name),{withFileTypes:true})){if(!v.isDirectory())continue;var c=p.join(b,o.name,v.name);if(f.existsSync(p.join(c,q)))return c}}}}catch(x){}return d})();console.log(r)")}"
python3 "$ECC_ROOT/skills/continuous-learning-v2/scripts/instinct-cli.py" evolve $ARGUMENTS
```

## Supported Args (v2.1)

- no args: analysis only
- `--generate`: also generate files under `evolved/{skills,commands,agents}`

## Behavior Notes

- Uses project + global instincts for analysis.
- Shows skill/command/agent candidates from trigger and domain clustering.
- Shows project -> global promotion candidates.
- With `--generate`, output path is:
  - project context: `~/.claude/homunculus/projects/<project-id>/evolved/`
  - global fallback: `~/.claude/homunculus/evolved/`
