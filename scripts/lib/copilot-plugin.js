'use strict';

// Experimental distribution layer only. All component transforms and runtime
// dependencies come from the existing Copilot project installation plan.
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { createManifestInstallPlan, applyInstallPlan } = require('./install-executor');
const { withHookConsent } = require('./install/hook-consent');
const { SCRIPT_BOUNDARY_SOURCE } = require('./install/opencode-script-boundary');
const { isPluginEntrypoint } = require('./copilot-plugin-runtime');
const SCHEMA = 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json';
const ROOT = path.resolve(__dirname, '../..');
const MAX_BYTES = 64 * 1024 * 1024;
const MAX_FILES = 10000;
const ARTIFACT_SCHEMA = 'ecc.copilot.plugin-artifact.v1';
const PROJECT_MARKERS = ['.github/ecc-install-state.json', '.github/hooks/ecc.json'];
const PROJECT_ONLY_HOOKS = new Set(['scripts/hooks/copilot-canvas.js', 'scripts/hooks/copilot-evidence.js',
  'scripts/hooks/copilot-native-telemetry.js']);
function exists(file) {
  try { fs.lstatSync(file); return true; }
  catch (error) { if (error.code === 'ENOENT') return false; throw error; }
}
function inside(root, file) {
  const relative = path.relative(root, file);
  return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}
function noProjectInstall(projectRoot) {
  if (!projectRoot) return;
  for (const relative of PROJECT_MARKERS) {
    try { fs.lstatSync(path.join(projectRoot, relative)); }
    catch (error) { if (error.code === 'ENOENT') continue; throw error; }
    throw new Error('Plugin/project installer coexistence requires explicit migration; existing installation preserved.');
  }
}
function relocateSkill(content) {
  if (!content.includes('.github/ecc/')) return content;
  const projected = content
    .replace(/(["'])\.github\/ecc\/([A-Za-z0-9._/-]+)\1/g, '"<ECC_PLUGIN_ROOT>/$2"')
    .replace(/\.github\/ecc\/([A-Za-z0-9._/-]+)/g, '"<ECC_PLUGIN_ROOT>/$1"')
    .replaceAll('.github/ecc/', '<ECC_PLUGIN_ROOT>/');
  const note = '\n## Bundled Copilot runtime location\n\nResolve `<ECC_PLUGIN_ROOT>` from this skill file\'s actual source path by removing the trailing `skills/NAME/SKILL.md` components. Replace that placeholder with the verified absolute plugin directory before executing a bundled helper, preserving the surrounding quotes. Keep the working directory at the user\'s project. The placeholder is not an environment variable and the project directory cannot choose the runtime root. Do not substitute a project-local helper or a Claude installation when the bundled file is unavailable.\n';
  return projected.replace(/^(---\r?\n[\s\S]*?\r?\n---\r?\n)/, `$1${note}\n`);
}
function destination(relative) {
  if (relative.startsWith('.github/skills/')) return relative.slice('.github/'.length);
  if (relative.startsWith('.github/agents/')) return 'com.github.copilot/agents/'
    + relative.slice('.github/agents/'.length).replace(/(?<!\.agent)\.md$/i, '.agent.md');
  if (relative.startsWith('.github/instructions/ecc/')) return 'com.github.copilot/rules/' + relative.slice('.github/instructions/ecc/'.length);
  if (relative.startsWith('.github/ecc/')) return relative.slice('.github/ecc/'.length);
  if (relative === '.github/hooks/ecc.json') return 'com.github.copilot/hooks/hooks.json';
  throw new Error('Unexpected project installation destination.');
}
function preparedHooks(content) {
  const original = JSON.parse(content);
  const hooks = Object.fromEntries(Object.entries(original.hooks).flatMap(([event, entries]) => {
    const projected = entries.flatMap(entry => {
      if (entry.exec !== 'node' || !Array.isArray(entry.args) || typeof entry.args[0] !== 'string'
        || !entry.args[0].startsWith('.github/ecc/scripts/')) throw new Error('Unsupported hook entry cannot be packaged.');
      const script = entry.args[0].slice('.github/ecc/'.length);
      if (PROJECT_ONLY_HOOKS.has(script)) return [];
      if (!isPluginEntrypoint(script)) throw new Error('Unreviewed plugin hook entrypoint.');
      return [{ ...entry, args: ['${COPILOT_PLUGIN_ROOT}/scripts/copilot-plugin-hook.js', script, ...entry.args.slice(1)] }];
    });
    return projected.length ? [[event, projected]] : [];
  }));
  // Root expansion and model-session behavior have not been natively measured.
  // Local install/discovery alone cannot authorize activation of these hooks.
  return Buffer.from(JSON.stringify({ version: 1, disableAllHooks: true, hooks }, null, 2) + '\n');
}
function safeRelative(relative) {
  return typeof relative === 'string' && !/[\\:]/.test(relative)
    && !Array.from(relative).some(character => character.charCodeAt(0) < 32)
    && relative.split('/').every(segment => segment && segment !== '.' && segment !== '..');
}
function put(root, relative, bytes, records) {
  if (!safeRelative(relative)) throw new Error('Unsafe artifact path.');
  const target = path.join(root, relative);
  const digest = crypto.createHash('sha256').update(bytes).digest('hex');
  if (records.has(relative)) {
    if (records.get(relative).sha256 !== digest) throw new Error('Conflicting generated artifact files.');
    return;
  }
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, bytes, { flag: 'wx', mode: 0o644 });
  records.set(relative, { path: relative, sha256: digest, bytes: bytes.length });
  if (records.size > MAX_FILES || [...records.values()].reduce((sum, row) => sum + row.bytes, 0) > MAX_BYTES) {
    throw new Error('Artifact quota exceeded.');
  }
}
function outputPath(value, sourceRoot) {
  if (typeof value !== 'string' || !path.isAbsolute(value)) throw new Error('Output must be an absolute new directory.');
  const output = path.resolve(value);
  if (inside(sourceRoot, output)) throw new Error('Output must be outside the source checkout.');
  if (exists(output)) throw new Error('Artifact output already exists.');
  let ancestor = path.dirname(output);
  while (!fs.existsSync(ancestor) && ancestor !== path.dirname(ancestor)) ancestor = path.dirname(ancestor);
  if (fs.realpathSync(ancestor) !== ancestor) throw new Error('Artifact output parents cannot redirect through links.');
  return output;
}
function buildPlugin(options) {
  const sourceRoot = fs.realpathSync(options.sourceRoot || ROOT);
  const output = outputPath(options.output, sourceRoot);
  noProjectInstall(options.projectRoot);
  const staging = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-copilot-plugin-stage-'));
  let temporary;
  try {
    const plan = withHookConsent(createManifestInstallPlan({ sourceRoot, target: 'copilot',
      projectRoot: staging, homeDir: path.join(staging, 'isolated-home'), env: {},
      ...(options.moduleIds ? { moduleIds: options.moduleIds } : { profileId: 'full' }) }), 'enabled');
    applyInstallPlan(plan);
    fs.mkdirSync(path.dirname(output), { recursive: true });
    temporary = fs.mkdtempSync(path.join(path.dirname(output), '.ecc-plugin-build-'));
    const records = new Map();
    for (const operation of plan.operations.filter(item => item.kind === 'copy-file')) {
      if (!inside(staging, operation.destinationPath)) throw new Error('Installation plan escaped staging.');
      const relative = path.relative(staging, operation.destinationPath).split(path.sep).join('/');
      const mapped = destination(relative);
      let bytes = fs.readFileSync(operation.destinationPath);
      if (relative === '.github/hooks/ecc.json') bytes = preparedHooks(bytes.toString('utf8'));
      else if (mapped.startsWith('skills/') && mapped.endsWith('/SKILL.md')) bytes = Buffer.from(relocateSkill(bytes.toString('utf8')));
      put(temporary, mapped, bytes, records);
    }
    for (const [relative, target] of [
      ['scripts/copilot-plugin-hook.js', 'scripts/copilot-plugin-hook.js'],
      ['scripts/lib/copilot-plugin-runtime.js', 'scripts/lib/copilot-plugin-runtime.js'],
      [SCRIPT_BOUNDARY_SOURCE, 'scripts/package.json'],
    ]) {
      const source = path.join(sourceRoot, relative);
      if (fs.realpathSync(source) !== source || !fs.lstatSync(source).isFile()) throw new Error('Unsafe plugin runtime source.');
      put(temporary, target, fs.readFileSync(source), records);
    }
    const version = JSON.parse(fs.readFileSync(path.join(sourceRoot, 'package.json'))).version;
    put(temporary, 'plugin.json', Buffer.from(JSON.stringify({ $schema: SCHEMA, name: 'ecc-copilot', version,
      description: 'Experimental ECC Copilot projection; native hooks remain disabled pending acceptance.', license: 'MIT' }, null, 2) + '\n'), records);
    const report = { schema: ARTIFACT_SCHEMA, nativeStatus: 'native-unverified',
      hooks: 'prepared-disabled', selectedModules: plan.selectedModuleIds, files: records.size,
      entries: [...records.values()].sort((a, b) => a.path.localeCompare(b.path)) };
    fs.writeFileSync(path.join(temporary, 'ecc-artifact.json'), JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
    // A fresh output only: never update or remove an existing artifact/cache.
    if (exists(output)) throw new Error('Artifact output already exists.');
    fs.renameSync(temporary, output); temporary = null;
    return { ...report, output };
  } finally {
    fs.rmSync(staging, { recursive: true, force: true });
    if (temporary) fs.rmSync(temporary, { recursive: true, force: true });
  }
}

function readInventory(root) {
  const inventoryPath = path.join(root, 'ecc-artifact.json');
  const inventoryStat = fs.lstatSync(inventoryPath);
  if (!inventoryStat.isFile() || inventoryStat.nlink !== 1 || inventoryStat.size > 4 * 1024 * 1024) {
    throw new Error('Linked or oversized artifact inventory.');
  }
  const report = JSON.parse(fs.readFileSync(inventoryPath, 'utf8'));
  if (report?.schema !== ARTIFACT_SCHEMA || report.nativeStatus !== 'native-unverified' || report.hooks !== 'prepared-disabled'
    || !Array.isArray(report.entries) || report.entries.length !== report.files || report.files > MAX_FILES) {
    throw new Error('Invalid artifact inventory.');
  }
  return report;
}

function inventoryEntries(report) {
  const expected = new Map();
  let bytes = 0;
  for (const row of report.entries) {
    if (!safeRelative(row?.path) || expected.has(row.path) || row.path === 'ecc-artifact.json'
      || typeof row.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(row.sha256)
      || !Number.isSafeInteger(row.bytes) || row.bytes < 0 || (bytes += row.bytes) > MAX_BYTES) {
      throw new Error('Invalid artifact inventory entry.');
    }
    expected.set(row.path, row);
  }
  if (!expected.has('plugin.json')) throw new Error('Missing plugin manifest inventory entry.');
  return expected;
}

function verifyPlugin(artifact) {
  if (typeof artifact !== 'string' || !path.isAbsolute(artifact)) throw new Error('Artifact path must be absolute.');
  const root = fs.realpathSync(artifact);
  const report = readInventory(root);
  verifyDirectory(root, inventoryEntries(report));
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'plugin.json'), 'utf8'));
  if (manifest?.$schema !== SCHEMA || manifest.name !== 'ecc-copilot' || typeof manifest.version !== 'string') {
    throw new Error('Invalid artifact plugin manifest.');
  }
  const hooks = path.join(root, 'com.github.copilot/hooks/hooks.json');
  if (exists(hooks) && JSON.parse(fs.readFileSync(hooks, 'utf8')).disableAllHooks !== true) {
    throw new Error('Experimental artifact hooks must remain disabled.');
  }
  return { artifact: root, name: manifest.name, version: manifest.version,
    nativeStatus: report.nativeStatus, hooks: report.hooks, files: report.files,
    paths: report.entries.map(row => row.path) };
}

function verifyDirectory(root, expected) {
  const pending = [''];
  let scanned = 0;
  while (pending.length) {
    const directory = pending.pop();
    for (const name of fs.readdirSync(path.join(root, directory))) {
      if (++scanned > MAX_FILES * 2) throw new Error('Artifact directory quota exceeded.');
      const relative = directory ? `${directory}/${name}` : name;
      if (relative === 'ecc-artifact.json') continue;
      const file = path.join(root, relative);
      const stat = fs.lstatSync(file);
      if (stat.isDirectory()) { pending.push(relative); continue; }
      if (!stat.isFile() || stat.nlink !== 1) throw new Error('Linked or unsupported artifact entry.');
      const entry = expected.get(relative);
      if (!entry) throw new Error('Unlisted artifact entry.');
      if (stat.size !== entry.bytes || crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex') !== entry.sha256) {
        throw new Error('Artifact size or digest mismatch.');
      }
      expected.delete(relative);
    }
  }
  if (expected.size) throw new Error('Artifact inventory references missing files.');
}

function projectedProjectPaths(relative) {
  if (relative.startsWith('skills/')) return [`.github/${relative}`];
  if (relative.startsWith('com.github.copilot/agents/')) {
    const name = relative.slice('com.github.copilot/agents/'.length);
    return [`.github/agents/${name}`, `.github/agents/${name.replace(/\.agent\.md$/, '.md')}`];
  }
  if (relative.startsWith('com.github.copilot/rules/')) {
    return [`.github/instructions/ecc/${relative.slice('com.github.copilot/rules/'.length)}`];
  }
  return [];
}

function projectCollision(project, relative) {
  const parts = relative.split('/');
  for (let index = 1; index <= parts.length; index++) {
    const prefix = parts.slice(0, index).join('/');
    const stat = fs.lstatSync(path.join(project, prefix), { throwIfNoEntry: false });
    if (!stat) return null;
    if (index === parts.length || !stat.isDirectory()) return prefix;
  }
  return null;
}

function previewMigration({ artifact, projectRoot }) {
  if (typeof projectRoot !== 'string' || !path.isAbsolute(projectRoot)) throw new Error('Project path must be absolute.');
  const project = fs.realpathSync(projectRoot);
  if (!fs.statSync(project).isDirectory()) throw new Error('Project path must be a directory.');
  const { paths, ...verified } = verifyPlugin(artifact);
  const markers = [...new Set(PROJECT_MARKERS.map(relative => projectCollision(project, relative)).filter(Boolean))];
  const collisions = [...new Set(paths.flatMap(projectedProjectPaths)
    .map(relative => projectCollision(project, relative)).filter(Boolean))].sort();
  return { schema: 'ecc.copilot.plugin-migration-preview.v1', project, ...verified, markers, collisions,
    status: markers.length || collisions.length ? 'conflict' : 'clear' };
}

module.exports = { buildPlugin, relocateSkill, noProjectInstall, verifyPlugin, previewMigration };
