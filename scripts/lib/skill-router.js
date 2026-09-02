/**
 * Skill routing for the opt-in UserPromptSubmit skill-router hook.
 *
 * Scores the user's prompt against skill descriptions with plain offline
 * token matching and returns the best matches, marking each one as installed
 * in the active plugin or available on demand inside the plugin.
 *
 * Catalog sources, in order:
 *   1. The carrier receipt (`ecc-profile.json`) written by
 *      scripts/plugin-profiles.js: its `catalog` rows carry an id, a
 *      description, a carrier-relative path, and a content hash. Nothing
 *      outside the plugin is ever referenced.
 *   2. The plugin's own `skills/` directory (the full plugin routes over
 *      itself), scanned once and cached under the user's home directory.
 */

'use strict';

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { parseFrontmatter } = require('./plugin-profiles');

const PROFILE_METADATA_FILE = 'ecc-profile.json';
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const DEFAULT_MAX_RESULTS = 3;
const DEFAULT_MIN_SCORE = 3;
const SAFE_RELATIVE_PATH = /^(?:skills|on-demand)\/[A-Za-z0-9._-]+\/SKILL\.md$/;

// Function words and generic task verbs only. Domain-ish words (test, fix,
// build, review, ...) stay routable because skills are named after them.
const STOPWORDS = new Set([
  'the', 'and', 'for', 'with', 'from', 'this', 'that', 'these', 'those',
  'have', 'has', 'had', 'you', 'your', 'our', 'are', 'was', 'were', 'been',
  'being', 'will', 'would', 'could', 'should', 'can', 'may', 'might', 'must',
  'not', 'but', 'into', 'onto', 'about', 'over', 'under', 'out', 'off',
  'when', 'where', 'what', 'which', 'who', 'whom', 'why', 'how', 'all',
  'any', 'some', 'each', 'more', 'most', 'other', 'such', 'only', 'also',
  'than', 'then', 'them', 'they', 'there', 'here', 'just', 'like', 'very',
  'really', 'please', 'help', 'want', 'need', 'make', 'made', 'using',
  'use', 'used', 'get', 'got', 'set', 'let', 'way', 'thing', 'things',
  'know', 'still', 'now', 'currently', 'something',
]);

function tokenize(text) {
  const tokens = new Set();
  for (const rawToken of String(text || '').toLowerCase().split(/[^a-z0-9]+/)) {
    if (rawToken.length < 3 || STOPWORDS.has(rawToken)) {
      continue;
    }
    tokens.add(rawToken);
    if (rawToken.length > 3 && rawToken.endsWith('s')) {
      tokens.add(rawToken.slice(0, -1));
    }
  }
  return tokens;
}

function listSkillDirs(skillsRoot) {
  if (!fs.existsSync(skillsRoot)) {
    return [];
  }
  return fs.readdirSync(skillsRoot, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => entry.name)
    .sort();
}

/**
 * Scan every SKILL.md under a plugin's `skills/` for its id and description.
 */
function readCatalog(pluginRoot) {
  const skillsRoot = path.join(pluginRoot, 'skills');
  const entries = [];
  for (const skillId of listSkillDirs(skillsRoot)) {
    const skillPath = path.join(skillsRoot, skillId, 'SKILL.md');
    if (!fs.existsSync(skillPath)) {
      continue;
    }
    const { description } = parseFrontmatter(fs.readFileSync(skillPath, 'utf8'));
    entries.push({ id: skillId, description, path: `skills/${skillId}/SKILL.md`, installed: true });
  }
  return entries;
}

function catalogSignature(pluginRoot) {
  const skillsRoot = path.join(pluginRoot, 'skills');
  try {
    const stat = fs.statSync(skillsRoot);
    return { dirCount: listSkillDirs(skillsRoot).length, mtimeMs: stat.mtimeMs };
  } catch {
    return { dirCount: 0, mtimeMs: 0 };
  }
}

/**
 * The cache lives under the user's home directory, NOT os.tmpdir(): a
 * stable, predictable filename in a shared /tmp would let another local
 * user pre-plant cache content that gets injected into this user's context.
 */
function cachePathFor(pluginRoot) {
  const cacheDir = process.env.ECC_SKILL_ROUTER_CACHE_DIR
    || path.join(os.homedir(), '.claude', 'cache');
  const digest = crypto.createHash('sha1').update(path.resolve(pluginRoot)).digest('hex').slice(0, 12);
  return path.join(cacheDir, `ecc-skill-router-${digest}.json`);
}

/**
 * Keep only well-formed catalog rows. Both the on-disk cache and a plugin's
 * receipt are attacker-writable in the threat model; a malformed entry must
 * never reach scoring or routed output, and a path must stay inside the
 * plugin's `skills/` or `on-demand/` trees.
 */
function sanitizeCatalogEntries(entries) {
  if (!Array.isArray(entries)) {
    return [];
  }
  return entries
    .filter(entry => entry
      && typeof entry.id === 'string'
      && entry.id.length > 0
      && typeof entry.description === 'string'
      && (entry.path === undefined || (typeof entry.path === 'string' && SAFE_RELATIVE_PATH.test(entry.path))))
    .map(entry => ({
      id: entry.id,
      description: entry.description,
      path: typeof entry.path === 'string' ? entry.path : `skills/${entry.id}/SKILL.md`,
      installed: entry.installed !== false,
    }));
}

function loadCatalog(pluginRoot) {
  const signature = catalogSignature(pluginRoot);
  const cachePath = cachePathFor(pluginRoot);

  try {
    const cached = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
    if (cached.signature
      && cached.signature.dirCount === signature.dirCount
      && cached.signature.mtimeMs === signature.mtimeMs
      && Number.isFinite(cached.builtAt)
      && cached.builtAt <= Date.now()
      && Date.now() - cached.builtAt < CACHE_TTL_MS
      && Array.isArray(cached.entries)) {
      return sanitizeCatalogEntries(cached.entries);
    }
  } catch {
    // missing or unreadable cache: rebuild below
  }

  const entries = readCatalog(pluginRoot);
  writeCatalogCache(cachePath, { signature, builtAt: Date.now(), entries });
  return entries;
}

/**
 * Persist the catalog cache without ever writing through a planted symlink:
 * exclusive temp file + atomic rename, best-effort throughout.
 */
function writeCatalogCache(cachePath, payload) {
  const tempPath = `${cachePath}.${process.pid}.tmp`;
  try {
    fs.mkdirSync(path.dirname(cachePath), { recursive: true });
    fs.writeFileSync(tempPath, JSON.stringify(payload), { mode: 0o600, flag: 'wx' });
    fs.renameSync(tempPath, cachePath);
  } catch {
    try {
      fs.unlinkSync(tempPath);
    } catch {
      // nothing to clean up
    }
  }
}

/**
 * Resolve the catalog for a plugin root: the receipt's embedded catalog when
 * the plugin is a generated carrier, otherwise the plugin's own skills.
 */
function resolveRouterContext(pluginRoot) {
  const installedIds = new Set(listSkillDirs(path.join(pluginRoot, 'skills')));
  let embeddedCatalog = null;

  try {
    const receipt = JSON.parse(fs.readFileSync(path.join(pluginRoot, PROFILE_METADATA_FILE), 'utf8'));
    if (receipt && Array.isArray(receipt.catalog)) {
      embeddedCatalog = sanitizeCatalogEntries(receipt.catalog)
        .map(entry => ({ ...entry, installed: installedIds.has(entry.id) }));
    }
  } catch {
    // no receipt: plugin root is the catalog source
  }

  return { pluginRoot, installedIds, embeddedCatalog };
}

/**
 * Score the prompt against the catalog. Skill-id token matches weigh 3,
 * description token matches weigh 1; ties break alphabetically so output
 * is deterministic.
 */
function routePrompt(prompt, options = {}) {
  const pluginRoot = options.pluginRoot;
  if (!pluginRoot) {
    throw new Error('routePrompt requires pluginRoot');
  }
  const maxResults = options.maxResults ?? DEFAULT_MAX_RESULTS;
  const minScore = options.minScore ?? DEFAULT_MIN_SCORE;

  const promptTokens = tokenize(prompt);
  if (promptTokens.size === 0) {
    return [];
  }

  const { installedIds, embeddedCatalog } = resolveRouterContext(pluginRoot);
  const scored = [];

  for (const entry of embeddedCatalog || loadCatalog(pluginRoot)) {
    if (entry.id === 'ecc-catalog') {
      continue;
    }
    let score = 0;
    for (const token of tokenize(entry.id.replace(/-/g, ' '))) {
      if (promptTokens.has(token)) {
        score += 3;
      }
    }
    for (const token of tokenize(entry.description)) {
      if (promptTokens.has(token)) {
        score += 1;
      }
    }
    if (score >= minScore) {
      scored.push({
        id: entry.id,
        description: entry.description,
        score,
        installed: installedIds.has(entry.id),
        path: entry.path,
      });
    }
  }

  scored.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
  return scored.slice(0, maxResults);
}

module.exports = {
  PROFILE_METADATA_FILE,
  tokenize,
  sanitizeCatalogEntries,
  resolveRouterContext,
  routePrompt,
};
