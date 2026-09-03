/**
 * Profile plugin ("carrier") generation for the Claude Code plugin surface.
 *
 * The marketplace plugin path loads the frontmatter of every skill, agent,
 * and command into session context and ignores the selective-install
 * manifests entirely. This library materializes an install selection as a
 * standalone slim plugin directory — a carrier — that a project can enable
 * instead of the full `ecc` plugin.
 *
 * Design rules (see docs/PLUGIN-PROFILES.md):
 *
 * - Context and capabilities are separate decisions. A narrow context
 *   profile never implies the hook runtime; hooks need an explicit
 *   `hooks` decision, recorded in the receipt.
 * - Generation fails closed. Every shipped command's script dependency
 *   closure is resolved; an unresolved static dependency aborts generation
 *   and the staged tree is re-verified before it is swapped into place.
 * - The carrier is self-contained. On-demand skill content is copied into
 *   the carrier and content-addressed; no absolute source path is written.
 * - Generation is staged, bounded, and receipted. Output is written to a
 *   staging directory, swapped atomically, and described by
 *   `ecc-profile.json`, which doubles as the ownership marker.
 * - The token ledger is labelled. The catalog cost is measured with a named
 *   method and version and gated against a declared budget.
 */

'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { DEFAULT_REPO_ROOT, resolveInstallPlan } = require('./install-manifests');
const { HOOK_CAPABILITY_GROUPS, formatHookCapabilityDisclosure } = require('./install/hook-consent');

const CATALOG_SKILL_ID = 'ecc-catalog';
const ON_DEMAND_DIR = 'on-demand';
const PLUGIN_NAME_PATTERN = /^[a-z0-9][a-z0-9-]*$/;
const DEFAULT_MARKETPLACE_NAME = 'ecc-profiles';
const PROFILE_METADATA_FILE = 'ecc-profile.json';
const PROFILE_GENERATOR_ID = 'everything-claude-code';
const RECEIPT_SCHEMA_VERSION = 1;
const HOOK_PROFILES = Object.freeze(['off', 'minimal', 'standard', 'strict']);
const DEFAULT_CONTEXT_BUDGET_TOKENS = 8000;

// The default token measurer. Claude's tokenizer is not public, so this is
// an estimate and is labelled as one in every ledger. Callers may inject a
// provider-backed `measureTokens` to replace it; the ledger records which
// method produced the number.
const DEFAULT_TOKEN_MEASURER = Object.freeze({
  method: 'chars-per-token-estimate',
  version: '1',
  measure: text => Math.ceil(String(text || '').length / 4),
});

const LISTING_PAYLOAD_FORMAT = 'name-colon-description-lines@1';

// Non-code inputs a command's script reads at runtime. Code dependencies
// are discovered by scanning the command body for `scripts/*.js` references
// and walking their require() graph; only data directories need listing.
const COMMAND_RUNTIME_DATA = Object.freeze({
  'plugin-profiles.md': ['manifests'],
  'project-init.md': ['manifests'],
});

const COMMAND_SCRIPT_REFERENCE_PATTERN = /scripts\/[A-Za-z0-9_./-]+\.js/g;
const RELATIVE_REQUIRE_PATTERN = /\b(?:require|import)\(\s*['"](\.[^'"]*)['"]\s*\)/g;
const DIRNAME_JOIN_REQUIRE_PATTERN = /\brequire\(\s*path\.join\(\s*__dirname\s*((?:,\s*['"][^'"]+['"]\s*)+)\)\s*\)/g;
// Tolerates one level of nested parentheses so `require(path.join(...))`
// is captured whole rather than cut at the inner `)`.
const DYNAMIC_REQUIRE_PATTERN = /\brequire\(\s*(?!['"])((?:[^()]|\([^()]*\))+)\)/g;

/**
 * Normalize a filesystem path to forward slashes.
 *
 * @param {string} relPath Path in platform-native form.
 * @returns {string} Path with POSIX separators.
 */
function toPosix(relPath) {
  return String(relPath).split(path.sep).join('/');
}

/**
 * sha256 hex digest of a string or buffer.
 *
 * @param {string|Buffer} content Content to hash.
 * @returns {string} Hex digest.
 */
function sha256(content) {
  return crypto.createHash('sha256').update(content).digest('hex');
}

/**
 * Read and parse a JSON file, reporting the logical name on failure.
 *
 * @param {string} filePath Absolute path to the JSON file.
 * @param {string} label Human-readable name used in the error message.
 * @returns {object} Parsed JSON.
 */
function readJson(filePath, label) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    throw new Error(`Failed to read ${label}: ${error.message}`);
  }
}

/**
 * Resolve a CommonJS-style specifier to a file: exact path, then `.js`, then
 * `/index.js`.
 *
 * @param {string} absPath Absolute candidate path.
 * @returns {string|null} Resolved file or null.
 */
function resolveModuleCandidate(absPath) {
  for (const candidate of [absPath, `${absPath}.js`, path.join(absPath, 'index.js')]) {
    try {
      if (fs.statSync(candidate).isFile()) {
        return candidate;
      }
    } catch {
      // try the next candidate shape
    }
  }
  return null;
}

/**
 * Extract the relative module specifiers a source file requires.
 *
 * Three shapes are followed: `require('./x')`, `import('./x')`, and
 * `require(path.join(__dirname, 'a', 'b'))` with string-literal segments.
 * Any other non-literal `require(...)` cannot be resolved statically and is
 * reported as dynamic.
 *
 * @param {string} source File contents.
 * @returns {{specifiers: Array<string>, dynamic: Array<string>}} Findings.
 */
function extractRequireSpecifiers(rawSource) {
  const specifiers = [];
  const dynamic = [];
  // Comments are not code: a doc comment that mentions a require shape must
  // not create a phantom dependency.
  const source = String(rawSource || '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

  RELATIVE_REQUIRE_PATTERN.lastIndex = 0;
  let match = RELATIVE_REQUIRE_PATTERN.exec(source);
  while (match !== null) {
    specifiers.push(match[1]);
    match = RELATIVE_REQUIRE_PATTERN.exec(source);
  }

  DIRNAME_JOIN_REQUIRE_PATTERN.lastIndex = 0;
  match = DIRNAME_JOIN_REQUIRE_PATTERN.exec(source);
  while (match !== null) {
    const segments = [...match[1].matchAll(/['"]([^'"]+)['"]/g)].map(m => m[1]);
    specifiers.push(`./${segments.join('/')}`);
    match = DIRNAME_JOIN_REQUIRE_PATTERN.exec(source);
  }

  DYNAMIC_REQUIRE_PATTERN.lastIndex = 0;
  match = DYNAMIC_REQUIRE_PATTERN.exec(source);
  while (match !== null) {
    const argument = match[1].trim();
    const isLiteralDirnameJoin = /^path\.join\(\s*__dirname\s*(?:,\s*['"][^'"]+['"]\s*)+\)$/.test(argument);
    if (!isLiteralDirnameJoin) {
      dynamic.push(argument);
    }
    match = DYNAMIC_REQUIRE_PATTERN.exec(source);
  }

  return { specifiers, dynamic };
}

/**
 * Walk the transitive require() graph of one or more entry scripts.
 *
 * Only relative specifiers are followed — bare specifiers are Node builtins
 * or npm packages, neither of which lives in the repo tree. Nothing is
 * skipped silently: every relative specifier that fails to resolve is
 * returned in `unresolved`, and every non-literal require is returned in
 * `dynamic` so callers can decide how to treat it.
 *
 * @param {Array<string>} entryPaths Repo-relative entry scripts.
 * @param {string} repoRoot Absolute repository root.
 * @returns {{files: Array<string>, unresolved: Array<{from: string, specifier: string}>, dynamic: Array<{from: string, expression: string}>}}
 */
function resolveScriptClosure(entryPaths, repoRoot) {
  const resolvedRoot = path.resolve(repoRoot);
  const seen = new Set();
  const unresolved = [];
  const dynamic = [];
  const queue = [];

  const toRelative = absPath => toPosix(path.relative(resolvedRoot, absPath));

  for (const entryPath of entryPaths) {
    const resolved = resolveModuleCandidate(path.join(resolvedRoot, ...entryPath.split('/')));
    if (resolved) {
      queue.push(resolved);
    } else {
      unresolved.push({ from: '<entry>', specifier: entryPath });
    }
  }

  while (queue.length > 0) {
    const current = queue.pop();
    const relative = toRelative(current);
    if (seen.has(relative) || relative.startsWith('..') || path.isAbsolute(relative)) {
      continue;
    }
    seen.add(relative);

    let source;
    try {
      source = fs.readFileSync(current, 'utf8');
    } catch (error) {
      unresolved.push({ from: relative, specifier: `<unreadable: ${error.message}>` });
      continue;
    }

    const findings = extractRequireSpecifiers(source);
    for (const specifier of findings.specifiers) {
      const next = resolveModuleCandidate(path.resolve(path.dirname(current), specifier));
      if (next) {
        queue.push(next);
      } else {
        unresolved.push({ from: relative, specifier });
      }
    }
    for (const expression of findings.dynamic) {
      dynamic.push({ from: relative, expression });
    }
  }

  return { files: [...seen].sort(), unresolved, dynamic };
}

/**
 * Read frontmatter and its `description:` without a YAML dependency.
 *
 * Handles inline scalars, quoted scalars, and block scalars (`>`, `>-`, `|`,
 * `|-`, and the `+` keep variants). 16 catalog skills use `>-`; reading
 * only the first line yields the literal indicator instead of the text.
 *
 * @param {string} source Full file contents.
 * @returns {{raw: string, name: string, description: string}} Parsed fields.
 */
function parseFrontmatter(source) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(source);
  if (!match) {
    return { raw: '', name: '', description: '' };
  }

  const lines = match[1].split(/\r?\n/);
  const nameLine = lines.find(line => /^name:/.test(line));
  const name = nameLine ? nameLine.slice('name:'.length).trim().replace(/^["']|["']$/g, '') : '';

  const startIndex = lines.findIndex(line => /^description:/.test(line));
  if (startIndex === -1) {
    return { raw: match[0], name, description: '' };
  }

  const inline = lines[startIndex].slice('description:'.length).trim();
  const blockScalar = /^([>|])([-+]?)$/.exec(inline);
  if (!blockScalar) {
    return { raw: match[0], name, description: inline.replace(/^["']|["']$/g, '') };
  }

  const isFolded = blockScalar[1] === '>';
  const body = [];
  for (let i = startIndex + 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (line.trim() === '') {
      body.push('');
      continue;
    }
    if (!/^\s/.test(line)) {
      break;
    }
    body.push(line.trim());
  }
  while (body.length > 0 && body[body.length - 1] === '') {
    body.pop();
  }

  let description = '';
  for (const line of body) {
    if (line === '') {
      description += '\n';
    } else if (description === '' || description.endsWith('\n')) {
      description += line;
    } else {
      description += isFolded ? ` ${line}` : `\n${line}`;
    }
  }

  return { raw: match[0], name, description: description.trim() };
}

/**
 * Collapse untrusted catalog text to one line: newlines, carriage returns,
 * and C0/C1 control bytes would otherwise let a description forge extra
 * Markdown table rows in the generated catalog skill.
 *
 * @param {string} text Text to flatten.
 * @returns {string} Single-line text.
 */
function flattenLine(text) {
  // eslint-disable-next-line no-control-regex
  return String(text || '').replace(/[\u0000-\u001F\u007F-\u009F]+/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * Estimate tokens with the default measurer (~4 chars per token).
 *
 * @param {string} text Text to measure.
 * @returns {number} Estimated tokens.
 */
function estimateTokens(text) {
  return DEFAULT_TOKEN_MEASURER.measure(text);
}

/**
 * True when a runtime path belongs to the hook runtime.
 *
 * @param {string} relPath POSIX repo-relative path.
 * @returns {boolean} Whether the path is hook runtime.
 */
function isHookRuntimePath(relPath) {
  return relPath === 'hooks' || relPath.startsWith('hooks/')
    || relPath === 'scripts/hooks' || relPath.startsWith('scripts/hooks/');
}

/**
 * Classify one install-module path into the plugin surface it feeds.
 */
function classifyModulePath(rawPath) {
  const relPath = toPosix(rawPath).replace(/\/+$/, '');
  if (relPath === 'skills' || relPath.startsWith('skills/')) {
    return { surface: 'skills', relPath };
  }
  if (relPath === 'agents' || relPath.startsWith('agents/')) {
    return { surface: 'agents', relPath };
  }
  if (relPath === 'commands' || relPath.startsWith('commands/')) {
    return { surface: 'commands', relPath };
  }
  if (relPath === 'hooks' || relPath.startsWith('hooks/') || relPath.startsWith('scripts/')) {
    return { surface: 'runtime', relPath };
  }
  return { surface: 'skipped', relPath };
}

function listChildDirectories(rootDir) {
  if (!fs.existsSync(rootDir)) {
    return [];
  }
  return fs.readdirSync(rootDir, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => entry.name)
    .sort();
}

function listMarkdownFiles(rootDir) {
  if (!fs.existsSync(rootDir)) {
    return [];
  }
  return fs.readdirSync(rootDir, { withFileTypes: true })
    .filter(entry => entry.isFile() && entry.name.endsWith('.md'))
    .map(entry => entry.name)
    .sort();
}

/**
 * Recursively list files under a directory as POSIX paths relative to it.
 *
 * @param {string} rootDir Directory to walk.
 * @returns {Array<string>} Sorted relative file paths.
 */
function listFilesRecursive(rootDir) {
  const files = [];
  const walk = dir => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const absPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(absPath);
      } else if (entry.isFile()) {
        files.push(toPosix(path.relative(rootDir, absPath)));
      }
    }
  };
  if (fs.existsSync(rootDir)) {
    walk(rootDir);
  }
  return files.sort();
}

/**
 * Find symlinks at or under an absolute path, without following them.
 *
 * fs.cpSync({recursive: true}) copies symlinks as symlinks (Node's default
 * dereference is false), and listFilesRecursive() above only counts
 * entry.isFile(), so a symlink is invisible to computeTreeDigest(). A
 * carrier that copies one can silently start serving whatever the link
 * currently resolves to, outside the receipted, content-addressed tree,
 * while its digest still reports "unmodified". Selected sources are
 * rejected outright when they contain one rather than trying to validate
 * where the link points — see docs/PLUGIN-PROFILES.md's self-containment
 * rule.
 *
 * @param {string} absPath Absolute file or directory to check.
 * @returns {Array<string>} Absolute paths of any symlinks found, at or
 *   under absPath. A symlinked directory is reported once and not
 *   descended into (its target is outside what generation controls).
 */
function findSymlinksUnder(absPath) {
  const found = [];
  let stat;
  try {
    stat = fs.lstatSync(absPath);
  } catch {
    return found;
  }
  if (stat.isSymbolicLink()) {
    found.push(absPath);
    return found;
  }
  if (stat.isDirectory()) {
    for (const entry of fs.readdirSync(absPath, { withFileTypes: true })) {
      const childPath = path.join(absPath, entry.name);
      if (entry.isSymbolicLink()) {
        found.push(childPath);
      } else if (entry.isDirectory()) {
        found.push(...findSymlinksUnder(childPath));
      }
    }
  }
  return found;
}

/**
 * Validate a `hooks` decision value.
 *
 * @param {unknown} value Candidate decision.
 * @returns {string|null} Normalized profile, or null when no decision given.
 */
function normalizeHookDecision(value) {
  if (value === undefined || value === null || value === '') {
    return null;
  }
  const normalized = String(value).trim().toLowerCase();
  if (!HOOK_PROFILES.includes(normalized)) {
    throw new Error(`Invalid hooks decision "${value}"; expected one of ${HOOK_PROFILES.join(', ')}`);
  }
  return normalized;
}

/**
 * Discover the scripts a set of shipped commands depend on, then resolve
 * their transitive require() closure.
 *
 * @param {Array<string>} commandFiles Command Markdown file names.
 * @param {string} repoRoot Absolute repository root.
 * @returns {{entries: Array<{command: string, script: string}>, files: Array<string>, data: Array<string>, unresolved: Array<object>, dynamic: Array<object>, warnings: Array<string>}}
 */
function resolveCommandRuntimeClosure(commandFiles, repoRoot) {
  const entries = [];
  const data = new Set();
  const warnings = [];
  const entryScripts = new Set();

  for (const commandFile of commandFiles) {
    const commandPath = path.join(repoRoot, 'commands', commandFile);
    let source;
    try {
      source = fs.readFileSync(commandPath, 'utf8');
    } catch {
      continue;
    }
    const references = new Set((source.match(COMMAND_SCRIPT_REFERENCE_PATTERN) || []).map(ref => ref.replace(/^\.\//, '')));
    for (const script of [...references].sort()) {
      if (fs.existsSync(path.join(repoRoot, ...script.split('/')))) {
        entries.push({ command: commandFile, script });
        entryScripts.add(script);
      } else {
        warnings.push(`Command ${commandFile}: references missing script ${script}`);
      }
    }
    for (const dataPath of COMMAND_RUNTIME_DATA[commandFile] || []) {
      if (fs.existsSync(path.join(repoRoot, ...dataPath.split('/')))) {
        data.add(dataPath);
      } else {
        warnings.push(`Command ${commandFile}: missing runtime data path ${dataPath}`);
      }
    }
  }

  const closure = resolveScriptClosure([...entryScripts].sort(), repoRoot);
  return {
    entries,
    files: closure.files,
    data: [...data].sort(),
    unresolved: closure.unresolved,
    dynamic: closure.dynamic,
    warnings,
  };
}

/**
 * Resolve an install selection into a concrete carrier plan.
 *
 * Options mirror resolveInstallPlan (profileId, moduleIds,
 * includeComponentIds, excludeComponentIds) plus:
 *
 * - `pluginName` — output directory name (validated).
 * - `hooks` — capability decision: `off`, `minimal`, `standard`, `strict`,
 *   or omitted. When omitted and the selection would materialize the hook
 *   runtime, the plan is returned with `hooks.decision === 'pending'` and
 *   the hook paths held back; generation refuses such a plan.
 * - `contextBudgetTokens` — declared listing budget (default 8000).
 */
function resolvePluginProfilePlan(options = {}) {
  const repoRoot = options.repoRoot || DEFAULT_REPO_ROOT;
  const hookDecision = normalizeHookDecision(options.hooks);
  const installPlan = resolveInstallPlan({
    repoRoot,
    profileId: options.profileId || null,
    moduleIds: options.moduleIds || [],
    includeComponentIds: options.includeComponentIds || [],
    excludeComponentIds: options.excludeComponentIds || [],
  });

  const defaultName = `ecc-${installPlan.profileId || 'custom'}`;
  const pluginName = options.pluginName || defaultName;
  if (!PLUGIN_NAME_PATTERN.test(pluginName)) {
    throw new Error(`Invalid plugin name "${pluginName}"; expected lowercase letters, digits, and hyphens`);
  }

  const skillDirs = new Set();
  const agentFiles = new Set();
  const commandFiles = new Set();
  const runtimePaths = new Set();
  const heldRuntimePaths = new Set();
  const skippedPaths = new Set();
  const warnings = [];

  const addRuntimePath = (relPath, moduleId) => {
    if (!fs.existsSync(path.join(repoRoot, ...relPath.split('/')))) {
      warnings.push(`Module ${moduleId}: missing runtime path ${relPath}`);
      return;
    }
    if (isHookRuntimePath(relPath)) {
      if (hookDecision === null || hookDecision === 'off') {
        heldRuntimePaths.add(relPath);
      } else {
        runtimePaths.add(relPath);
      }
      return;
    }
    runtimePaths.add(relPath);
  };

  for (const module of installPlan.selectedModules) {
    for (const rawPath of module.paths || []) {
      const { surface, relPath } = classifyModulePath(rawPath);

      if (surface === 'skipped') {
        skippedPaths.add(relPath);
        continue;
      }

      if (surface === 'runtime') {
        addRuntimePath(relPath, module.id);
        continue;
      }

      if (surface === 'skills') {
        if (relPath === 'skills') {
          listChildDirectories(path.join(repoRoot, 'skills')).forEach(name => skillDirs.add(name));
        } else {
          const skillId = relPath.slice('skills/'.length).split('/')[0];
          if (fs.existsSync(path.join(repoRoot, 'skills', skillId, 'SKILL.md'))) {
            skillDirs.add(skillId);
          } else {
            warnings.push(`Module ${module.id}: missing skill ${skillId}`);
          }
        }
        continue;
      }

      if (surface === 'agents') {
        if (relPath === 'agents') {
          listMarkdownFiles(path.join(repoRoot, 'agents')).forEach(name => agentFiles.add(name));
        } else {
          const fileName = relPath.slice('agents/'.length);
          if (fs.existsSync(path.join(repoRoot, 'agents', fileName))) {
            agentFiles.add(fileName);
          } else {
            warnings.push(`Module ${module.id}: missing agent ${fileName}`);
          }
        }
        continue;
      }

      if (relPath === 'commands') {
        listMarkdownFiles(path.join(repoRoot, 'commands')).forEach(name => commandFiles.add(name));
      } else {
        const fileName = relPath.slice('commands/'.length);
        if (fs.existsSync(path.join(repoRoot, 'commands', fileName))) {
          commandFiles.add(fileName);
        } else {
          warnings.push(`Module ${module.id}: missing command ${fileName}`);
        }
      }
    }
  }

  // Ship the backing code for every command so a carrier never carries a
  // slash command it cannot run. Runtime paths cost zero session context.
  const closure = resolveCommandRuntimeClosure([...commandFiles].sort(), repoRoot);
  warnings.push(...closure.warnings);

  // Directories copied wholesale (hooks-runtime's scripts/lib, scripts/hooks)
  // contain scripts with their own requires; those must resolve inside the
  // carrier too, or the staged verification rightly refuses it.
  const wholesaleEntries = [];
  for (const runtimePath of runtimePaths) {
    const absPath = path.join(repoRoot, ...runtimePath.split('/'));
    if (fs.statSync(absPath).isDirectory()) {
      for (const relFile of listFilesRecursive(absPath)) {
        if (relFile.endsWith('.js')) {
          wholesaleEntries.push(`${runtimePath}/${relFile}`);
        }
      }
    }
  }
  if (wholesaleEntries.length > 0) {
    const wholesale = resolveScriptClosure(wholesaleEntries, repoRoot);
    closure.files = [...new Set([...closure.files, ...wholesale.files])].sort();
    closure.unresolved.push(...wholesale.unresolved);
    closure.dynamic.push(...wholesale.dynamic);
  }

  const hooksIncluded = hookDecision !== null && hookDecision !== 'off';
  for (const depPath of [...closure.files, ...closure.data]) {
    const covered = [...runtimePaths].some(
      existing => existing === depPath || depPath.startsWith(`${existing}/`)
    );
    if (covered) {
      continue;
    }
    if (isHookRuntimePath(depPath) && !hooksIncluded) {
      // A command script reaching into the hook runtime does not authorize
      // the hook runtime; the file is copied as plain code, but the hooks
      // manifest itself is never carried without a decision.
      if (depPath === 'hooks/hooks.json') {
        heldRuntimePaths.add(depPath);
        continue;
      }
    }
    runtimePaths.add(depPath);
  }

  const rootPackage = readJson(path.join(repoRoot, 'package.json'), 'package.json');

  let decision;
  if (hookDecision === null) {
    decision = heldRuntimePaths.size > 0 ? 'pending' : 'off';
  } else if (hookDecision === 'off') {
    decision = 'off';
  } else {
    decision = 'enabled';
  }

  return {
    repoRoot,
    pluginName,
    profileId: installPlan.profileId,
    version: rootPackage.version,
    profileInput: {
      profileId: options.profileId || null,
      moduleIds: [...(options.moduleIds || [])],
      includeComponentIds: [...(options.includeComponentIds || [])],
      excludeComponentIds: [...(options.excludeComponentIds || [])],
    },
    selectedModuleIds: installPlan.selectedModuleIds,
    skills: [...skillDirs].sort(),
    agents: [...agentFiles].sort(),
    commands: [...commandFiles].sort(),
    runtimePaths: [...runtimePaths].sort(),
    heldRuntimePaths: [...heldRuntimePaths].sort(),
    skippedPaths: [...skippedPaths].sort(),
    hooks: {
      decision,
      profile: decision === 'enabled' ? hookDecision : null,
      groups: decision === 'enabled' ? HOOK_CAPABILITY_GROUPS.map(group => group.id) : [],
    },
    closure: {
      entries: closure.entries,
      files: closure.files,
      unresolved: closure.unresolved,
      dynamic: closure.dynamic,
    },
    contextBudgetTokens: Number.isFinite(options.contextBudgetTokens)
      ? options.contextBudgetTokens
      : DEFAULT_CONTEXT_BUDGET_TOKENS,
    warnings,
  };
}

/**
 * Build the human-readable refusal for a plan whose hook decision is pending.
 *
 * @returns {string} Disclosure text reused from the installer consent gate.
 */
function buildHookDecisionMessage() {
  return 'This selection would carry ECC\'s automatic hook runtime, which can:\n'
    + `${formatHookCapabilityDisclosure()}\n`
    + 'A context profile does not authorize lifecycle automation. Pass '
    + '--hooks <minimal|standard|strict> to carry the hook runtime at that '
    + 'profile, or --hooks off (alias --no-hooks) to generate the carrier without it.';
}

/**
 * The frontmatter written for the generated catalog skill.
 *
 * @returns {{name: string, description: string}} Frontmatter fields.
 */
function catalogSkillFrontmatter() {
  return {
    name: CATALOG_SKILL_ID,
    description: 'Index of the full ECC skill catalog carried by this slim profile plugin. '
      + 'Use when a task needs an ECC skill that is not installed in this profile: find it in the table, '
      + 'then read its SKILL.md from the listed path inside this plugin.',
  };
}

/**
 * Enumerate the listing entries Claude Code loads for a plan: one
 * {surface, id, name, description} per installed skill, agent, and command.
 *
 * @param {object} plan Resolved plan.
 * @param {boolean} includeCatalogSkill Whether the catalog skill is emitted.
 * @returns {Array<{surface: string, id: string, name: string, description: string}>}
 */
function buildListingEntries(plan, includeCatalogSkill = true) {
  const { repoRoot } = plan;
  const entries = [];
  const push = (surface, id, filePath) => {
    if (!fs.existsSync(filePath)) {
      return;
    }
    const { name, description } = parseFrontmatter(fs.readFileSync(filePath, 'utf8'));
    entries.push({ surface, id, name: name || id, description });
  };

  for (const skillId of plan.skills) {
    push('skill', skillId, path.join(repoRoot, 'skills', skillId, 'SKILL.md'));
  }
  if (includeCatalogSkill) {
    const { name, description } = catalogSkillFrontmatter();
    entries.push({ surface: 'skill', id: CATALOG_SKILL_ID, name, description });
  }
  for (const agentFile of plan.agents) {
    push('agent', agentFile.replace(/\.md$/, ''), path.join(repoRoot, 'agents', agentFile));
  }
  for (const commandFile of plan.commands) {
    push('command', commandFile.replace(/\.md$/, ''), path.join(repoRoot, 'commands', commandFile));
  }
  return entries;
}

/**
 * Render listing entries in the shape the harness lists them.
 *
 * @param {Array<object>} entries Listing entries.
 * @returns {string} Payload text.
 */
function buildListingPayload(entries) {
  return entries.map(entry => `${entry.name}: ${flattenLine(entry.description)}`).join('\n');
}

/**
 * Measure the per-session listing cost of a plan against its budget.
 *
 * @param {object} plan Resolved plan.
 * @param {object} [options] Measurement options.
 * @param {boolean} [options.includeCatalogSkill=true] Count the catalog skill.
 * @param {{method: string, version: string, measure: Function}} [options.measurer] Token measurer.
 * @param {number} [options.budget] Budget override (default: plan.contextBudgetTokens).
 * @returns {object} Ledger.
 */
function measureContextLedger(plan, options = {}) {
  const measurer = options.measurer || DEFAULT_TOKEN_MEASURER;
  const includeCatalogSkill = options.includeCatalogSkill !== false;
  const entries = buildListingEntries(plan, includeCatalogSkill);
  const payload = buildListingPayload(entries);
  const budget = Number.isFinite(options.budget) ? options.budget : plan.contextBudgetTokens;
  const tokens = measurer.measure(payload);

  return {
    method: measurer.method,
    methodVersion: measurer.version,
    payloadFormat: LISTING_PAYLOAD_FORMAT,
    entries: {
      skills: entries.filter(entry => entry.surface === 'skill').length,
      agents: entries.filter(entry => entry.surface === 'agent').length,
      commands: entries.filter(entry => entry.surface === 'command').length,
    },
    chars: payload.length,
    tokens,
    budget,
    withinBudget: tokens <= budget,
    measuredAt: new Date().toISOString(),
  };
}

/**
 * Estimated listing tokens for a plan (default measurer, catalog included).
 *
 * @param {object} plan Resolved plan.
 * @returns {number} Estimated tokens.
 */
function estimatePlanCatalogTokens(plan) {
  return measureContextLedger(plan).tokens;
}

/**
 * Read {id, name, description, sha256} for every skill in the source catalog.
 *
 * @param {string} repoRoot Absolute repository root.
 * @returns {Array<{id: string, name: string, description: string, sha256: string}>}
 */
function readCatalogEntries(repoRoot) {
  const entries = [];
  for (const skillId of listChildDirectories(path.join(repoRoot, 'skills'))) {
    const skillPath = path.join(repoRoot, 'skills', skillId, 'SKILL.md');
    if (!fs.existsSync(skillPath)) {
      continue;
    }
    const source = fs.readFileSync(skillPath);
    const { name, description } = parseFrontmatter(source.toString('utf8'));
    entries.push({ id: skillId, name: name || skillId, description, sha256: sha256(source) });
  }
  return entries;
}

/**
 * Digest of the exact context surface: every installed skill, agent, and
 * command with the hash of its file.
 *
 * @param {object} plan Resolved plan.
 * @returns {string} sha256 hex digest.
 */
function computeContextDigest(plan) {
  const { repoRoot } = plan;
  const lines = [];
  for (const skillId of plan.skills) {
    lines.push(`skill:${skillId}:${sha256(fs.readFileSync(path.join(repoRoot, 'skills', skillId, 'SKILL.md')))}`);
  }
  for (const agentFile of plan.agents) {
    lines.push(`agent:${agentFile}:${sha256(fs.readFileSync(path.join(repoRoot, 'agents', agentFile)))}`);
  }
  for (const commandFile of plan.commands) {
    lines.push(`command:${commandFile}:${sha256(fs.readFileSync(path.join(repoRoot, 'commands', commandFile)))}`);
  }
  return sha256(lines.sort().join('\n'));
}

/**
 * Digest of a generated tree: every file path and content hash, excluding
 * the receipt itself so the receipt can carry the digest.
 *
 * @param {string} pluginRoot Directory to digest.
 * @returns {string} sha256 hex digest.
 */
function computeTreeDigest(pluginRoot) {
  const lines = [];
  for (const relPath of listFilesRecursive(pluginRoot)) {
    if (relPath === PROFILE_METADATA_FILE) {
      continue;
    }
    lines.push(`${relPath}:${sha256(fs.readFileSync(path.join(pluginRoot, ...relPath.split('/'))))}`);
  }
  return sha256(lines.join('\n'));
}

/**
 * Write the `ecc-catalog` skill into a carrier. Rows point at content
 * inside the carrier only; no source-tree path is written.
 *
 * @param {object} plan Resolved plan.
 * @param {string} pluginRoot Destination plugin directory.
 * @param {Array<object>} catalogRows Catalog rows with carrier-relative paths.
 * @returns {number} Number of rows written.
 */
function writeCatalogSkill(plan, pluginRoot, catalogRows) {
  const rows = catalogRows.map(row => {
    const description = flattenLine(row.description);
    const summary = description.length > 140 ? `${description.slice(0, 137)}...` : description;
    return `| ${row.id} | ${row.installed ? 'installed' : 'on demand'} | ${summary.replace(/\|/g, '\\|')} | \`${row.path}\` |`;
  });

  const { name, description } = catalogSkillFrontmatter();
  const body = [
    '---',
    `name: ${name}`,
    `description: ${description}`,
    '---',
    '',
    '# ECC Skill Catalog',
    '',
    `This plugin is a slim ECC profile carrier (\`${plan.profileId || 'custom'}\`, ecc@${plan.version}).`,
    'Installed skills are listed by Claude Code as usual. Skills marked "on demand"',
    `are copies carried inside this plugin under \`${ON_DEMAND_DIR}/\`; each path below is`,
    'relative to this plugin\'s root (`${CLAUDE_PLUGIN_ROOT}`). Read the file when the',
    'task needs that skill. Nothing outside this plugin is referenced.',
    '',
    '| Skill | Status | Description | Path |',
    '|---|---|---|---|',
    ...rows,
    '',
  ].join('\n');

  const catalogDir = path.join(pluginRoot, 'skills', CATALOG_SKILL_ID);
  fs.mkdirSync(catalogDir, { recursive: true });
  fs.writeFileSync(path.join(catalogDir, 'SKILL.md'), body);
  return rows.length;
}

/**
 * Build the `.claude-plugin/plugin.json` document for a generated plugin.
 */
function buildPluginManifest(plan, { hasSkills, hasCommands }) {
  const rootPluginPath = path.join(plan.repoRoot, '.claude-plugin', 'plugin.json');
  const rootPlugin = fs.existsSync(rootPluginPath)
    ? readJson(rootPluginPath, '.claude-plugin/plugin.json')
    : {};

  // Claude Code's plugin validator rejects `agents` and v2.1+ auto-loads
  // hooks/hooks.json, so neither field may appear here (see
  // tests/plugin-manifest.test.js). mcpServers stays explicitly empty so a
  // root .mcp.json copy is never auto-bundled.
  return {
    name: plan.pluginName,
    version: plan.version,
    description: `ECC profile plugin "${plan.profileId || 'custom'}" generated from ecc@${plan.version} - `
      + `${plan.skills.length} skills, ${plan.agents.length} agents, ${plan.commands.length} commands. `
      + 'The full skill catalog stays available on demand via the ecc-catalog skill.',
    author: rootPlugin.author,
    homepage: rootPlugin.homepage,
    repository: rootPlugin.repository,
    ...(rootPlugin.license ? { license: rootPlugin.license } : {}),
    mcpServers: {},
    ...(hasSkills ? { skills: ['./skills/'] } : {}),
    ...(hasCommands ? { commands: ['./commands/'] } : {}),
  };
}

/**
 * Read a carrier's receipt, or null when absent or unparseable.
 *
 * @param {string} pluginRoot Plugin directory.
 * @returns {object|null} Parsed receipt.
 */
function readProfileReceipt(pluginRoot) {
  try {
    const receipt = JSON.parse(fs.readFileSync(path.join(pluginRoot, PROFILE_METADATA_FILE), 'utf8'));
    return receipt && typeof receipt === 'object' ? receipt : null;
  } catch {
    return null;
  }
}

/**
 * True when a directory is output this generator previously wrote and has
 * not been modified since: the receipt must name this generator AND its
 * recorded tree digest must match the directory's current contents. A
 * copied-in marker file alone does not make a directory replaceable.
 *
 * @param {string} pluginRoot Candidate plugin directory.
 * @returns {boolean} Whether the directory is safe to replace.
 */
function isGeneratedProfilePlugin(pluginRoot) {
  const receipt = readProfileReceipt(pluginRoot);
  if (!receipt || receipt.generatedFrom !== PROFILE_GENERATOR_ID || typeof receipt.treeDigest !== 'string') {
    return false;
  }
  try {
    return computeTreeDigest(pluginRoot) === receipt.treeDigest;
  } catch {
    return false;
  }
}

/**
 * Resolve and bound the output location for a plan.
 *
 * @param {object} plan Resolved plan.
 * @param {string} outRoot Marketplace root.
 * @returns {{outRoot: string, pluginRoot: string}} Absolute paths.
 */
function resolveOutputPaths(plan, outRoot) {
  if (!plan || typeof plan.pluginName !== 'string' || !PLUGIN_NAME_PATTERN.test(plan.pluginName)) {
    throw new Error(`Invalid plugin name "${plan && plan.pluginName}"; expected lowercase letters, digits, and hyphens`);
  }
  if (!outRoot) {
    throw new Error('generateProfilePlugin requires outRoot');
  }
  const resolvedOut = path.resolve(outRoot);
  const pluginRoot = path.resolve(resolvedOut, plan.pluginName);
  if (!pluginRoot.startsWith(resolvedOut + path.sep)) {
    throw new Error(`Refusing to write outside ${resolvedOut}: ${pluginRoot}`);
  }
  return { outRoot: resolvedOut, pluginRoot };
}

/**
 * Enumerate every copy operation a plan implies, as {source, destination}
 * pairs relative to repoRoot and the plugin root. Shared by generation and
 * dry-run preview so the preview is exact.
 *
 * @param {object} plan Resolved plan.
 * @param {object} options Options.
 * @param {boolean} options.includeCatalogSkill Copy on-demand skills.
 * @param {Array<object>} options.catalogEntries Full catalog.
 * @returns {Array<{source: string, destination: string}>} Copy operations.
 */
function collectCopyOperations(plan, { includeCatalogSkill, catalogEntries }) {
  const operations = [];
  const installed = new Set(plan.skills);
  for (const skillId of plan.skills) {
    operations.push({ source: `skills/${skillId}`, destination: `skills/${skillId}` });
  }
  for (const agentFile of plan.agents) {
    operations.push({ source: `agents/${agentFile}`, destination: `agents/${agentFile}` });
  }
  for (const commandFile of plan.commands) {
    operations.push({ source: `commands/${commandFile}`, destination: `commands/${commandFile}` });
  }
  for (const runtimePath of plan.runtimePaths) {
    operations.push({ source: runtimePath, destination: runtimePath });
  }
  if (includeCatalogSkill) {
    for (const entry of catalogEntries) {
      if (!installed.has(entry.id)) {
        operations.push({ source: `skills/${entry.id}`, destination: `${ON_DEMAND_DIR}/${entry.id}` });
      }
    }
  }
  return operations;
}

/**
 * Verify a staged tree is internally resolvable: every relative require in
 * every copied script must resolve inside the staged tree. This is the
 * fail-closed check that catches a command whose dependency closure was
 * incomplete before anything is swapped into place.
 *
 * @param {string} stagedRoot Staged plugin directory.
 * @returns {Array<{from: string, specifier: string}>} Unresolved requires.
 */
function verifyStagedRuntime(stagedRoot) {
  const unresolved = [];
  for (const relPath of listFilesRecursive(stagedRoot)) {
    if (!relPath.endsWith('.js')) {
      continue;
    }
    const absPath = path.join(stagedRoot, ...relPath.split('/'));
    const { specifiers } = extractRequireSpecifiers(fs.readFileSync(absPath, 'utf8'));
    for (const specifier of specifiers) {
      const target = path.resolve(path.dirname(absPath), specifier);
      if (!target.startsWith(path.resolve(stagedRoot) + path.sep) || !resolveModuleCandidate(target)) {
        unresolved.push({ from: relPath, specifier });
      }
    }
  }
  return unresolved;
}

/**
 * Describe what `generate` would do without writing anything.
 *
 * @param {object} options Same options as generateProfilePlugin.
 * @returns {object} Preview: paths, operations, deletion, ledger, blockers.
 */
function previewProfilePlugin(options = {}) {
  const { plan } = options;
  const { outRoot, pluginRoot } = resolveOutputPaths(plan, options.outRoot);
  const includeCatalogSkill = options.includeCatalogSkill !== false;
  const catalogEntries = includeCatalogSkill ? readCatalogEntries(plan.repoRoot) : [];
  const operations = collectCopyOperations(plan, { includeCatalogSkill, catalogEntries });
  const symlinkPaths = operations
    .flatMap(operation => findSymlinksUnder(path.join(plan.repoRoot, ...operation.source.split('/'))))
    .sort();
  const ledger = measureContextLedger(plan, { includeCatalogSkill, measurer: options.measurer, budget: options.budget });
  const existing = fs.existsSync(pluginRoot);
  const existingReceipt = existing ? readProfileReceipt(pluginRoot) : null;
  const existingIsGenerated = existing && isGeneratedProfilePlugin(pluginRoot);

  const blockers = [];
  if (plan.hooks.decision === 'pending') {
    blockers.push(buildHookDecisionMessage());
  }
  if (plan.closure.unresolved.length > 0) {
    blockers.push('Unresolved runtime dependencies:\n'
      + plan.closure.unresolved.map(item => `  ${item.from} -> ${item.specifier}`).join('\n'));
  }
  if (symlinkPaths.length > 0) {
    blockers.push('Selected sources contain symlinks, which a generated carrier cannot own '
      + '(the tree digest that proves a carrier is unmodified does not see through them, '
      + 'so a link can be repointed after generation without detection):\n'
      + symlinkPaths.map(absPath => `  ${toPosix(path.relative(plan.repoRoot, absPath))}`).join('\n'));
  }
  if (!ledger.withinBudget && !options.allowOverBudget) {
    blockers.push(`Context ledger ${ledger.tokens} tokens exceeds the declared budget of ${ledger.budget} `
      + `(${ledger.method}@${ledger.methodVersion}). Narrow the selection, raise --budget, or pass --allow-over-budget.`);
  }
  if (existing && !existingIsGenerated && !options.force) {
    blockers.push(`Refusing to overwrite ${pluginRoot}: it is not an unmodified generated profile plugin `
      + `(${PROFILE_METADATA_FILE} missing, foreign, or its tree digest no longer matches). `
      + 'Choose another --name/--out, or pass --force to replace it.');
  }

  return {
    outRoot,
    pluginRoot,
    operations,
    generatedFiles: [
      `.claude-plugin/plugin.json`,
      PROFILE_METADATA_FILE,
      ...(includeCatalogSkill ? [`skills/${CATALOG_SKILL_ID}/SKILL.md`] : []),
      ...(plan.hooks.decision === 'enabled' ? ['ecc/setup.json'] : []),
    ],
    willReplace: existing,
    existingIsGenerated,
    existingReceipt: existingReceipt
      ? { treeDigest: existingReceipt.treeDigest || null, createdAt: existingReceipt.createdAt || null }
      : null,
    ledger,
    blockers,
  };
}

/**
 * Materialize a resolved plan as a plugin directory under outRoot.
 *
 * The tree is built in a staging directory beside the target, verified, and
 * swapped in atomically; an existing target is kept until the swap
 * succeeds. Refuses when the hook decision is pending, when the runtime
 * closure is unresolved, when the ledger exceeds its budget (unless
 * allowOverBudget), or when the target is not an unmodified generated
 * plugin (unless force).
 *
 * @param {object} options Generation options.
 * @param {object} options.plan Resolved plan from resolvePluginProfilePlan().
 * @param {string} options.outRoot Marketplace root to write into.
 * @param {boolean} [options.includeCatalogSkill=true] Emit the catalog skill and on-demand copies.
 * @param {boolean} [options.force=false] Replace a non-generated directory.
 * @param {boolean} [options.allowOverBudget=false] Proceed past the budget gate.
 * @param {boolean} [options.keepPrevious=false] Keep the replaced tree beside the target.
 * @param {object} [options.measurer] Token measurer override.
 * @param {number} [options.budget] Budget override.
 * @returns {object} Generation result including pluginRoot, receipt, and ledger.
 */
function generateProfilePlugin(options = {}) {
  const { plan } = options;
  if (!plan || !plan.pluginName) {
    throw new Error('generateProfilePlugin requires a resolved plan');
  }
  const preview = previewProfilePlugin(options);
  if (preview.blockers.length > 0) {
    throw new Error(preview.blockers.join('\n\n'));
  }

  const { outRoot, pluginRoot } = preview;
  const includeCatalogSkill = options.includeCatalogSkill !== false;
  const { repoRoot } = plan;
  const catalogEntries = includeCatalogSkill ? readCatalogEntries(repoRoot) : [];
  const stagingRoot = path.join(outRoot, `.staging-${plan.pluginName}-${process.pid}`);
  const previousRoot = path.join(outRoot, `.prev-${plan.pluginName}-${process.pid}`);
  const previousReceipt = preview.existingReceipt;

  fs.rmSync(stagingRoot, { recursive: true, force: true });
  fs.mkdirSync(stagingRoot, { recursive: true });

  let swapped = false;
  try {
    for (const operation of preview.operations) {
      fs.cpSync(
        path.join(repoRoot, ...operation.source.split('/')),
        path.join(stagingRoot, ...operation.destination.split('/')),
        { recursive: true }
      );
    }

    const installed = new Set(plan.skills);
    const catalogRows = catalogEntries.map(entry => ({
      id: entry.id,
      installed: installed.has(entry.id),
      description: entry.description,
      sha256: entry.sha256,
      path: installed.has(entry.id) ? `skills/${entry.id}/SKILL.md` : `${ON_DEMAND_DIR}/${entry.id}/SKILL.md`,
    }));
    const catalogSkillCount = includeCatalogSkill ? writeCatalogSkill(plan, stagingRoot, catalogRows) : 0;

    const manifest = buildPluginManifest(plan, {
      hasSkills: plan.skills.length > 0 || includeCatalogSkill,
      hasCommands: plan.commands.length > 0,
    });
    fs.mkdirSync(path.join(stagingRoot, '.claude-plugin'), { recursive: true });
    fs.writeFileSync(path.join(stagingRoot, '.claude-plugin', 'plugin.json'), `${JSON.stringify(manifest, null, 2)}\n`);

    if (plan.hooks.decision === 'enabled') {
      // Pin the hook profile inside the carrier through the managed-config
      // fallback hook-flags.js already honours (env and plugin options still
      // take precedence, in that order).
      fs.mkdirSync(path.join(stagingRoot, 'ecc'), { recursive: true });
      fs.writeFileSync(
        path.join(stagingRoot, 'ecc', 'setup.json'),
        `${JSON.stringify({ hooks: { enabled: true, profile: plan.hooks.profile } }, null, 2)}\n`
      );
    }

    const unresolved = verifyStagedRuntime(stagingRoot);
    if (unresolved.length > 0) {
      throw new Error('Staged carrier failed runtime verification; unresolved requires:\n'
        + unresolved.map(item => `  ${item.from} -> ${item.specifier}`).join('\n'));
    }

    const ledger = preview.ledger;
    const receipt = {
      schemaVersion: RECEIPT_SCHEMA_VERSION,
      generatedFrom: PROFILE_GENERATOR_ID,
      generatorVersion: plan.version,
      eccVersion: plan.version,
      createdAt: new Date().toISOString(),
      pluginName: plan.pluginName,
      profileId: plan.profileId,
      version: plan.version,
      profileInput: plan.profileInput,
      selectedModuleIds: plan.selectedModuleIds,
      context: {
        skills: plan.skills,
        agents: plan.agents,
        commands: plan.commands,
        digest: computeContextDigest(plan),
      },
      capabilities: { hooks: plan.hooks },
      runtime: {
        paths: plan.runtimePaths,
        held: plan.heldRuntimePaths,
        closureEntries: plan.closure.entries,
        dynamicRequires: plan.closure.dynamic,
      },
      tokenLedger: ledger,
      catalog: catalogRows,
      treeDigest: null,
      previous: previousReceipt,
    };
    receipt.treeDigest = computeTreeDigest(stagingRoot);
    fs.writeFileSync(path.join(stagingRoot, PROFILE_METADATA_FILE), `${JSON.stringify(receipt, null, 2)}\n`);

    // Atomic swap: park the existing target, move staging in, then discard
    // the parked tree. If the move fails the parked tree is restored.
    fs.rmSync(previousRoot, { recursive: true, force: true });
    if (fs.existsSync(pluginRoot)) {
      fs.renameSync(pluginRoot, previousRoot);
    }
    try {
      fs.renameSync(stagingRoot, pluginRoot);
      swapped = true;
    } catch (error) {
      if (fs.existsSync(previousRoot) && !fs.existsSync(pluginRoot)) {
        fs.renameSync(previousRoot, pluginRoot);
      }
      throw error;
    }
    if (!options.keepPrevious) {
      fs.rmSync(previousRoot, { recursive: true, force: true });
    }

    return {
      pluginRoot,
      previousRoot: options.keepPrevious && fs.existsSync(previousRoot) ? previousRoot : null,
      manifest,
      receipt,
      ledger,
      catalogSkillCount,
      estimatedCatalogTokens: ledger.tokens,
      counts: {
        skills: plan.skills.length + (includeCatalogSkill ? 1 : 0),
        agents: plan.agents.length,
        commands: plan.commands.length,
        runtimePaths: plan.runtimePaths.length,
        onDemandSkills: catalogRows.filter(row => !row.installed).length,
      },
    };
  } finally {
    if (!swapped) {
      fs.rmSync(stagingRoot, { recursive: true, force: true });
    }
  }
}

/**
 * Scan outRoot for generated plugin directories and (re)write the local
 * marketplace manifest. Staging and parked directories are dot-prefixed
 * and never listed.
 */
function writeMarketplaceManifest(options = {}) {
  const outRoot = options.outRoot;
  if (!outRoot) {
    throw new Error('writeMarketplaceManifest requires outRoot');
  }
  const marketplaceName = options.marketplaceName || DEFAULT_MARKETPLACE_NAME;

  const plugins = [];
  for (const dirName of listChildDirectories(outRoot)) {
    if (dirName.startsWith('.')) {
      continue;
    }
    const manifestPath = path.join(outRoot, dirName, '.claude-plugin', 'plugin.json');
    if (!fs.existsSync(manifestPath)) {
      continue;
    }
    const manifest = readJson(manifestPath, `${dirName}/.claude-plugin/plugin.json`);
    plugins.push({
      name: manifest.name,
      source: `./${dirName}`,
      description: manifest.description,
      version: manifest.version,
      ...(manifest.license ? { license: manifest.license } : {}),
      category: 'workflow',
    });
  }

  const marketplace = {
    name: marketplaceName,
    owner: { name: 'Generated locally by ecc plugin-profiles' },
    metadata: {
      description: 'Generated ECC profile plugins - slim per-project alternatives to the full ecc plugin',
    },
    plugins,
  };

  const manifestDir = path.join(outRoot, '.claude-plugin');
  fs.mkdirSync(manifestDir, { recursive: true });
  const manifestPath = path.join(manifestDir, 'marketplace.json');
  fs.writeFileSync(manifestPath, `${JSON.stringify(marketplace, null, 2)}\n`);

  return { manifestPath, marketplace };
}

module.exports = {
  CATALOG_SKILL_ID,
  ON_DEMAND_DIR,
  DEFAULT_MARKETPLACE_NAME,
  PROFILE_METADATA_FILE,
  PROFILE_GENERATOR_ID,
  RECEIPT_SCHEMA_VERSION,
  HOOK_PROFILES,
  DEFAULT_CONTEXT_BUDGET_TOKENS,
  DEFAULT_TOKEN_MEASURER,
  LISTING_PAYLOAD_FORMAT,
  COMMAND_RUNTIME_DATA,
  extractRequireSpecifiers,
  resolveScriptClosure,
  resolveCommandRuntimeClosure,
  isGeneratedProfilePlugin,
  readProfileReceipt,
  classifyModulePath,
  parseFrontmatter,
  flattenLine,
  estimateTokens,
  buildListingEntries,
  buildListingPayload,
  measureContextLedger,
  estimatePlanCatalogTokens,
  computeContextDigest,
  computeTreeDigest,
  buildHookDecisionMessage,
  resolvePluginProfilePlan,
  previewProfilePlugin,
  generateProfilePlugin,
  verifyStagedRuntime,
  writeMarketplaceManifest,
};
