---
name: skill-host-compat
description: Lint ECC skills for Codex/Cursor-safe frontmatter and Claude-only substitutions before a skill PR.
command: true
---

# Skill Host Compatibility

Lint curated `skills/` for Codex-safe frontmatter and Claude-only substitutions.

## Implementation

Run the host-compat validator:

```bash
ECC_ROOT="${CLAUDE_PLUGIN_ROOT:-$(node -e "var r=(function(){var p=require('path'),f=require('fs'),o=require('os');var e=process.env.CLAUDE_PLUGIN_ROOT;if(e&&e.trim())return e.trim();var d=p.join(o.homedir(),'.claude');function L(x){try{return require(p.join(x,'scripts','lib','resolve-ecc-root')).resolveEccRoot()}catch(_){return null}}var r=L(d);if(r)return r;var s=['ecc','ecc@ecc','marketplaces/ecc','everything-claude-code','everything-claude-code@everything-claude-code','marketplaces/everything-claude-code'];for(var i=0;i<s.length;i++){r=L(p.join(d,'plugins',s[i]));if(r)return r}try{var g=['ecc','everything-claude-code'];for(var j=0;j<g.length;j++){var c=p.join(d,'plugins','cache',g[j]);var O=f.readdirSync(c);for(var k=0;k<O.length;k++){var q=p.join(c,O[k]);var V=f.readdirSync(q);for(var m=0;m<V.length;m++){r=L(p.join(q,V[m]));if(r)return r}}}}catch(_){}return d})();console.log(r)}")}"
node "$ECC_ROOT/scripts/ci/validate-skill-host-compat.js"
```

Inventory counts without failing:

```bash
ECC_ROOT="${CLAUDE_PLUGIN_ROOT:-$(node -e "var r=(function(){var p=require('path'),f=require('fs'),o=require('os');var e=process.env.CLAUDE_PLUGIN_ROOT;if(e&&e.trim())return e.trim();var d=p.join(o.homedir(),'.claude');function L(x){try{return require(p.join(x,'scripts','lib','resolve-ecc-root')).resolveEccRoot()}catch(_){return null}}var r=L(d);if(r)return r;var s=['ecc','ecc@ecc','marketplaces/ecc','everything-claude-code','everything-claude-code@everything-claude-code','marketplaces/everything-claude-code'];for(var i=0;i<s.length;i++){r=L(p.join(d,'plugins',s[i]));if(r)return r}try{var g=['ecc','everything-claude-code'];for(var j=0;j<g.length;j++){var c=p.join(d,'plugins','cache',g[j]);var O=f.readdirSync(c);for(var k=0;k<O.length;k++){var q=p.join(c,O[k]);var V=f.readdirSync(q);for(var m=0;m<V.length;m++){r=L(p.join(q,V[m]));if(r)return r}}}}catch(_){}return d})();console.log(r)}")}"
node "$ECC_ROOT/scripts/ci/validate-skill-host-compat.js" --inventory
```

## Usage

```
/skill-host-compat                 # Fail on substitutions and Codex drift
/skill-host-compat --inventory     # JSON counts, exit 0
/skill-host-compat --strict-checklist
```

## What to Do

1. Run `scripts/ci/validate-skill-host-compat.js` from the ECC root
2. Show ERROR and WARN lines to the user
3. For substitution errors, move Claude env vars out of bash fences. Rewrite `$CLAUDE_PROJECT_DIR` to `$(pwd)` or an explicit path
4. For Codex-key errors, drop `origin` / `version` / `argument-hint` on the copy
