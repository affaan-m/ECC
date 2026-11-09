'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { buildAudit, scanText, renderReport } = require('../../scripts/ci/copilot-catalog-audit');
let passed = 0;
function test(name, fn) { fn(); passed++; console.log(`PASS ${name}`); }
const root = path.resolve(__dirname, '../..');
test('all canonical content has deterministic rows and hashes', () => {
  const a = buildAudit(root);
  assert.deepStrictEqual(a, buildAudit(root));
  for (const [kind, count] of Object.entries({ skill: 314, agent: 71, command: 98 })) {
    assert.equal(a.files.filter(row => row.kind === kind).length, count);
  }
  assert(a.files.every(row => /^[a-f0-9]{64}$/.test(row.sha256)));
  assert.equal(a.unknown_commands.length, 0);
});
test('scanner separates prose from fenced executable candidates without claiming semantic proof', () => {
  const text = 'Historically see `~/.claude/settings.json`.\n```bash\npython3 scripts/missing.py\necho $CLAUDE_PLUGIN_ROOT\n```\n';
  const findings = scanText(root, 'skills/fixture/SKILL.md', text);
  assert(findings.some(row => row.reference === '~/.claude' && row.context === 'documentation-reference'));
  assert(findings.some(row => row.reference === 'scripts/missing.py' && row.resolution === 'missing' && row.context === 'executable-candidate'));
  assert(findings.some(row => row.kind === 'host-variable' && row.review === 'semantic-review-required'));
});
test('local resolved references do not become missing and dynamic paths remain unknown', () => {
  const rows = scanText(root, 'commands/fixture.md', '`scripts/memory.js` `$CLAUDE_PLUGIN_ROOT/scripts/a.js`');
  assert(rows.some(row => row.reference === 'scripts/memory.js' && row.resolution === 'present'));
  assert(rows.some(row => row.resolution === 'dynamic'));
});
test('audit identifies references to bundled skill assets separately from checkout paths', () => {
  const rows = scanText(root, 'skills/docs-governance/SKILL.md', 'node scripts/audit-docs.py');
  assert(rows.some(row => row.reference === 'scripts/audit-docs.py' && row.resolution === 'skill-local-present'));
});
test('Task Skill APIs interpreters external prerequisites and aliases are reviewable', () => {
  const rows = scanText(root, 'skills/fixture/SKILL.md', '```text\nTask(subagent_type="x")\nSkill("x")\npython3 x.py\ngh pr view\n/plan\n```');
  for (const kind of ['host-api', 'interpreter', 'external-tool', 'renamed-command']) assert(rows.some(row => row.kind === kind), kind);
});
test('a new unregistered command cannot silently enter the executable profile', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-audit-'));
  try {
    for (const dir of ['skills', 'agents', 'commands', 'rules', 'scripts', 'hooks', 'assets', 'mcp-configs']) fs.mkdirSync(path.join(temp, dir));
    fs.writeFileSync(path.join(temp, 'commands/new-unreviewed-command.md'), '# New\n');
    assert.deepEqual(buildAudit(temp).unknown_commands, ['new-unreviewed-command']);
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
});
test('report distinguishes the installed package gate from native certification', () => {
  const report = renderReport(buildAudit(root));
  assert.match(report, /semantic review/);
  assert.match(report, /native-unverified/);
  assert.match(report, /npm run copilot:verify-package/);
});
test('explicit skill adaptations remain separate from canonical findings and native evidence', () => {
  const { files } = buildAudit(root);
  const row = name => files.find(item => item.source === `skills/${name}/SKILL.md`);
  assert.equal(row('gateguard').copilot_projection, 'projected');
  assert.equal(row('delivery-gate').copilot_projection, 'notice-only');
  assert.equal(row('coding-standards').copilot_projection, undefined);
  assert.equal(row('delivery-gate').native_status, 'native-unverified');
  assert(row('delivery-gate').findings.length > 0);
  assert.deepEqual(row('plan-canvas').copilot_runtime_references, [
    { path: 'scripts/copilot-canvas.js', resolution: 'standalone-closure' },
  ]);
  assert.deepEqual(row('skill-stocktake').copilot_runtime_references, [
    { path: 'scripts/copilot-telemetry.js', resolution: 'additional-module' },
  ]);
});
test('a projected skill with a missing managed runtime is identified separately', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-audit-'));
  try {
    const dir = path.join(temp, 'skills', 'plan-canvas');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'SKILL.md'), '---\nname: plan-canvas\n---\n# Plan Canvas\n');
    const audit = buildAudit(temp);
    assert.deepEqual(audit.missing_projection_runtimes, [
      { source: 'skills/plan-canvas/SKILL.md', path: 'scripts/copilot-canvas.js' },
    ]);
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
});
console.log(`Passed: ${passed}, Failed: 0`);
