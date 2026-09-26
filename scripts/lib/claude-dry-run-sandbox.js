'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const { realpathNearestExisting } = require('./path-safety');

function readSnapshotFile(filePath) {
  try {
    const stat = fs.statSync(filePath);
    if (!stat.isFile()) {
      const error = new Error(`Claude dry-run state is not a regular file: ${filePath}`);
      error.code = 'INVALID_DRY_RUN_STATE';
      throw error;
    }
    return fs.readFileSync(filePath);
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

function claudeStateFilePath(paths, options) {
  const hasCustomConfigDir = (
    options.configDir !== undefined
    || Boolean(process.env.CLAUDE_CONFIG_DIR)
  );
  return hasCustomConfigDir
    ? path.join(paths.configDir, '.claude.json')
    : path.join(paths.homeDir, '.claude.json');
}

function remapSnapshotPath(value, mappings) {
  if (typeof value !== 'string' || !path.isAbsolute(value)) return value;
  for (const mapping of mappings) {
    const relative = path.relative(mapping.source, value);
    if (
      relative === ''
      || (
        relative !== '..'
        && !relative.startsWith(`..${path.sep}`)
        && !path.isAbsolute(relative)
      )
    ) {
      return relative === '' ? mapping.destination : path.join(mapping.destination, relative);
    }
  }
  return value;
}

function remapSnapshotValue(value, mappings) {
  if (typeof value === 'string') return remapSnapshotPath(value, mappings);
  if (Array.isArray(value)) {
    return value.map(entry => remapSnapshotValue(entry, mappings));
  }
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).map(([key, entry]) => [
    remapSnapshotPath(key, mappings),
    remapSnapshotValue(entry, mappings),
  ]));
}

function copyJsonSnapshot(sourcePath, destinationPath, mappings) {
  const content = readSnapshotFile(sourcePath);
  if (content === null) return;
  let snapshot = content;
  try {
    const parsed = JSON.parse(content.toString('utf8'));
    snapshot = Buffer.from(`${JSON.stringify(remapSnapshotValue(parsed, mappings), null, 2)}\n`);
  } catch {
    // Preserve malformed input so Claude reports the same inventory error from isolation.
  }
  fs.mkdirSync(path.dirname(destinationPath), { recursive: true, mode: 0o700 });
  fs.writeFileSync(destinationPath, snapshot, { mode: 0o600 });
}

function createSnapshotMappings(entries) {
  const mappings = [];
  for (const entry of entries) {
    const sources = new Set([
      path.resolve(entry.source),
      realpathNearestExisting(entry.source),
    ]);
    for (const source of sources) {
      mappings.push({ source, destination: entry.destination });
    }
  }
  return mappings.sort((left, right) => right.source.length - left.source.length);
}

function createDryRunSandbox(paths, options, baseEnv) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-claude-dry-run-'));
  const homeDir = path.join(root, 'home');
  const configDir = path.join(root, 'config');
  const projectRoot = path.join(root, 'project');
  const tempDir = path.join(root, 'tmp');
  try {
    fs.chmodSync(root, 0o700);
    for (const directoryPath of [homeDir, configDir, projectRoot, tempDir]) {
      fs.mkdirSync(directoryPath, { recursive: true, mode: 0o700 });
    }
    const mappings = createSnapshotMappings([
      { source: paths.projectRoot, destination: projectRoot },
      { source: paths.configDir, destination: configDir },
      { source: paths.homeDir, destination: homeDir },
    ]);
    const snapshots = [
      [claudeStateFilePath(paths, options), path.join(configDir, '.claude.json')],
      [path.join(paths.configDir, 'settings.json'), path.join(configDir, 'settings.json')],
      [path.join(paths.configDir, 'settings.local.json'), path.join(configDir, 'settings.local.json')],
      [
        path.join(paths.configDir, 'plugins', 'installed_plugins.json'),
        path.join(configDir, 'plugins', 'installed_plugins.json'),
      ],
      [
        path.join(paths.configDir, 'plugins', 'known_marketplaces.json'),
        path.join(configDir, 'plugins', 'known_marketplaces.json'),
      ],
      [
        path.join(paths.projectRoot, '.claude', 'settings.json'),
        path.join(projectRoot, '.claude', 'settings.json'),
      ],
      [
        path.join(paths.projectRoot, '.claude', 'settings.local.json'),
        path.join(projectRoot, '.claude', 'settings.local.json'),
      ],
    ];
    for (const [sourcePath, destinationPath] of snapshots) {
      copyJsonSnapshot(sourcePath, destinationPath, mappings);
    }
    return {
      cwd: projectRoot,
      env: {
        ...baseEnv,
        APPDATA: path.join(root, 'appdata'),
        CLAUDE_CONFIG_DIR: configDir,
        CLAUDE_PROJECT_DIR: projectRoot,
        HOME: homeDir,
        INIT_CWD: projectRoot,
        LOCALAPPDATA: path.join(root, 'localappdata'),
        OLDPWD: projectRoot,
        PWD: projectRoot,
        TEMP: tempDir,
        TMP: tempDir,
        TMPDIR: tempDir,
        USERPROFILE: homeDir,
        XDG_CACHE_HOME: path.join(root, 'xdg-cache'),
        XDG_CONFIG_HOME: path.join(root, 'xdg-config'),
        XDG_DATA_HOME: path.join(root, 'xdg-data'),
        XDG_STATE_HOME: path.join(root, 'xdg-state'),
      },
      root,
    };
  } catch (error) {
    fs.rmSync(root, { force: true, recursive: true });
    throw error;
  }
}

function createDryRunClaudeRunner(run, paths, options = {}) {
  return (args, runOptions = {}) => {
    const sandbox = createDryRunSandbox(
      paths,
      options,
      runOptions.env || process.env
    );
    try {
      return run(args, {
        ...runOptions,
        cwd: sandbox.cwd,
        env: sandbox.env,
      });
    } finally {
      fs.rmSync(sandbox.root, { force: true, recursive: true });
    }
  };
}

module.exports = {
  createDryRunClaudeRunner,
};
