const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const agentsByCommand = {
  'review-pr': [
    'code-reviewer',
    'comment-analyzer',
    'pr-test-analyzer',
    'silent-failure-hunter',
    'type-design-analyzer',
    'code-simplifier',
  ],
  'react-review': ['react-reviewer', 'typescript-reviewer'],
  'react-test': ['react-reviewer'],
  'react-build': ['react-build-resolver'],
  'vue-review': ['vue-reviewer', 'typescript-reviewer'],
  'feature-dev': ['code-architect', 'code-explorer'],
  'orch-fix-defect': ['code-explorer'],
  'fastapi-review': ['fastapi-reviewer'],
  'flutter-review': ['flutter-reviewer'],
  'flutter-build': ['dart-build-resolver'],
  'flutter-test': ['dart-build-resolver', 'flutter-reviewer'],
  'gan-build': ['gan-planner', 'gan-generator', 'gan-evaluator'],
  'hookify': ['conversation-analyzer'],
  'marketing-campaign': ['marketing-agent'],
};

test('a full OpenCode install includes agents required by affected commands', () => {
  const repoRoot = path.resolve(__dirname, '..');
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-review-agents-'));
  const configHome = path.join(home, '.config');
  const installRoot = path.join(configHome, 'opencode');

  try {
    execFileSync(process.execPath, ['scripts/build-opencode.js'], {
      cwd: repoRoot,
      stdio: 'pipe',
    });

    execFileSync(process.execPath, [
      'scripts/install-apply.js',
      '--target', 'opencode',
      '--profile', 'full',
      '--no-hooks',
    ], {
      cwd: repoRoot,
      env: {
        ...process.env,
        HOME: home,
        USERPROFILE: home,
        XDG_CONFIG_HOME: configHome,
        OPENCODE_CONFIG_DIR: installRoot,
      },
      stdio: ['ignore', 'ignore', 'pipe'],
    });

    const config = JSON.parse(
      fs.readFileSync(path.join(installRoot, 'opencode.json'), 'utf8')
    );
    const missing = Object.entries(agentsByCommand).flatMap(([command, agents]) => {
      const commandFile = path.join(installRoot, 'commands', `${command}.md`);
      assert.ok(fs.existsSync(commandFile), `Expected /${command} to be installed`);

      return agents.filter(name => {
        const hasAgentFile = ['agents', 'agent'].some(folder =>
          fs.existsSync(path.join(installRoot, folder, `${name}.md`))
        );
        return !Object.hasOwn(config.agent ?? {}, name) && !hasAgentFile;
      }).map(name => `/${command} -> ${name}`);
    });

    assert.deepEqual(missing, [], `Missing OpenCode agents: ${missing.join(', ')}`);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});
