/**
 * Tests for Codex shell helpers.
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const execFileSync = require('child_process').execFileSync;
const TOML = require('@iarna/toml');

const repoRoot = path.join(__dirname, '..', '..');
const installScript = path.join(repoRoot, 'scripts', 'codex', 'install-global-git-hooks.sh');
const syncScript = path.join(repoRoot, 'scripts', 'sync-ecc-to-codex.sh');

const IS_WSL_BASH = spawnSync('bash', ['-lc', 'test -d /mnt/c -o -d /mnt/d'], {
  stdio: 'ignore',
}).status === 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    return true;
  } catch (error) {
    console.log(`  ✗ ${name}`);
    console.log(`    Error: ${error.message}`);
    return false;
  }
}

function createTempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function cleanup(dirPath) {
  fs.rmSync(dirPath, { recursive: true, force: true });
}

function toBashPath(filePath) {
  if (IS_WSL_BASH) {
    return String(filePath)
      .replace(/^([A-Za-z]):/, (_, driveLetter) => `/mnt/${driveLetter.toLowerCase()}`)
      .replace(/\\/g, '/');
  }

  if (process.platform !== 'win32') {
    return filePath;
  }

  try {
    return execFileSync('bash', ['-lc', 'cygpath -u -- "$1"', 'bash', filePath], {
      encoding: 'utf8',
    }).trim();
  } catch {
    return String(filePath)
      .replace(/^([A-Za-z]):/, (_, driveLetter) => `/${driveLetter.toLowerCase()}`)
      .replace(/\\/g, '/');
  }
}

function toBashEnv(env) {
  if (process.platform !== 'win32') {
    return env;
  }

  const pathKeys = new Set(['HOME', 'USERPROFILE', 'XDG_CONFIG_HOME', 'GIT_CONFIG_GLOBAL', 'CODEX_HOME', 'AGENTS_HOME', 'ECC_GLOBAL_HOOKS_DIR']);
  return Object.fromEntries(
    Object.entries(env).map(([key, value]) => [
      key,
      pathKeys.has(key) ? toBashPath(value) : value,
    ])
  );
}

function runBash(scriptPath, args = [], env = {}, cwd = repoRoot) {
  const normalizedScript = fs.readFileSync(scriptPath, 'utf8').replace(/\r\n/g, '\n');
  return spawnSync('bash', ['-s', '--', ...args.map(toBashPath)], {
    cwd,
    env: {
      ...process.env,
      ...toBashEnv(env),
    },
    encoding: 'utf8',
    input: normalizedScript,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
}

function makeHermeticCodexEnv(homeDir, codexDir, extraEnv = {}) {
  const agentsHome = path.join(homeDir, '.agents');
  const hooksDir = path.join(codexDir, 'git-hooks');
  return {
    HOME: homeDir,
    USERPROFILE: homeDir,
    XDG_CONFIG_HOME: path.join(homeDir, '.config'),
    GIT_CONFIG_GLOBAL: path.join(homeDir, '.gitconfig'),
    CODEX_HOME: codexDir,
    AGENTS_HOME: agentsHome,
    ECC_GLOBAL_HOOKS_DIR: hooksDir,
    CLAUDE_PACKAGE_MANAGER: 'npm',
    CLAUDE_CODE_PACKAGE_MANAGER: 'npm',
    LANG: 'C.UTF-8',
    LC_ALL: 'C.UTF-8',
    ...extraEnv,
  };
}

let passed = 0;
let failed = 0;

// Windows NTFS does not allow double-quote characters in file paths,
// so the quoted-path shell-injection test is only meaningful on Unix.
if (os.platform() === 'win32') {
  console.log('  - install-global-git-hooks.sh quoted paths (skipped on Windows)');
} else if (
  test('install-global-git-hooks.sh handles quoted hook paths without shell injection', () => {
    const homeDir = createTempDir('codex-hooks-home-');
    const weirdHooksDir = path.join(homeDir, 'git-hooks "quoted"');

    try {
      const result = runBash(installScript, [], {
        HOME: homeDir,
        ECC_GLOBAL_HOOKS_DIR: weirdHooksDir,
      });

      assert.strictEqual(result.status, 0, result.stderr || result.stdout);
      assert.ok(fs.existsSync(path.join(weirdHooksDir, 'pre-commit')));
      assert.ok(fs.existsSync(path.join(weirdHooksDir, 'pre-push')));
    } finally {
      cleanup(homeDir);
    }
  })
)
  passed++;
else failed++;


if (IS_WSL_BASH && process.platform === 'win32') {
  console.log('  - sync-ecc-to-codex.sh integration tests (skipped on Windows/WSL path bridge)');
  console.log(`\nPassed: ${passed}`);
  console.log(`Failed: ${failed}`);
  process.exit(failed > 0 ? 1 : 0);
}

if (
  test('sync installs the missing Codex baseline and accepts the legacy context7 MCP section', () => {
    const homeDir = createTempDir('codex-sync-home-');
    const codexDir = path.join(homeDir, '.codex');
    const configPath = path.join(codexDir, 'config.toml');
    const agentsPath = path.join(codexDir, 'AGENTS.md');
    const config = [
      'persistent_instructions = ""',
      '',
      '[agents]',
      'explorer = { description = "Read-only codebase explorer for gathering evidence before changes are proposed." }',
      '',
      '[mcp_servers.context7]',
      'command = "npx"',
      'args = ["-y", "@upstash/context7-mcp"]',
      '',
      '[mcp_servers.github]',
      'command = "npx"',
      'args = ["-y", "@modelcontextprotocol/server-github"]',
      '',
      '[mcp_servers.memory]',
      'command = "npx"',
      'args = ["-y", "@modelcontextprotocol/server-memory"]',
      '',
      '[mcp_servers.sequential-thinking]',
      'command = "npx"',
      'args = ["-y", "@modelcontextprotocol/server-sequential-thinking"]',
      '',
    ].join('\n');

    try {
      fs.mkdirSync(codexDir, { recursive: true });
      fs.writeFileSync(configPath, config);

      const syncResult = runBash(syncScript, ['--update-mcp'], makeHermeticCodexEnv(homeDir, codexDir));
      assert.strictEqual(syncResult.status, 0, `${syncResult.stdout}\n${syncResult.stderr}`);

      const syncedAgents = fs.readFileSync(agentsPath, 'utf8');
      assert.match(syncedAgents, /^# Everything Claude Code \(ECC\) — Agent Instructions/m);
      assert.match(syncedAgents, /^# Codex Supplement \(From ECC \.codex\/AGENTS\.md\)/m);

      const syncedConfig = fs.readFileSync(configPath, 'utf8');
      const parsedConfig = TOML.parse(syncedConfig);
      assert.strictEqual(parsedConfig.approval_policy, 'on-request');
      assert.strictEqual(parsedConfig.sandbox_mode, 'workspace-write');
      assert.strictEqual(parsedConfig.web_search, 'live');
      assert.ok(!Object.prototype.hasOwnProperty.call(parsedConfig, 'multi_agent'));
      assert.ok(parsedConfig.features);
      assert.strictEqual(parsedConfig.features.multi_agent, true);
      assert.ok(parsedConfig.profiles);
      assert.strictEqual(parsedConfig.profiles.strict.approval_policy, 'on-request');
      assert.strictEqual(parsedConfig.profiles.yolo.approval_policy, 'never');
      assert.ok(parsedConfig.agents);
      assert.strictEqual(parsedConfig.agents.max_threads, 6);
      assert.strictEqual(parsedConfig.agents.max_depth, 1);
      assert.strictEqual(parsedConfig.agents.explorer.config_file, 'agents/explorer.toml');
      assert.strictEqual(parsedConfig.agents.reviewer.config_file, 'agents/reviewer.toml');
      assert.strictEqual(parsedConfig.agents.docs_researcher.config_file, 'agents/docs-researcher.toml');
      assert.ok(parsedConfig.mcp_servers.exa);
      assert.ok(parsedConfig.mcp_servers.github);
      assert.ok(parsedConfig.mcp_servers.memory);
      assert.ok(parsedConfig.mcp_servers['sequential-thinking']);
      assert.ok(parsedConfig.mcp_servers.context7);

      for (const roleFile of ['explorer.toml', 'reviewer.toml', 'docs-researcher.toml']) {
        assert.ok(fs.existsSync(path.join(codexDir, 'agents', roleFile)));
      }
    } finally {
      cleanup(homeDir);
    }
  })
)
  passed++;
else failed++;

if (
  test('sync adds parent-table keys when the target only declares an implicit parent table', () => {
    const homeDir = createTempDir('codex-sync-implicit-parent-home-');
    const codexDir = path.join(homeDir, '.codex');
    const configPath = path.join(codexDir, 'config.toml');
    const config = [
      'persistent_instructions = ""',
      '',
      '[agents.explorer]',
      'description = "Read-only codebase explorer for gathering evidence before changes are proposed."',
      '',
    ].join('\n');

    try {
      fs.mkdirSync(codexDir, { recursive: true });
      fs.writeFileSync(configPath, config);

      const syncResult = runBash(syncScript, [], makeHermeticCodexEnv(homeDir, codexDir));
      assert.strictEqual(syncResult.status, 0, `${syncResult.stdout}\n${syncResult.stderr}`);

      const parsedConfig = TOML.parse(fs.readFileSync(configPath, 'utf8'));
      assert.strictEqual(parsedConfig.agents.max_threads, 6);
      assert.strictEqual(parsedConfig.agents.max_depth, 1);
      assert.strictEqual(parsedConfig.agents.explorer.config_file, 'agents/explorer.toml');
    } finally {
      cleanup(homeDir);
    }
  })
)
  passed++;
else failed++;

console.log(`\nPassed: ${passed}`);
console.log(`Failed: ${failed}`);
process.exit(failed > 0 ? 1 : 0);
