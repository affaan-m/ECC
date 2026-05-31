---
name: instinct-status
description: Show learned instincts (project + global) with confidence
command: true
---

# Instinct Status Command

Shows learned instincts for the current project plus global instincts, grouped by domain.

## Implementation

Run the instinct CLI after resolving the active ECC root the same way the hook
bootstrap and other slash commands do: `CLAUDE_PLUGIN_ROOT`, standard install,
known plugin roots, plugin cache, then `~/.claude`. This avoids silently using
an old manual install when the plugin is active but `CLAUDE_PLUGIN_ROOT` is not
available in the slash-command shell context (#2037).

```bash
ECC_ROOT="${CLAUDE_PLUGIN_ROOT:-$(node -e "var r=(()=>{var e=process.env.CLAUDE_PLUGIN_ROOT;if(e&&e.trim())return e.trim();var p=require('path'),f=require('fs'),h=require('os').homedir(),d=p.join(h,'.claude'),q=p.join('scripts','lib','utils.js');if(f.existsSync(p.join(d,q)))return d;for(var s of [['ecc'],['ecc@ecc'],['marketplace','ecc'],['everything-claude-code'],['everything-claude-code@everything-claude-code'],['marketplace','everything-claude-code']]){var l=p.join(d,'plugins',...s);if(f.existsSync(p.join(l,q)))return l}try{for(var g of ['ecc','everything-claude-code']){var b=p.join(d,'plugins','cache',g);for(var o of f.readdirSync(b,{withFileTypes:true})){if(!o.isDirectory())continue;for(var v of f.readdirSync(p.join(b,o.name),{withFileTypes:true})){if(!v.isDirectory())continue;var c=p.join(b,o.name,v.name);if(f.existsSync(p.join(c,q)))return c}}}}catch(x){}return d})();console.log(r)")}"
python3 "$ECC_ROOT/skills/continuous-learning-v2/scripts/instinct-cli.py" status
```

## Usage

```
/instinct-status
```

## What to Do

1. Detect current project context (git remote/path hash)
2. Read project instincts from `~/.claude/homunculus/projects/<project-id>/instincts/`
3. Read global instincts from `~/.claude/homunculus/instincts/`
4. Merge with precedence rules (project overrides global when IDs collide)
5. Display grouped by domain with confidence bars and observation stats

## Output Format

```
============================================================
  INSTINCT STATUS - 12 total
============================================================

  Project: my-app (a1b2c3d4e5f6)
  Project instincts: 8
  Global instincts:  4

## PROJECT-SCOPED (my-app)
  ### WORKFLOW (3)
    ███████░░░  70%  grep-before-edit [project]
              trigger: when modifying code

## GLOBAL (apply to all projects)
  ### SECURITY (2)
    █████████░  85%  validate-user-input [global]
              trigger: when handling user input
```
