---
description: Run a deterministic repository harness audit and return a prioritized scorecard.
---

# Harness Audit Command

Run a deterministic repository harness audit and return a prioritized scorecard.

## Usage

`/harness-audit [scope] [--format text|json] [--root path]`

- `scope` (optional): `repo` (default), `hooks`, `skills`, `commands`, `agents`
- `--format`: output style (`text` default, `json` for automation)
- `--root`: audit a specific path instead of the current working directory

## Deterministic Engine

Always run:

```bash
IFS= read -r ECC_ROOT <<'ECC_PLUGIN_ROOT_LITERAL'
${CLAUDE_PLUGIN_ROOT}
ECC_PLUGIN_ROOT_LITERAL
if [ -z "$ECC_ROOT" ] || [ "$ECC_ROOT" = '$''{CLAUDE_PLUGIN_ROOT}' ] || [ ! -f "$ECC_ROOT/scripts/harness-audit.js" ]; then
  ECC_ROOT="$(node -e "console.log((function(){var p=require('path'),f=require('fs'),o=require('os');var d=(process.env.CLAUDE_CONFIG_DIR||'').trim()||p.join(o.homedir(),'.claude');if(d==='~')d=o.homedir();else if(d.charAt(0)==='~'&&(d.charAt(1)==='/'||d.charCodeAt(1)===92))d=p.join(o.homedir(),d.slice(2));try{if(o.platform()==='linux'){var v=f.readFileSync('/proc/version','utf8').toLowerCase();if(v.includes('microsoft')){var b=String.fromCharCode(92),m=d.match(/^([A-Za-z]):/);if(m&&(d.charAt(2)==='/'||d.charAt(2)===b)){var dl=m[1].toLowerCase();d='/mnt/'+dl+d.slice(2).split(b).join('/')}}}}catch(_){}d=p.resolve(N(d));function N(x){if(o.platform()==='win32'&&x.charAt(0)==='/'&&x.charAt(1).match(/[A-Za-z]/)&&(x.length===2||x.charAt(2)==='/'))return x.charAt(1).toUpperCase()+':/'+x.slice(3);return x}function F(x){try{return f.statSync(x).isFile()}catch(_){return false}}function L(x){x=(x||'').trim();if(x==='')return null;x=p.resolve(N(x));return F(p.join(x,p.join('scripts','harness-audit.js')))?x:null}var r=L(process.env.CLAUDE_PLUGIN_ROOT)||L(process.env.ANTIGRAVITY_PLUGIN_ROOT)||L(process.env.GEMINI_PLUGIN_ROOT)||L(d)||L(p.join(o.homedir(),'.gemini','config','plugins','ecc'));if(r)return r;var s=['ecc','ecc@ecc','marketplaces/ecc','everything-claude-code','everything-claude-code@everything-claude-code','marketplaces/everything-claude-code'];for(var i=0;i<s.length;i++){r=L(p.join(d,'plugins',s[i]));if(r)return r}function D(x){try{return f.readdirSync(x,{withFileTypes:true}).filter(function(z){return z.isDirectory()}).map(function(z){return z.name})}catch(e){if(e.code==='ENOENT')return [];throw e}}var g=['ecc','everything-claude-code'];for(var j=0;j<g.length;j++){var c=p.join(d,'plugins','cache',g[j]);var O=D(c);for(var k=0;k<O.length;k++){var q=p.join(c,O[k]);var V=D(q);for(var m=0;m<V.length;m++){r=L(p.join(q,V[m]));if(r)return r}}}var x=(process.env.OPENCODE_CONFIG_DIR||'').trim(),z=N((process.env.XDG_CONFIG_HOME||'').trim());r=L(x||(z?p.join(z,'opencode'):p.join(o.homedir(),'.config','opencode')));if(r)return r;var a=N((process.env.CLAUDE_PROJECT_DIR||'').trim())||process.cwd(),q=p.join(a,'.claude');return F(p.join(q,'ecc','install-state.json'))||F(p.join(q,'scripts','lib','resolve-ecc-root.js'))?L(q)||'':''})())")" || exit 1
  if [ -z "$ECC_ROOT" ] &&
     [ -f .claude-plugin/plugin.json ] && [ -f scripts/lib/resolve-ecc-root.js ]; then
    ECC_ROOT="$PWD"
  fi
fi
if [ -z "$ECC_ROOT" ] || [ ! -f "$ECC_ROOT/scripts/harness-audit.js" ]; then
  echo 'ECC command script not found. Check the ECC plugin or install directory.' >&2
  exit 1
fi
node "$ECC_ROOT/scripts/harness-audit.js" <scope> --format <text|json> [--root <path>]
```

This script is the source of truth for scoring and checks. Do not invent additional dimensions or ad-hoc points.

Rubric version: `2026-05-19`.

The script computes up to 12 fixed categories (`0-10` normalized each). The first seven are always applicable; GitHub Integration is always applicable; deploy-target categories are applicable only when a matching marker is detected.

1. Tool Coverage
2. Context Efficiency
3. Quality Gates
4. Memory Persistence
5. Eval Coverage
6. Security Guardrails
7. Cost Efficiency
8. GitHub Integration
9. Vercel Integration *(when `vercel.json` or `.vercel/` is present)*
10. Netlify Integration *(when `netlify.toml` or `.netlify/` is present)*
11. Cloudflare Integration *(when `wrangler.toml` or `wrangler.jsonc` is present)*
12. Fly Integration *(when `fly.toml` is present)*

Scores are derived from explicit file/rule checks and are reproducible for the same commit.
The script audits the current working directory by default and auto-detects whether the target is the ECC repo itself or a consumer project using ECC.

## Output Contract

Return:

1. `overall_score` out of `max_score`. `max_score` depends on which categories are applicable to the target; never assume a fixed total.
2. `applicable_categories[]` and `category_count` describing which categories contributed.
3. Category scores and concrete findings.
4. Failed checks with exact file paths.
5. Top 3 actions from the deterministic output (`top_actions`).
6. Suggested ECC skills to apply next.

## Checklist

- Use script output directly; do not rescore manually.
- If `--format json` is requested, return the script JSON unchanged.
- If text is requested, summarize failing checks and top actions.
- Include exact file paths from `checks[]` and `top_actions[]`.

## Example Result

```text
Harness Audit (repo, repo): 71/80
- Tool Coverage: 10/10 (10/10 pts)
- Context Efficiency: 9/10 (9/10 pts)
- Quality Gates: 10/10 (10/10 pts)
- GitHub Integration: 2/10 (2/10 pts)

Top 3 Actions:
1) [GitHub Integration] Add at least one workflow under .github/workflows/. (.github/workflows/)
2) [Security Guardrails] Add prompt/tool preflight security guards in hooks/hooks.json. (hooks/hooks.json)
3) [Eval Coverage] Increase automated test coverage across scripts/hooks/lib. (tests/)
```

## Arguments

$ARGUMENTS:
- `repo|hooks|skills|commands|agents` (optional scope)
- `--format text|json` (optional output format)
