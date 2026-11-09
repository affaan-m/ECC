#!/usr/bin/env node
'use strict';

const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { fixtureEnvironment, plannedSkills } = require('./copilot-native-discovery');
const { createManifestInstallPlan } = require('./lib/install-executor');
const { withHookConsent } = require('./lib/install/hook-consent');
const { scanText } = require('./ci/copilot-catalog-audit');

const ROOT = path.resolve(__dirname, '..');

// These are examples or identifiers reviewed against the rendered entrypoints.
// An unknown missing path must be fixed or reviewed before the gate can pass.
const REVIEWED_EXAMPLES = new Map([
  ['skills/agent-payment-x402/SKILL.md', ['assets/decimals']], // TypeScript comment
  ['skills/coding-standards/SKILL.md', ['hooks/useAuth.ts']], // project example
  ['skills/council-multi-model/SKILL.md', ['scripts/council-multi-model.test.js']], // full checkout tests/ prefix
  ['skills/docker-patterns/SKILL.md', ['scripts/init-db.sql', 'scripts/init.sql']], // project mounts
  ['skills/git-workflow/SKILL.md', ['hooks/pre-commit', 'hooks/pre-push']], // hooks created by the example
  ['skills/ios-icon-gen/SKILL.md', ['assets/icons']], // generated output path fragment
  ['skills/motion-advanced/SKILL.md', ['hooks/use-reduced-motion']], // project example
  ['skills/motion-foundations/SKILL.md', ['hooks/use-reduced-motion', 'hooks/use-reduced-motion.tsx']],
  ['skills/motion-patterns/SKILL.md', ['hooks/use-reduced-motion']],
  ['skills/react-review/SKILL.md', ['hooks/useUser.ts']], // project example
  ['agents/planner.md', ['hooks/stripe/route.ts']], // fragment of the example webhook path
  ['agents/react-reviewer.md', ['hooks/exhaustive-deps']], // ESLint rule name
  ['instructions/ecc/react/hooks.instructions.md', ['hooks/rules-of-hooks', 'hooks/exhaustive-deps']],
]);

function run(command, args, { cwd, env, input, label }) {
  const result = spawnSync(command, args, {
    cwd, env, input, encoding: 'utf8', shell: false, windowsHide: true,
    timeout: 90000, maxBuffer: 24 * 1024 * 1024,
  });
  if (result.error || result.signal || result.status !== 0) throw new Error(`${label} failed.`);
  return result.stdout;
}

function verifyPackagedCatalog(project, plan) {
  const expected = plannedSkills(plan.operations, project);
  assert.ok(expected.size, 'Full source profile must plan skills');
  const skills = path.join(project, '.github', 'skills');
  const actual = fs.readdirSync(skills, { withFileTypes: true })
    .filter(entry => entry.isDirectory() && fs.existsSync(path.join(skills, entry.name, 'SKILL.md')))
    .map(entry => entry.name).sort();
  assert.deepEqual(actual, [...expected.keys()].sort(), 'Packed profile skill coverage');
  let managedReferences = 0;
  let instructions = 0;
  let skillLocalReferences = 0;
  let files = 0;
  const managed = path.join(project, '.github', 'ecc');
  for (const { destinationPath, sourceRelativePath } of plan.operations) {
    // npm omits this skill's Python build-output ignore metadata.
    if (sourceRelativePath === 'skills/taste-application/scripts/.gitignore') continue;
    files++;
    const relative = path.relative(project, destinationPath);
    assert.ok(fs.existsSync(destinationPath) && fs.lstatSync(destinationPath).isFile(),
      `Packed profile did not install ${relative}`);
    if (!/^(?:skills|agents|instructions)$/.test(relative.split(path.sep)[1]) || !relative.endsWith('.md')) continue;
    instructions++;
    const body = fs.readFileSync(destinationPath, 'utf8');
    const entry = path.relative(path.join(project, '.github'), destinationPath).split(path.sep).join('/');
    const findings = scanText(ROOT, entry, body)
      .filter(finding => finding.context === 'executable-candidate');
    const hostExamples = findings.filter(finding => finding.kind.startsWith('host-'));
    assert.ok(!hostExamples.length,
      `Host-specific fenced references in ${relative}: ${hostExamples.map(finding => finding.line).join(', ')}`);
    if (/^(?:skills\/[^/]+\/SKILL\.md|agents\/|instructions\/)/.test(entry)) {
      const examples = REVIEWED_EXAMPLES.get(entry) || [];
      const unresolved = findings.filter(finding => finding.kind === 'local-reference'
        && finding.resolution === 'missing' && !examples.includes(finding.reference));
      assert.ok(!unresolved.length,
        `Unreviewed paths in ${relative}: ${unresolved.map(finding => finding.reference).join(', ')}`);
    }
    for (const match of body.matchAll(/<installed-skill>\/((?:scripts|assets)\/[\w./-]+)/g)) {
      const [, asset] = match;
      assert.ok(!asset.split('/').includes('..'), `Unexpected skill asset reference in ${relative}`);
      const target = path.join(path.dirname(destinationPath), asset);
      assert.ok(fs.existsSync(target) && fs.lstatSync(target).isFile(), `Missing ${asset} for ${relative}`);
      skillLocalReferences++;
    }
    const references = new Set([...body.matchAll(/\.github\/ecc\/(scripts\/[\w./-]+\.(?:[cm]?js|py|ps1|sh))\b/g)]
      .map(match => match[1]));
    for (const runtime of references) {
      assert.ok(!runtime.split('/').includes('..'), `Unexpected runtime reference in ${relative}`);
      assert.ok(fs.existsSync(path.join(managed, runtime)) && fs.lstatSync(path.join(managed, runtime)).isFile(),
        `Missing ${runtime} for installed instruction ${relative}`);
      managedReferences++;
    }
  }
  return { files, skills: actual.length, instructions, managedReferences, skillLocalReferences };
}

function smoke(npm) {
  if (!npm || !path.isAbsolute(npm) || !fs.statSync(npm).isFile()) throw new Error('Run the package smoke through npm.');
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc copilot package '));
  try {
    const env = fixtureEnvironment(fixture);
    const pack = JSON.parse(run(process.execPath, [npm, 'pack', '--ignore-scripts', '--json', '--pack-destination', fixture], {
      cwd: ROOT, env, label: 'Package creation',
    }));
    const name = pack[0]?.filename;
    assert.ok(typeof name === 'string' && /^ecc-universal-[a-z0-9.-]+\.tgz$/i.test(name));
    run('tar', ['-xzf', path.join(fixture, name), '-C', fixture], { cwd: fixture, env, label: 'Package extraction' });
    const project = fs.mkdirSync(path.join(fixture, 'project'), { recursive: true });
    const metadata = '{"type":"module"}\n';
    fs.writeFileSync(path.join(project, 'package.json'), metadata);
    // Test the packed sources using the dependency tree already verified by
    // npm ci. No network dependency resolution is performed by this smoke.
    const installEnv = { ...env, NODE_PATH: path.join(ROOT, 'node_modules') };
    const installer = path.join(fixture, 'package', 'scripts', 'install-apply.js');
    const sourcePlan = withHookConsent(createManifestInstallPlan({
      target: 'copilot', profileId: 'full', projectRoot: project, homeDir: fixture, env,
    }), 'declined');
    const apply = JSON.parse(run(process.execPath, [installer, '--target', 'copilot', '--profile', 'full', '--no-hooks', '--json'], {
      cwd: project, env: installEnv, label: 'Packed project install',
    }));
    assert.equal(apply.result.applied, true);
    const catalog = verifyPackagedCatalog(project, sourcePlan);
    const invoke = (file, args, input) => JSON.parse(run(process.execPath, [path.join(project, '.github', 'ecc', 'scripts', file), ...args], {
      cwd: project, env, input, label: 'Installed runtime',
    }));
    assert.deepEqual(invoke('copilot-hookify.js', ['list']), { rules: [] });
    assert.equal(invoke('copilot-skill-comply.js', ['--session', 'package-smoke', '--skill', 'skill-comply']).status,
      'journal-unavailable');
    assert.equal(invoke('hooks/copilot-lifecycle.js', ['checkpoint', '--session', 'package-smoke', '--stdin'], 'Packed fixture checkpoint.').saved, true);
    assert.equal(invoke('hooks/copilot-lifecycle.js', ['recall', '--session', 'package-smoke']).summary, 'Packed fixture checkpoint.');
    assert.equal(fs.existsSync(path.join(project, '.github', 'hooks', 'ecc.json')), false);
    assert.equal(fs.readFileSync(path.join(project, 'package.json'), 'utf8'), metadata);
    return { schema: 'ecc.copilot.package-smoke.v1', status: 'passed', platform: process.platform,
      node: process.version, catalog, package: name, integrity: pack[0].integrity, nativeAcceptance: 'pending' };
  } finally { fs.rmSync(fixture, { recursive: true, force: true }); }
}

try { process.stdout.write(JSON.stringify(smoke(process.env.npm_execpath), null, 2) + '\n'); }
catch (error) { process.stderr.write(`Copilot package smoke failed. ${error instanceof assert.AssertionError ? (error.generatedMessage ? 'A packed fixture check failed.' : error.message) : error.message}\n`); process.exitCode = 1; }
