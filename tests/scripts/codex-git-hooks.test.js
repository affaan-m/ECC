'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const PRE_PUSH_HOOK = path.join(
  __dirname,
  '..',
  '..',
  'scripts',
  'codex-git-hooks',
  'pre-push'
);
const GLOBAL_STATE_CHECK = path.join(
  __dirname,
  '..',
  '..',
  'scripts',
  'codex',
  'check-codex-global-state.sh'
);
const CI_WORKFLOW = path.join(__dirname, '..', '..', '.github', 'workflows', 'ci.yml');
const PUSH_UPDATE = `refs/heads/main ${'1'.repeat(40)} refs/heads/main ${'2'.repeat(40)}\n`;

console.log('=== Testing Codex git hooks ===\n');

let passed = 0;
let failed = 0;

function test(description, fn) {
  try {
    fn();
    console.log(`  ✓ ${description}`);
    passed++;
  } catch (error) {
    console.log(`  ✗ ${description}: ${error.message}`);
    failed++;
  }
}

test('pre-push leaves Python test execution to CI', () => {
  const projectMarkers = [
    ['requirements.txt', 'pytest\n'],
    ['pyproject.toml', '[tool.pytest.ini_options]\n']
  ];

  for (const [projectFile, projectContent] of projectMarkers) {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-pre-push-'));
    const binDir = path.join(tempRoot, 'bin');
    const pytestMarker = path.join(tempRoot, 'pytest-ran');

    try {
      fs.mkdirSync(binDir);
      fs.writeFileSync(path.join(tempRoot, projectFile), projectContent);
      fs.writeFileSync(
        path.join(binDir, 'pytest'),
        '#!/usr/bin/env bash\n: > "$PYTEST_MARKER"\nexit 42\n'
      );
      fs.chmodSync(path.join(binDir, 'pytest'), 0o755);
      const init = spawnSync('git', ['init'], { cwd: tempRoot, encoding: 'utf8' });
      assert.strictEqual(init.status, 0, `${projectFile}: git init failed: ${init.stderr}`);

      const hookEnv = {
        ...process.env,
        PATH: `${binDir}${path.delimiter}${process.env.PATH}`,
        PYTEST_MARKER: pytestMarker,
        ECC_SKIP_GIT_HOOKS: '0',
        ECC_SKIP_PREPUSH: '0'
      };
      for (const key of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_COMMON_DIR', 'GIT_PREFIX']) {
        delete hookEnv[key];
      }

      const result = spawnSync('bash', [PRE_PUSH_HOOK], {
        cwd: tempRoot,
        encoding: 'utf8',
        input: PUSH_UPDATE,
        env: hookEnv
      });

      assert.strictEqual(result.status, 0, `${projectFile}: ${result.stderr || result.stdout}`);
      assert.match(result.stdout, /\[ECC pre-push\]/, `${projectFile}: hook did not run`);
      assert.strictEqual(
        fs.existsSync(pytestMarker),
        false,
        `${projectFile}: pre-push must not invoke pytest`
      );
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  }
});

test('global state check detects a stale pytest hook without ripgrep', () => {
  if (process.platform === 'win32') return;

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-global-state-'));
  const codexHome = path.join(tempRoot, 'codex');
  const agentsHome = path.join(tempRoot, 'agents');
  const hooksDir = path.join(codexHome, 'git-hooks');
  const promptsDir = path.join(codexHome, 'prompts');
  const binDir = path.join(tempRoot, 'bin');
  const requiredCommands = ['awk', 'bash', 'dirname', 'find', 'grep', 'tr', 'wc'];
  const requiredSkills = [
    'api-design',
    'article-writing',
    'backend-patterns',
    'coding-standards',
    'content-engine',
    'e2e-testing',
    'eval-harness',
    'frontend-patterns',
    'frontend-slides',
    'investor-materials',
    'investor-outreach',
    'market-research',
    'security-review',
    'strategic-compact',
    'tdd-workflow',
    'verification-loop'
  ];

  try {
    fs.mkdirSync(hooksDir, { recursive: true });
    fs.mkdirSync(promptsDir, { recursive: true });
    fs.mkdirSync(binDir, { recursive: true });
    fs.mkdirSync(path.join(agentsHome, 'skills'), { recursive: true });

    fs.writeFileSync(
      path.join(codexHome, 'config.toml'),
      [
        'multi_agent = true',
        '[profiles.strict]',
        '[profiles.yolo]',
        '[mcp_servers.chrome-devtools]'
      ].join('\n')
    );
    fs.writeFileSync(
      path.join(codexHome, 'AGENTS.md'),
      '# Everything Claude Code (ECC)\n# Codex Supplement (From ECC .codex/AGENTS.md)\n'
    );
    fs.writeFileSync(path.join(promptsDir, 'ecc-prompts-manifest.txt'), '');
    fs.writeFileSync(path.join(promptsDir, 'ecc-extension-prompts-manifest.txt'), '');
    for (let index = 0; index < 43; index++) {
      fs.writeFileSync(path.join(promptsDir, `ecc-${index}.md`), '');
    }
    for (const skill of requiredSkills) {
      fs.mkdirSync(path.join(agentsHome, 'skills', skill));
    }
    fs.writeFileSync(path.join(hooksDir, 'pre-commit'), '#!/usr/bin/env bash\nexit 0\n');
    fs.writeFileSync(path.join(hooksDir, 'pre-push'), '#!/usr/bin/env bash\npytest -q\n');
    fs.chmodSync(path.join(hooksDir, 'pre-commit'), 0o755);
    fs.chmodSync(path.join(hooksDir, 'pre-push'), 0o755);

    for (const command of requiredCommands) {
      const resolved = spawnSync('sh', ['-c', `command -v ${command}`], { encoding: 'utf8' });
      assert.strictEqual(resolved.status, 0, `cannot resolve ${command}: ${resolved.stderr}`);
      fs.symlinkSync(resolved.stdout.trim(), path.join(binDir, command));
    }
    fs.writeFileSync(
      path.join(binDir, 'git'),
      '#!/usr/bin/env bash\nif [[ "$*" == "config --global --get core.hooksPath" ]]; then printf "%s\\n" "$TEST_HOOKS_PATH"; exit 0; fi\nexit 1\n'
    );
    fs.chmodSync(path.join(binDir, 'git'), 0o755);

    const result = spawnSync(path.join(binDir, 'bash'), [GLOBAL_STATE_CHECK], {
      encoding: 'utf8',
      env: {
        HOME: tempRoot,
        CODEX_HOME: codexHome,
        AGENTS_HOME: agentsHome,
        ECC_GLOBAL_HOOKS_DIR: hooksDir,
        TEST_HOOKS_PATH: hooksDir,
        PATH: binDir
      }
    });

    assert.strictEqual(result.status, 1, result.stderr || result.stdout);
    assert.match(result.stdout, /\[FAIL\] Global pre-push hook must leave pytest execution to CI/);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('CI collects the complete Python test tree', () => {
  const workflow = fs.readFileSync(CI_WORKFLOW, 'utf8');

  assert.match(workflow, /python -m pytest tests -m "not integration"/);
  assert.doesNotMatch(workflow, /python -m pytest tests\/test_\*\.py/);
});

console.log(`\n=== Results: Passed: ${passed}, Failed: ${failed} ===`);
if (failed > 0) process.exit(1);
