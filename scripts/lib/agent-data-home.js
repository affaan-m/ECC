/**
 * Resolve ECC agent data home (memory persistence root) across harnesses.
 * @see https://github.com/affaan-m/ECC/issues/2065
 */

const fs = require('fs');
const path = require('path');

const AGENT_DATA_HOME_ENV = 'ECC_AGENT_DATA_HOME';
const DEFAULT_CLAUDE_DIR_NAME = '.claude';
const DEFAULT_CURSOR_ECC_DIR_SEGMENTS = ['.cursor', 'ecc'];
const PROJECT_CONFIG_RELATIVE = path.join('.cursor', 'ecc-agent-data.json');

function getHomeDirFromEnv() {
  const explicitHome = process.env.HOME || process.env.USERPROFILE;
  if (explicitHome && String(explicitHome).trim().length > 0) {
    return path.resolve(explicitHome);
  }
  return require('os').homedir();
}

function expandHomePath(value) {
  if (!value || typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith('~')) {
    const remainder = trimmed.slice(1).replace(/^[/\\]+/, '');
    return remainder ? path.join(getHomeDirFromEnv(), remainder) : getHomeDirFromEnv();
  }
  return path.resolve(trimmed);
}

/**
 * True when the current process is a Cursor hook subprocess.
 * Cursor documents CURSOR_VERSION and CURSOR_PROJECT_DIR for hook scripts.
 */
function isCursorHookRuntime() {
  if (process.env.CURSOR_VERSION && String(process.env.CURSOR_VERSION).trim()) {
    return true;
  }
  if (process.env.CURSOR_PROJECT_DIR && String(process.env.CURSOR_PROJECT_DIR).trim()) {
    return true;
  }
  return false;
}

function getDefaultCursorAgentDataHome() {
  return path.join(getHomeDirFromEnv(), ...DEFAULT_CURSOR_ECC_DIR_SEGMENTS);
}

function getDefaultClaudeAgentDataHome() {
  return path.join(getHomeDirFromEnv(), DEFAULT_CLAUDE_DIR_NAME);
}

function readProjectConfigAt(configPath) {
  if (!configPath || typeof configPath !== 'string') return null;
  if (!fs.existsSync(configPath)) return null;

  try {
    const parsed = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    const candidate = parsed.agentDataHome || parsed.ECC_AGENT_DATA_HOME;
    if (typeof candidate !== 'string' || !candidate.trim()) return null;
    return expandHomePath(candidate);
  } catch (error) {
    console.error(
      `[ECC] Failed to read or parse agent data config at ${configPath}: ${error.message}`
    );
    return null;
  }
}

function readProjectConfig(projectDir) {
  if (!projectDir || typeof projectDir !== 'string') return null;
  return readProjectConfigAt(path.join(projectDir, PROJECT_CONFIG_RELATIVE));
}

function resolveProjectDir() {
  const candidates = [
    process.env.CURSOR_PROJECT_DIR,
    process.env.CLAUDE_PROJECT_DIR,
    process.cwd(),
  ];

  for (const candidate of candidates) {
    if (!candidate || typeof candidate !== 'string') continue;
    const resolved = path.resolve(candidate);
    if (fs.existsSync(path.join(resolved, '.cursor'))) {
      return resolved;
    }
  }

  return process.cwd();
}

/**
 * Resolve agent data home without mutating process.env.
 */
function resolveAgentDataHome(options = {}) {
  const fromEnv = expandHomePath(process.env[AGENT_DATA_HOME_ENV]);
  if (fromEnv) return fromEnv;

  const projectDir = options.projectDir || resolveProjectDir();
  const fromProject = readProjectConfig(projectDir);
  if (fromProject) return fromProject;

  if (options.preferCursorDefault === true || isCursorHookRuntime()) {
    return getDefaultCursorAgentDataHome();
  }

  return getDefaultClaudeAgentDataHome();
}

/**
 * Set ECC_AGENT_DATA_HOME on the current process when unset (hook subprocess safety net).
 * @returns {string} Resolved agent data home
 */
function ensureAgentDataHomeEnv(options = {}) {
  const resolved = resolveAgentDataHome(options);
  if (!expandHomePath(process.env[AGENT_DATA_HOME_ENV])) {
    process.env[AGENT_DATA_HOME_ENV] = resolved;
  }
  return resolved;
}

/**
 * Build Cursor sessionStart hook output env payload.
 */
function getCursorSessionEnvPayload(options = {}) {
  const agentDataHome = resolveAgentDataHome({
    ...options,
    preferCursorDefault: true,
  });

  return {
    ECC_AGENT_DATA_HOME: agentDataHome,
  };
}

module.exports = {
  AGENT_DATA_HOME_ENV,
  DEFAULT_CLAUDE_DIR_NAME,
  DEFAULT_CURSOR_ECC_DIR_SEGMENTS,
  PROJECT_CONFIG_RELATIVE,
  expandHomePath,
  isCursorHookRuntime,
  getDefaultCursorAgentDataHome,
  getDefaultClaudeAgentDataHome,
  readProjectConfig,
  readProjectConfigAt,
  resolveProjectDir,
  resolveAgentDataHome,
  ensureAgentDataHomeEnv,
  getCursorSessionEnvPayload,
};
