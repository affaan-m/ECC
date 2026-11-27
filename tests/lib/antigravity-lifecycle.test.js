'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { createManifestInstallPlan } = require('../../scripts/lib/install/plan');
const { applyInstallPlan } = require('../../scripts/lib/install/apply');
const { withHookConsent } = require('../../scripts/lib/install/hook-consent');
const { buildDoctorReport, repairInstalledStates, uninstallInstalledStates } = require('../../scripts/lib/install-lifecycle');

const repoRoot = path.join(__dirname, '..', '..');
const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'antigravity-lifecycle-'));
const homeDir = path.join(fixtureRoot, 'home');
const projectRoot = path.join(fixtureRoot, 'project');

try {
  fs.mkdirSync(homeDir);
  fs.mkdirSync(projectRoot);
  const plan = withHookConsent(createManifestInstallPlan({
    profileId: 'core',
    target: 'antigravity-home',
    homeDir,
    projectRoot,
  }), 'enabled');
  const workflowPath = path.join(homeDir, '.gemini', 'config', 'workflows', 'plan.md');
  applyInstallPlan(plan);

  const original = fs.readFileSync(workflowPath, 'utf8');
  fs.unlinkSync(workflowPath);

  const doctor = buildDoctorReport({
    repoRoot,
    homeDir,
    projectRoot,
    targets: ['antigravity-home'],
  }).results[0];
  assert.ok(!doctor.issues.some(issue => issue.code === 'unsafe-managed-destination'));

  const repaired = repairInstalledStates({
    repoRoot,
    homeDir,
    projectRoot,
    targets: ['antigravity-home'],
  }).results[0];
  assert.strictEqual(repaired.status, 'repaired', repaired.error);
  assert.strictEqual(fs.readFileSync(workflowPath, 'utf8'), original);

  const outsidePath = path.join(homeDir, 'outside.md');
  fs.writeFileSync(outsidePath, 'user content');
  fs.unlinkSync(workflowPath);
  fs.symlinkSync(outsidePath, workflowPath);
  const refused = repairInstalledStates({
    repoRoot,
    homeDir,
    projectRoot,
    targets: ['antigravity-home'],
  }).results[0];
  assert.strictEqual(refused.status, 'error');
  assert.match(refused.error, /unsafe managed destination|symlink/i);
  assert.strictEqual(fs.readFileSync(outsidePath, 'utf8'), 'user content');

  const uninstalled = uninstallInstalledStates({
    homeDir,
    projectRoot,
    targets: ['antigravity-home'],
  }).results[0];
  assert.strictEqual(uninstalled.status, 'partial', uninstalled.error);
  assert.ok(uninstalled.retainedPaths.includes(workflowPath));
  assert.ok(fs.lstatSync(workflowPath).isSymbolicLink());
  assert.strictEqual(fs.readFileSync(outsidePath, 'utf8'), 'user content');

  const symlinkHome = path.join(fixtureRoot, 'symlink-home');
  const symlinkProject = path.join(fixtureRoot, 'symlink-project');
  fs.mkdirSync(symlinkHome);
  fs.mkdirSync(symlinkProject);
  const symlinkPlan = withHookConsent(createManifestInstallPlan({
    profileId: 'core',
    target: 'antigravity-home',
    homeDir: symlinkHome,
    projectRoot: symlinkProject,
  }), 'enabled');
  applyInstallPlan(symlinkPlan);
  const workflowsRoot = path.join(symlinkHome, '.gemini', 'config', 'workflows');
  const externalRoot = path.join(fixtureRoot, 'external-workflows');
  fs.renameSync(workflowsRoot, externalRoot);
  fs.symlinkSync(externalRoot, workflowsRoot, 'dir');
  const externalWorkflow = path.join(externalRoot, 'plan.md');
  const externalContent = fs.readFileSync(externalWorkflow, 'utf8');

  assert.throws(() => applyInstallPlan(symlinkPlan), /outside|symlink|trusted/i);
  // One unsafe target root must not hide doctor results for other targets.
  applyInstallPlan(withHookConsent(createManifestInstallPlan({
    profileId: 'core',
    target: 'antigravity',
    homeDir: symlinkHome,
    projectRoot: symlinkProject,
  }), 'enabled'));
  const unsafeRootDoctor = buildDoctorReport({
    repoRoot,
    homeDir: symlinkHome,
    projectRoot: symlinkProject,
    targets: ['antigravity-home', 'antigravity'],
  }).results;
  const homeDoctor = unsafeRootDoctor.find(result => result.adapter.target === 'antigravity-home');
  const projectDoctor = unsafeRootDoctor.find(result => result.adapter.target === 'antigravity');
  assert.strictEqual(homeDoctor.status, 'error');
  assert.ok(homeDoctor.issues.some(issue => issue.code === 'unsafe-trusted-root'));
  assert.ok(projectDoctor, 'project target must still be reported');
  assert.notStrictEqual(projectDoctor.status, 'error');
  const rootSymlinkRepair = repairInstalledStates({
    repoRoot,
    homeDir: symlinkHome,
    projectRoot: symlinkProject,
    targets: ['antigravity-home'],
  }).results[0];
  const rootSymlinkUninstall = uninstallInstalledStates({
    homeDir: symlinkHome,
    projectRoot: symlinkProject,
    targets: ['antigravity-home'],
  }).results[0];
  assert.strictEqual(rootSymlinkRepair.status, 'error');
  assert.strictEqual(rootSymlinkUninstall.status, 'error');
  assert.strictEqual(fs.readFileSync(externalWorkflow, 'utf8'), externalContent);

  const defaultHome = path.join(fixtureRoot, 'default-home');
  const defaultProject = path.join(fixtureRoot, 'default-project');
  fs.mkdirSync(defaultHome);
  fs.mkdirSync(defaultProject);
  applyInstallPlan(withHookConsent(createManifestInstallPlan({
    profileId: 'core',
    target: 'antigravity',
    homeDir: defaultHome,
    projectRoot: defaultProject,
  }), 'enabled'));
  const previousHome = process.env.HOME;
  const previousCwd = process.cwd();
  try {
    process.env.HOME = defaultHome;
    process.chdir(defaultProject);
    const defaultUninstall = uninstallInstalledStates({ targets: ['antigravity'] }).results[0];
    assert.strictEqual(defaultUninstall.status, 'uninstalled', defaultUninstall.error);
    assert.ok(!fs.existsSync(path.join(defaultProject, '.agents', 'ecc-install-state.json')));
  } finally {
    process.chdir(previousCwd);
    if (previousHome === undefined) delete process.env.HOME;
    else process.env.HOME = previousHome;
  }
  console.log('Results: Passed: 7, Failed: 0');
} finally {
  fs.rmSync(fixtureRoot, { recursive: true, force: true });
}
