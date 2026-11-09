'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { copilotRuntimeSkillStatus, runtimeSkillPaths } = require('../../scripts/lib/install/copilot-runtime-skills');
const { adaptCopilotRuntimeSkill } = require('../../scripts/lib/install/copilot-runtime-skill-transform');
const { transformInstallContent } = require('../../scripts/lib/install/content-transform');
const { createManifestInstallPlan, applyInstallPlan } = require('../../scripts/lib/install-executor');
const { withHookConsent } = require('../../scripts/lib/install/hook-consent');
const ROOT = path.resolve(__dirname, '../..');
let passed = 0;
function test(name, fn) { fn(); passed++; console.log(`PASS ${name}`); }
function source(name) { return fs.readFileSync(path.join(ROOT, `skills/${name}/SKILL.md`), 'utf8'); }
function projected(name) { return transformInstallContent({ sourceRelativePath: `skills/${name}/SKILL.md`, contentTransform: 'copilot-workflow-paths' }, source(name)); }
const project = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-skill-projection-'));
try {
  test('only explicitly supported runtime skill paths get a host projection', () => {
    const other = source('coding-standards');
    assert.equal(adaptCopilotRuntimeSkill(other, 'skills/coding-standards/SKILL.md'), other);
    assert.equal(adaptCopilotRuntimeSkill(source('unified-memory'), 'examples/unified-memory/SKILL.md'), source('unified-memory'));
    assert.equal(copilotRuntimeSkillStatus('skills\\gateguard\\SKILL.md'), 'projected');
    for (const name of ['plan-canvas', 'plan-orchestrate', 'skill-comply']) {
      const windowsPath = path.win32.join('skills', name, 'SKILL.md');
      assert.equal(transformInstallContent({
        sourceRelativePath: windowsPath, contentTransform: 'copilot-workflow-paths',
      }, source(name)), projected(name));
    }
    assert.equal(copilotRuntimeSkillStatus('skills/delivery-gate/SKILL.md'), 'notice-only');
    assert.equal(copilotRuntimeSkillStatus('examples/unified-memory/SKILL.md'), null);
    assert.throws(() => adaptCopilotRuntimeSkill('missing frontmatter', 'skills/unified-memory/SKILL.md'));
    assert.throws(() => adaptCopilotRuntimeSkill(source('tdd-workflow'), 'skills/unified-memory/SKILL.md'));
  });
  test('learning projection uses managed CLI and contains no executable Claude bootstrap or approval claims', () => {
    const text = projected('continuous-learning-v2');
    assert.match(text, /node|Python 3/);
    assert.match(text, /\.github\/ecc\/scripts\/copilot-learning\.py status/);
    assert.match(text, /ECC_COPILOT_OBSERVE/);
    assert.match(text, /review-only|review only/);
    assert.match(text, /copilot-learning\.py identity --apply/);
    assert.match(text, /copilot-observer\.js once --backend metadata-sequences/);
    assert.match(text, /source: skills\/continuous-learning-v2\/SKILL\.md/);
    assert.match(text, /native: unverified/);
    assert.doesNotMatch(text, /CLAUDE_|observe\.sh|~\/\.claude|100% reliable|Auto-approved|Haiku/);
  });
  test('Vault projection uses doctor scoped recall and manual proposal save', () => {
    const text = projected('unified-memory');
    assert.match(text, /\.github\/ecc\/scripts\/copilot-memory\.js doctor/);
    assert.match(text, /--reviewed-sha256/);
    assert.match(text, /ECC_MEMORY_HARNESS=copilot/);
    assert.match(text, /project.*team/s);
    assert.match(text, /unreviewed/);
    assert.doesNotMatch(text, /npm install -g|ECC_MEMORY_HARNESS=codex|node scripts\/ecc\.js|printf/);
  });
  test('legacy learning does not install an alternative transcript observer', () => {
    const text = projected('continuous-learning');
    assert.match(text, /legacy/i);
    assert.match(text, /continuous-learning-v2/);
    assert.doesNotMatch(text, /evaluate-session\.sh|~\/\.claude|CLAUDE_/);
    assert.deepEqual(runtimeSkillPaths(['skills/continuous-learning']), []);
  });
  test('remaining catalog workflows use Copilot surfaces or an explicit compatibility notice', () => {
    for (const [name, expected] of [
      ['rules-distill', /\.github\/instructions/], ['skill-comply', /run the helper once[\s\S]*copilot-skill-comply\.js --session/],
      ['skill-scout', /rg -il/], ['ecc-recipes', /\.github\/skills/],
      ['knowledge-ops', /Unified\s+Memory/], ['ai-regression-testing', /sandbox.*production/is],
    ]) {
      const result = projected(name);
      assert.match(result, expected);
      assert.doesNotMatch(result, /~\/\.claude|\.claude\/commands|claude -p|uv run python -m scripts\.run/);
      assert.equal(transformInstallContent({ sourceRelativePath: `skills/${name}/SKILL.md` }, source(name)), source(name));
      const helpers = runtimeSkillPaths([`skills/${name}`]);
      if (name === 'skill-comply') assert.ok(helpers.includes('scripts/copilot-skill-comply.js'));
      else assert.deepEqual(helpers, []);
    }
  });
  test('host-specific setup is removed from Context Keeper and repo scan', () => {
    const ck = projected('ck');
    assert.match(ck, /copilot-lifecycle\.js checkpoint --session/);
    assert.doesNotMatch(ck, /CLAUDE_SKILL_DIR|~\/\.claude|commands\/save\.mjs/);
    assert.ok(runtimeSkillPaths(['skills/ck']).includes('scripts/hooks/copilot-lifecycle.js'));
    const scan = projected('repo-scan');
    assert.match(scan, /status: notice-only/);
    assert.doesNotMatch(scan, /git clone|rm -rf|CLAUDE_CONFIG_DIR|~\/\.claude/);
    for (const name of ['agentic-os', 'autonomous-agent-harness']) {
      const notice = projected(name);
      assert.match(notice, /status: notice-only/);
      assert.match(notice, /bounded/i);
      assert.doesNotMatch(notice, /~\/\.claude|\.claude\/commands|CLAUDE\.md|CronCreate/);
      const helpers = runtimeSkillPaths([`skills/${name}`]);
      if (name === 'skill-comply') assert.ok(helpers.includes('scripts/copilot-skill-comply.js'));
      else assert.deepEqual(helpers, []);
    }
  });
  test('projected plan routing and cost reporting use standalone Copilot entrypoints', () => {
    const target = fs.realpathSync(fs.mkdtempSync(path.join(project, 'plan-cost-')));
    const plan = withHookConsent(createManifestInstallPlan({ target: 'copilot',
      includeComponentIds: ['skill:plan-orchestrate', 'skill:cost-tracking'], projectRoot: target,
      homeDir: path.join(project, 'home'), env: {} }), 'declined');
    applyInstallPlan(plan);
    const skill = name => fs.readFileSync(path.join(target, '.github/skills', name, 'SKILL.md'), 'utf8');
    const router = skill('plan-orchestrate');
    assert.match(router, /"command":"multi-plan"/);
    assert.match(router, /\[Plan:.*#step-/);
    assert.match(router, /BLOCKED/);
    assert.doesNotMatch(router, /\/orch-add-feature|\/orch-fix-defect|workflows\/.*\.workflow\.js/);
    const usage = skill('cost-tracking');
    assert.match(usage, /copilot-cost-report\.js --session NATIVE_SESSION_ID/);
    assert.match(usage, /estimatedCostUsd/);
    assert.doesNotMatch(usage, /~\/\.claude|stop:cost-tracker|costs\.jsonl/);
    const config = path.join(target, 'private');
    const native = path.join(config, 'session-state', 'test-session');
    fs.mkdirSync(native, { recursive: true });
    fs.writeFileSync(path.join(native, 'events.jsonl'), [
      { type: 'session.start', data: { sessionId: 'test-session', context: { cwd: target } } },
      { type: 'session.usage_checkpoint', data: { totalNanoAiu: 4 } },
      { type: 'session.shutdown', data: { totalNanoAiu: 7 } },
    ].map(row => JSON.stringify(row)).join('\n') + '\n');
    const run = (file, args, input) => {
      const result = spawnSync(process.execPath, [file, ...args], {
        cwd: target, env: { ...process.env, COPILOT_HOME: config }, input, encoding: 'utf8', timeout: 15000,
      });
      assert.ifError(result.error);
      return result;
    };
    const report = run('.github/ecc/scripts/copilot-cost-report.js', ['--session', 'test-session']);
    assert.equal(report.status, 0, report.stderr);
    const result = JSON.parse(report.stdout);
    assert.equal(result.totalNanoAiu, 7);
    assert.equal(result.estimatedCostUsd, null);
    const request = router.match(/```json\n([^\n]+)\n```/)[1];
    assert.equal(JSON.parse(request).command, 'multi-plan');
    const unconfigured = run('.github/ecc/scripts/copilot-orchestrate.js', [], request);
    assert.equal(unconfigured.status, 1);
    assert.match(JSON.parse(unconfigured.stdout).error, /configuration/);
    const dry = run('.github/ecc/scripts/copilot-orchestrate.js', [], JSON.stringify({ command: 'loop-status' }));
    assert.equal(dry.status, 0, dry.stderr);
    assert.deepEqual(JSON.parse(dry.stdout), { runs: [] });
    assert.equal(fs.existsSync(path.join(target, '.github/hooks/ecc.json')), false);
  });
  test('Copilot catalog review uses installed project paths and explicit evidence sources', () => {
    const target = path.join(project, 'catalog review');
    fs.mkdirSync(target);
    const plan = withHookConsent(createManifestInstallPlan({ target: 'copilot',
      moduleIds: ['workflow-quality', 'commands-core'], projectRoot: target,
      homeDir: path.join(project, 'home'), env: {} }), 'declined');
    applyInstallPlan(plan);
    const skill = name => fs.readFileSync(path.join(target, '.github/skills', name, 'SKILL.md'), 'utf8');
    const compatibility = skill('skill-host-compat');
    assert.match(compatibility, /copilot-catalog-audit\.js" --check/);
    assert.match(compatibility, /trusted.*checkout/is);
    assert.match(compatibility, /installed.*\.github\/skills/is);
    assert.doesNotMatch(compatibility, /CLAUDE_PLUGIN_ROOT|validate-skill-host-compat\.js|--strict-checklist/);
    const stocktake = skill('skill-stocktake');
    assert.match(stocktake, /\.github\/skills/);
    assert.match(stocktake, /copilot-telemetry\.js --health/);
    assert.match(stocktake, /unmeasured/);
    assert.doesNotMatch(stocktake, /~\/\.claude|quick-diff\.sh|save-results\.sh|jq/);
    assert.equal(fs.existsSync(path.join(target, '.github/hooks/ecc.json')), false);
    assert.equal(fs.existsSync(path.join(target, '.github/ecc/scripts/ci/copilot-catalog-audit.js')), false);
    const telemetryHome = path.join(target, 'private');
    const health = spawnSync(process.execPath, ['.github/ecc/scripts/copilot-telemetry.js', '--health'], {
      cwd: target, env: { ...process.env, COPILOT_HOME: telemetryHome }, encoding: 'utf8', timeout: 15000,
    });
    assert.ifError(health.error);
    assert.equal(health.status, 0, health.stderr);
    assert.deepEqual(JSON.parse(health.stdout), []);
    assert.equal(fs.existsSync(telemetryHome), false);
    for (const name of ['skill-host-compat', 'skill-stocktake']) {
      assert.equal(copilotRuntimeSkillStatus(`skills/${name}/SKILL.md`), 'projected');
      assert.equal(adaptCopilotRuntimeSkill(source(name), `examples/${name}/SKILL.md`), source(name));
    }
  });
  test('guard, quality and delivery describe the actual Copilot policy boundaries', () => {
    const guard = projected('gateguard');
    assert.match(guard, /ECC_COPILOT_FACTFORCE=1/);
    assert.match(guard, /pre:copilot:guard/);
    assert.match(guard, /complete.*read/is);
    assert.doesNotMatch(guard, /gateguard-report\.js|GATEGUARD_EXEMPT_GLOBS|destructive-retry/);
    const quality = projected('plankton-code-quality');
    assert.match(quality, /ECC_COPILOT_QUALITY_MODE=check/);
    assert.match(quality, /copilot-runtime\.js quality-gate --file/);
    assert.doesNotMatch(quality, /CLAUDE_PLUGIN_ROOT|claude -p|npx|ECC_QUALITY_GATE_FIX/);
    const delivery = projected('delivery-gate');
    assert.match(delivery, /status: notice-only/);
    assert.match(delivery, /git diff --check/);
    assert.doesNotMatch(delivery, /quality-gate\.py|~\/\.claude|shutil\.disk_usage/);
  });
  test('standalone strategic compact saves and recalls a manual checkpoint with hooks declined', () => {
    const target = path.join(project, 'strategic compact');
    fs.mkdirSync(target);
    const plan = withHookConsent(createManifestInstallPlan({ target: 'copilot',
      includeComponentIds: ['skill:strategic-compact', 'skill:ck'], projectRoot: target,
      homeDir: path.join(project, 'home'), env: {} }), 'declined');
    applyInstallPlan(plan);
    assert.ok(runtimeSkillPaths(['skills/strategic-compact']).includes('scripts/hooks/copilot-lifecycle.js'));
    const text = fs.readFileSync(path.join(target, '.github/skills/strategic-compact/SKILL.md'), 'utf8');
    assert.match(text, /copilot-lifecycle\.js checkpoint --session/);
    assert.match(fs.readFileSync(path.join(target, '.github/skills/ck/SKILL.md'), 'utf8'), /copilot-lifecycle\.js checkpoint --session/);
    assert.match(text, /ECC_COPILOT_COMPACT_SUGGESTIONS=1/);
    assert.doesNotMatch(text, /suggest-compact\.js|CLAUDE_CODE_AUTO_COMPACT_WINDOW|~\/\.claude/);
    assert.equal(fs.existsSync(path.join(target, '.github/hooks/ecc.json')), false);
    const run = (args, input) => {
      const result = spawnSync(process.execPath, ['.github/ecc/scripts/hooks/copilot-lifecycle.js', ...args], {
        cwd: target, env: { ...process.env, COPILOT_HOME: path.join(target, 'private') },
        input, encoding: 'utf8', timeout: 15000,
      });
      assert.ifError(result.error);
      assert.equal(result.status, 0, result.stderr);
      return JSON.parse(result.stdout);
    };
    const checkpoint = 'Exploration complete. Next: run the regression suite.';
    assert.equal(run(['checkpoint', '--session', 'test-session', '--stdin'], checkpoint).saved, true);
    assert.equal(run(['recall', '--session', 'test-session']).summary, checkpoint);
  });
  test('canonical sources and other target transformations remain unchanged', () => {
    for (const name of ['unified-memory', 'continuous-learning-v2', 'continuous-learning', 'configure-ecc', 'hookify-rules',
      'gateguard', 'plankton-code-quality', 'delivery-gate', 'strategic-compact', 'skill-host-compat', 'skill-stocktake',
      'plan-orchestrate', 'cost-tracking']) {
      const before = source(name);
      transformInstallContent({ sourceRelativePath: `skills/${name}/SKILL.md`, contentTransform: 'copilot-workflow-paths' }, before);
      assert.equal(source(name), before);
      assert.equal(transformInstallContent({ sourceRelativePath: `skills/${name}/SKILL.md` }, before), before);
    }
  });
  test('standalone Hookify skill manages a rule in an ESM project before explicit hook activation', () => {
    const target = path.join(project, 'hookify project');
    const fixtureHome = path.join(project, 'hookify-home');
    fs.mkdirSync(target);
    fs.mkdirSync(fixtureHome);
    const projectMetadata = '{"type":"module"}\n';
    const projectPackage = path.join(target, 'package.json');
    fs.writeFileSync(projectPackage, projectMetadata);
    const env = { ...process.env, HOME: fixtureHome, USERPROFILE: fixtureHome, ECC_DRY_RUN: '0',
      ECC_HOOKS_ENABLED: 'true', ECC_HOOK_PROFILE: 'standard', ECC_DISABLED_HOOKS: '' };
    const run = (args, input) => {
      const result = spawnSync(process.execPath, args, { cwd: target, env, input, encoding: 'utf8', timeout: 20000 });
      assert.ifError(result.error);
      assert.equal(result.status, 0, result.stderr || result.stdout);
      return JSON.parse(result.stdout);
    };
    const installer = [path.join(ROOT, 'scripts/install-apply.js'), '--target', 'copilot', '--json'];
    assert.equal(run([...installer, '--skills', 'hookify-rules', '--no-hooks']).result.applied, true);
    const skill = fs.readFileSync(path.join(target, '.github/skills/hookify-rules/SKILL.md'), 'utf8');
    const manifest = path.join(target, '.github/hooks/ecc.json');
    const cli = '.github/ecc/scripts/copilot-hookify.js';
    assert.ok(skill.includes(`${cli} create --name`));
    assert.doesNotMatch(skill, /\.claude\/|python3 -c/);
    assert.equal(fs.existsSync(manifest), false);
    assert.deepEqual(run([cli, 'list']).rules, []);
    const name = 'fixture-marker';
    const rule = '---\nname: fixture-marker\nenabled: true\nevent: bash\naction: block\npattern: ECC_TEST_MARKER\n---\nFixture policy.\n';
    assert.equal(run([cli, 'create', '--name', name, '--stdin'], rule).created, true);
    const [created] = run([cli, 'list']).rules;
    assert.equal(created.name, name);
    assert.equal(created.source.split(path.sep).join('/'), '.github/ecc/hookify/hookify.fixture-marker.local.md');
    assert.equal(run([...installer, '--modules', 'hooks-runtime', '--enable-hooks']).result.applied, true);
    const entry = JSON.parse(fs.readFileSync(manifest, 'utf8')).hooks.preToolUse.find(item => item.args[0] === cli);
    assert.ok(entry);
    const input = JSON.stringify({ cwd: target, sessionId: 'fixture', toolName: 'powershell', toolArgs: { command: 'Write-Output ECC_TEST_MARKER' } });
    assert.equal(run(entry.args, input).permissionDecision, 'deny');
    assert.equal(run([cli, 'configure', '--name', name, '--enabled', 'false']).updated, true);
    assert.deepEqual(run(entry.args, input), {});
    assert.equal(run([...installer, '--skills', 'hookify-rules', '--no-hooks']).result.applied, true);
    assert.equal(fs.existsSync(manifest), false);
    assert.equal(run([cli, 'list']).rules[0].enabled, false);
    const marker = path.join(target, '.github/ecc/scripts/package.json');
    assert.equal(JSON.parse(fs.readFileSync(marker, 'utf8')).type, 'commonjs');
    fs.unlinkSync(marker);
    assert.equal(run([path.join(ROOT, 'scripts/repair.js'), '--target', 'copilot', '--json']).summary.errorCount, 0);
    assert.equal(run([cli, 'list']).rules[0].enabled, false);
    assert.equal(fs.readFileSync(projectPackage, 'utf8'), projectMetadata);
  });
  test('configure-ecc projects a Copilot-only workflow and its installer previews and repairs the selected project', () => {
    const target = path.join(project, 'configure ecc');
    const fixtureHome = path.join(project, 'configure-home');
    fs.mkdirSync(target);
    fs.mkdirSync(fixtureHome);
    const run = (script, ...args) => {
      const result = spawnSync(process.execPath, [path.join(ROOT, 'scripts', script), '--target', 'copilot', ...args, '--json'], {
        cwd: target, env: { ...process.env, HOME: fixtureHome, USERPROFILE: fixtureHome, ECC_DRY_RUN: '0' },
        encoding: 'utf8', timeout: 20000, maxBuffer: 16 * 1024 * 1024,
      });
      assert.ifError(result.error);
      assert.equal(result.status, 0, result.stderr);
      return JSON.parse(result.stdout);
    };
    const selection = ['--profile', 'core', '--no-hooks'];
    const preview = run('install-apply.js', ...selection, '--dry-run');
    assert.equal(preview.dryRun, true);
    assert.equal(preview.plan.adapter.target, 'copilot');
    assert.equal(preview.plan.hookConsent, 'declined');
    assert.deepEqual(fs.readdirSync(target), []);
    assert.deepEqual(fs.readdirSync(fixtureHome), []);
    const applied = run('install-apply.js', ...selection);
    assert.equal(applied.result.applied, true);
    assert.equal(applied.result.statePreview.request.hookConsent, 'declined');
    const installed = path.join(target, '.github/skills/configure-ecc/SKILL.md');
    const text = fs.readFileSync(installed, 'utf8');
    assert.match(text, /install-apply\.js" --target copilot --profile core --no-hooks --dry-run --json/);
    assert.match(text, /repair\.js" --target copilot --dry-run --json/);
    assert.doesNotMatch(text, /CLAUDE_PLUGIN_ROOT|npx --yes|plugin marketplace/);
    const hooks = path.join(target, '.github/hooks');
    assert.equal(fs.existsSync(path.join(hooks, 'ecc.json')), false);
    fs.mkdirSync(hooks, { recursive: true });
    const userHook = path.join(hooks, 'user.json');
    fs.writeFileSync(userHook, '{}\n');
    fs.unlinkSync(installed);
    const repair = run('repair.js', '--dry-run');
    assert.equal(repair.dryRun, true);
    assert.equal(repair.summary.plannedRepairCount, 1);
    assert.equal(fs.existsSync(installed), false);
    assert.equal(run('repair.js').summary.repairedCount, 1);
    assert.equal(fs.readFileSync(installed, 'utf8'), text);
    assert.equal(fs.readFileSync(userHook, 'utf8'), '{}\n');
    assert.equal(fs.existsSync(path.join(hooks, 'ecc.json')), false);
  });
  test('runtime dependency paths are explicit deduplicated and do not include canonical Vault source', () => {
    const paths = runtimeSkillPaths(['skills/unified-memory', 'skills/continuous-learning-v2/SKILL.md', 'skills/unified-memory']);
    assert.equal(paths.length, new Set(paths).size);
    assert.ok(paths.includes('scripts/copilot-memory.js'));
    assert.ok(paths.includes('scripts/copilot-learning.py'));
    assert.ok(paths.includes('scripts/copilot-observer.js'));
    assert.ok(!paths.includes('scripts/memory.js'));
    for (const file of paths) {
      assert.ok(fs.statSync(path.join(ROOT, file)).isFile(), file);
      const target = path.join(project, '.github/ecc', file);
      fs.mkdirSync(path.dirname(target), { recursive: true }); fs.copyFileSync(path.join(ROOT, file), target);
    }
    const result = spawnSync(process.execPath, ['.github/ecc/scripts/copilot-memory.js', 'doctor'], {
      cwd: project, env: { ...process.env, COPILOT_HOME: path.join(project, 'private') }, encoding: 'utf8', timeout: 15000,
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).status, 'unavailable');
    const learning = spawnSync(process.env.ECC_TEST_PYTHON || 'python', ['.github/ecc/scripts/copilot-learning.py', 'status'], {
      cwd: project, env: { ...process.env, COPILOT_HOME: path.join(project, 'private') }, encoding: 'utf8', timeout: 20000,
    });
    assert.ifError(learning.error);
    assert.equal(learning.status, 0, learning.stderr);
    assert.equal(JSON.parse(learning.stdout).ok, true);
    const observer = spawnSync(process.execPath, ['.github/ecc/scripts/copilot-observer.js', 'status'], {
      cwd: project, env: { ...process.env, COPILOT_HOME: path.join(project, 'private') }, encoding: 'utf8', timeout: 15000,
    });
    assert.equal(observer.status, 0, observer.stderr);
    assert.equal(JSON.parse(observer.stdout).status, 'stopped');
  });
  test('standalone autonomous-loops prepares a scoped run and legacy host notices stay explicit', () => {
    const target = path.join(project, 'loop fixture');
    const fixtureHome = path.join(project, 'loop-home');
    fs.mkdirSync(target);
    fs.mkdirSync(fixtureHome);
    const env = { ...process.env, HOME: fixtureHome, USERPROFILE: fixtureHome,
      COPILOT_HOME: path.join(fixtureHome, 'copilot'), ECC_DRY_RUN: '0' };
    const run = (args, input) => {
      const result = spawnSync(process.execPath, args, { cwd: target, env, input, encoding: 'utf8', timeout: 20000 });
      assert.ifError(result.error);
      assert.equal(result.status, 0, result.stderr || result.stdout);
      return JSON.parse(result.stdout);
    };
    const result = run([path.join(ROOT, 'scripts/install-apply.js'), '--target', 'copilot', '--skills', 'autonomous-loops', '--no-hooks', '--json']);
    assert.equal(result.result.applied, true);
    const skill = fs.readFileSync(path.join(target, '.github/skills/autonomous-loops/SKILL.md'), 'utf8');
    const cli = '.github/ecc/scripts/copilot-orchestrate.js';
    assert.ok(skill.includes(cli));
    assert.doesNotMatch(skill, /\.claude\//);
    const prepared = run([cli], JSON.stringify({ command: 'loop-start', task: 'Review the fixture', maxIterations: 2 }));
    assert.equal(prepared.result.status, 'prepared');
    const read = run([cli], JSON.stringify({ command: 'loop-status', runId: prepared.runId }));
    assert.equal(read.runs[0].runId, prepared.runId);
    assert.equal(read.runs[0].status, 'prepared');
    assert.equal(fs.existsSync(path.join(target, '.github/hooks/ecc.json')), false);
    for (const name of ['config-gc', 'dmux-workflows', 'deepseek-harness-setup']) {
      assert.match(projected(name), /status: notice-only/);
      assert.doesNotMatch(projected(name), /~\/\.claude|~\/\.dsh|npx |tmux new-session/);
    }
  });
  test('standalone memory skill installs its helper closure even when automatic hooks are declined', () => {
    const target = path.join(project, 'standalone'); fs.mkdirSync(target);
    const plan = withHookConsent(createManifestInstallPlan({ target: 'copilot',
      moduleIds: ['skill-unified-memory', 'hooks-runtime'], projectRoot: target,
      homeDir: path.join(target, 'home'), env: {} }), 'declined');
    applyInstallPlan(plan);
    const text = fs.readFileSync(path.join(target, '.github/skills/unified-memory/SKILL.md'), 'utf8');
    assert.match(text, /\.github\/ecc\/scripts\/copilot-memory\.js doctor/);
    assert.equal(fs.existsSync(path.join(target, '.github/hooks/ecc.json')), false);
    for (const file of runtimeSkillPaths(['skills/unified-memory'])) assert.ok(fs.existsSync(path.join(target, '.github/ecc', file)), file);
    const result = spawnSync(process.execPath, ['.github/ecc/scripts/copilot-memory.js', 'doctor'], {
      cwd: target, env: { ...process.env, COPILOT_HOME: path.join(target, 'private') }, encoding: 'utf8', timeout: 15000,
    });
    assert.equal(result.status, 0, result.stderr); assert.equal(JSON.parse(result.stdout).status, 'unavailable');
    const preview = spawnSync(process.execPath, ['.github/ecc/scripts/copilot-memory.js', 'mcp-preview', '--config', path.join(target, '.mcp.json')], {
      cwd: target, env: { ...process.env, ECC_COPILOT_MEMORY_RUNTIME: ROOT }, encoding: 'utf8', timeout: 15000,
    });
    assert.equal(preview.status, 0, preview.stderr);
    assert.match(preview.stdout, /copilot-memory-mcp/);
    assert.equal(fs.existsSync(path.join(target, '.mcp.json')), false);
  });
  test('commands hooks and runtime skills share one owner per distributed helper destination', () => {
    const plan = withHookConsent(createManifestInstallPlan({ target: 'copilot',
      moduleIds: ['skill-unified-memory', 'workflow-quality', 'commands-core', 'hooks-runtime'],
      projectRoot: path.join(project, 'combined'), homeDir: path.join(project, 'home'), env: {} }), 'enabled');
    const helpers = plan.operations.filter(operation => operation.destinationPath.includes(`${path.sep}ecc${path.sep}`));
    const destinations = helpers.map(operation => operation.destinationPath);
    assert.equal(destinations.length, new Set(destinations).size);
  });
  console.log(`Passed: ${passed}, Failed: 0`);
} finally { fs.rmSync(project, { recursive: true, force: true }); }
