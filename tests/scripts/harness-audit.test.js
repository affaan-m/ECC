/**
 * Tests for scripts/harness-audit.js
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

const SCRIPT = path.join(__dirname, '..', '..', 'scripts', 'harness-audit.js');
const { parseArgs, findPluginInstall, compareVersionDesc } = require(SCRIPT);

function createTempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function cleanup(dirPath) {
  fs.rmSync(dirPath, { recursive: true, force: true });
}

function buildEnv(options = {}) {
  const userProfile = options.userProfile || options.homeDir || process.env.USERPROFILE;
  const env = {
    ...process.env,
    USERPROFILE: userProfile,
  };

  if (Object.prototype.hasOwnProperty.call(options, 'homeDir')) {
    env.HOME = options.homeDir;
  } else {
    env.HOME = process.env.HOME;
  }

  return env;
}

function run(args = [], options = {}) {
  const stdout = execFileSync('node', [SCRIPT, ...args], {
    cwd: options.cwd || path.join(__dirname, '..', '..'),
    env: buildEnv(options),
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
    timeout: 10000,
  });

  return stdout;
}

function runProcess(args = [], options = {}) {
  return spawnSync('node', [SCRIPT, ...args], {
    cwd: options.cwd || path.join(__dirname, '..', '..'),
    env: buildEnv(options),
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
    timeout: 10000,
  });
}

function test(name, fn) {
  try {
    fn();
    console.log(`  \u2713 ${name}`);
    return true;
  } catch (error) {
    console.log(`  \u2717 ${name}`);
    console.log(`    Error: ${error.message}`);
    return false;
  }
}

function runTests() {
  console.log('\n=== Testing harness-audit.js ===\n');

  let passed = 0;
  let failed = 0;

  if (test('parseArgs accepts supported forms and rejects invalid arguments', () => {
    const rootDir = createTempDir('harness-audit-args-root-');

    try {
      assert.strictEqual(parseArgs(['node', 'script', '--help']).help, true);
      assert.strictEqual(parseArgs(['node', 'script', '-h']).help, true);

      const spaced = parseArgs(['node', 'script', '--format', 'json', '--scope', 'skills', '--root', rootDir]);
      assert.strictEqual(spaced.format, 'json');
      assert.strictEqual(spaced.scope, 'skills');
      assert.strictEqual(spaced.root, path.resolve(rootDir));

      const equals = parseArgs(['node', 'script', '--format=json', '--scope=hooks', `--root=${rootDir}`]);
      assert.strictEqual(equals.format, 'json');
      assert.strictEqual(equals.scope, 'hooks');
      assert.strictEqual(equals.root, path.resolve(rootDir));

      assert.strictEqual(parseArgs(['node', 'script', 'commands']).scope, 'commands');
      assert.strictEqual(parseArgs(['node', 'script', '--scope']).scope, 'repo');
      assert.throws(() => parseArgs(['node', 'script', '--format', 'xml']), /Invalid format: xml/);
      assert.throws(() => parseArgs(['node', 'script', '--scope', 'bad-scope']), /Invalid scope: bad-scope/);
      assert.throws(() => parseArgs(['node', 'script', '--unknown']), /Unknown argument: --unknown/);
    } finally {
      cleanup(rootDir);
    }
  })) passed++; else failed++;

  if (test('cli help exits cleanly and invalid cli args exit with stderr', () => {
    const help = runProcess(['--help']);
    assert.strictEqual(help.status, 0);
    assert.strictEqual(help.stderr, '');
    assert.ok(help.stdout.includes('Usage: node scripts/harness-audit.js'));
    assert.ok(help.stdout.includes('Deterministic harness audit'));

    const invalid = runProcess(['--format', 'xml']);
    assert.strictEqual(invalid.status, 1);
    assert.strictEqual(invalid.stdout, '');
    assert.ok(invalid.stderr.includes('Error: Invalid format: xml. Use text or json.'));
  })) passed++; else failed++;

  if (test('json output is deterministic between runs', () => {
    const first = run(['repo', '--format', 'json']);
    const second = run(['repo', '--format', 'json']);

    assert.strictEqual(first, second);
  })) passed++; else failed++;

  if (test('report includes bounded scores and fixed categories', () => {
    const parsed = JSON.parse(run(['repo', '--format', 'json']));

    assert.strictEqual(parsed.deterministic, true);
    assert.strictEqual(parsed.rubric_version, '2026-05-19');
    assert.strictEqual(parsed.target_mode, 'repo');
    assert.ok(parsed.overall_score >= 0);
    assert.ok(parsed.max_score > 0);
    assert.ok(parsed.overall_score <= parsed.max_score);

    const categoryNames = Object.keys(parsed.categories);
    assert.ok(categoryNames.includes('Tool Coverage'));
    assert.ok(categoryNames.includes('Context Efficiency'));
    assert.ok(categoryNames.includes('Quality Gates'));
    assert.ok(categoryNames.includes('Memory Persistence'));
    assert.ok(categoryNames.includes('Eval Coverage'));
    assert.ok(categoryNames.includes('Security Guardrails'));
    assert.ok(categoryNames.includes('Cost Efficiency'));
    assert.ok(categoryNames.includes('GitHub Integration'));
  })) passed++; else failed++;

  if (test('report exposes applicable_categories and category_count', () => {
    const parsed = JSON.parse(run(['repo', '--format', 'json']));

    assert.ok(Array.isArray(parsed.applicable_categories), 'applicable_categories must be an array');
    assert.ok(parsed.applicable_categories.length > 0);
    assert.strictEqual(parsed.category_count, parsed.applicable_categories.length);
    for (const name of parsed.applicable_categories) {
      assert.ok(parsed.categories[name].max > 0, `${name} must have max > 0 to be applicable`);
    }
  })) passed++; else failed++;

  if (test('GitHub Integration category scores against a fully-wired consumer fixture', () => {
    const homeDir = createTempDir('harness-audit-home-gh-');
    const projectRoot = createTempDir('harness-audit-project-gh-');

    try {
      fs.mkdirSync(path.join(homeDir, '.claude', 'plugins', 'ecc', '.claude-plugin'), { recursive: true });
      fs.writeFileSync(
        path.join(homeDir, '.claude', 'plugins', 'ecc', '.claude-plugin', 'plugin.json'),
        JSON.stringify({ name: 'ecc' }, null, 2)
      );

      fs.mkdirSync(path.join(projectRoot, '.github', 'workflows'), { recursive: true });
      fs.mkdirSync(path.join(projectRoot, '.github', 'ISSUE_TEMPLATE'), { recursive: true });
      fs.writeFileSync(path.join(projectRoot, '.github', 'workflows', 'ci.yml'), 'name: ci\n');
      fs.writeFileSync(path.join(projectRoot, '.github', 'PULL_REQUEST_TEMPLATE.md'), '# PR\n');
      fs.writeFileSync(path.join(projectRoot, '.github', 'ISSUE_TEMPLATE', 'bug.md'), '# Bug\n');
      fs.writeFileSync(path.join(projectRoot, '.github', 'CODEOWNERS'), '* @owner\n');
      fs.writeFileSync(path.join(projectRoot, '.github', 'dependabot.yml'), 'version: 2\n');
      fs.writeFileSync(path.join(projectRoot, 'package.json'), JSON.stringify({ name: 'gh-test' }));

      const parsed = JSON.parse(run(['repo', '--format', 'json'], { cwd: projectRoot, homeDir }));
      const github = parsed.categories['GitHub Integration'];

      assert.ok(github, 'GitHub Integration category must exist');
      assert.strictEqual(github.score, 10, `GitHub Integration should score 10/10, got ${github.score}`);
      assert.strictEqual(github.earned, github.max);
      assert.ok(parsed.applicable_categories.includes('GitHub Integration'));
    } finally {
      cleanup(homeDir);
      cleanup(projectRoot);
    }
  })) passed++; else failed++;

  if (test('provider categories are omitted unless a marker is present', () => {
    const homeDir = createTempDir('harness-audit-home-no-provider-');
    const projectRoot = createTempDir('harness-audit-project-no-provider-');

    try {
      fs.mkdirSync(path.join(homeDir, '.claude', 'plugins', 'ecc', '.claude-plugin'), { recursive: true });
      fs.writeFileSync(
        path.join(homeDir, '.claude', 'plugins', 'ecc', '.claude-plugin', 'plugin.json'),
        JSON.stringify({ name: 'ecc' }, null, 2)
      );
      fs.writeFileSync(path.join(projectRoot, 'package.json'), JSON.stringify({ name: 'p' }));

      const parsed = JSON.parse(run(['repo', '--format', 'json'], { cwd: projectRoot, homeDir }));

      assert.ok(!parsed.applicable_categories.includes('Vercel Integration'));
      const vercel = parsed.categories['Vercel Integration'];
      assert.ok(!vercel || vercel.max === 0, 'Vercel Integration should not contribute when no marker');
    } finally {
      cleanup(homeDir);
      cleanup(projectRoot);
    }
  })) passed++; else failed++;

  if (test('Vercel Integration category scores when vercel.json present', () => {
    const homeDir = createTempDir('harness-audit-home-vercel-');
    const projectRoot = createTempDir('harness-audit-project-vercel-');

    try {
      fs.mkdirSync(path.join(homeDir, '.claude', 'plugins', 'ecc', '.claude-plugin'), { recursive: true });
      fs.writeFileSync(
        path.join(homeDir, '.claude', 'plugins', 'ecc', '.claude-plugin', 'plugin.json'),
        JSON.stringify({ name: 'ecc' }, null, 2)
      );

      fs.mkdirSync(path.join(projectRoot, '.github', 'workflows'), { recursive: true });
      fs.writeFileSync(path.join(projectRoot, 'vercel.json'), '{}\n');
      fs.writeFileSync(path.join(projectRoot, '.env.example'), 'VERCEL_TOKEN=\n');
      fs.writeFileSync(path.join(projectRoot, '.github', 'workflows', 'deploy.yml'), 'uses: amondnet/vercel-action@v25\n');
      fs.writeFileSync(
        path.join(projectRoot, 'package.json'),
        JSON.stringify({ name: 'p', scripts: { build: 'next build', deploy: 'vercel deploy' } })
      );

      const parsed = JSON.parse(run(['repo', '--format', 'json'], { cwd: projectRoot, homeDir }));
      const vercel = parsed.categories['Vercel Integration'];

      assert.ok(vercel, 'Vercel Integration category must exist when vercel.json present');
      assert.ok(vercel.max > 0);
      assert.ok(parsed.applicable_categories.includes('Vercel Integration'));
      assert.strictEqual(vercel.score, 10, `Vercel should score 10/10 with full wiring, got ${vercel.score}`);
    } finally {
      cleanup(homeDir);
      cleanup(projectRoot);
    }
  })) passed++; else failed++;

  if (test('detector map: Netlify, Cloudflare, Fly each trigger their category', () => {
    const homeDir = createTempDir('harness-audit-home-multi-');

    function probe(markerFile, markerContents, expectedCategory) {
      const root = createTempDir('harness-audit-project-multi-');
      try {
        fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'p' }));
        fs.writeFileSync(path.join(root, markerFile), markerContents);
        const parsed = JSON.parse(run(['repo', '--format', 'json'], { cwd: root, homeDir }));
        assert.ok(
          parsed.applicable_categories.includes(expectedCategory),
          `${markerFile} should activate ${expectedCategory}`
        );
      } finally {
        cleanup(root);
      }
    }

    try {
      fs.mkdirSync(path.join(homeDir, '.claude', 'plugins', 'ecc', '.claude-plugin'), { recursive: true });
      fs.writeFileSync(
        path.join(homeDir, '.claude', 'plugins', 'ecc', '.claude-plugin', 'plugin.json'),
        JSON.stringify({ name: 'ecc' }, null, 2)
      );

      probe('netlify.toml', '[build]\n', 'Netlify Integration');
      probe('wrangler.toml', 'name = "p"\n', 'Cloudflare Integration');
      probe('fly.toml', 'app = "p"\n', 'Fly Integration');
    } finally {
      cleanup(homeDir);
    }
  })) passed++; else failed++;

  if (test('max_score reflects only applicable categories', () => {
    const homeDir = createTempDir('harness-audit-home-max-');
    const noVercel = createTempDir('harness-audit-project-max-novercel-');
    const withVercel = createTempDir('harness-audit-project-max-vercel-');

    try {
      fs.mkdirSync(path.join(homeDir, '.claude', 'plugins', 'ecc', '.claude-plugin'), { recursive: true });
      fs.writeFileSync(
        path.join(homeDir, '.claude', 'plugins', 'ecc', '.claude-plugin', 'plugin.json'),
        JSON.stringify({ name: 'ecc' }, null, 2)
      );

      fs.writeFileSync(path.join(noVercel, 'package.json'), JSON.stringify({ name: 'p' }));
      fs.writeFileSync(path.join(withVercel, 'package.json'), JSON.stringify({ name: 'p' }));
      fs.writeFileSync(path.join(withVercel, 'vercel.json'), '{}\n');

      const noVercelParsed = JSON.parse(run(['repo', '--format', 'json'], { cwd: noVercel, homeDir }));
      const withVercelParsed = JSON.parse(run(['repo', '--format', 'json'], { cwd: withVercel, homeDir }));

      assert.ok(
        withVercelParsed.max_score > noVercelParsed.max_score,
        `with-vercel max_score (${withVercelParsed.max_score}) should exceed no-vercel (${noVercelParsed.max_score})`
      );
    } finally {
      cleanup(homeDir);
      cleanup(noVercel);
      cleanup(withVercel);
    }
  })) passed++; else failed++;

  if (test('non-git directory does not crash the script', () => {
    const homeDir = createTempDir('harness-audit-home-bare-');
    const bare = createTempDir('harness-audit-project-bare-');

    try {
      fs.mkdirSync(path.join(homeDir, '.claude', 'plugins', 'ecc', '.claude-plugin'), { recursive: true });
      fs.writeFileSync(
        path.join(homeDir, '.claude', 'plugins', 'ecc', '.claude-plugin', 'plugin.json'),
        JSON.stringify({ name: 'ecc' }, null, 2)
      );
      fs.writeFileSync(path.join(bare, 'package.json'), JSON.stringify({ name: 'p' }));

      const output = run(['repo', '--format', 'json'], { cwd: bare, homeDir });
      const parsed = JSON.parse(output);
      assert.ok(parsed.overall_score >= 0);
      assert.ok(parsed.max_score > 0);
    } finally {
      cleanup(homeDir);
      cleanup(bare);
    }
  })) passed++; else failed++;

  if (test('scope filtering changes max score and check list', () => {
    const full = JSON.parse(run(['repo', '--format', 'json']));
    const scoped = JSON.parse(run(['hooks', '--format', 'json']));

    assert.strictEqual(scoped.scope, 'hooks');
    assert.ok(scoped.max_score < full.max_score);
    assert.ok(scoped.checks.length < full.checks.length);
    assert.ok(scoped.checks.every(check => check.path.includes('hooks') || check.path.includes('scripts/hooks')));
  })) passed++; else failed++;

  if (test('text format includes summary header', () => {
    const output = run(['repo']);
    assert.ok(output.includes('Harness Audit (repo, repo):'));
    assert.ok(output.includes('Top 3 Actions:') || output.includes('Checks:'));
  })) passed++; else failed++;

  if (test('detects repo mode from structural markers when package name differs', () => {
    const projectRoot = createTempDir('harness-audit-structural-repo-');

    try {
      fs.mkdirSync(path.join(projectRoot, 'scripts'), { recursive: true });
      fs.mkdirSync(path.join(projectRoot, '.claude-plugin'), { recursive: true });
      fs.mkdirSync(path.join(projectRoot, 'agents'), { recursive: true });
      fs.mkdirSync(path.join(projectRoot, 'skills'), { recursive: true });
      fs.writeFileSync(path.join(projectRoot, 'scripts', 'harness-audit.js'), '#!/usr/bin/env node\n');
      fs.writeFileSync(path.join(projectRoot, '.claude-plugin', 'plugin.json'), JSON.stringify({ name: 'ecc' }, null, 2));
      fs.writeFileSync(
        path.join(projectRoot, 'package.json'),
        JSON.stringify({ name: 'forked-harness', scripts: { test: 'node scripts/validate-commands.js && node tests/run-all.js' } }, null, 2)
      );

      const parsed = JSON.parse(run(['--format=json', `--root=${projectRoot}`]));
      assert.strictEqual(parsed.target_mode, 'repo');
      assert.strictEqual(parsed.root_dir, path.resolve(projectRoot));
    } finally {
      cleanup(projectRoot);
    }
  })) passed++; else failed++;

  if (test('audits consumer projects from cwd instead of the ECC repo root', () => {
    const homeDir = createTempDir('harness-audit-home-');
    const projectRoot = createTempDir('harness-audit-project-');

    try {
      fs.mkdirSync(path.join(homeDir, '.claude', 'plugins', 'ecc', '.claude-plugin'), { recursive: true });
      fs.writeFileSync(
        path.join(homeDir, '.claude', 'plugins', 'ecc', '.claude-plugin', 'plugin.json'),
        JSON.stringify({ name: 'ecc' }, null, 2)
      );

      fs.mkdirSync(path.join(projectRoot, '.github', 'workflows'), { recursive: true });
      fs.mkdirSync(path.join(projectRoot, 'tests'), { recursive: true });
      fs.mkdirSync(path.join(projectRoot, '.claude'), { recursive: true });
      fs.writeFileSync(path.join(projectRoot, 'AGENTS.md'), '# Project instructions\n');
      fs.writeFileSync(path.join(projectRoot, '.mcp.json'), JSON.stringify({ mcpServers: {} }, null, 2));
      fs.writeFileSync(path.join(projectRoot, '.gitignore'), 'node_modules\n.env\n');
      fs.writeFileSync(path.join(projectRoot, '.github', 'workflows', 'ci.yml'), 'name: ci\n');
      fs.writeFileSync(path.join(projectRoot, 'tests', 'app.test.js'), 'test placeholder\n');
      fs.writeFileSync(path.join(projectRoot, '.claude', 'settings.json'), JSON.stringify({ hooks: ['PreToolUse'] }, null, 2));
      fs.writeFileSync(
        path.join(projectRoot, 'package.json'),
        JSON.stringify({ name: 'consumer-project', scripts: { test: 'node tests/app.test.js' } }, null, 2)
      );

      const parsed = JSON.parse(run(['repo', '--format', 'json'], { cwd: projectRoot, homeDir }));

      assert.strictEqual(parsed.target_mode, 'consumer');
      assert.strictEqual(parsed.root_dir, fs.realpathSync(projectRoot));
      assert.ok(parsed.overall_score > 0, 'Consumer project should receive non-zero score when harness signals exist');
      assert.ok(parsed.checks.some(check => check.id === 'consumer-plugin-install' && check.pass));
      assert.ok(parsed.checks.every(check => !check.path.startsWith('agents/') && !check.path.startsWith('skills/')));
    } finally {
      cleanup(homeDir);
      cleanup(projectRoot);
    }
  })) passed++; else failed++;

  if (test('scores empty consumer projects without plugin or harness signals as failing checks', () => {
    const homeDir = createTempDir('harness-audit-empty-home-');
    const projectRoot = createTempDir('harness-audit-empty-project-');

    try {
      const parsed = JSON.parse(run(['repo', '--format', 'json'], { cwd: projectRoot, homeDir }));

      assert.strictEqual(parsed.target_mode, 'consumer');
      assert.strictEqual(parsed.overall_score, 0);
      assert.ok(parsed.max_score > 0);
      assert.strictEqual(parsed.top_actions.length, 3);
      assert.ok(parsed.checks.some(check => check.id === 'consumer-plugin-install' && !check.pass));
      assert.ok(parsed.checks.some(check => check.id === 'consumer-project-overrides' && !check.pass));
      assert.ok(parsed.checks.some(check => check.id === 'consumer-secret-hygiene' && !check.pass));
    } finally {
      cleanup(homeDir);
      cleanup(projectRoot);
    }
  })) passed++; else failed++;

  if (test('prints no top actions when consumer checks all pass', () => {
    const homeDir = createTempDir('harness-audit-passing-home-');
    const projectRoot = createTempDir('harness-audit-passing-project-');

    try {
      fs.mkdirSync(path.join(projectRoot, '.claude', 'plugins', 'ecc@ecc'), { recursive: true });
      fs.writeFileSync(
        path.join(projectRoot, '.claude', 'plugins', 'ecc@ecc', 'plugin.json'),
        JSON.stringify({ name: 'ecc' }, null, 2)
      );
      fs.mkdirSync(path.join(projectRoot, '.claude'), { recursive: true });
      fs.mkdirSync(path.join(projectRoot, '.github', 'workflows', 'nested'), { recursive: true });
      fs.mkdirSync(path.join(projectRoot, '.github', 'ISSUE_TEMPLATE'), { recursive: true });
      fs.mkdirSync(path.join(projectRoot, 'docs', 'adr'), { recursive: true });
      fs.mkdirSync(path.join(projectRoot, 'evals'), { recursive: true });
      fs.mkdirSync(path.join(projectRoot, 'src'), { recursive: true });
      fs.writeFileSync(path.join(projectRoot, '.claude', 'hooks.json'), JSON.stringify({ hooks: [] }, null, 2));
      fs.writeFileSync(path.join(projectRoot, '.claude', 'settings.local.json'), JSON.stringify({ local: true }, null, 2));
      fs.writeFileSync(path.join(projectRoot, 'CLAUDE.md'), '# Consumer instructions\n');
      fs.writeFileSync(path.join(projectRoot, 'src', 'app.spec.ts'), 'test placeholder\n');
      fs.writeFileSync(path.join(projectRoot, '.github', 'workflows', 'nested', 'ci.yaml'), 'name: ci\n');
      fs.writeFileSync(path.join(projectRoot, '.github', 'PULL_REQUEST_TEMPLATE.md'), '# PR\n');
      fs.writeFileSync(path.join(projectRoot, '.github', 'ISSUE_TEMPLATE', 'bug.md'), '# Bug\n');
      fs.writeFileSync(path.join(projectRoot, '.github', 'CODEOWNERS'), '* @owner\n');
      fs.writeFileSync(path.join(projectRoot, 'docs', 'adr', '001.md'), '# Record\n');
      fs.writeFileSync(path.join(projectRoot, 'evals', 'smoke.json'), '{}\n');
      fs.writeFileSync(path.join(projectRoot, '.github', 'dependabot.yml'), 'version: 2\n');
      fs.writeFileSync(path.join(projectRoot, '.gitignore'), 'node_modules\n.env.local\n');
      fs.writeFileSync(
        path.join(projectRoot, 'package.json'),
        JSON.stringify({ name: 'passing-consumer', scripts: {} }, null, 2)
      );

      const parsed = JSON.parse(run(['repo', '--format', 'json'], { cwd: projectRoot, homeDir }));
      assert.strictEqual(parsed.target_mode, 'consumer');
      assert.strictEqual(parsed.overall_score, parsed.max_score);

      const text = run(['repo'], { cwd: projectRoot, homeDir });
      assert.ok(text.includes(`Harness Audit (repo, consumer): ${parsed.max_score}/${parsed.max_score}`));
      assert.ok(text.includes('Checks: 16 total, 0 failing'));
      assert.ok(!text.includes('Top 3 Actions:'));

      const scopedText = run(['agents'], { cwd: projectRoot, homeDir });
      assert.ok(scopedText.includes('Harness Audit (agents, consumer):'));
      assert.ok(scopedText.includes('Checks: 1 total, 0 failing'));
    } finally {
      cleanup(homeDir);
      cleanup(projectRoot);
    }
  })) passed++; else failed++;

  if (test('detects marketplace-installed Claude plugins under home marketplaces/', () => {
    const homeDir = createTempDir('harness-audit-marketplace-home-');
    const projectRoot = createTempDir('harness-audit-marketplace-project-');

    try {
      fs.mkdirSync(path.join(homeDir, '.claude', 'plugins', 'marketplaces', 'everything-claude-code', '.claude-plugin'), { recursive: true });
      fs.writeFileSync(
        path.join(homeDir, '.claude', 'plugins', 'marketplaces', 'everything-claude-code', '.claude-plugin', 'plugin.json'),
        JSON.stringify({ name: 'everything-claude-code' }, null, 2)
      );

      fs.mkdirSync(path.join(projectRoot, '.github', 'workflows'), { recursive: true });
      fs.mkdirSync(path.join(projectRoot, 'tests'), { recursive: true });
      fs.mkdirSync(path.join(projectRoot, '.claude'), { recursive: true });
      fs.writeFileSync(path.join(projectRoot, 'AGENTS.md'), '# Project instructions\n');
      fs.writeFileSync(path.join(projectRoot, '.mcp.json'), JSON.stringify({ mcpServers: {} }, null, 2));
      fs.writeFileSync(path.join(projectRoot, '.gitignore'), 'node_modules\n.env\n');
      fs.writeFileSync(path.join(projectRoot, '.github', 'workflows', 'ci.yml'), 'name: ci\n');
      fs.writeFileSync(path.join(projectRoot, 'tests', 'app.test.js'), 'test placeholder\n');
      fs.writeFileSync(path.join(projectRoot, '.claude', 'settings.json'), JSON.stringify({ hooks: ['PreToolUse'] }, null, 2));
      fs.writeFileSync(
        path.join(projectRoot, 'package.json'),
        JSON.stringify({ name: 'consumer-project', scripts: { test: 'node tests/app.test.js' } }, null, 2)
      );

      const parsed = JSON.parse(run(['repo', '--format', 'json'], { cwd: projectRoot, homeDir }));
      assert.ok(parsed.checks.some(check => check.id === 'consumer-plugin-install' && check.pass));
    } finally {
      cleanup(homeDir);
      cleanup(projectRoot);
    }
  })) passed++; else failed++;

  if (test('detects marketplace-installed Claude plugins under project marketplaces/', () => {
    const homeDir = createTempDir('harness-audit-marketplace-home-');
    const projectRoot = createTempDir('harness-audit-marketplace-project-');

    try {
      fs.mkdirSync(path.join(projectRoot, '.claude', 'plugins', 'marketplaces', 'everything-claude-code', '.claude-plugin'), { recursive: true });
      fs.writeFileSync(
        path.join(projectRoot, '.claude', 'plugins', 'marketplaces', 'everything-claude-code', '.claude-plugin', 'plugin.json'),
        JSON.stringify({ name: 'everything-claude-code' }, null, 2)
      );

      fs.mkdirSync(path.join(projectRoot, '.github', 'workflows'), { recursive: true });
      fs.mkdirSync(path.join(projectRoot, 'tests'), { recursive: true });
      fs.mkdirSync(path.join(projectRoot, '.claude'), { recursive: true });
      fs.writeFileSync(path.join(projectRoot, 'AGENTS.md'), '# Project instructions\n');
      fs.writeFileSync(path.join(projectRoot, '.mcp.json'), JSON.stringify({ mcpServers: {} }, null, 2));
      fs.writeFileSync(path.join(projectRoot, '.gitignore'), 'node_modules\n.env\n');
      fs.writeFileSync(path.join(projectRoot, '.github', 'workflows', 'ci.yml'), 'name: ci\n');
      fs.writeFileSync(path.join(projectRoot, 'tests', 'app.test.js'), 'test placeholder\n');
      fs.writeFileSync(path.join(projectRoot, '.claude', 'settings.json'), JSON.stringify({ hooks: ['PreToolUse'] }, null, 2));
      fs.writeFileSync(
        path.join(projectRoot, 'package.json'),
        JSON.stringify({ name: 'consumer-project', scripts: { test: 'node tests/app.test.js' } }, null, 2)
      );

      const parsed = JSON.parse(run(['repo', '--format', 'json'], { cwd: projectRoot, homeDir }));
      assert.ok(parsed.checks.some(check => check.id === 'consumer-plugin-install' && check.pass));
    } finally {
      cleanup(homeDir);
      cleanup(projectRoot);
    }
  })) passed++; else failed++;

  if (test('detects marketplace-installed Claude plugins from USERPROFILE fallback on Windows-style setups', () => {
    const homeDir = createTempDir('harness-audit-marketplace-home-');
    const projectRoot = createTempDir('harness-audit-marketplace-project-');

    try {
      fs.mkdirSync(path.join(homeDir, '.claude', 'plugins', 'marketplaces', 'everything-claude-code', '.claude-plugin'), { recursive: true });
      fs.writeFileSync(
        path.join(homeDir, '.claude', 'plugins', 'marketplaces', 'everything-claude-code', '.claude-plugin', 'plugin.json'),
        JSON.stringify({ name: 'everything-claude-code' }, null, 2)
      );

      fs.mkdirSync(path.join(projectRoot, '.github', 'workflows'), { recursive: true });
      fs.mkdirSync(path.join(projectRoot, 'tests'), { recursive: true });
      fs.mkdirSync(path.join(projectRoot, '.claude'), { recursive: true });
      fs.writeFileSync(path.join(projectRoot, 'AGENTS.md'), '# Project instructions\n');
      fs.writeFileSync(path.join(projectRoot, '.mcp.json'), JSON.stringify({ mcpServers: {} }, null, 2));
      fs.writeFileSync(path.join(projectRoot, '.gitignore'), 'node_modules\n.env\n');
      fs.writeFileSync(path.join(projectRoot, '.github', 'workflows', 'ci.yml'), 'name: ci\n');
      fs.writeFileSync(path.join(projectRoot, 'tests', 'app.test.js'), 'test placeholder\n');
      fs.writeFileSync(path.join(projectRoot, '.claude', 'settings.json'), JSON.stringify({ hooks: ['PreToolUse'] }, null, 2));
      fs.writeFileSync(
        path.join(projectRoot, 'package.json'),
        JSON.stringify({ name: 'consumer-project', scripts: { test: 'node tests/app.test.js' } }, null, 2)
      );

      const parsed = JSON.parse(run(['repo', '--format', 'json'], {
        cwd: projectRoot,
        homeDir: '',
        userProfile: homeDir,
      }));
      assert.ok(parsed.checks.some(check => check.id === 'consumer-plugin-install' && check.pass));
    } finally {
      cleanup(homeDir);
      cleanup(projectRoot);
    }
  })) passed++; else failed++;

  if (test('detects Claude plugin installs from installed_plugins.json', () => {
    const homeDir = createTempDir('harness-audit-manifest-home-');
    const projectRoot = createTempDir('harness-audit-manifest-project-');
    const pluginsDir = path.join(homeDir, '.claude', 'plugins');
    const installRoot = path.join(pluginsDir, 'cache', 'everything-claude-code', 'ecc', '2.0.0');

    try {
      fs.mkdirSync(path.join(installRoot, '.claude-plugin'), { recursive: true });
      fs.writeFileSync(
        path.join(installRoot, '.claude-plugin', 'plugin.json'),
        JSON.stringify({ name: 'ecc', version: '2.0.0' }, null, 2)
      );
      fs.writeFileSync(
        path.join(pluginsDir, 'installed_plugins.json'),
        JSON.stringify({
          plugins: {
            'ecc@everything-claude-code': [
              { installPath: path.join('cache', 'everything-claude-code', 'ecc', '2.0.0') },
            ],
          },
        }, null, 2)
      );

      const originalHome = process.env.HOME;
      process.env.HOME = homeDir;
      try {
        const found = findPluginInstall(projectRoot);
        assert.ok(found);
        assert.ok(found.includes(`${path.sep}cache${path.sep}everything-claude-code${path.sep}ecc${path.sep}2.0.0${path.sep}`));
      } finally {
        if (originalHome === undefined) {
          delete process.env.HOME;
        } else {
          process.env.HOME = originalHome;
        }
      }
    } finally {
      cleanup(homeDir);
      cleanup(projectRoot);
    }
  })) passed++; else failed++;

  if (test('detects newest Claude plugin install from cache marketplace layout', () => {
    const homeDir = createTempDir('harness-audit-cache-home-');
    const projectRoot = createTempDir('harness-audit-cache-project-');
    const pluginRoot = path.join(homeDir, '.claude', 'plugins', 'cache', 'everything-claude-code', 'ecc');

    try {
      for (const version of ['1.8.0', '1.10.0']) {
        fs.mkdirSync(path.join(pluginRoot, version, '.claude-plugin'), { recursive: true });
        fs.writeFileSync(
          path.join(pluginRoot, version, '.claude-plugin', 'plugin.json'),
          JSON.stringify({ name: 'ecc', version }, null, 2)
        );
      }

      const originalHome = process.env.HOME;
      process.env.HOME = homeDir;
      try {
        const found = findPluginInstall(projectRoot);
        assert.ok(found);
        assert.ok(found.includes(`${path.sep}1.10.0${path.sep}`), `expected newest version, got ${found}`);
      } finally {
        if (originalHome === undefined) {
          delete process.env.HOME;
        } else {
          process.env.HOME = originalHome;
        }
      }
    } finally {
      cleanup(homeDir);
      cleanup(projectRoot);
    }
  })) passed++; else failed++;

  if (test('compareVersionDesc orders numeric version components', () => {
    const versions = ['1.8.0', '1.10.0', '1.9.0', '2.0.0'].sort(compareVersionDesc);
    assert.deepStrictEqual(versions, ['2.0.0', '1.10.0', '1.9.0', '1.8.0']);
    assert.doesNotThrow(() => compareVersionDesc('1.0.0-rc.1', '1.0.0'));
  })) passed++; else failed++;

  console.log(`\nResults: Passed: ${passed}, Failed: ${failed}`);
  process.exit(failed > 0 ? 1 : 0);
}

runTests();
