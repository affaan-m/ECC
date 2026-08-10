'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const yaml = require('yaml');

const repoRoot = path.join(__dirname, '..', '..');
const read = relative => fs.readFileSync(path.join(repoRoot, relative), 'utf8');

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    return true;
  } catch (error) {
    console.log(`  ✗ ${name}`);
    console.log(`    ${error.message}`);
    return false;
  }
}

const results = [];

console.log('\n=== Sandbox testing agent surface ===\n');

results.push(test('skill has strict frontmatter and the complete agent workflow', () => {
  const skill = read('skills/sandbox-testing/SKILL.md');
  const frontmatter = skill.match(/^---\n([\s\S]*?)\n---/);
  assert.ok(frontmatter, 'SKILL.md frontmatter is missing');
  const metadata = yaml.parse(frontmatter[1]);
  assert.deepStrictEqual(Object.keys(metadata).sort(), ['description', 'name']);
  assert.strictEqual(metadata.name, 'sandbox-testing');
  for (const phrase of [
    'probe --refresh',
    '--dry-run',
    'execution_mode: mock',
    'install_diff.complete: true',
    'at most one',
    'Tier 0 process sandbox',
    'Hosted CI matrix',
    'Read-only is not confidential',
    'npm install --global ecc-universal',
  ]) {
    assert.ok(skill.includes(phrase), `skill must explain ${phrase}`);
  }
}));

results.push(test('OpenAI interface metadata is valid and names the skill in its prompt', () => {
  const metadata = yaml.parse(read('skills/sandbox-testing/agents/openai.yaml'));
  assert.strictEqual(metadata.interface.display_name, 'Sandbox Testing');
  assert.ok(metadata.interface.short_description.length >= 25);
  assert.ok(metadata.interface.short_description.length <= 64);
  assert.match(metadata.interface.default_prompt, /\$sandbox-testing/);
}));

results.push(test('demo manifest validates against the production contract', () => {
  const { loadManifest } = require(path.join(repoRoot, 'scripts', 'sandbox', 'contracts'));
  const manifest = loadManifest(path.join(repoRoot, 'examples', 'sandbox', 'install-ecc-clean-user.yaml'));
  assert.strictEqual(manifest.name, 'install-ecc-clean-user');
  assert.deepStrictEqual(manifest.needs.os, ['linux']);
  assert.ok(manifest.needs.capabilities.includes('clean-home'));
  assert.ok(manifest.steps.setup[0].includes('/workspace/source'));
  assert.ok(manifest.steps.setup[0].includes('--target codex'));
}));

results.push(test('fresh-harness failure fixture validates against the production report contract', () => {
  const { validateReport } = require(path.join(repoRoot, 'scripts', 'sandbox', 'contracts'));
  const report = validateReport(JSON.parse(read('tests/fixtures/sandbox/agent-surface-failure.json')));
  assert.strictEqual(report.result, 'fail');
  assert.strictEqual(report.escalations.length, 1);
  assert.strictEqual(report.install_diff.complete, true);
}));

results.push(test('retained Claude Code and Codex eval outputs remain contract-correct', () => {
  const { parseManifestText } = require(path.join(repoRoot, 'scripts', 'sandbox', 'contracts'));
  for (const harness of ['claude-code', 'codex']) {
    const output = JSON.parse(read(`docs/design/sandbox-testing/evidence/phase8-${harness}.json`));
    const manifest = parseManifestText(output.manifest_yaml, `<${harness}-eval>`);
    assert.strictEqual(manifest.needs.trust, 'first-party');
    assert.strictEqual(manifest.needs.native, false);
    for (const need of ['clean-home', 'pkg-install', 'network:*']) {
      assert.ok(manifest.needs.capabilities.includes(need), `${harness} omitted ${need}`);
    }
    assert.strictEqual(output.interpretation.result, 'fail');
    assert.strictEqual(output.interpretation.backend, 'podman');
    assert.strictEqual(output.interpretation.tier, 1);
    assert.strictEqual(output.interpretation.execution_mode, 'real');
    assert.match(output.interpretation.first_failure, /acme --version/);
    assert.match(output.interpretation.escalation, /srt.*podman/);
    assert.strictEqual(output.interpretation.install_diff_complete, true);
    assert.match(output.interpretation.evidence_claim, /degraded/i);
  }
}));

results.push(test('user guide documents routing, setup, limits, and harness-neutral JSON', () => {
  const docs = read('docs/sandbox-testing.md');
  for (const phrase of [
    'agent declares needs, never a backend',
    'All CLI output is JSON',
    'Docker Desktop',
    'gh auth login',
    'iOS Simulator',
    'no model SDK calls',
    'Tier 2 scans are bounded',
    'sanitized staging directory',
  ]) {
    assert.ok(docs.includes(phrase), `guide must explain ${phrase}`);
  }
}));

results.push(test('Claude hook is registered as an optional Bash failure suggestion', () => {
  const hooks = JSON.parse(read('hooks/hooks.json')).hooks.PostToolUseFailure;
  const registration = hooks.find(entry => entry.id === 'post:bash-failure:sandbox-escalation-suggest');
  assert.ok(registration, 'sandbox suggestion hook is not registered');
  assert.strictEqual(registration.matcher, 'Bash');
  assert.ok(registration.hooks[0].command.includes('sandbox-escalation-suggest.js'));
}));

results.push(test('npm package includes the complete skill directory', () => {
  const pkg = JSON.parse(read('package.json'));
  assert.ok(pkg.files.includes('skills/sandbox-testing/'));
  assert.strictEqual(pkg.bin['ecc-sandbox'], 'scripts/sandbox/ecc-sandbox');
}));

results.push(test('managed content installs disclose the separate sandbox runtime prerequisite', () => {
  const modules = JSON.parse(read('manifests/install-modules.json')).modules;
  const workflow = modules.find(module => module.id === 'workflow-quality');
  assert.ok(workflow.paths.includes('skills/sandbox-testing'));
  assert.ok(workflow.paths.includes('docs/sandbox-testing.md'));
  assert.ok(workflow.paths.includes('examples/sandbox'));
  assert.match(workflow.description, /sandbox-testing workflows require the separately installed ecc-universal CLI runtime/);
}));

const passed = results.filter(Boolean).length;
console.log(`\n${passed}/${results.length} tests passed`);
if (passed !== results.length) process.exitCode = 1;
