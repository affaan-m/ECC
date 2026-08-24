'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

const CURRENT_PLUGIN_SLUG = 'ecc';
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
const PLUGIN_ROOT_ENV_KEYS = ['GROK_PLUGIN_ROOT', 'CLAUDE_PLUGIN_ROOT', 'ECC_PLUGIN_ROOT'];

function pluginRootFromEnv(env = process.env) {
  for (const key of PLUGIN_ROOT_ENV_KEYS) {
    const value = env[key];
    if (value && String(value).trim()) {
      return String(value).trim();
    }
  }
  return '';
}

function findRootInVendorHome(vendorDir, isRoot) {
  if (isRoot(vendorDir)) {
    return vendorDir;
  }

  for (const segments of PLUGIN_ROOT_SEGMENTS) {
    const candidate = path.join(vendorDir, 'plugins', ...segments);
    if (isRoot(candidate)) {
      return candidate;
    }
  }

  try {
    for (const slug of PLUGIN_CACHE_SLUGS) {
      const cacheBase = path.join(vendorDir, 'plugins', 'cache', slug);
      const orgDirs = fs.readdirSync(cacheBase, { withFileTypes: true });

      for (const orgEntry of orgDirs) {
        if (!orgEntry.isDirectory()) continue;
        const orgPath = path.join(cacheBase, orgEntry.name);

        let versionDirs;
        try {
          versionDirs = fs.readdirSync(orgPath, { withFileTypes: true });
        } catch {
          continue;
        }

        for (const verEntry of versionDirs) {
          if (!verEntry.isDirectory()) continue;
          const candidate = path.join(orgPath, verEntry.name);
          if (isRoot(candidate)) {
            return candidate;
          }
        }
      }
    }
  } catch {
    // Vendor plugin cache doesn't exist or isn't readable.
  }

  try {
    const installedBase = path.join(vendorDir, 'installed-plugins');
    const installedDirs = fs.readdirSync(installedBase, { withFileTypes: true });
    for (const entry of installedDirs) {
      if (!entry.isDirectory()) continue;
      const candidate = path.join(installedBase, entry.name);
      if (isRoot(candidate)) {
        return candidate;
      }
    }
  } catch {
    // Grok (and similar) installed-plugins homes are optional.
  }

  return null;
}

/**
 * Resolve the ECC source root directory.
 *
 * Tries, in order:
 *   1. GROK_PLUGIN_ROOT, CLAUDE_PLUGIN_ROOT, or ECC_PLUGIN_ROOT
 *   2. Standard install location (~/.claude/) — when a complete root exists there
 *   3. Known plugin roots under ~/.claude/plugins/ (current + legacy slugs)
 *   4. Plugin cache auto-detection — scans ~/.claude/plugins/cache/{ecc,everything-claude-code}/
 *   5. The same layout under ~/.grok/, plus ~/.grok/installed-plugins/<hash>/
 *   6. Fallback to ~/.claude/ (original behaviour)
 *
 * @param {object} [options]
 * @param {string} [options.homeDir]  Override home directory (for testing)
 * @param {string} [options.envRoot]  Override plugin-root env (for testing)
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
    : pluginRootFromEnv(process.env);

  if (envRoot && envRoot.trim()) {
    return envRoot.trim();
  }

  const homeDir = options.homeDir || os.homedir();
  const claudeDir = path.join(homeDir, '.claude');
  const grokDir = path.join(homeDir, '.grok');

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

  return findRootInVendorHome(claudeDir, isRoot)
    || findRootInVendorHome(grokDir, isRoot)
    || claudeDir;
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
 * When GROK_PLUGIN_ROOT, CLAUDE_PLUGIN_ROOT, or ECC_PLUGIN_ROOT is set it is
 * used directly. Grok trusted plugin hooks set both GROK_PLUGIN_ROOT and the
 * CLAUDE_PLUGIN_ROOT alias. Otherwise the inline probes ~/.claude plugin
 * locations only far enough to load this module, then delegates to
 * resolveEccRoot() (which also searches ~/.grok).
 *
 * Usage in commands:
 *   const _r = <paste INLINE_RESOLVE>;
 *   const sm = require(_r + '/scripts/lib/session-manager');
 */
const INLINE_RESOLVE = `(function(){var p=require('path'),f=require('fs'),o=require('os');var e=process.env.GROK_PLUGIN_ROOT||process.env.CLAUDE_PLUGIN_ROOT||process.env.ECC_PLUGIN_ROOT;if(e&&e.trim())return e.trim();var d=p.join(o.homedir(),'.claude');function L(x){try{return require(p.join(x,'scripts','lib','resolve-ecc-root')).resolveEccRoot()}catch(_){return null}}var r=L(d);if(r)return r;var s=['ecc','ecc@ecc','marketplaces/ecc','everything-claude-code','everything-claude-code@everything-claude-code','marketplaces/everything-claude-code'];for(var i=0;i<s.length;i++){r=L(p.join(d,'plugins',s[i]));if(r)return r}try{var g=['ecc','everything-claude-code'];for(var j=0;j<g.length;j++){var c=p.join(d,'plugins','cache',g[j]);var O=f.readdirSync(c);for(var k=0;k<O.length;k++){var q=p.join(c,O[k]);var V=f.readdirSync(q);for(var m=0;m<V.length;m++){r=L(p.join(q,V[m]));if(r)return r}}}}catch(_){}return d})()`;

module.exports = {
  resolveEccRoot,
  pluginRootFromEnv,
  PLUGIN_ROOT_ENV_KEYS,
  INLINE_RESOLVE,
};
