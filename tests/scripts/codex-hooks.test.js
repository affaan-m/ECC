/**
 * Tests for Codex shell helpers.
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const TOML = require('@iarna/toml');

const repoRoot = path.join(__dirname, '..', '..');
const installScript = path.join(repoRoot, 'scripts', 'codex', 'install-global-git-hooks.sh');
const mergeCodexConfigScript = path.join(repoRoot, 'scripts', 'codex', 'merge-codex-config.js');
const mergeMcpConfigScript = path.join(repoRoot, 'scripts', 'codex', 'merge-mcp-config.js');
const syncScript = path.join(repoRoot, 'scripts', 'sync-ecc-to-codex.sh');
const deterministicPackageEnv = {
  CLAUDE_PACKAGE_MANAGER: 'npm',
  CLAUDE_CODE_PACKAGE_MANAGER: 'npm',
};

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

function runBash(scriptPath, args = [], env = {}, cwd = repoRoot) {
  return spawnSync('bash', [scriptPath, ...args], {
    cwd,
    env: {
      ...process.env,
      ...env,
    },
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
  });
}

function runNode(scriptPath, args = [], env = {}, cwd = repoRoot) {
  return spawnSync('node', [scriptPath, ...args], {
    cwd,
    env: {
      ...process.env,
      ...env,
    },
    encoding: 'utf8',
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

if (
  test('merge-codex-config reports usage, missing files, and TOML parse failures', () => {
    const tempDir = createTempDir('codex-merge-errors-');

    try {
      const noArgs = runNode(mergeCodexConfigScript);
      assert.strictEqual(noArgs.status, 1);
      assert.match(noArgs.stderr, /Usage: merge-codex-config\.js/);

      const missingPath = path.join(tempDir, 'missing-config.toml');
      const missing = runNode(mergeCodexConfigScript, [missingPath]);
      assert.strictEqual(missing.status, 1);
      assert.match(missing.stderr, /Config file not found/);

      const invalidPath = path.join(tempDir, 'invalid-config.toml');
      fs.writeFileSync(invalidPath, 'approval_policy = [\n');
      const invalid = runNode(mergeCodexConfigScript, [invalidPath]);
      assert.strictEqual(invalid.status, 1);
      assert.match(invalid.stderr, /Failed to parse TOML/);
    } finally {
      cleanup(tempDir);
    }
  })
)
  passed++;
else failed++;

if (
  test('merge-codex-config dry-run reports additions without mutating the target', () => {
    const tempDir = createTempDir('codex-merge-dry-run-');
    const configPath = path.join(tempDir, 'config.toml');
    const original = '';

    try {
      fs.writeFileSync(configPath, original);
      const result = runNode(mergeCodexConfigScript, [configPath, '--dry-run']);

      assert.strictEqual(result.status, 0, `${result.stdout}\n${result.stderr}`);
      assert.match(result.stdout, /\[add-root\]/);
      assert.match(result.stdout, /\[add-table\] \[features\]/);
      assert.match(result.stdout, /Dry run/);
      assert.strictEqual(fs.readFileSync(configPath, 'utf8'), original);
    } finally {
      cleanup(tempDir);
    }
  })
)
  passed++;
else failed++;

if (
  test('merge-codex-config preserves user root choices while adding missing baseline tables', () => {
    const tempDir = createTempDir('codex-merge-add-only-');
    const configPath = path.join(tempDir, 'config.toml');

    try {
      fs.writeFileSync(configPath, 'approval_policy = "never"\n');
      const result = runNode(mergeCodexConfigScript, [configPath]);

      assert.strictEqual(result.status, 0, `${result.stdout}\n${result.stderr}`);
      assert.match(result.stdout, /Done\. Baseline Codex settings merged\./);

      const merged = fs.readFileSync(configPath, 'utf8');
      const parsed = TOML.parse(merged);
      assert.strictEqual(parsed.approval_policy, 'never');
      assert.strictEqual(parsed.sandbox_mode, 'workspace-write');
      assert.strictEqual(parsed.web_search, 'live');
      assert.strictEqual(parsed.features.multi_agent, true);
      assert.strictEqual(parsed.profiles.strict.approval_policy, 'on-request');
      assert.strictEqual(parsed.profiles.yolo.approval_policy, 'never');
      assert.strictEqual(parsed.agents.max_threads, 6);
      assert.strictEqual(parsed.agents.explorer.config_file, 'agents/explorer.toml');
    } finally {
      cleanup(tempDir);
    }
  })
)
  passed++;
else failed++;

if (
  test('merge-codex-config no-ops when the Codex baseline is already present', () => {
    const tempDir = createTempDir('codex-merge-noop-');
    const configPath = path.join(tempDir, 'config.toml');
    const original = fs.readFileSync(path.join(repoRoot, '.codex', 'config.toml'), 'utf8');

    try {
      fs.writeFileSync(configPath, original);
      const result = runNode(mergeCodexConfigScript, [configPath]);

      assert.strictEqual(result.status, 0, `${result.stdout}\n${result.stderr}`);
      assert.match(result.stdout, /All baseline Codex settings already present/);
      assert.strictEqual(fs.readFileSync(configPath, 'utf8'), original);
    } finally {
      cleanup(tempDir);
    }
  })
)
  passed++;
else failed++;

if (
  test('merge-codex-config warns when inline tables cannot be safely extended', () => {
    const tempDir = createTempDir('codex-merge-inline-warn-');
    const configPath = path.join(tempDir, 'config.toml');
    const original = 'agents = { explorer = { description = "custom explorer" } }\n';

    try {
      fs.writeFileSync(configPath, original);
      const result = runNode(mergeCodexConfigScript, [configPath, '--dry-run']);

      assert.strictEqual(result.status, 0, `${result.stdout}\n${result.stderr}`);
      assert.match(result.stderr, /WARNING: Skipping missing keys/);
      assert.strictEqual(fs.readFileSync(configPath, 'utf8'), original);
    } finally {
      cleanup(tempDir);
    }
  })
)
  passed++;
else failed++;

if (
  test('merge-mcp-config reports usage, missing files, and TOML parse failures', () => {
    const tempDir = createTempDir('mcp-merge-errors-');

    try {
      const noArgs = runNode(mergeMcpConfigScript, [], deterministicPackageEnv);
      assert.strictEqual(noArgs.status, 1);
      assert.match(noArgs.stderr, /Usage: merge-mcp-config\.js/);

      const missingPath = path.join(tempDir, 'missing-config.toml');
      const missing = runNode(mergeMcpConfigScript, [missingPath], deterministicPackageEnv);
      assert.strictEqual(missing.status, 1);
      assert.match(missing.stderr, /Config file not found/);

      const invalidPath = path.join(tempDir, 'invalid-config.toml');
      fs.writeFileSync(invalidPath, '[mcp_servers.github\n');
      const invalid = runNode(mergeMcpConfigScript, [invalidPath], deterministicPackageEnv);
      assert.strictEqual(invalid.status, 1);
      assert.match(invalid.stderr, /Failed to parse/);
    } finally {
      cleanup(tempDir);
    }
  })
)
  passed++;
else failed++;

if (
  test('merge-mcp-config dry-run appends the current default set without mutating target', () => {
    const tempDir = createTempDir('mcp-merge-dry-run-');
    const configPath = path.join(tempDir, 'config.toml');
    const original = '';

    try {
      fs.writeFileSync(configPath, original);
      const result = runNode(mergeMcpConfigScript, [configPath, '--dry-run'], deterministicPackageEnv);

      assert.strictEqual(result.status, 0, `${result.stdout}\n${result.stderr}`);
      assert.match(result.stdout, /Package manager: npm \(exec: npx\)/);
      assert.match(result.stdout, /\[add\] mcp_servers\.chrome-devtools/);
      assert.match(result.stdout, /\[mcp_servers\.chrome-devtools\]/);
      assert.match(result.stdout, /Dry run/);
      // Retired defaults (June 2026 connector policy) must not be emitted.
      assert.doesNotMatch(result.stdout, /mcp_servers\.(supabase|playwright|context7|exa|github|memory|sequential-thinking)\b/);
      assert.doesNotMatch(result.stdout, /url = /);
      assert.strictEqual(fs.readFileSync(configPath, 'utf8'), original);
    } finally {
      cleanup(tempDir);
    }
  })
)
  passed++;
else failed++;

if (
  test('merge-mcp-config no-ops after all recommended servers are present', () => {
    const tempDir = createTempDir('mcp-merge-noop-');
    const configPath = path.join(tempDir, 'config.toml');

    try {
      fs.writeFileSync(configPath, '');
      const first = runNode(mergeMcpConfigScript, [configPath], deterministicPackageEnv);
      assert.strictEqual(first.status, 0, `${first.stdout}\n${first.stderr}`);

      const merged = fs.readFileSync(configPath, 'utf8');
      const parsed = TOML.parse(merged);
      assert.strictEqual(parsed.mcp_servers['chrome-devtools'].command, 'npx');
      assert.deepStrictEqual(parsed.mcp_servers['chrome-devtools'].args, ['chrome-devtools-mcp@latest']);
      assert.strictEqual(parsed.mcp_servers['chrome-devtools'].startup_timeout_sec, 30);
      // No retired server may be (re-)emitted — exa's url form broke Codex (#2224).
      assert.strictEqual(parsed.mcp_servers.exa, undefined);
      assert.strictEqual(parsed.mcp_servers.github, undefined);
      assert.strictEqual(parsed.mcp_servers.supabase, undefined);

      const second = runNode(mergeMcpConfigScript, [configPath], deterministicPackageEnv);
      assert.strictEqual(second.status, 0, `${second.stdout}\n${second.stderr}`);
      assert.match(second.stdout, /\[ok\] mcp_servers\.chrome-devtools/);
      assert.match(second.stdout, /All ECC MCP servers already present/);
      assert.strictEqual(fs.readFileSync(configPath, 'utf8'), merged);
    } finally {
      cleanup(tempDir);
    }
  })
)
  passed++;
else failed++;

if (
  test('merge-mcp-config repairs the invalid exa url entry from earlier ECC versions (#2224)', () => {
    const tempDir = createTempDir('mcp-merge-exa-repair-');
    const configPath = path.join(tempDir, 'config.toml');
    const original = [
      '[mcp_servers.github]',
      'command = "npx"',
      'args = ["-y", "@modelcontextprotocol/server-github"]',
      '',
      '[mcp_servers.exa]',
      'url = "https://mcp.exa.ai/mcp"',
      '',
    ].join('\n');

    try {
      fs.writeFileSync(configPath, original);
      const result = runNode(mergeMcpConfigScript, [configPath], deterministicPackageEnv);

      assert.strictEqual(result.status, 0, `${result.stdout}\n${result.stderr}`);
      assert.match(result.stdout, /\[repair\] mcp_servers\.exa/);

      const updated = fs.readFileSync(configPath, 'utf8');
      const parsed = TOML.parse(updated);
      assert.strictEqual(parsed.mcp_servers.exa, undefined, 'invalid exa url entry must be removed');
      assert.doesNotMatch(updated, /url = "https:\/\/mcp\.exa\.ai\/mcp"/);
      // User-managed servers are untouched; current default is added.
      assert.strictEqual(parsed.mcp_servers.github.command, 'npx');
      assert.strictEqual(parsed.mcp_servers['chrome-devtools'].command, 'npx');

      // Re-running must not re-introduce the invalid entry.
      const second = runNode(mergeMcpConfigScript, [configPath], deterministicPackageEnv);
      assert.strictEqual(second.status, 0, `${second.stdout}\n${second.stderr}`);
      assert.doesNotMatch(fs.readFileSync(configPath, 'utf8'), /mcp_servers\.exa/);
    } finally {
      cleanup(tempDir);
    }
  })
)
  passed++;
else failed++;

if (
  test('merge-mcp-config leaves a user-managed stdio exa entry untouched', () => {
    const tempDir = createTempDir('mcp-merge-exa-stdio-');
    const configPath = path.join(tempDir, 'config.toml');
    const original = [
      '[mcp_servers.exa]',
      'command = "npx"',
      'args = ["-y", "mcp-remote", "https://mcp.exa.ai/mcp"]',
      'startup_timeout_sec = 30',
      '',
    ].join('\n');

    try {
      fs.writeFileSync(configPath, original);
      const result = runNode(mergeMcpConfigScript, [configPath], deterministicPackageEnv);

      assert.strictEqual(result.status, 0, `${result.stdout}\n${result.stderr}`);
      assert.doesNotMatch(result.stdout, /\[repair\]/);

      const parsed = TOML.parse(fs.readFileSync(configPath, 'utf8'));
      assert.strictEqual(parsed.mcp_servers.exa.command, 'npx');
      assert.deepStrictEqual(parsed.mcp_servers.exa.args, ['-y', 'mcp-remote', 'https://mcp.exa.ai/mcp']);
    } finally {
      cleanup(tempDir);
    }
  })
)
  passed++;
else failed++;

if (
  test('merge-mcp-config update dry-run refreshes managed sections and leaves user servers alone', () => {
    const tempDir = createTempDir('mcp-merge-update-dry-run-');
    const configPath = path.join(tempDir, 'config.toml');
    const original = [
      '[mcp_servers.chrome-devtools]',
      'command = "custom"',
      'args = ["old"]',
      '',
      '[mcp_servers.context7]',
      'command = "npx"',
      'args = ["-y", "@upstash/context7-mcp@latest"]',
      '',
    ].join('\n');

    try {
      fs.writeFileSync(configPath, original);
      const result = runNode(mergeMcpConfigScript, [configPath, '--update-mcp', '--dry-run'], deterministicPackageEnv);

      assert.strictEqual(result.status, 0, `${result.stdout}\n${result.stderr}`);
      assert.match(result.stdout, /\[remove\] mcp_servers\.chrome-devtools/);
      assert.match(result.stdout, /\[mcp_servers\.chrome-devtools\]/);
      // Retired servers are no longer ECC-managed: never removed or re-added.
      assert.doesNotMatch(result.stdout, /\[remove\] mcp_servers\.context7/);
      assert.strictEqual(fs.readFileSync(configPath, 'utf8'), original);
    } finally {
      cleanup(tempDir);
    }
  })
)
  passed++;
else failed++;

if (
  test('merge-mcp-config removes disabled servers without appending replacements', () => {
    const tempDir = createTempDir('mcp-merge-disabled-');
    const configPath = path.join(tempDir, 'config.toml');
    const original = [
      '[mcp_servers.chrome-devtools]',
      'command = "npx"',
      'args = ["chrome-devtools-mcp@latest"]',
      '',
    ].join('\n');

    try {
      fs.writeFileSync(configPath, original);
      const result = runNode(mergeMcpConfigScript, [configPath], {
        ...deterministicPackageEnv,
        ECC_DISABLED_MCPS: 'chrome-devtools',
      });

      assert.strictEqual(result.status, 0, `${result.stdout}\n${result.stderr}`);
      assert.match(result.stdout, /Disabled via ECC_DISABLED_MCPS/);
      assert.match(result.stdout, /\[skip\] mcp_servers\.chrome-devtools \(disabled\)/);
      assert.match(result.stdout, /\[update\] mcp_servers\.chrome-devtools \(disabled\)/);
      assert.match(result.stdout, /Done\. Removed 1 server section\(s\)\./);

      const updated = fs.readFileSync(configPath, 'utf8');
      assert.doesNotMatch(updated, /chrome-devtools/);
    } finally {
      cleanup(tempDir);
    }
  })
)
  passed++;
else failed++;

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
      // Current default connector is added; retired servers are not emitted,
      // and pre-existing user-managed entries are preserved untouched.
      assert.ok(parsedConfig.mcp_servers['chrome-devtools']);
      assert.strictEqual(parsedConfig.mcp_servers.exa, undefined);
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
