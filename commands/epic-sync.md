---
description: Sync epic issue bodies, labels, and local coordination snapshots from GitHub.
---

# /epic-sync

Run a deterministic sync for epic issues.

If a source-only plugin install reports missing `sql.js`, install ECC’s locked production dependencies once with `npm --prefix "<ecc-root>" ci --omit=dev --ignore-scripts`. Replace `<ecc-root>` with the installed ECC directory.

```bash
IFS= read -r ECC_ROOT <<'ECC_PLUGIN_ROOT_LITERAL'
${CLAUDE_PLUGIN_ROOT}
ECC_PLUGIN_ROOT_LITERAL
if [ -z "$ECC_ROOT" ] || [ "$ECC_ROOT" = '$''{CLAUDE_PLUGIN_ROOT}' ]; then
  ECC_ROOT="$(node -e "console.log((function(){var p=require('path'),f=require('fs'),o=require('os');var e=process.env.CLAUDE_PLUGIN_ROOT;if(e&&e.trim())return e.trim();var d=(process.env.CLAUDE_CONFIG_DIR||'').trim()||p.join(o.homedir(),'.claude');if(d==='~')d=o.homedir();else if(d.charAt(0)==='~'&&(d.charAt(1)==='/'||d.charCodeAt(1)===92))d=p.join(o.homedir(),d.slice(2));try{if(o.platform()==='linux'){var v=f.readFileSync('/proc/version','utf8').toLowerCase();if(v.includes('microsoft')){var b=String.fromCharCode(92),m=d.match(/^([A-Za-z]):/);if(m&&(d.charAt(2)==='/'||d.charAt(2)===b)){var dl=m[1].toLowerCase();d='/mnt/'+dl+d.slice(2).split(b).join('/')}}}}catch(_){}d=p.resolve(d);function L(x){try{return require(p.join(x,'scripts','lib','resolve-ecc-root')).resolveEccRoot({probe:p.join('scripts','github-coordination.js')})}catch(_){return null}}var r=L(d);if(r)return r;var s=['ecc','ecc@ecc','marketplaces/ecc','everything-claude-code','everything-claude-code@everything-claude-code','marketplaces/everything-claude-code'];for(var i=0;i<s.length;i++){r=L(p.join(d,'plugins',s[i]));if(r)return r}function D(x){try{return f.readdirSync(x,{withFileTypes:true}).filter(function(z){return z.isDirectory()}).map(function(z){return z.name})}catch(e){if(e.code==='ENOENT')return [];throw e}}var g=['ecc','everything-claude-code'];for(var j=0;j<g.length;j++){var c=p.join(d,'plugins','cache',g[j]);var O=D(c);for(var k=0;k<O.length;k++){var q=p.join(c,O[k]);var V=D(q);for(var m=0;m<V.length;m++){r=L(p.join(q,V[m]));if(r)return r}}}return d})())")" || exit 1
  if [ -z "${CLAUDE_PLUGIN_ROOT:-}" ] && [ ! -f "$ECC_ROOT/scripts/github-coordination.js" ] &&
     [ -f .claude-plugin/plugin.json ] && [ -f scripts/lib/resolve-ecc-root.js ]; then
    ECC_ROOT="$PWD"
  fi
fi
if [ ! -f "$ECC_ROOT/scripts/github-coordination.js" ]; then
  echo 'ECC command script not found. Check the ECC plugin or install directory.' >&2
  exit 1
fi
node "$ECC_ROOT/scripts/github-coordination.js" sync --repo <owner/repo>
```

What this does:

1. Reads issue bodies as the canonical epic state.
2. Reconciles the coordination block with labels.
3. Writes a fresh local snapshot for each epic issue.
4. Keeps the SQLite cache aligned with GitHub.

Compatibility aliases:

- `/projects`
- `/work-items sync-github`
