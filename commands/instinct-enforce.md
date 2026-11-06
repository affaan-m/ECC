---
name: instinct-enforce
description: Dry-run instinct-enforce against a sample Write/Edit/MultiEdit/Bash payload and print matching instincts
command: true
---

# Instinct Enforce Command

Dry-runs `scripts/hooks/instinct-enforce.js` against a JSON file of `{tool_name, tool_input}` and prints matches. Use this when `/instinct-status` shows instincts that keep being ignored at tool time.

## Implementation

Resolve the active ECC plugin root the same way `hooks/hooks.json` and `/instinct-status` do — env var → standard install → known plugin roots → plugin cache → fallback (#2037). Then run the hook in `--check` mode.

```bash
ECC_ROOT="${CLAUDE_PLUGIN_ROOT:-$(node -e "var r=(function(){var p=require('path'),f=require('fs'),o=require('os');var e=process.env.CLAUDE_PLUGIN_ROOT;if(e&&e.trim())return e.trim();var d=p.join(o.homedir(),'.claude');function L(x){try{return require(p.join(x,'scripts','lib','resolve-ecc-root')).resolveEccRoot()}catch(_){return null}}var r=L(d);if(r)return r;var s=['ecc','ecc@ecc','marketplaces/ecc','everything-claude-code','everything-claude-code@everything-claude-code','marketplaces/everything-claude-code'];for(var i=0;i<s.length;i++){r=L(p.join(d,'plugins',s[i]));if(r)return r}try{var g=['ecc','everything-claude-code'];for(var j=0;j<g.length;j++){var c=p.join(d,'plugins','cache',g[j]);var O=f.readdirSync(c);for(var k=0;k<O.length;k++){var q=p.join(c,O[k]);var V=f.readdirSync(q);for(var m=0;m<V.length;m++){r=L(p.join(q,V[m]));if(r)return r}}}}catch(_){}return d})();console.log(r)")}"
node "$ECC_ROOT/scripts/hooks/instinct-enforce.js" --check "${1:-./instinct-enforce-payload.json}"
```

## Usage

```
/instinct-enforce
/instinct-enforce ./payload.json
```

Payload shape:

```json
{
  "tool_name": "Write",
  "tool_input": {
    "file_path": "src/fooWidget.js",
    "contents": "export function fooWidget() {}"
  }
}
```

## What to Do

1. Resolve `ECC_ROOT` with the shared inline locator
2. Read `{tool_name, tool_input}` from the JSON file
3. Load project + global instincts from the SessionStart store
4. Print `verdict` (`block` / `warn` / `none`) and up to 3 matching instinct ids
5. Do not echo the payload; a missing file is a CLI error, a missing store is `verdict: none`
6. Tell a gate miss apart from a real no-match:
   - unsupported tool (e.g. `Grep`): `verdict: none` + `reason: Grep not enforced`, exit 0
   - no `tool_name`: `verdict: none` + `reason: payload has no tool_name`, exit 1
   - no `tool_input` object: `verdict: none` + `reason: payload has no tool_input object`, exit 1

## Related

- `/instinct-status` — list learned instincts
- `skills/instinct-enforce` — PreToolUse hook, env vars, match policy
- `continuous-learning-v2` — instinct store and observer (observer stays off by default)
