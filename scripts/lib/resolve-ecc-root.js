'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

// Lazily loaded so this module can be required from stripped-down directories
// (e.g., temp dirs in tests that copy only resolve-ecc-root.js + utils.js).
// Falls back to identity on failure, which matches non-WSL behavior.
let _convertWindowsPathToWSL = null;
function convertWindowsPathToWSL(windowsPath) {
  if (_convertWindowsPathToWSL === null) {
    try {
      _convertWindowsPathToWSL = require('./install-targets/helpers').convertWindowsPathToWSL;
    } catch (_) {
      // Module unavailable from this location; non-WSL behavior returns
      // the input unchanged, so the fallback is safe.
      _convertWindowsPathToWSL = (p) => p;
    }
  }
  return _convertWindowsPathToWSL(windowsPath);
}

const CURRENT_PLUGIN_SLUG = 'ecc';
// Legacy install id, kept for existing installs.
const LEGACY_PLUGIN_SLUG = 'everything-claude-code';
const CURRENT_PLUGIN_HANDLE = `${CURRENT_PLUGIN_SLUG}@${CURRENT_PLUGIN_SLUG}`;
const LEGACY_PLUGIN_HANDLE = `${LEGACY_PLUGIN_SLUG}@${LEGACY_PLUGIN_SLUG}`;
const PLUGIN_CACHE_SLUGS = [CURRENT_PLUGIN_SLUG, LEGACY_PLUGIN_SLUG];
const PLUGIN_ROOT_SEGMENTS = [
  [CURRENT_PLUGIN_SLUG],
  [CURRENT_PLUGIN_HANDLE],
  ['marketplaces', CURRENT_PLUGIN_SLUG],
  [LEGACY_PLUGIN_SLUG],
  [LEGACY_PLUGIN_HANDLE],
  ['marketplaces', LEGACY_PLUGIN_SLUG],
];

// Artifacts that identify a COMPLETE ECC root when the caller gives no explicit
// probe. A real ECC root ships both the script tree AND ECC's skills; a partial
// install (scripts copied, skills not) must not qualify for skill-resolving
// callers, which build `skills/...` paths against the resolved root (#2544).
// Checking "skills/ exists" is not enough — a user's own ~/.claude/skills/ can
// be present with none of ECC's skills — so we probe for a sentinel skill that
// ships in every ECC root and is exactly what the failing skill commands need.
// If that skill is ever renamed, move this sentinel with it.
const DEFAULT_SCRIPT_PROBE = path.join('scripts', 'lib', 'utils.js');
const DEFAULT_SKILL_PROBE = path.join('skills', 'continuous-learning-v2');

/**
 * Resolve the ECC source root directory.
 *
 * Tries, in order:
 *   1. Plugin roots supplied by Claude, Antigravity, or Gemini
 *   2. Standard install location (~/.claude/) — when scripts exist there
 *   3. Known plugin roots under ~/.claude/plugins/ (current + legacy slugs)
 *   4. Plugin cache auto-detection — scans ~/.claude/plugins/cache/{ecc,everything-claude-code}/
 *   5. Fallback to ~/.claude/ (original behaviour)
 *
 * @param {object} [options]
 * @param {string} [options.homeDir]  Override home directory (for testing)
 * @param {string} [options.envRoot]  Override CLAUDE_PLUGIN_ROOT (for testing)
 * @param {string} [options.probe]    Relative path to the file that a candidate
 *                                    root must contain. When
 *                                    omitted, a candidate must contain BOTH the
 *                                    ECC script tree and a sentinel ECC skill,
 *                                    so a partial install (scripts without
 *                                    skills) is rejected for skill consumers.
 * @returns {string} Resolved ECC root path
 */
function resolveEccRoot(options = {}) {
  // With a named probe, a partial install must not hide later candidates.
  // Skill consumers without a probe retain the explicit override and require
  // both a script and an ECC skill when discovering a root (#2544).
  const isRoot = options.probe
    ? (dir) => {
      try {
        return fs.statSync(path.join(dir, options.probe)).isFile();
      } catch {
        return false;
      }
    }
    : (dir) => fs.existsSync(path.join(dir, DEFAULT_SCRIPT_PROBE))
            && fs.existsSync(path.join(dir, DEFAULT_SKILL_PROBE));
  const envRoots = options.envRoot !== undefined
    ? [options.envRoot]
    : [process.env.CLAUDE_PLUGIN_ROOT, process.env.ANTIGRAVITY_PLUGIN_ROOT, process.env.GEMINI_PLUGIN_ROOT];
  const envRoot = options.probe
    ? envRoots.map((dir) => normalizePluginRootForPlatform(dir && dir.trim()))
      .find((dir) => dir && isRoot(dir))
    : envRoots.find(Boolean);

  if (envRoot && envRoot.trim()) {
    return envRoot.trim();
  }

  const homeDir = options.homeDir || os.homedir();
  const configuredDir = options.configDir !== undefined
    ? options.configDir
    : process.env.CLAUDE_CONFIG_DIR;
  // On WSL, convert Windows paths (e.g., C:\Users\name\.claude) to WSL paths
  // (/mnt/c/Users/name/.claude) so the resolver finds the correct location.
  const wslConfiguredDir = convertWindowsPathToWSL(configuredDir);
  const rawDir = typeof wslConfiguredDir === 'string' ? wslConfiguredDir.trim() : '';
  const expandedDir = rawDir === '~'
    ? homeDir
    : (rawDir.startsWith('~/') || rawDir.startsWith('~\\'))
      ? path.join(homeDir, rawDir.slice(2))
      : rawDir;
  const claudeDir = expandedDir ? path.resolve(expandedDir) : path.join(homeDir, '.claude');

  // Standard install — files are copied directly into ~/.claude/
  if (isRoot(claudeDir)) {
    return claudeDir;
  }

  // Antigravity global plugin install — ~/.gemini/config/plugins/ecc
  const antigravityPluginDir = path.join(homeDir, '.gemini', 'config', 'plugins', 'ecc');
  if (isRoot(antigravityPluginDir)) {
    return antigravityPluginDir;
  }

  // Exact legacy plugin install locations. These preserve backwards
  // compatibility without scanning arbitrary plugin trees.
  const legacyPluginRoots = PLUGIN_ROOT_SEGMENTS.map((segments) =>
    path.join(claudeDir, 'plugins', ...segments)
  );

  for (const candidate of legacyPluginRoots) {
    if (isRoot(candidate)) {
      return candidate;
    }
  }

  // Missing cache locations are independent; unreadable/corrupt locations must surface.
  const directories = (dir) => {
    try { return fs.readdirSync(dir, { withFileTypes: true }); }
    catch (error) { if (error.code === 'ENOENT') return [];throw error; }
  };
  for (const slug of PLUGIN_CACHE_SLUGS) {
    const cacheBase = path.join(claudeDir, 'plugins', 'cache', slug);
    for (const orgEntry of directories(cacheBase)) {
      if (!orgEntry.isDirectory()) continue;
      const orgPath = path.join(cacheBase, orgEntry.name);
      for (const verEntry of directories(orgPath)) {
        if (!verEntry.isDirectory()) continue;
        const candidate = path.join(orgPath, verEntry.name);
        if (isRoot(candidate)) return candidate;
      }
    }
  }

  return claudeDir;
}

function normalizePluginRootForPlatform(rootDir, platform = process.platform) {
  if (platform !== 'win32' || typeof rootDir !== 'string') return rootDir;

  const match = rootDir.match(/^\/([a-zA-Z])(?:\/(.*))?$/);
  if (!match) return rootDir;

  const [, driveLetter, rest = ''] = match;
  return `${driveLetter.toUpperCase()}:/${rest}`;
}

/**
 * Compact inline locator for embedding in hooks.json and command .md code blocks.
 *
 * Earlier revisions inlined the *entire* resolveEccRoot() search (~700 chars,
 * duplicated ~80×). That blob used a spread (`...s`) over nested array literals,
 * which broke Windows hook execution due to shell quoting (#2368).
 *
 * This minified form contains no spread, no nested array literals, and no
 * escaped double quotes, so it survives `node -e "..."` quoting on every shell.
 * The default form uses CLAUDE_PLUGIN_ROOT directly when set. Otherwise it
 * probes the locations resolveEccRoot() knows about — ~/.claude, exact plugin roots
 * under ~/.claude/plugins/, and the versioned plugin cache — only far enough to
 * load the committed resolve-ecc-root module, then delegates the authoritative
 * decision to resolveEccRoot(). This keeps discovery behaviour identical to the
 * old inline while centralising the real logic in one tested module.
 * With a command probe, check for a runnable file directly. This lets
 * commands find the installed script without loading JavaScript merely to
 * decide which root to use.
 *
 * Usage in commands:
 *   const _r = <paste INLINE_RESOLVE>;
 *   const sm = require(_r + '/scripts/lib/session-manager');
 */
// Lazily loaded so this module can be required from stripped-down directories
// (e.g., temp dirs in tests that copy only resolve-ecc-root.js + utils.js).
// Falls back to canonical inline string with identical escaping when unavailable.
let _inlineWslConversion = null;
function getInlineWslConversion() {
  if (_inlineWslConversion === null) {
    try {
      _inlineWslConversion = require('./install-targets/helpers').INLINE_WSL_CONVERSION;
    } catch (_) {
      _inlineWslConversion = `try{if(o.platform()==='linux'){var v=f.readFileSync('/proc/version','utf8').toLowerCase();if(v.includes('microsoft')){var b=String.fromCharCode(92),m=d.match(/^([A-Za-z]):/);if(m&&(d.charAt(2)==='/'||d.charAt(2)===b)){var dl=m[1].toLowerCase();d='/mnt/'+dl+d.slice(2).split(b).join('/')}}}}catch(_){}`;
    }
  }
  return _inlineWslConversion;
}

function buildInlineResolve(options = {}) {
  const wslConversion = getInlineWslConversion();
  let probePath;
  if (options && options.probe) {
    const segments = String(options.probe).split(/[\\/]/).filter(Boolean);
    for (const seg of segments) {
      if (!/^[\w.-]+$/.test(seg)) {
        throw new Error(`Invalid probe segment: ${seg}`);
      }
    }
    probePath = `p.join(${segments.map((s) => `'${s}'`).join(',')})`;
  }
  const command = options?.command && probePath;
  const probeArg = probePath ? `{probe:${probePath}}` : '';
  const inspect = command
    ? `function N(x){if(o.platform()==='win32'&&x.charAt(0)==='/'&&x.charAt(1).match(/[A-Za-z]/)&&(x.length===2||x.charAt(2)==='/'))return x.charAt(1).toUpperCase()+':/'+x.slice(3);return x}`
      + `function F(x){try{return f.statSync(x).isFile()}catch(_){return false}}`
      + `function L(x){x=(x||'').trim();if(x==='')return null;x=p.resolve(N(x));return F(p.join(x,${probePath}))?x:null}`
    : `function L(x){try{return require(p.join(x,'scripts','lib','resolve-ecc-root')).resolveEccRoot(${probeArg})}catch(_){return null}}`;
  const first = command
    ? `var r=L(process.env.CLAUDE_PLUGIN_ROOT)||L(process.env.ANTIGRAVITY_PLUGIN_ROOT)||L(process.env.GEMINI_PLUGIN_ROOT)||L(d)||L(p.join(o.homedir(),'.gemini','config','plugins','ecc'));if(r)return r;`
    : 'var r=L(d);if(r)return r;';
  const fallback = command
    ? `var x=(process.env.OPENCODE_CONFIG_DIR||'').trim(),z=N((process.env.XDG_CONFIG_HOME||'').trim());r=L(x||(z?p.join(z,'opencode'):p.join(o.homedir(),'.config','opencode')));if(r)return r;`
      + `var a=N((process.env.CLAUDE_PROJECT_DIR||'').trim())||process.cwd(),q=p.join(a,'.claude');return F(p.join(q,'ecc','install-state.json'))||F(p.join(q,'scripts','lib','resolve-ecc-root.js'))?L(q)||'':''`
    : 'return d';
  return `(function(){var p=require('path'),f=require('fs'),o=require('os');${command ? '' : "var e=process.env.CLAUDE_PLUGIN_ROOT;if(e&&e.trim())return e.trim();"}`
    + `var d=(process.env.CLAUDE_CONFIG_DIR||'').trim()||p.join(o.homedir(),'.claude');`
    + `if(d==='~')d=o.homedir();else if(d.charAt(0)==='~'&&(d.charAt(1)==='/'||d.charCodeAt(1)===92))d=p.join(o.homedir(),d.slice(2));`
    + `${wslConversion}d=p.resolve(${command ? 'N(d)' : 'd'});${inspect}${first}`
    + `var s=['ecc','ecc@ecc','marketplaces/ecc','everything-claude-code','everything-claude-code@everything-claude-code','marketplaces/everything-claude-code'];for(var i=0;i<s.length;i++){r=L(p.join(d,'plugins',s[i]));if(r)return r}`
    + `function D(x){try{return f.readdirSync(x,{withFileTypes:true}).filter(function(z){return z.isDirectory()}).map(function(z){return z.name})}catch(e){if(e.code==='ENOENT')return [];throw e}}`
    + `var g=['ecc','everything-claude-code'];for(var j=0;j<g.length;j++){var c=p.join(d,'plugins','cache',g[j]);var O=D(c);for(var k=0;k<O.length;k++){var q=p.join(c,O[k]);var V=D(q);for(var m=0;m<V.length;m++){r=L(p.join(q,V[m]));if(r)return r}}}`
    + `${fallback}})()`;
}

const INLINE_RESOLVE = buildInlineResolve();

module.exports = {
  resolveEccRoot,
  normalizePluginRootForPlatform,
  INLINE_RESOLVE,
  buildInlineResolve,
};
