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
    'review sandbox.yaml',
    'ecc-sandbox launch sandbox.yaml',
    '--purpose',
    '--consent y',
    '--proposal',
    '--expect-backend',
    'selected terminal',
    'listen RUN_ID --follow --format jsonl',
    'Verification',
    'exploration replica',
    '--record',
    'review.cast',
    'review_wait_ms',
    'execution_mode: mock',
    'install_diff.complete: true',
    'at most one',
    'Tier 0 process sandbox',
    'review-tier1-claude-installer.yaml',
    'Hosted CI matrix',
    'Read-only is not confidential',
    'npm install --global ecc-universal',
  ]) {
    assert.ok(skill.includes(phrase), `skill must explain ${phrase}`);
  }
  assert.doesNotMatch(skill, /Docker|Microsandbox/i);
}));

results.push(test('OpenAI interface metadata is valid and names the skill in its prompt', () => {
  const metadata = yaml.parse(read('skills/sandbox-testing/agents/openai.yaml'));
  assert.strictEqual(metadata.interface.display_name, 'Sandbox Testing');
  assert.ok(metadata.interface.short_description.length >= 25);
  assert.ok(metadata.interface.short_description.length <= 64);
  assert.match(metadata.interface.default_prompt, /\$sandbox-testing/);
  assert.match(metadata.interface.default_prompt, /\$terminal-opener/);
  assert.match(metadata.interface.default_prompt, /visible|interactive/i);
}));

results.push(test('optional visible review and exploration compose the same skills in every supported harness', () => {
  const skill = read('skills/sandbox-testing/SKILL.md');
  assert.match(skill, /compose `?\$sandbox-testing`? with `?\$terminal-opener`?/i);
  assert.match(skill, /optional[\s\S]{0,160}(?:visible review|exploration)/i);
  assert.match(
    skill,
    /same[\s\S]{0,80}contract[\s\S]{0,120}Claude Code[\s\S]{0,60}Codex[\s\S]{0,60}Kimi Code/i
  );
}));

results.push(test('Tier 1 docs require explicit user consent and an observable manual-testing loop', () => {
  for (const relativePath of ['skills/sandbox-testing/SKILL.md', 'docs/sandbox-testing.md']) {
    const content = read(relativePath);
    assert.match(
      content,
      /Would you like to launch a Tier 1 rootless Podman sandbox with[\s\S]{0,240}for testing[\s\S]{0,80}\? y\/n/i,
      `${relativePath} must give agents a literal y/n consent prompt`
    );
    assert.match(
      content,
      /isolated backend feature testing[\s\S]{0,160}install(?:er|ation) testing/i,
      `${relativePath} must name the primary Tier 1 use cases`
    );
    assert.match(
      content,
      /agent[\s\S]{0,160}(?:listen|monitor)[\s\S]{0,200}(?:adjust|edit|iterate)/i,
      `${relativePath} must explain the agent observation and iteration loop`
    );
    assert.match(
      content,
      /WezTerm[\s\S]{0,160}macOS Terminal\.app/i,
      `${relativePath} must state the initial terminal-client requirement`
    );
    assert.match(
      content,
      /ecc-sandbox launch[\s\S]{0,240}consent-required[\s\S]{0,240}--consent y/i,
      `${relativePath} must document the manifest-first consent flow`
    );
    assert.doesNotMatch(
      content,
      /supports only WezTerm|Terminal\.app is an open (?:gap|acceptance gap)/i,
      `${relativePath} must not retain the resolved Terminal.app gap`
    );
  }
}));

results.push(test('design conventions name rootless Podman as the only active Tier 1 runtime', () => {
  const conventions = read('docs/design/sandbox-testing/CONVENTIONS.md');
  assert.match(conventions, /Tier 1 has exactly one runtime:\s*rootless Podman/i);
  assert.doesNotMatch(conventions, /preferred Microsandbox backend/i);
  assert.doesNotMatch(
    conventions,
    /Microsandbox startup failure may fall back[\s\S]{0,160}Podman/i
  );
}));

results.push(test('skill and guide document the separate bounded human exploration lease', () => {
  for (const relativePath of ['skills/sandbox-testing/SKILL.md', 'docs/sandbox-testing.md']) {
    const content = read(relativePath);
    assert.match(
      content,
      /hands-on exploration[\s\S]{0,200}at least 30 minutes[\s\S]{0,120}bounded human lease/i,
      `${relativePath} must document the bounded human exploration lease`
    );
    assert.match(
      content,
      /setup commands? keep[\s\S]{0,120}(?:the )?manifest timeout/i,
      `${relativePath} must retain the manifest timeout for setup commands`
    );
  }
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

results.push(test('Tier 1 installer demo runs a full Claude project lifecycle in disposable state', () => {
  const { loadManifest } = require(path.join(repoRoot, 'scripts', 'sandbox', 'contracts'));
  const manifest = loadManifest(path.join(
    repoRoot,
    'examples',
    'sandbox',
    'review-tier1-claude-installer.yaml'
  ));
  assert.strictEqual(manifest.name, 'review-tier1-claude-installer');
  assert.deepStrictEqual(manifest.needs.os, ['linux']);
  assert.ok(manifest.needs.capabilities.includes('clean-home'));
  assert.ok(manifest.needs.capabilities.includes('pkg-install'));
  assert.strictEqual(manifest.needs.native, false);
  assert.match(manifest.steps.setup.join('\n'), /\/workspace\/source\/install\.sh/);
  assert.match(manifest.steps.setup.join('\n'), /--target claude-project --profile full/);
  assert.match(manifest.steps.assert.join('\n'), /scripts\/ecc\.js doctor/);
  assert.match(manifest.steps.assert.join('\n'), /drifted-managed-files/);
  assert.strictEqual(manifest.report, 'install-diff');
}));

results.push(test('Tier 2 Codex developer preset preloads a disposable native security lab', () => {
  const { loadManifest } = require(path.join(repoRoot, 'scripts', 'sandbox', 'contracts'));
  const manifest = loadManifest(path.join(
    repoRoot,
    'examples',
    'sandbox',
    'review-tier2-codex.yaml'
  ));
  const setup = manifest.steps.setup.join('\n');
  const assertions = manifest.steps.assert.join('\n');

  assert.strictEqual(manifest.name, 'review-tier2-codex');
  assert.deepStrictEqual(manifest.needs.os, ['macos']);
  assert.deepStrictEqual(manifest.needs.arch, ['arm64']);
  assert.strictEqual(manifest.needs.native, true);
  assert.ok(manifest.needs.capabilities.includes('pkg-install'));
  assert.ok(manifest.needs.capabilities.includes('network:*'));
  assert.match(setup, /softwareupdate --install/);
  assert.match(setup, /https:\/\/chatgpt\.com\/codex\/install\.sh/);
  assert.match(setup, /security-lab/);
  assert.match(setup, /git[^\n]* init/);
  assert.match(assertions, /codex --version/);
  assert.match(assertions, /git[^\n]* status/);
  assert.doesNotMatch(setup, /OPENAI_API_KEY|api[_-]?key|token/i);
  assert.strictEqual(manifest.report, 'exit-only');
}));

results.push(test('visible-review fixtures make deterministic Tier 0, 1, and 2 claims', () => {
  const { loadManifest } = require(path.join(repoRoot, 'scripts', 'sandbox', 'contracts'));
  const fixtures = [
    {
      path: 'examples/sandbox/review-tier0-srt.yaml',
      name: 'review-tier0-srt',
      os: ['any'],
      native: false,
      report: 'exit-only',
      required: [],
      forbidden: ['clean-home', 'pkg-install', 'services', 'gui'],
    },
    {
      path: 'examples/sandbox/review-tier1-podman.yaml',
      name: 'review-tier1-podman',
      os: ['linux'],
      native: false,
      report: 'install-diff',
      required: ['clean-home'],
      forbidden: ['services', 'gui'],
    },
    {
      path: 'examples/sandbox/review-tier2-lume.yaml',
      name: 'review-tier2-lume',
      os: ['macos'],
      arch: ['arm64'],
      native: true,
      report: 'exit-only',
      required: ['network:*'],
      forbidden: ['services'],
    },
  ];

  for (const expected of fixtures) {
    const manifest = loadManifest(path.join(repoRoot, expected.path));
    assert.strictEqual(manifest.name, expected.name);
    assert.deepStrictEqual(manifest.needs.os, expected.os);
    assert.strictEqual(manifest.needs.native, expected.native);
    if (expected.arch) assert.deepStrictEqual(manifest.needs.arch, expected.arch);
    for (const capability of expected.required) {
      assert.ok(manifest.needs.capabilities.includes(capability), `${expected.path} omitted ${capability}`);
    }
    for (const capability of expected.forbidden) {
      assert.ok(!manifest.needs.capabilities.includes(capability), `${expected.path} includes ${capability}`);
    }
    assert.match(manifest.steps.setup[0], /review setup begin/);
    assert.match(manifest.steps.setup[0], /sleep 2/);
    assert.strictEqual(manifest.report, expected.report);
  }
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
    'one visible terminal',
    'review examples/sandbox/review-tier0-srt.yaml',
    'review examples/sandbox/review-tier1-podman.yaml',
    'launch examples/sandbox/review-tier1-podman.yaml',
    'review examples/sandbox/review-tier2-lume.yaml',
    '--expect-backend',
    'listen "$RUN_ID" --follow --format jsonl',
    '_supervise RUN_ID',
    '_ui RUN_ID',
    '_guard RUN_ID',
    'ui.ready',
    'step.output',
    'shell: false',
    'filtered environment',
    'Verification and exploration',
    'review.cast',
    'active_total_ms',
    'review_wait_ms',
    'window closes',
    'closed stdin',
    'Acceptance Contract',
    'no model SDK calls',
    'Tier 2 scans are bounded',
    'sanitized staging directory',
    '/ecc:sandbox-testing',
    '$sandbox-testing',
    'review-tier1-claude-installer.yaml',
    'review-tier2-codex.yaml',
  ]) {
    assert.ok(docs.includes(phrase), `guide must explain ${phrase}`);
  }
  assert.doesNotMatch(docs, /Docker|Microsandbox/i);
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
