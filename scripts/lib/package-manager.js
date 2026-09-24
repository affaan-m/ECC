/**
 * Package Manager Detection and Selection
 * Automatically detects the preferred package manager or lets user choose
 *
 * Supports: npm, pnpm, yarn, bun
 */

const fs = require('fs');
const path = require('path');
const { commandExists, getClaudeDir, readFile, writeFile } = require('./utils');

// Package manager definitions
const PACKAGE_MANAGERS = {
  npm: {
    name: 'npm',
    lockFile: 'package-lock.json',
    installCmd: 'npm install',
    runCmd: 'npm run',
    execCmd: 'npx',
    testCmd: 'npm test',
    buildCmd: 'npm run build',
    devCmd: 'npm run dev'
  },
  pnpm: {
    name: 'pnpm',
    lockFile: 'pnpm-lock.yaml',
    installCmd: 'pnpm install',
    runCmd: 'pnpm',
    execCmd: 'pnpm dlx',
    testCmd: 'pnpm test',
    buildCmd: 'pnpm build',
    devCmd: 'pnpm dev'
  },
  yarn: {
    name: 'yarn',
    lockFile: 'yarn.lock',
    installCmd: 'yarn',
    runCmd: 'yarn',
    execCmd: 'yarn dlx',
    testCmd: 'yarn test',
    buildCmd: 'yarn build',
    devCmd: 'yarn dev'
  },
  bun: {
    name: 'bun',
    lockFile: 'bun.lock',
    // Bun switched its default lockfile from the binary bun.lockb to the
    // text-based bun.lock. Keep recognizing the legacy file too.
    lockFileAliases: ['bun.lockb'],
    installCmd: 'bun install',
    runCmd: 'bun run',
    execCmd: 'bunx',
    testCmd: 'bun test',
    buildCmd: 'bun run build',
    devCmd: 'bun run dev'
  }
};

// Priority order for detection
const DETECTION_PRIORITY = ['pnpm', 'bun', 'yarn', 'npm'];

// Config file path
function getConfigPath() {
  return path.join(getClaudeDir(), 'package-manager.json');
}

/**
 * Load saved package manager configuration
 */
function loadConfig() {
  const configPath = getConfigPath();
  const content = readFile(configPath);

  if (content) {
    try {
      return JSON.parse(content);
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * Save package manager configuration
 */
function saveConfig(config) {
  const configPath = getConfigPath();
  writeFile(configPath, JSON.stringify(config, null, 2));
}

/**
 * Detect package manager from lock file in project directory
 */
function detectFromLockFile(projectDir = process.cwd()) {
  for (const pmName of DETECTION_PRIORITY) {
    const pm = PACKAGE_MANAGERS[pmName];
    const lockFileNames = [pm.lockFile, ...(pm.lockFileAliases || [])];

    if (lockFileNames.some(lockFileName => fs.existsSync(path.join(projectDir, lockFileName)))) {
      return pmName;
    }
  }
  return null;
}

/**
 * Detect package manager from package.json packageManager field
 */
function detectFromPackageJson(projectDir = process.cwd()) {
  const packageJsonPath = path.join(projectDir, 'package.json');
  const content = readFile(packageJsonPath);

  if (content) {
    try {
      const pkg = JSON.parse(content);
      if (pkg.packageManager) {
        // Format: "pnpm@8.6.0" or just "pnpm"
        const pmName = pkg.packageManager.split('@')[0];
        if (PACKAGE_MANAGERS[pmName]) {
          return pmName;
        }
      }
    } catch {
      // Invalid package.json
    }
  }
  return null;
}

/**
 * Get available package managers (installed on system)
 *
 * WARNING: This spawns child processes (where.exe on Windows, which on Unix)
 * for each package manager. Do NOT call this during session startup hooks —
 * it can exceed Bun's spawn limit on Windows and freeze the plugin.
 * Use detectFromLockFile() or detectFromPackageJson() for hot paths.
 */
function getAvailablePackageManagers() {
  const available = [];

  for (const pmName of Object.keys(PACKAGE_MANAGERS)) {
    if (commandExists(pmName)) {
      available.push(pmName);
    }
  }

  return available;
}

/**
 * Get the package manager to use for current project
 *
 * Detection priority:
 * 1. Environment variable CLAUDE_PACKAGE_MANAGER
 * 2. Project-specific config (in .claude/package-manager.json)
 * 3. package.json packageManager field
 * 4. Lock file detection
 * 5. Global user preference (in ~/.claude/package-manager.json)
 * 6. Default to npm (no child processes spawned)
 *
 * @param {object} options - Options
 * @param {string} options.projectDir - Project directory to detect from (default: cwd)
 * @returns {object} - { name, config, source }
 */
function getPackageManager(options = {}) {
  const { projectDir = process.cwd() } = options;

  // 1. Check environment variable
  const envPm = process.env.CLAUDE_PACKAGE_MANAGER;
  if (envPm && PACKAGE_MANAGERS[envPm]) {
    return {
      name: envPm,
      config: PACKAGE_MANAGERS[envPm],
      source: 'environment'
    };
  }

  // 2. Check project-specific config
  const projectConfigPath = path.join(projectDir, '.claude', 'package-manager.json');
  const projectConfig = readFile(projectConfigPath);
  if (projectConfig) {
    try {
      const config = JSON.parse(projectConfig);
      if (config.packageManager && PACKAGE_MANAGERS[config.packageManager]) {
        return {
          name: config.packageManager,
          config: PACKAGE_MANAGERS[config.packageManager],
          source: 'project-config'
        };
      }
    } catch {
      // Invalid config
    }
  }

  // 3. Check package.json packageManager field
  const fromPackageJson = detectFromPackageJson(projectDir);
  if (fromPackageJson) {
    return {
      name: fromPackageJson,
      config: PACKAGE_MANAGERS[fromPackageJson],
      source: 'package.json'
    };
  }

  // 4. Check lock file
  const fromLockFile = detectFromLockFile(projectDir);
  if (fromLockFile) {
    return {
      name: fromLockFile,
      config: PACKAGE_MANAGERS[fromLockFile],
      source: 'lock-file'
    };
  }

  // 5. Check global user preference
  const globalConfig = loadConfig();
  if (globalConfig && globalConfig.packageManager && PACKAGE_MANAGERS[globalConfig.packageManager]) {
    return {
      name: globalConfig.packageManager,
      config: PACKAGE_MANAGERS[globalConfig.packageManager],
      source: 'global-config'
    };
  }

  // 6. Default to npm (always available with Node.js)
  // NOTE: Previously this called getAvailablePackageManagers() which spawns
  // child processes (where.exe/which) for each PM. This caused plugin freezes
  // on Windows (see #162) because session-start hooks run during Bun init,
  // and the spawned processes exceed Bun's spawn limit.
  // Steps 1-5 already cover all config-based and file-based detection.
  // If none matched, npm is the safe default.
  return {
    name: 'npm',
    config: PACKAGE_MANAGERS.npm,
    source: 'default'
  };
}

/**
 * Set user's preferred package manager (global)
 */
function setPreferredPackageManager(pmName) {
  if (!PACKAGE_MANAGERS[pmName]) {
    throw new Error(`Unknown package manager: ${pmName}`);
  }

  const config = loadConfig() || {};
  config.packageManager = pmName;
  config.setAt = new Date().toISOString();

  try {
    saveConfig(config);
  } catch (err) {
    throw new Error(`Failed to save package manager preference: ${err.message}`);
  }

  return config;
}

/**
 * Set project's preferred package manager
 */
function setProjectPackageManager(pmName, projectDir = process.cwd()) {
  if (!PACKAGE_MANAGERS[pmName]) {
    throw new Error(`Unknown package manager: ${pmName}`);
  }

  const configDir = path.join(projectDir, '.claude');
  const configPath = path.join(configDir, 'package-manager.json');

  const config = {
    packageManager: pmName,
    setAt: new Date().toISOString()
  };

  try {
    writeFile(configPath, JSON.stringify(config, null, 2));
  } catch (err) {
    throw new Error(`Failed to save package manager config to ${configPath}: ${err.message}`);
  }
  return config;
}

// Allowed characters in script/binary names: alphanumeric, dash, underscore, dot, slash, @
// This prevents shell metacharacter injection while allowing scoped packages (e.g., @scope/pkg)
const SAFE_NAME_REGEX = /^[@a-zA-Z0-9_./-]+$/;

/**
 * Get the command to run a script
 * @param {string} script - Script name (e.g., "dev", "build", "test")
 * @param {object} options - { projectDir }
 * @throws {Error} If script name contains unsafe characters
 */
function getRunCommand(script, options = {}) {
  if (!script || typeof script !== 'string') {
    throw new Error('Script name must be a non-empty string');
  }
  if (!SAFE_NAME_REGEX.test(script)) {
    throw new Error(`Script name contains unsafe characters: ${script}`);
  }

  const pm = getPackageManager(options);

  switch (script) {
    case 'install':
      return pm.config.installCmd;
    case 'test':
      return pm.config.testCmd;
    case 'build':
      return pm.config.buildCmd;
    case 'dev':
      return pm.config.devCmd;
    default:
      return `${pm.config.runCmd} ${script}`;
  }
}

// Allowed characters in arguments: alphanumeric, whitespace, dashes, dots, slashes,
// equals, colons, commas, quotes, @. Rejects shell metacharacters like ; | & ` $ ( ) { } < > !
const SAFE_ARGS_REGEX = /^[@a-zA-Z0-9\s_./:=,'"*+-]+$/;

/**
 * Get the command to execute a package binary
 * @param {string} binary - Binary name (e.g., "prettier", "eslint")
 * @param {string} args - Arguments to pass
 * @throws {Error} If binary name or args contain unsafe characters
 */
function getExecCommand(binary, args = '', options = {}) {
  if (!binary || typeof binary !== 'string') {
    throw new Error('Binary name must be a non-empty string');
  }
  if (!SAFE_NAME_REGEX.test(binary)) {
    throw new Error(`Binary name contains unsafe characters: ${binary}`);
  }
  if (args && typeof args === 'string' && !SAFE_ARGS_REGEX.test(args)) {
    throw new Error(`Arguments contain unsafe characters: ${args}`);
  }

  const pm = getPackageManager(options);
  return `${pm.config.execCmd} ${binary}${args ? ' ' + args : ''}`;
}

/**
 * Interactive prompt for package manager selection
 * Returns a message for Claude to show to user
 *
 * NOTE: Does NOT spawn child processes to check availability.
 * Lists all supported PMs and shows how to configure preference.
 */
function getSelectionPrompt() {
  let message = '[PackageManager] No package manager preference detected.\n';
  message += 'Supported package managers: ' + Object.keys(PACKAGE_MANAGERS).join(', ') + '\n';
  message += '\nTo set your preferred package manager:\n';
  message += '  - Global: Set CLAUDE_PACKAGE_MANAGER environment variable\n';
  message += '  - Or add to ~/.claude/package-manager.json: {"packageManager": "pnpm"}\n';
  message += '  - Or add to package.json: {"packageManager": "pnpm@8"}\n';
  message += '  - Or add a lock file to your project (e.g., pnpm-lock.yaml)\n';

  return message;
}

// Escape regex metacharacters in a string before interpolating into a pattern
function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Generate a regex pattern that matches commands for all package managers
 * @param {string} action - Action pattern (e.g., "run dev", "install", "test")
 */
function getCommandPattern(action) {
  const patterns = [];

  // Trim spaces from action to handle leading/trailing whitespace gracefully
  const trimmedAction = action.trim();

  if (trimmedAction === 'dev') {
    patterns.push(
      'npm run dev',
      'pnpm( run)? dev',
      'yarn dev',
      'bun run dev'
    );
  } else if (trimmedAction === 'install') {
    patterns.push(
      'npm install',
      'pnpm install',
      'yarn( install)?',
      'bun install'
    );
  } else if (trimmedAction === 'test') {
    patterns.push(
      'npm test',
      'pnpm test',
      'yarn test',
      'bun test'
    );
  } else if (trimmedAction === 'build') {
    patterns.push(
      'npm run build',
      'pnpm( run)? build',
      'yarn build',
      'bun run build'
    );
  } else {
    // Generic run command — escape regex metacharacters in action
    const escaped = escapeRegex(trimmedAction);
    patterns.push(
      `npm run ${escaped}`,
      `pnpm( run)? ${escaped}`,
      `yarn ${escaped}`,
      `bun run ${escaped}`
    );
  }

  return `(${patterns.join('|')})`;
}

module.exports = {
  PACKAGE_MANAGERS,
  DETECTION_PRIORITY,
  getPackageManager,
  setPreferredPackageManager,
  setProjectPackageManager,
  getAvailablePackageManagers,
  detectFromLockFile,
  detectFromPackageJson,
  getRunCommand,
  getExecCommand,
  getSelectionPrompt,
  getCommandPattern
};
