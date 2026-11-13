'use strict';

// Neighbor skills: skills the host has installed from somewhere other than ECC.
// ECC never loads them and never reads their bodies. Their names and
// descriptions are matched against the task so the ones that also fit can be
// listed as companions next to ECC's own selection, which they never change.
// The host can then use ECC's skill and the user's other skills together. The
// list is an explicit, digest-bound input: resolution never scans the machine,
// so the same input gives the same result everywhere. Discovery is a separate,
// read-only step that writes a snapshot.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const yaml = require('js-yaml');
const { scoreExternal, tokenize } = require('./context-retrieval');
const { DEFAULT_REPO_ROOT, digestObject } = require('./context-profile-support');

const SCHEMA = 'ecc.context-neighbors.v1';
// The envelope `ecc profile <command> --json` prints around a successful result.
const OPERATION_SCHEMA = 'ecc.profile-operation.v1';
const MAX_NEIGHBORS = 1024;
const MAX_NAME_BYTES = 128;
const MAX_SOURCE_BYTES = 256;
const MAX_DESCRIPTION_BYTES = 4096;
// Discovery keeps the routing-relevant start of long descriptions.
const DISCOVERED_DESCRIPTION_CHARS = 1024;
const MAX_SNAPSHOT_BYTES = 4 * 1024 * 1024;
const MAX_SKILL_FILE_BYTES = 256 * 1024;
const MAX_FRONTMATTER_CHARS = 16 * 1024;
const MAX_JSON_BYTES = 1024 * 1024;
const NEIGHBOR_KEYS = new Set(['source', 'name', 'description']);
const SNAPSHOT_KEYS = new Set(['schemaVersion', 'target', 'neighbors', 'neighborsDigest', 'excludedEccCopies',
  'excludedEccPlugins', 'skipped']);
const TARGETS = ['claude', 'codex'];
// C0/C1 controls (tab and line breaks are collapsed instead) and invisible format characters
// (zero-width, bidi, tag characters) are rejected: this text is shown to models.
// eslint-disable-next-line no-control-regex
const CONTROL = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f]|\p{Cf}/u;

function boundedString(value, label, maxBytes, index) {
  if (typeof value !== 'string' || !value.trim() || Buffer.byteLength(value) > maxBytes || CONTROL.test(value)) {
    throw new Error(`Neighbor ${index} ${label} must be a non-empty string of at most ${maxBytes} bytes`);
  }
  return value.trim().replace(/\s+/g, ' ');
}

function compareNeighbors(left, right) {
  for (const key of ['source', 'name', 'description']) {
    if (left[key] !== right[key]) return left[key] < right[key] ? -1 : 1;
  }
  return 0;
}

/** Validate a neighbor list (an array, or an ecc.context-neighbors.v1 snapshot)
 * and return it canonically ordered and deduplicated with its digest. */
function normalizeNeighbors(value) {
  const snapshot = value && typeof value === 'object' && !Array.isArray(value) ? value : null;
  if (snapshot && (snapshot.schemaVersion !== SCHEMA || !Array.isArray(snapshot.neighbors)
    || Object.keys(snapshot).some(key => !SNAPSHOT_KEYS.has(key)))) {
    throw new Error(`Neighbor skills must be an array or an ${SCHEMA} snapshot`);
  }
  const list = Array.isArray(value) ? value : snapshot ? snapshot.neighbors : null;
  if (!list) throw new Error(`Neighbor skills must be an array or an ${SCHEMA} snapshot`);
  if (list.length > MAX_NEIGHBORS) throw new Error(`Neighbor skills must list at most ${MAX_NEIGHBORS} entries`);
  const normalized = list.map((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error(`Neighbor ${index} must be an object`);
    for (const key of Object.keys(item)) if (!NEIGHBOR_KEYS.has(key)) throw new Error(`Unknown neighbor field: ${key}`);
    return { source: item.source === undefined ? 'unspecified' : boundedString(item.source, 'source', MAX_SOURCE_BYTES, index),
      name: boundedString(item.name, 'name', MAX_NAME_BYTES, index),
      description: boundedString(item.description, 'description', MAX_DESCRIPTION_BYTES, index) };
  }).sort(compareNeighbors);
  const neighbors = normalized.filter((item, index) => !index || compareNeighbors(item, normalized[index - 1]) !== 0);
  const neighborsDigest = digestObject(neighbors);
  if (snapshot && snapshot.neighborsDigest !== undefined && snapshot.neighborsDigest !== neighborsDigest) {
    throw new Error('Neighbor snapshot digest does not match its neighbors');
  }
  return { neighbors, neighborsDigest };
}

/** Read and validate a neighbor snapshot file written by discovery or by hand. */
function readNeighborSnapshot(file) {
  const absolute = path.resolve(file);
  const stat = fs.statSync(absolute);
  if (!stat.isFile() || stat.size > MAX_SNAPSHOT_BYTES) {
    throw new Error(`Neighbor snapshot must be a file of at most ${MAX_SNAPSHOT_BYTES} bytes`);
  }
  const bytes = fs.readFileSync(absolute);
  const text = bytes.toString('utf8');
  if (!Buffer.from(text).equals(bytes) || text.includes('\0')) throw new Error('Neighbor snapshot must be UTF-8 JSON without NUL');
  let value;
  try { value = JSON.parse(text); } catch { throw new Error('Neighbor snapshot must be valid JSON'); }
  // `ecc profile neighbors --json` wraps the snapshot in the CLI's operation
  // envelope; saving that output and passing it back must work as-is.
  if (value && value.schemaVersion === OPERATION_SCHEMA && value.status === 'success' && value.neighbors
    && typeof value.neighbors === 'object' && value.neighbors.schemaVersion === SCHEMA) value = value.neighbors;
  return { schemaVersion: SCHEMA, ...normalizeNeighbors(value) };
}

function slug(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'skill';
}

const COMPANION_LIMITATION = 'Companion skills are installed non-ECC skills matched by name and description only, '
  + "scored with ECC's word statistics: a word no ECC skill uses weighs more, so a companion can be listed on vocabulary "
  + 'alone. ECC does not load, read or vouch for them; the host decides whether to use them.';

/** A validated, non-empty neighbor set, or null. No list and an empty list are
 * both null, so the resolver result is unchanged without neighbors. */
function companionInput(neighbors) {
  if (neighbors === null || neighbors === undefined) return null;
  const set = normalizeNeighbors(neighbors);
  return set.neighbors.length ? set : null;
}

// One skill per name and description: copies installed from several sources
// collapse into the first source in canonical order; the rest are alsoIn.
function distinctSkills(neighbors) {
  const bySkill = new Map();
  for (const item of neighbors) {
    const key = `${item.name}\n${item.description}`;
    if (bySkill.has(key)) bySkill.get(key).alsoIn.push(item.source);
    else bySkill.set(key, { ...item, alsoIn: [] });
  }
  return [...bySkill.values()];
}

/** Installed neighbors that also match the query, strongest first, to list
 * beside ECC's own selection. Each neighbor is scored with the ECC index's own
 * statistics, shaped like an ECC entry whose id slug is its name. It is listed
 * when it clears the caller's evidence bar and a matched term is in its name.
 * A companion is marked sameTopicAs ECC's top candidate when one of its
 * matched terms is an anchor term (name or trigger) of that candidate. */
// A companion clears the score and term bar and either shares a word with the
// prompt in its name (anchored), or is the single best-scoring neighbor and
// leads the next one by the auto-admission margin. Specialized skills often
// have names a prompt never uses; the margin keeps that route to one clear
// winner instead of every neighbor with matching description words.
function rankCompanions(index, query, neighbors, { minBm25, minTerms, minAnchorTerms, margin, limit, top = null }) {
  if (!index || !neighbors || !neighbors.length) return [];
  const topAnchors = new Set(top && Array.isArray(top.anchorTerms) ? top.anchorTerms : []);
  const entries = distinctSkills(neighbors).map(skill => ({ id: `skill:${slug(skill.name)}`, name: skill.name,
    description: skill.description, skill, nameTerms: new Set(tokenize(skill.name)) }));
  const scored = scoreExternal(index, query, entries);
  const onBar = candidate => candidate.bm25 >= minBm25 && candidate.matchedTerms.length >= minTerms;
  const anchored = candidate => candidate.matchedTerms.filter(term => candidate.entry.nameTerms.has(term)).length >= minAnchorTerms;
  const clearLead = (candidate, position) => position === 0 && (!scored[1] || candidate.bm25 >= margin * scored[1].bm25);
  return scored
    .filter((candidate, position) => onBar(candidate) && (anchored(candidate) || clearLead(candidate, position)))
    .slice(0, limit)
    .map(({ entry, bm25, matchedTerms }) => ({ name: entry.skill.name, source: entry.skill.source,
      ...(entry.skill.alsoIn.length ? { alsoIn: entry.skill.alsoIn } : {}),
      description: entry.skill.description, bm25, matchedTerms,
      ...(top && matchedTerms.some(term => topAnchors.has(term)) ? { sameTopicAs: top.id } : {}) }));
}

function readBoundedJson(file) {
  try {
    const stat = fs.statSync(file);
    if (!stat.isFile() || stat.size > MAX_JSON_BYTES) return null;
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function frontmatter(file) {
  const stat = fs.statSync(file);
  if (!stat.isFile() || stat.size > MAX_SKILL_FILE_BYTES) return null;
  const text = fs.readFileSync(file, 'utf8');
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);
  // Only name and description are needed; a frontmatter block this large is
  // not a skill header, so it is skipped before YAML parsing.
  if (!match || match[1].length > MAX_FRONTMATTER_CHARS) return null;
  const value = yaml.load(match[1], { schema: yaml.CORE_SCHEMA });
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

function skillDirectories(root) {
  try {
    return fs.readdirSync(path.join(root, 'skills'), { withFileTypes: true })
      .filter(entry => (entry.isDirectory() || entry.isSymbolicLink()) && !entry.name.startsWith('.'))
      .map(entry => path.join(root, 'skills', entry.name))
      .sort();
  } catch {
    return [];
  }
}

function claudeSkillRoots(configDir, eccPluginName) {
  const roots = [{ source: 'claude:user', root: configDir }];
  let excludedEccPlugins = 0;
  const installed = readBoundedJson(path.join(configDir, 'plugins', 'installed_plugins.json'));
  const settings = readBoundedJson(path.join(configDir, 'settings.json'));
  const enabled = settings && typeof settings.enabledPlugins === 'object' && settings.enabledPlugins ? settings.enabledPlugins : {};
  const plugins = installed && typeof installed.plugins === 'object' && installed.plugins ? installed.plugins : {};
  for (const key of Object.keys(plugins).sort()) {
    if (enabled[key] !== true || !Array.isArray(plugins[key])) continue;
    const record = plugins[key].find(item => item && (item.scope === undefined || item.scope === 'user')
      && typeof item.installPath === 'string' && path.isAbsolute(item.installPath));
    if (!record) continue;
    const manifest = readBoundedJson(path.join(record.installPath, '.claude-plugin', 'plugin.json'));
    if (eccPluginName && manifest && manifest.name === eccPluginName) {
      excludedEccPlugins += 1;
      continue;
    }
    const source = `claude:plugin:${key}`;
    // A plugin key that cannot be a valid source label is skipped, not fatal.
    if (Buffer.byteLength(source) > MAX_SOURCE_BYTES || CONTROL.test(source)) continue;
    roots.push({ source, root: record.installPath });
  }
  return { roots, excludedEccPlugins };
}

const comparable = text => String(text || '').trim().replace(/\s+/g, ' ');

// One skill directory: a neighbor summary, an installed ECC copy, a skipped
// (unreadable or incomplete) skill, or no SKILL.md at all.
function readSkillSummary(directory, eccCopies) {
  const file = path.join(directory, 'SKILL.md');
  if (!fs.existsSync(file)) return { kind: 'missing' };
  let meta;
  try { meta = frontmatter(file); } catch { meta = null; }
  const name = meta && typeof meta.name === 'string' && meta.name.trim() ? meta.name.trim() : path.basename(directory);
  const description = meta && typeof meta.description === 'string' ? comparable(meta.description) : '';
  if (!description || Buffer.byteLength(name) > MAX_NAME_BYTES || CONTROL.test(name) || CONTROL.test(description)) {
    return { kind: 'skipped' };
  }
  if (eccCopies.has(`${comparable(name)}\n${description}`)) return { kind: 'ecc' };
  return { kind: 'neighbor', skill: { name, description: description.slice(0, DISCOVERED_DESCRIPTION_CHARS) } };
}

// Skill roots to read for one target, in source order.
function discoveryRoots({ target, env, home, projectDir, eccPluginName }) {
  if (target !== 'claude') {
    return { roots: [{ source: 'codex:user', root: env.CODEX_HOME || path.join(home, '.codex') }], excludedEccPlugins: 0 };
  }
  const configDir = env.CLAUDE_CONFIG_DIR || path.join(home, '.claude');
  const discovery = claudeSkillRoots(configDir, eccPluginName);
  const projectRoot = projectDir && path.join(projectDir, '.claude');
  // Run from the home directory, the project folder is the user folder: read it once.
  if (projectRoot && path.resolve(projectRoot) !== path.resolve(configDir)) {
    return { ...discovery, roots: [...discovery.roots, { source: 'claude:project', root: projectRoot }] };
  }
  return discovery;
}

/** Read-only discovery of the skills a provider home exposes besides ECC.
 * Claude: user skills, skills of enabled user-scope plugins, and, with
 * projectDir, the project's own `.claude/skills` (where teams keep skills
 * specific to their codebase). Codex: the Codex home's skills. ECC's own
 * plugin and installed copies of ECC skills (same name and description as the
 * registry) are excluded. */
function discoverNeighborSkills({ repoRoot = DEFAULT_REPO_ROOT, target = 'codex', env = process.env,
  home = os.homedir(), projectDir = null } = {}) {
  if (!TARGETS.includes(target)) throw new Error(`Unsupported neighbor target: ${target}`);
  if (projectDir !== null && (target !== 'claude' || typeof projectDir !== 'string' || !path.isAbsolute(projectDir))) {
    throw new Error('A project directory must be an absolute path and applies to the claude target only');
  }
  const { loadContextRegistry } = require('./context-pack-registry');
  const registry = loadContextRegistry({ repoRoot });
  const eccCopies = new Set(registry.entries.map(entry => `${comparable(entry.name)}\n${comparable(entry.description)}`));
  const eccPlugin = readBoundedJson(path.join(repoRoot, '.claude-plugin', 'plugin.json'));
  const discovery = discoveryRoots({ target, env, home, projectDir, eccPluginName: eccPlugin && eccPlugin.name });
  const neighbors = [];
  const counts = { missing: 0, skipped: 0, ecc: 0 };
  for (const { source, root } of discovery.roots) {
    for (const directory of skillDirectories(root)) {
      const found = readSkillSummary(directory, eccCopies);
      if (found.kind !== 'neighbor') {
        counts[found.kind] += 1;
        continue;
      }
      neighbors.push({ source, ...found.skill });
      if (neighbors.length > MAX_NEIGHBORS) throw new Error(`Discovered more than ${MAX_NEIGHBORS} neighbor skills`);
    }
  }
  const excludedEccCopies = counts.ecc;
  const skipped = counts.skipped;
  const normalized = normalizeNeighbors(neighbors);
  return { schemaVersion: SCHEMA, target, neighbors: normalized.neighbors, neighborsDigest: normalized.neighborsDigest,
    excludedEccCopies, excludedEccPlugins: discovery.excludedEccPlugins, skipped };
}

module.exports = { COMPANION_LIMITATION, SCHEMA, companionInput, discoverNeighborSkills, normalizeNeighbors, rankCompanions,
  readNeighborSnapshot };
