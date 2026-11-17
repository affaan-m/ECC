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
 *   1. CLAUDE_PLUGIN_ROOT env var (set by Claude Code for hooks, or by user)
 *   2. Standard install location (~/.claude/) — when scripts exist there
 *   3. Known plugin roots under ~/.claude/plugins/ (current + legacy slugs)
 *   4. Plugin cache auto-detection — scans ~/.claude/plugins/cache/{ecc,everything-claude-code}/
 *   5. Fallback to ~/.claude/ (original behaviour)
 *
 * @param {object} [options]
 * @param {string} [options.homeDir]  Override home directory (for testing)
 * @param {string} [options.envRoot]  Override CLAUDE_PLUGIN_ROOT (for testing)
 * @param {string} [options.probe]    Relative path used to verify a candidate
 *                                    root contains what the caller needs. When
 *                                    given, it is honored exactly (script
 *                                    consumers pass their own script path). When
 *                                    omitted, a candidate must contain BOTH the
 *                                    ECC script tree and a sentinel ECC skill,
 *                                    so a partial install (scripts without
 *                                    skills) is rejected for skill consumers.
 * @returns {string} Resolved ECC root path
 */
function resolveEccRoot(options = {}) {
  const envRoot = options.envRoot !== undefined
    ? options.envRoot
    : (process.env.CLAUDE_PLUGIN_ROOT || '');

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

  // Decide whether a candidate directory is a usable ECC root. An explicit
  // caller probe is honored exactly (script consumers know the artifact they
  // need). With the default probe the caller is a skill consumer, so a
  // candidate must contain both ECC's scripts and a sentinel ECC skill —
  // otherwise a scripts-only ~/.claude short-circuits and every skill path
  // resolves to a location that does not exist (#2544).
  const isRoot = options.probe
    ? (dir) => fs.existsSync(path.join(dir, options.probe))
    : (dir) => fs.existsSync(path.join(dir, DEFAULT_SCRIPT_PROBE))
            && fs.existsSync(path.join(dir, DEFAULT_SKILL_PROBE));

  // Standard install — files are copied directly into ~/.claude/
  if (isRoot(claudeDir)) {
    return claudeDir;
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
 * When CLAUDE_PLUGIN_ROOT is set (as Claude Code does for plugin hooks and
 * commands) it is used directly. Otherwise the inline probes the same set of
 * locations resolveEccRoot() knows about — ~/.claude, the exact plugin roots
 * under ~/.claude/plugins/, and the versioned plugin cache — only far enough to
 * load the committed resolve-ecc-root module, then delegates the authoritative
 * decision to resolveEccRoot(). This keeps discovery behaviour identical to the
 * old inline while centralising the real logic in one tested module.
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
  let probeArg = '';
  if (options && options.probe) {
    const segments = String(options.probe).split(/[\\/]/).filter(Boolean);
    for (const seg of segments) {
      if (!/^[\w.-]+$/.test(seg)) {
        throw new Error(`Invalid probe segment: ${seg}`);
      }
    }
    probeArg = `{probe:p.join(${segments.map((s) => `'${s}'`).join(',')})}`;
  }
  return `(function(){var p=require('path'),f=require('fs'),o=require('os');var e=process.env.CLAUDE_PLUGIN_ROOT;if(e&&e.trim())return e.trim();var d=(process.env.CLAUDE_CONFIG_DIR||'').trim()||p.join(o.homedir(),'.claude');if(d==='~')d=o.homedir();else if(d.charAt(0)==='~'&&(d.charAt(1)==='/'||d.charCodeAt(1)===92))d=p.join(o.homedir(),d.slice(2));${wslConversion}d=p.resolve(d);function L(x){try{return require(p.join(x,'scripts','lib','resolve-ecc-root')).resolveEccRoot(${probeArg})}catch(_){return null}}var r=L(d);if(r)return r;var s=['ecc','ecc@ecc','marketplaces/ecc','everything-claude-code','everything-claude-code@everything-claude-code','marketplaces/everything-claude-code'];for(var i=0;i<s.length;i++){r=L(p.join(d,'plugins',s[i]));if(r)return r}function D(x){try{return f.readdirSync(x,{withFileTypes:true}).filter(function(z){return z.isDirectory()}).map(function(z){return z.name})}catch(e){if(e.code==='ENOENT')return [];throw e}}var g=['ecc','everything-claude-code'];for(var j=0;j<g.length;j++){var c=p.join(d,'plugins','cache',g[j]);var O=D(c);for(var k=0;k<O.length;k++){var q=p.join(c,O[k]);var V=D(q);for(var m=0;m<V.length;m++){r=L(p.join(q,V[m]));if(r)return r}}}return d})()`;
}

const INLINE_RESOLVE = buildInlineResolve();

module.exports = {
  resolveEccRoot,
  normalizePluginRootForPlatform,
  INLINE_RESOLVE,
  buildInlineResolve,
};
