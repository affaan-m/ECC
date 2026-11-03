'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { adaptCopilotCommand, adaptCopilotSkill, getCommandCapability, PORTABLE_COMMANDS } = require('../../scripts/lib/install/copilot-command');
const { transformInstallContent } = require('../../scripts/lib/install/content-transform');
const adapter = require('../../scripts/lib/install-targets/copilot-project');
const REPO = path.resolve(__dirname, '../..');
let passed = 0;
let failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (error) { console.error(`  ✗ ${name}: ${error.stack}`); failed++; }
}
const source = '---\ndescription: Build safely.\nallowed-tools: ["bash(*)"]\nmodel: opus\ndisable-model-invocation: true\n---\n# Build\nUse $ARGUMENTS with ecc:planner.\n';

test('portable commands become manually invocable skills without permission grants', () => {
  const result = adaptCopilotCommand(source, 'commands/build-fix.md');
  assert.match(result, /name: build-fix/);
  assert.match(result, /description: Build safely\./);
  assert.doesNotMatch(result, /allowed-tools:|^model:|\$ARGUMENTS|ecc:planner/);
  assert.match(result, /current user request/);
  assert.match(result, /planner/);
});
test('unknown commands are explicitly blocked without legacy executable code', () => {
  const result = adaptCopilotCommand('---\ndescription: Legacy\n---\nnode "$CLAUDE_PLUGIN_ROOT/scripts/x.js"\n', 'commands/future-command.md');
  assert.match(result, /not yet ported/i);
  assert.doesNotMatch(result, /CLAUDE_PLUGIN_ROOT|scripts\/x\.js/);
  assert.match(result, /status: blocked/);
});
test('bad command names and missing descriptions fail before projection', () => {
  for (const name of ['commands/../outside.md', 'commands/nul.md', 'commands/A.md', '/commands/a.md']) {
    assert.throws(() => adaptCopilotCommand(source, name), /command path/);
  }
  assert.throws(() => adaptCopilotCommand('# broken', 'commands/build-fix.md'), /frontmatter/);
  assert.throws(() => adaptCopilotCommand('---\nname: a\n---\nbody', 'commands/build-fix.md'), /description/);
});
test('portable commands reject newly introduced runtime syntax', () => {
  assert.throws(() => adaptCopilotCommand('---\ndescription: Build\n---\nnode "$CLAUDE_PLUGIN_ROOT/x.js"\n', 'commands/build-fix.md'), /runtime dependency/);
});
test('capability statuses are deterministic and explicit', () => {
  assert.strictEqual(getCommandCapability('build-fix').status, 'portable');
  assert.strictEqual(getCommandCapability('sessions').status, 'copilot-native');
  assert.strictEqual(getCommandCapability('astra-review').status, 'copilot-native');
  assert.strictEqual(getCommandCapability('new-command').status, 'blocked');
});
test('lifecycle commands use managed Copilot runtime and require real identity', () => {
  for (const name of ['sessions', 'save-session', 'resume-session']) {
    const result = adaptCopilotCommand(fs.readFileSync(path.join(REPO, 'commands', `${name}.md`), 'utf8'), `commands/${name}.md`);
    assert.match(result, /\.github\/ecc\/scripts\/hooks\/copilot-lifecycle\.js/);
    assert.doesNotMatch(result, /~\/\.claude|CLAUDE_PLUGIN|\$ARGUMENTS/);
    assert.match(result, /status: copilot-native/);
  }
  assert.match(adaptCopilotCommand(source, 'commands/save-session.md'), /do not invent/i);
});
test('canonical skill projection strips tools and preserves workflow data', () => {
  const result = adaptCopilotSkill(source.replace('description:', 'name: build-fix\ndescription:'));
  assert.match(result, /name: build-fix/);
  assert.doesNotMatch(result, /^allowed-tools:|^model:/m);
  assert.match(result, /^disable-model-invocation: true$/m);
  assert.match(result, /# Build/);
});
test('transform boundary invokes command and skill projections', () => {
  assert.match(transformInstallContent({ contentTransform: 'copilot-command', sourceRelativePath: 'commands/build-fix.md' }, source), /name: build-fix/);
  const skill = source.replace('description:', 'name: build-fix\ndescription:');
  assert.doesNotMatch(transformInstallContent({ contentTransform: 'copilot-workflow-paths', sourceRelativePath: 'skills/build-fix/SKILL.md' }, skill), /allowed-tools:/);
});
test('planning projects command discovery and canonical skill wins duplicates', () => {
  const operations = adapter.planOperations({ repoRoot: REPO, projectRoot: '/project', modules: [
    { id: 'commands-core', paths: ['commands'] },
    { id: 'skills-quality', paths: ['skills/issue-review'] },
  ] });
  const commands = operations.filter(op => op.contentTransform === 'copilot-command');
  assert.ok(commands.length > 70);
  assert.ok(commands.some(op => op.destinationPath.endsWith('/skills/build-fix/SKILL.md')));
  assert.ok(!commands.some(op => op.sourceRelativePath === 'commands/issue-review.md'));
  const canonical = operations.filter(op => op.destinationPath === '/project/.github/skills/issue-review');
  assert.strictEqual(canonical.length, 1);
  assert.strictEqual(canonical[0].sourceRelativePath, 'skills/issue-review');
});
test('commands-only selection includes canonical workflows without duplicates', () => {
  const operations = adapter.planOperations({ repoRoot: REPO, projectRoot: '/project', modules: [{ id: 'commands-core', paths: ['commands'] }] });
  assert.strictEqual(operations.filter(op => op.destinationPath === '/project/.github/skills/issue-review').length, 1);
});
test('commands planning rejects traversal and does not invent nonexistent sources', () => {
  for (const file of ['commands/../x.md', 'commands/missing.md', 'commands\\..\\x.md']) {
    const operations = adapter.planOperations({ repoRoot: REPO, projectRoot: '/project', modules: [{ id: 'commands-core', paths: [file] }] });
    assert.ok(!operations.some(operation => operation.contentTransform === 'copilot-command'));
    assert.ok(operations.every(operation => !operation.sourceRelativePath.includes('..')));
  }
});
test('all audited portable command files adapt successfully', () => {
  for (const name of PORTABLE_COMMANDS) {
    const content = fs.readFileSync(path.join(REPO, 'commands', `${name}.md`), 'utf8');
    const result = adaptCopilotCommand(content, `commands/${name}.md`);
    assert.match(result, new RegExp(`name: ${require('../../scripts/lib/install/copilot-command-capabilities').copilotCommandName(name)}`));
  }
});
test('instruction-only documentation and Git workflows remain usable', () => {
  for (const name of ['update-docs', 'prp-commit', 'jira', 'prp-plan', 'prp-prd', 'prp-implement', 'pr', 'prp-pr', 'plan-prd', 'learn', 'learn-eval', 'skill-create', 'checkpoint', 'plan']) {
    const result = adaptCopilotCommand(fs.readFileSync(path.join(REPO, 'commands', `${name}.md`), 'utf8'), `commands/${name}.md`);
    assert.match(result, /status: portable/);
    assert.doesNotMatch(result, /~\/\.claude|CLAUDE_PLUGIN|\.claude\//);
    assert.doesNotMatch(result, /\$ARGUMENTS/);
  }
});
test('builtin slash collisions use explicit ECC aliases without hijacking builtins', () => {
  const operations = adapter.planOperations({ repoRoot: REPO, projectRoot: '/project', modules: [{ id: 'commands-core', paths: ['commands'] }] });
  for (const name of ['plan', 'pr', 'sessions']) {
    assert.ok(operations.some(op => op.destinationPath === `/project/.github/skills/ecc-${name}/SKILL.md`));
    assert.ok(!operations.some(op => op.destinationPath === `/project/.github/skills/${name}/SKILL.md`));
    const result = adaptCopilotCommand(fs.readFileSync(path.join(REPO, 'commands', `${name}.md`), 'utf8'), `commands/${name}.md`);
    assert.match(result, new RegExp(`name: ecc-${name}`));
  }
  const result = adaptCopilotCommand('---\ndescription: Build.\n---\nNext /plan, /pr and /sessions. Preserve /plan-canvas and /prp-pr.\n', 'commands/build-fix.md');
  assert.match(result, /Next \/ecc-plan, \/ecc-pr and \/ecc-sessions/);
  assert.match(result, /Preserve \/plan-canvas and \/prp-pr/);
});
test('extended capabilities name implemented entrypoints and preserve backend prerequisites', () => {
  const cases = {
    'cost-report': /copilot-cost-report/,
    'epic-claim': /copilot-epics/,
    'instinct-import': /copilot-learning/,
    'multi-plan': /copilot-orchestrate/,
    'orch-review': /copilot-orchestrate/,
    'quality-gate': /copilot-runtime/,
    'hookify': /Hookify|hookify/,
  };
  for (const [name, reason] of Object.entries(cases)) {
    assert.strictEqual(getCommandCapability(name).status, 'copilot-native');
    const result = adaptCopilotCommand(source, `commands/${name}.md`);
    assert.match(result, reason);
    assert.doesNotMatch(result, /# Build/);
  }
});
test('commands-only install discovers the full catalog without tool auto-approval grants', () => {
  const { createManifestInstallPlan, applyInstallPlan } = require('../../scripts/lib/install-executor');
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-copilot-catalog-'));
  try {
    const plan = createManifestInstallPlan({ repoRoot: REPO, target: 'copilot', moduleIds: ['commands-core'], projectRoot: project, homeDir: path.join(project, 'home'), env: {}, hooksEnabled: false });
    applyInstallPlan(plan);
    const commands = fs.readdirSync(path.join(REPO, 'commands')).filter(file => file.endsWith('.md'));
    const projected = path.join(project, '.github/skills');
    for (const command of commands) {
      const originalName = path.basename(command, '.md');
      const name = require('../../scripts/lib/install/copilot-command-capabilities').copilotCommandName(originalName);
      const contents = fs.readFileSync(path.join(projected, name, 'SKILL.md'), 'utf8');
      const header = require('js-yaml').load(contents.match(/^---\n([\s\S]*?)\n---/)[1]);
      assert.strictEqual(header.name, name);
      assert.ok(!Object.hasOwn(header, 'allowed-tools'));
      assert.ok(!Object.hasOwn(header, 'model'));
    }
    assert.strictEqual(fs.readdirSync(projected).length, commands.length);
    assert.ok(!fs.existsSync(path.join(project, '.claude')));
  } finally { fs.rmSync(project, { recursive: true, force: true }); }
});
test('real installer preserves user-owned aliases across repair and uninstall', () => {
  const { createManifestInstallPlan, applyInstallPlan } = require('../../scripts/lib/install-executor');
  const { repairInstalledStates, uninstallInstalledStates } = require('../../scripts/lib/install-lifecycle');
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-copilot-commands-'));
  try {
    const skill = path.join(project, '.github/skills/build-fix/SKILL.md');
    fs.mkdirSync(path.dirname(skill), { recursive: true });
    fs.writeFileSync(skill, 'USER OWNED\n');
    const options = { repoRoot: REPO, projectRoot: project, homeDir: path.join(project, 'home'), env: {} };
    const plan = createManifestInstallPlan({ ...options, target: 'copilot', moduleIds: ['commands-core'], hooksEnabled: false });
    applyInstallPlan(plan);
    assert.strictEqual(fs.readFileSync(skill, 'utf8'), 'USER OWNED\n');
    const managed = path.join(project, '.github/skills/save-session/SKILL.md');
    assert.match(fs.readFileSync(managed, 'utf8'), /copilot-lifecycle\.js checkpoint/);
    fs.unlinkSync(managed);
    assert.strictEqual(repairInstalledStates({ ...options, targets: ['copilot'] }).summary.errorCount, 0);
    assert.ok(fs.existsSync(managed));
    assert.strictEqual(uninstallInstalledStates({ ...options, targets: ['copilot'] }).summary.errorCount, 0);
    assert.strictEqual(fs.readFileSync(skill, 'utf8'), 'USER OWNED\n');
    assert.ok(!fs.existsSync(managed));
  } finally { fs.rmSync(project, { recursive: true, force: true }); }
});
console.log(`\nPassed: ${passed}, Failed: ${failed}`);
if (failed) process.exitCode = 1;
