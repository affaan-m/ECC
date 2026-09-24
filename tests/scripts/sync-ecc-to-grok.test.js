/**
 * Source-level and isolated-home tests for scripts/sync-ecc-to-grok.sh
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const TOML = require('@iarna/toml');

const repoRoot = path.join(__dirname, '..', '..');
const scriptPath = path.join(repoRoot, 'scripts', 'sync-ecc-to-grok.sh');
const sanityCheckerPath = path.join(repoRoot, 'scripts', 'grok', 'check-grok-global-state.sh');
const legacyStateHelper = path.join(repoRoot, 'scripts', 'codex', 'legacy-sync-state.js');
const mergeMcpConfigScript = path.join(repoRoot, 'scripts', 'codex', 'merge-mcp-config.js');
const hooksInstallerPath = path.join(repoRoot, 'scripts', 'codex', 'install-global-git-hooks.sh');
const source = fs.readFileSync(scriptPath, 'utf8');
const sanitySource = fs.readFileSync(sanityCheckerPath, 'utf8');
const hooksSource = fs.readFileSync(hooksInstallerPath, 'utf8');
const normalizedSource = source.replace(/\r\n/g, '\n');

function extractFunction(name) {
  const start = normalizedSource.indexOf(`${name}() {`);
  if (start < 0) {
    return '';
  }
  let depth = 0;
  const bodyStart = normalizedSource.indexOf('{', start);
  if (bodyStart < 0) {
    return '';
  }
  for (let i = bodyStart; i < normalizedSource.length; i += 1) {
    const char = normalizedSource[i];
    if (char === '{') depth += 1;
    else if (char === '}') {
      depth -= 1;
      if (depth === 0) {
        return normalizedSource.slice(start, i + 1);
      }
    }
  }
  return '';
}

const runOrEchoSource = extractFunction('run_or_echo');

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

function resolveBashExecutable(env = process.env) {
  return env.BASH_PATH
    || (process.platform === 'win32' && fs.existsSync('C:\\Program Files\\Git\\bin\\bash.exe')
      ? 'C:\\Program Files\\Git\\bin\\bash.exe'
      : fs.existsSync('/bin/bash')
        ? '/bin/bash'
        : 'bash');
}

function runBash(targetPath, { args = [], env = {}, cwd = repoRoot } = {}) {
  const bash = resolveBashExecutable(env);
  return spawnSync(bash, [targetPath, ...args], {
    cwd,
    env: {
      ...process.env,
      ...env,
    },
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
  });
}

function runNode(targetPath, args = [], env = {}) {
  return spawnSync('node', [targetPath, ...args], {
    cwd: repoRoot,
    env: {
      ...process.env,
      CLAUDE_PACKAGE_MANAGER: 'npm',
      CLAUDE_CODE_PACKAGE_MANAGER: 'npm',
      ...env,
    },
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
  });
}

function makeHermeticGrokEnv(homeDir, grokDir, extraEnv = {}) {
  return {
    HOME: homeDir,
    USERPROFILE: homeDir,
    XDG_CONFIG_HOME: path.join(homeDir, '.config'),
    GIT_CONFIG_GLOBAL: path.join(homeDir, '.gitconfig'),
    GIT_CONFIG_NOSYSTEM: '1',
    GROK_HOME: grokDir,
    AGENTS_HOME: path.join(homeDir, '.agents'),
    ECC_GLOBAL_HOOKS_DIR: path.join(grokDir, 'git-hooks'),
    CLAUDE_PACKAGE_MANAGER: 'npm',
    CLAUDE_CODE_PACKAGE_MANAGER: 'npm',
    LANG: 'C.UTF-8',
    LC_ALL: 'C.UTF-8',
    ...extraEnv,
  };
}

function runTests() {
  console.log('\n=== Testing sync-ecc-to-grok.sh ===\n');

  let passed = 0;
  let failed = 0;

  if (test('run_or_echo does not use eval', () => {
    assert.ok(runOrEchoSource, 'Expected to locate run_or_echo function body');
    assert.ok(!runOrEchoSource.includes('eval "$@"'), 'run_or_echo should not execute through eval');
  })) passed++; else failed++;

  if (test('run_or_echo executes argv directly', () => {
    assert.ok(runOrEchoSource.includes('    "$@"'), 'run_or_echo should execute the argv vector directly');
  })) passed++; else failed++;

  if (test('dry-run output shell-escapes argv', () => {
    assert.ok(runOrEchoSource.includes("printf ' %q' \"$@\""), 'Dry-run mode should print shell-escaped argv');
  })) passed++; else failed++;

  if (test('filesystem-changing calls use argv-form run_or_echo invocations', () => {
    assert.ok(source.includes('run_or_echo mkdir -p "$BACKUP_DIR"'), 'mkdir should use argv form');
    assert.ok(source.includes('run_or_echo mkdir -p "$(dirname "$GROK_NAV_GUIDE_DEST")"'));
    assert.ok(source.includes('run_or_echo cp "$GROK_NAV_GUIDE_SRC" "$GROK_NAV_GUIDE_DEST"'));
    assert.ok(source.includes('run_or_echo cp "$GROK_COMMAND_AGENT_MAP_SRC" "$GROK_COMMAND_AGENT_MAP_DEST"'));
    assert.ok(source.includes('run_or_echo cp "$GROK_COMMANDS_QUICK_REF_SRC" "$GROK_COMMANDS_QUICK_REF_DEST"'));
    assert.ok(source.includes('run_or_echo cp "$GROK_CONTRIBUTING_SRC" "$GROK_CONTRIBUTING_DEST"'));
    assert.ok(source.includes('run_or_echo mkdir -p "$(dirname "$GROK_PR_TEMPLATE_DEST")"'));
    assert.ok(source.includes('run_or_echo cp "$GROK_PR_TEMPLATE_SRC" "$GROK_PR_TEMPLATE_DEST"'));
    assert.ok(!source.includes('run_or_echo rm -rf "$dest"'));
    assert.ok(!source.includes('run_or_echo cp -R "$skill_dir" "$dest"'));
  })) passed++; else failed++;

  if (test('sync script uses Grok-native source and destination paths', () => {
    assert.ok(source.includes('GROK_HOME="${GROK_HOME:-$HOME/.grok}"'));
    assert.ok(source.includes('AGENTS_GROK_SUPP_SRC="$REPO_ROOT/.grok/AGENTS.md"'));
    assert.ok(source.includes('GROK_AGENTS_SRC="$REPO_ROOT/.grok/agents"'));
    assert.ok(source.includes('GROK_AGENTS_DEST="$GROK_HOME/agents"'));
    assert.ok(source.includes('GROK_NAV_GUIDE_SRC="$REPO_ROOT/docs/GROK-NAVIGATION-GUIDE.md"'));
    assert.ok(source.includes('GROK_NAV_GUIDE_DEST="$GROK_HOME/docs/GROK-NAVIGATION-GUIDE.md"'));
    assert.ok(source.includes('COMMANDS_DEST="$GROK_HOME/commands"'));
    assert.ok(source.includes('AGENTS_HOME="${AGENTS_HOME:-$HOME/.agents}"'));
    assert.ok(source.includes('AGENTS_SKILLS_SRC="$REPO_ROOT/.agents/skills"'));
    assert.ok(source.includes('AGENTS_SKILLS_DEST="$AGENTS_HOME/skills"'));
    assert.ok(source.includes('--trusted-root "$AGENTS_HOME"'));
    assert.ok(source.includes('SKILLS_INSTALLER="$REPO_ROOT/scripts/grok/install-agents-skills.js"'));
    assert.ok(source.includes('COMMAND_GENERATOR="$REPO_ROOT/scripts/grok/generate-command-file.js"'));
    assert.ok(source.includes('COMMANDS_INSTALLER="$REPO_ROOT/scripts/grok/install-grok-commands.js"'));
    assert.ok(!source.includes('find "$AGENTS_SKILLS_SRC"'));
    assert.ok(source.includes('require_path "$GROK_NAV_GUIDE_SRC" "ECC Grok navigation guide"'));
    for (const required of [
      'GROK_COMMAND_AGENT_MAP_SRC="$REPO_ROOT/docs/COMMAND-AGENT-MAP.md"',
      'GROK_COMMANDS_QUICK_REF_SRC="$REPO_ROOT/COMMANDS-QUICK-REF.md"',
      'GROK_CONTRIBUTING_SRC="$REPO_ROOT/CONTRIBUTING.md"',
      'GROK_PR_TEMPLATE_SRC="$REPO_ROOT/.github/PULL_REQUEST_TEMPLATE.md"',
    ]) {
      assert.ok(source.includes(required), `Expected ${required}`);
    }
  })) passed++; else failed++;

  if (test('sync script does not reuse Codex-only sources, config merge, or prompts dir', () => {
    assert.ok(!source.includes('merge-codex-config.js'));
    assert.ok(!source.includes('check-codex-global-state.sh'));
    assert.ok(!source.includes('CODEX_HOME'));
    assert.ok(!source.includes('.codex/AGENTS.md'));
    assert.ok(!source.includes('docs/CODEX-NAVIGATION-GUIDE.md'));
    assert.ok(!source.includes('*.toml'));
    assert.ok(!source.includes('$GROK_HOME/prompts'));
  })) passed++; else failed++;

  if (test('sync script avoids GNU-only grep -P parsing', () => {
    assert.ok(!source.includes('grep -oP'));
  })) passed++; else failed++;

  if (test('Grok sync does not keep unused Codex TOML helper functions', () => {
    assert.ok(!source.includes('extract_context7_key() {'));
    assert.ok(!source.includes('generate_command_file() {'));
    assert.ok(!source.includes('toml_escape() {'));
    assert.ok(!source.includes('remove_section_inplace() {'));
    assert.ok(source.includes('basename "$previous_extension"'));
  })) passed++; else failed++;

  if (test('process substitution has no space before the inner parenthesis', () => {
    assert.ok(!source.includes('done < < (find'));
    assert.ok(source.includes('COMMANDS_INSTALLER="$REPO_ROOT/scripts/grok/install-grok-commands.js"'));
  })) passed++; else failed++;

  if (test('sync records a versioned ownership manifest before mutating Grok state', () => {
    const beginIndex = source.indexOf('"$LEGACY_STATE_HELPER" begin');
    const mcpMergeIndex = source.indexOf('node "$MCP_MERGE_SCRIPT" "$CONFIG_FILE"');
    const finalizeIndex = source.indexOf('"$LEGACY_STATE_HELPER" finalize');
    assert.ok(beginIndex > -1, 'legacy manifest begin is missing');
    assert.ok(mcpMergeIndex > beginIndex, 'manifest must begin before config mutation');
    assert.ok(finalizeIndex > mcpMergeIndex, 'manifest must finalize after managed writes');
    assert.ok(source.includes('--grok-home "$GROK_HOME"'));
    assert.ok(source.includes('record_managed_path "$copied"'));
    assert.ok(source.includes('record_managed_path "${ECC_GLOBAL_HOOKS_DIR:-$GROK_HOME/git-hooks}/pre-commit"'));
    assert.ok(
      source.includes('node "$SKILLS_INSTALLER" "$AGENTS_SKILLS_SRC" "$AGENTS_SKILLS_DEST" --dry-run > "$_skills_copied"'),
      'skills dests must be recorded from a dry-run listing before copy'
    );
    assert.ok(
      source.includes('node "$COMMANDS_INSTALLER" "${COMMAND_INSTALL_ARGS[@]}" --dry-run > "$_commands_copied"'),
      'command dests must be recorded from a dry-run listing before write'
    );
  })) passed++; else failed++;

  if (test('sync inherits its ERR trap so helper failures trigger rollback', () => {
    assert.match(source, /^set -Eeuo pipefail$/m);
    assert.ok(source.includes("trap 'rollback_legacy_sync $?' ERR"));
    assert.ok(source.includes('node "$LEGACY_STATE_HELPER" rollback --state "$LEGACY_STATE_PATH"'));
    assert.ok(
      source.indexOf("trap 'rollback_legacy_sync $?' ERR")
        < source.indexOf('record_managed_path "$CONFIG_FILE"')
    );
  })) passed++; else failed++;

  if (test('MCP merge is invoked with a Grok harness flag', () => {
    assert.ok(source.includes('--harness grok'));
  })) passed++; else failed++;

  if (test('sanity checker is Grok-native and does not require Codex config keys', () => {
    assert.ok(source.includes('SANITY_CHECKER="$REPO_ROOT/scripts/grok/check-grok-global-state.sh"'));
    assert.ok(sanitySource.includes('GROK_HOME="${GROK_HOME:-$HOME/.grok}"'));
    assert.ok(sanitySource.includes('$GROK_HOME/commands'));
    assert.ok(sanitySource.includes('${AGENTS_HOME:-$HOME/.agents}/skills'));
    assert.ok(!sanitySource.includes('$REPO_ROOT/.agents'));
    assert.ok(sanitySource.includes('Grok Supplement'));
    assert.ok(!sanitySource.includes('multi_agent'));
    assert.ok(!sanitySource.includes('profiles.strict'));
    assert.ok(!sanitySource.includes('persistent_instructions'));
    assert.ok(!sanitySource.includes('url is not valid for Codex'));
  })) passed++; else failed++;

  if (test('git hooks installer backs up next to the destination home, not a hardcoded Codex path', () => {
    assert.ok(hooksSource.includes('BACKUP_DIR="$(dirname "$DEST_DIR")/backups/git-hooks-$STAMP"'));
    assert.ok(!hooksSource.includes('BACKUP_DIR="$HOME/.codex/backups/git-hooks-$STAMP"'));
  })) passed++; else failed++;

  if (test('legacy-sync-state.js accepts --grok-home as the harness home', () => {
    const homeDir = createTempDir('grok-legacy-home-');
    const grokHome = path.join(homeDir, '.grok');
    const backupDir = path.join(grokHome, 'backups', 'ecc-test');
    fs.mkdirSync(grokHome, { recursive: true });
    fs.mkdirSync(backupDir, { recursive: true });
    fs.writeFileSync(path.join(grokHome, 'config.toml'), '[models]\ndefault = "grok-4.6"\n');
    try {
      const result = runNode(legacyStateHelper, [
        'begin',
        '--grok-home', grokHome,
        '--backup-dir', backupDir,
      ]);
      assert.strictEqual(result.status, 0, result.stderr || result.stdout);
      const statePath = result.stdout.trim();
      assert.ok(fs.existsSync(statePath), 'expected a Grok legacy sync state file');
      const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
      assert.strictEqual(path.resolve(state.codexHome), path.resolve(grokHome));
    } finally {
      cleanup(homeDir);
    }
  })) passed++; else failed++;

  if (test('MCP merge --harness grok keeps a valid Grok HTTP exa entry', () => {
    const tempDir = createTempDir('grok-mcp-url-');
    const configPath = path.join(tempDir, 'config.toml');
    const original = [
      '[mcp_servers.exa]',
      'url = "https://mcp.exa.ai/mcp"',
      '',
    ].join('\n');
    try {
      fs.writeFileSync(configPath, original);
      const result = runNode(mergeMcpConfigScript, [configPath, '--harness', 'grok']);
      assert.strictEqual(result.status, 0, result.stderr || result.stdout);
      const parsed = TOML.parse(fs.readFileSync(configPath, 'utf8'));
      assert.strictEqual(parsed.mcp_servers.exa.url, 'https://mcp.exa.ai/mcp');
      assert.ok(parsed.mcp_servers['chrome-devtools']);
    } finally {
      cleanup(tempDir);
    }
  })) passed++; else failed++;

  if (test('dry-run against an isolated Grok home does not write managed files', () => {
    const homeDir = createTempDir('grok-sync-dry-run-');
    const grokDir = path.join(homeDir, '.grok');
    fs.mkdirSync(grokDir, { recursive: true });
    fs.writeFileSync(path.join(grokDir, 'config.toml'), '[models]\ndefault = "grok-4.6"\n');
    try {
      const result = runBash(scriptPath, {
        args: ['--dry-run'],
        env: makeHermeticGrokEnv(homeDir, grokDir),
      });
      assert.strictEqual(result.status, 0, `${result.stdout}\n${result.stderr}`);
      assert.match(result.stdout, /\[dry-run\]/);
      assert.ok(!fs.existsSync(path.join(grokDir, 'AGENTS.md')));
      assert.ok(!fs.existsSync(path.join(grokDir, 'commands')));
      assert.ok(!fs.existsSync(path.join(grokDir, 'agents')));
      assert.ok(!fs.existsSync(path.join(homeDir, '.agents', 'skills', 'tdd-workflow')));
      const parsed = TOML.parse(fs.readFileSync(path.join(grokDir, 'config.toml'), 'utf8'));
      assert.strictEqual(parsed.mcp_servers, undefined);
    } finally {
      cleanup(homeDir);
    }
  })) passed++; else failed++;

  if (test('apply sync writes Grok commands, agents, AGENTS.md, and MCP without Codex keys', () => {
    const homeDir = createTempDir('grok-sync-apply-');
    const grokDir = path.join(homeDir, '.grok');
    const configPath = path.join(grokDir, 'config.toml');
    fs.mkdirSync(grokDir, { recursive: true });
    fs.writeFileSync(configPath, [
      '[cli]',
      'installer = "internal"',
      '',
      '[models]',
      'default = "grok-4.6"',
      '',
    ].join('\n'));
    try {
      const result = runBash(scriptPath, {
        env: makeHermeticGrokEnv(homeDir, grokDir),
      });
      assert.strictEqual(result.status, 0, `${result.stdout}\n${result.stderr}`);

      const agents = fs.readFileSync(path.join(grokDir, 'AGENTS.md'), 'utf8');
      assert.match(agents, /^# Everything Claude Code \(ECC\) — Agent Instructions/m);
      assert.match(agents, /^# Grok Supplement \(From ECC \.grok\/AGENTS\.md\)/m);

      const parsed = TOML.parse(fs.readFileSync(configPath, 'utf8'));
      assert.strictEqual(parsed.models.default, 'grok-4.6');
      assert.strictEqual(parsed.approval_policy, undefined);
      assert.strictEqual(parsed.sandbox_mode, undefined);
      assert.ok(parsed.mcp_servers['chrome-devtools']);

      for (const agentFile of ['explorer.md', 'reviewer.md', 'docs-researcher.md']) {
        assert.ok(fs.existsSync(path.join(grokDir, 'agents', agentFile)), `missing ${agentFile}`);
      }
      assert.ok(!fs.existsSync(path.join(grokDir, 'agents', 'explorer.toml')));
      assert.ok(fs.existsSync(path.join(grokDir, 'commands', 'ecc-commands-manifest.txt')));
      assert.ok(fs.existsSync(path.join(grokDir, 'commands', 'ecc-plan.md')));
      const planCommand = fs.readFileSync(path.join(grokDir, 'commands', 'ecc-plan.md'), 'utf8');
      assert.match(planCommand, /^---\nname: ecc-plan\ndescription: "/);
      assert.ok(!planCommand.includes('Source: '));
      assert.match(planCommand, /WAIT for user CONFIRM/);
      assert.ok(fs.existsSync(path.join(grokDir, 'commands', 'aside.md')));
      assert.ok(!fs.existsSync(path.join(grokDir, 'commands', 'ecc-aside.md')));
      const asideCommand = fs.readFileSync(path.join(grokDir, 'commands', 'aside.md'), 'utf8');
      assert.match(asideCommand, /^---\nname: aside\ndescription: "/);
      assert.ok(fs.existsSync(path.join(grokDir, 'docs', 'GROK-NAVIGATION-GUIDE.md')));
      assert.ok(fs.existsSync(path.join(grokDir, 'git-hooks', 'pre-commit')));
      assert.ok(fs.existsSync(path.join(homeDir, '.agents', 'skills', 'tdd-workflow', 'SKILL.md')));
      assert.ok(!fs.existsSync(path.join(homeDir, '.codex')));
    } finally {
      cleanup(homeDir);
    }
  })) passed++; else failed++;

  if (test('skill install skips native copy when a whitespace-equivalent source-command wrapper exists', () => {
    const homeDir = createTempDir('grok-sync-skill-eq-');
    const grokDir = path.join(homeDir, '.grok');
    const nativeSkill = fs.readFileSync(
      path.join(repoRoot, '.agents', 'skills', 'tdd-workflow', 'SKILL.md'),
      'utf8'
    );
    fs.mkdirSync(grokDir, { recursive: true });
    fs.writeFileSync(path.join(grokDir, 'config.toml'), '[models]\ndefault = "grok-4.6"\n');
    const wrapperPath = path.join(homeDir, '.agents', 'skills', 'source-command-tdd-workflow', 'SKILL.md');
    fs.mkdirSync(path.dirname(wrapperPath), { recursive: true });
    fs.writeFileSync(wrapperPath, nativeSkill.replace(/\n/g, '\n\n'));
    try {
      const result = runBash(scriptPath, { env: makeHermeticGrokEnv(homeDir, grokDir) });
      assert.strictEqual(result.status, 0, `${result.stdout}\n${result.stderr}`);
      assert.ok(!fs.existsSync(path.join(homeDir, '.agents', 'skills', 'tdd-workflow')));
      assert.strictEqual(fs.readFileSync(wrapperPath, 'utf8'), nativeSkill.replace(/\n/g, '\n\n'));
    } finally {
      cleanup(homeDir);
    }
  })) passed++; else failed++;

  if (test('apply sync ignores extension-manifest entries that escape the commands directory', () => {
    const homeDir = createTempDir('grok-sync-ext-escape-');
    const grokDir = path.join(homeDir, '.grok');
    const commandsDir = path.join(grokDir, 'commands');
    const outside = path.join(homeDir, 'outside.txt');
    fs.mkdirSync(commandsDir, { recursive: true });
    fs.writeFileSync(path.join(grokDir, 'config.toml'), '[models]\ndefault = "grok-4.6"\n');
    fs.writeFileSync(outside, 'KEEP\n');
    fs.writeFileSync(
      path.join(commandsDir, 'ecc-extension-commands-manifest.txt'),
      '../../outside.txt\n'
    );
    try {
      const result = runBash(scriptPath, { env: makeHermeticGrokEnv(homeDir, grokDir) });
      assert.strictEqual(result.status, 0, `${result.stdout}\n${result.stderr}`);
      assert.strictEqual(fs.readFileSync(outside, 'utf8'), 'KEEP\n');
    } finally {
      cleanup(homeDir);
    }
  })) passed++; else failed++;

  if (test('skill install copies native files beside a different wrapper and never overwrites dest files', () => {
    const homeDir = createTempDir('grok-sync-skill-diff-');
    const grokDir = path.join(homeDir, '.grok');
    fs.mkdirSync(grokDir, { recursive: true });
    fs.writeFileSync(path.join(grokDir, 'config.toml'), '[models]\ndefault = "grok-4.6"\n');
    const wrapperPath = path.join(homeDir, '.agents', 'skills', 'source-command-plan-canvas', 'SKILL.md');
    const existingNative = path.join(homeDir, '.agents', 'skills', 'coding-standards', 'SKILL.md');
    fs.mkdirSync(path.dirname(wrapperPath), { recursive: true });
    fs.mkdirSync(path.dirname(existingNative), { recursive: true });
    const wrapperBody = '---\nname: source-command-plan-canvas\n---\nUse gpt-5.5\n';
    fs.writeFileSync(wrapperPath, wrapperBody);
    fs.writeFileSync(existingNative, 'DO NOT TOUCH\n');
    try {
      const result = runBash(scriptPath, { env: makeHermeticGrokEnv(homeDir, grokDir) });
      assert.strictEqual(result.status, 0, `${result.stdout}\n${result.stderr}`);
      assert.ok(fs.existsSync(path.join(homeDir, '.agents', 'skills', 'plan-canvas', 'SKILL.md')));
      assert.strictEqual(fs.readFileSync(wrapperPath, 'utf8'), wrapperBody);
      assert.strictEqual(fs.readFileSync(existingNative, 'utf8'), 'DO NOT TOUCH\n');
    } finally {
      cleanup(homeDir);
    }
  })) passed++; else failed++;

  console.log(`\nResults: Passed: ${passed}, Failed: ${failed}`);
  process.exit(failed > 0 ? 1 : 0);
}

runTests();
