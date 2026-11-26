---
description: Validate epic readiness, dependencies, and coordination policy.
---

# /epic-validate

Validate a single epic issue before publishing or review handoff.

If a source-only plugin install reports missing `sql.js`, install ECC’s locked production dependencies once with `npm --prefix "<ecc-root>" ci --omit=dev --ignore-scripts`. Replace `<ecc-root>` with the installed ECC directory.

```bash
IFS= read -r ECC_ROOT <<'ECC_PLUGIN_ROOT_LITERAL'
${CLAUDE_PLUGIN_ROOT}
ECC_PLUGIN_ROOT_LITERAL
if [ -z "$ECC_ROOT" ] || [ "$ECC_ROOT" = '$''{CLAUDE_PLUGIN_ROOT}' ] || [ ! -f "$ECC_ROOT/scripts/github-coordination.js" ]; then
  ECC_ROOT="$(node -e "console.log((function(){var p=require('path'),f=require('fs'),o=require('os');var d=(process.env.CLAUDE_CONFIG_DIR||'').trim()||p.join(o.homedir(),'.claude');if(d==='~')d=o.homedir();else if(d.charAt(0)==='~'&&(d.charAt(1)==='/'||d.charCodeAt(1)===92))d=p.join(o.homedir(),d.slice(2));try{if(o.platform()==='linux'){var v=f.readFileSync('/proc/version','utf8').toLowerCase();if(v.includes('microsoft')){var b=String.fromCharCode(92),m=d.match(/^([A-Za-z]):/);if(m&&(d.charAt(2)==='/'||d.charAt(2)===b)){var dl=m[1].toLowerCase();d='/mnt/'+dl+d.slice(2).split(b).join('/')}}}}catch(_){}d=p.resolve(N(d));function N(x){if(o.platform()==='win32'&&x.charAt(0)==='/'&&x.charAt(1).match(/[A-Za-z]/)&&(x.length===2||x.charAt(2)==='/'))return x.charAt(1).toUpperCase()+':/'+x.slice(3);return x}function F(x){try{return f.statSync(x).isFile()}catch(_){return false}}function L(x){x=(x||'').trim();if(x==='')return null;x=p.resolve(N(x));return F(p.join(x,p.join('scripts','github-coordination.js')))?x:null}var r=L(process.env.CLAUDE_PLUGIN_ROOT)||L(process.env.ANTIGRAVITY_PLUGIN_ROOT)||L(process.env.GEMINI_PLUGIN_ROOT)||L(d)||L(p.join(o.homedir(),'.gemini','config','plugins','ecc'));if(r)return r;var s=['ecc','ecc@ecc','marketplaces/ecc','everything-claude-code','everything-claude-code@everything-claude-code','marketplaces/everything-claude-code'];for(var i=0;i<s.length;i++){r=L(p.join(d,'plugins',s[i]));if(r)return r}function D(x){try{return f.readdirSync(x,{withFileTypes:true}).filter(function(z){return z.isDirectory()}).map(function(z){return z.name})}catch(e){if(e.code==='ENOENT')return [];throw e}}var g=['ecc','everything-claude-code'];for(var j=0;j<g.length;j++){var c=p.join(d,'plugins','cache',g[j]);var O=D(c);for(var k=0;k<O.length;k++){var q=p.join(c,O[k]);var V=D(q);for(var m=0;m<V.length;m++){r=L(p.join(q,V[m]));if(r)return r}}}var x=(process.env.OPENCODE_CONFIG_DIR||'').trim(),z=N((process.env.XDG_CONFIG_HOME||'').trim());r=L(x||(z?p.join(z,'opencode'):p.join(o.homedir(),'.config','opencode')));if(r)return r;var a=N((process.env.CLAUDE_PROJECT_DIR||'').trim())||process.cwd(),q=p.join(a,'.claude');return F(p.join(q,'ecc','install-state.json'))||F(p.join(q,'scripts','lib','resolve-ecc-root.js'))?L(q)||'':''})())")" || exit 1
  if [ -z "$ECC_ROOT" ] &&
     [ -f .claude-plugin/plugin.json ] && [ -f scripts/lib/resolve-ecc-root.js ]; then
    ECC_ROOT="$PWD"
  fi
fi
if [ -z "$ECC_ROOT" ] || [ ! -f "$ECC_ROOT/scripts/github-coordination.js" ]; then
  echo 'ECC command script not found. Check the ECC plugin or install directory.' >&2
  exit 1
fi
node "$ECC_ROOT/scripts/github-coordination.js" validate <issue-number> --repo <owner/repo>
```

What this checks:

1. Coordination state exists and is parseable.
2. Validation state is satisfied by policy.
3. Declared dependencies are closed.
4. The epic is ready for the next workflow stage.

Compatibility aliases:

- `/quality-gate`
