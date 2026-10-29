/** Synthetic legacy migration: both install roots stay locked across build/apply. */
'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createFileSystemLoader } = require('./helpers/load-with-file-system');
const { assertFilePostimage } = require('./helpers/assert-file-postimage');
const fileSystem = { ...fs };
const load = createFileSystemLoader(fileSystem);
const { applyInstallPlan } = load(require.resolve('../../scripts/lib/install/apply'));
const { withHookConsent } = require('../../scripts/lib/install/hook-consent');
const { repairInstalledStates, buildDoctorReport } = load(require.resolve('../../scripts/lib/install-lifecycle'));
const { createInstallState, readInstallState, writeInstallState } = require('../../scripts/lib/install-state');
const { withOpenCodeInstallLocks } = load(require.resolve('../../scripts/lib/install/opencode-install-lock'));
const { removeVerifiedLegacyFile } = require('../../scripts/lib/install/opencode-legacy-migration');

const SOURCE_RELATIVE_PATH = path.join('skills', 'skill-comply', 'SKILL.md');
const SKILL_CONTENT = '---\nname: skill-comply\ndescription: Synthetic migration fixture.\n---\n\n# Inert fixture\n';
const sha256 = value => crypto.createHash('sha256').update(value).digest('hex');
const lockPath = root => path.join(root, 'ecc-install-state.json.ecc.lock');

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function privateFixture(callback) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-legacy-consent-lock-')));
  const sourceRoot = path.join(root, 'source');
  const homeDir = path.join(root, 'home');
  const legacyRoot = path.join(homeDir, '.opencode');
  const canonicalRoot = path.join(homeDir, '.config', 'opencode');
  const sourcePath = path.join(sourceRoot, SOURCE_RELATIVE_PATH);
  const legacyFile = path.join(legacyRoot, SOURCE_RELATIVE_PATH);
  const legacyStatePath = path.join(legacyRoot, 'ecc-install-state.json');
  const canonicalStatePath = path.join(canonicalRoot, 'ecc-install-state.json');
  const adapter = { id: 'opencode-home', target: 'opencode', kind: 'home' };
  try {
    writeJson(path.join(sourceRoot, 'package.json'), { name: 'synthetic-ecc-lock-fixture', version: '2.2.2' });
    writeJson(path.join(sourceRoot, 'manifests', 'install-modules.json'), {
      version: 1,
      modules: [{ id: 'workflow-quality', kind: 'skills', description: 'Inert test skill.',
        paths: [SOURCE_RELATIVE_PATH], targets: ['opencode'], dependencies: [],
        defaultInstall: false, cost: 'light', stability: 'stable' }],
    });
    writeJson(path.join(sourceRoot, 'manifests', 'install-profiles.json'), { version: 1, profiles: {} });
    writeJson(path.join(sourceRoot, 'manifests', 'install-components.json'), { version: 1, components: [] });
    for (const filePath of [sourcePath, legacyFile]) {
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, SKILL_CONTENT);
    }
    const operation = { kind: 'copy-file', moduleId: 'workflow-quality',
      sourceRelativePath: SOURCE_RELATIVE_PATH, destinationPath: legacyFile,
      strategy: 'preserve-relative-path', ownership: 'managed', scaffoldOnly: false,
      contentSha256: sha256(SKILL_CONTENT) };
    const stateOptions = {
      adapter,
      request: { profile: null, modules: ['workflow-quality'], includeComponents: [],
        excludeComponents: [], legacyLanguages: [], legacyMode: false, hookConsent: null },
      resolution: { selectedModules: ['workflow-quality'], skippedModules: [] },
      source: { repoVersion: '2.2.2', repoCommit: 'synthetic-legacy-lock-fixture', manifestVersion: 1 },
    };
    writeInstallState(legacyStatePath, createInstallState({ ...stateOptions,
      targetRoot: legacyRoot, installStatePath: legacyStatePath, operations: [operation] }));
    const canonicalOperation = { ...operation, sourcePath,
      destinationPath: path.join(canonicalRoot, SOURCE_RELATIVE_PATH) };
    const canonicalPlan = {
      target: 'opencode', adapter, sourceRoot, homeDir, targetRoot: canonicalRoot,
      installRoot: canonicalRoot, installStatePath: canonicalStatePath,
      selectedModuleIds: ['workflow-quality'], operations: [canonicalOperation], warnings: [],
      statePreview: createInstallState({ ...stateOptions, targetRoot: canonicalRoot,
        installStatePath: canonicalStatePath, operations: [canonicalOperation] }),
    };
    const sourceFiles = ['package.json', 'manifests/install-modules.json',
      'manifests/install-profiles.json', 'manifests/install-components.json', SOURCE_RELATIVE_PATH];
    const sourceSnapshot = new Map(sourceFiles.map(relative => [relative,
      fs.readFileSync(path.join(sourceRoot, relative))]));
    callback({ root, homeDir, sourceRoot, sourcePath, sourceSnapshot, legacyRoot, canonicalRoot,
      legacyFile, legacyStatePath, canonicalStatePath, canonicalPlan });
  } finally {
    // The generated payload and all install paths are inside this fixture.
    // No repository assets, compiler output, real user home or providers are used.
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function repair(value, buildOpencodePayload) {
  return repairInstalledStates({ repoRoot: value.sourceRoot, homeDir: value.homeDir,
    projectRoot: value.homeDir, targets: ['opencode'], env: {}, buildOpencodePayload });
}

function assertSourceUnchanged(value) {
  for (const [relative, bytes] of value.sourceSnapshot) {
    assert.deepStrictEqual(fs.readFileSync(path.join(value.sourceRoot, relative)), bytes, relative);
  }
}

function assertHeldAndIndependentWritersRefused(value) {
  const lockBytes = [value.canonicalRoot, value.legacyRoot].map(targetRoot => {
    const bytes = fs.readFileSync(lockPath(targetRoot));
    assert.strictEqual(JSON.parse(bytes).pid, process.pid);
    return bytes;
  });
  const legacyBytes = fs.readFileSync(value.legacyStatePath);
  assert.throws(() => applyInstallPlan(value.canonicalPlan, {
    beforeInstallStateRead() { assert.fail('Independent apply reached state read while migration held both locks'); },
  }), /Another ECC process.*OpenCode/);
  let nestedBuilds = 0;
  const nested = repair(value, () => {
    nestedBuilds++;
    assert.fail('Independent repair reached build while migration held both locks');
  });
  assert.strictEqual(nested.results.length, 1, JSON.stringify(nested));
  assert.strictEqual(nested.results[0].status, 'error');
  assert.match(nested.results[0].error, /Another ECC process.*OpenCode/);
  assert.strictEqual(nestedBuilds, 0);
  assert.strictEqual(fs.existsSync(value.canonicalStatePath), false);
  assert.deepStrictEqual(fs.readFileSync(value.legacyStatePath), legacyBytes);
  [value.canonicalRoot, value.legacyRoot].forEach((targetRoot, index) => {
    assert.deepStrictEqual(fs.readFileSync(lockPath(targetRoot)), lockBytes[index]);
  });
}

function assertBothLocksReleased(value) {
  for (const targetRoot of [value.canonicalRoot, value.legacyRoot]) {
    assert.strictEqual(fs.existsSync(lockPath(targetRoot)), false);
  }
  withOpenCodeInstallLocks([value.canonicalRoot, value.legacyRoot], () => {
    assert.ok(fs.existsSync(lockPath(value.canonicalRoot)));
    assert.ok(fs.existsSync(lockPath(value.legacyRoot)));
  });
  for (const targetRoot of [value.canonicalRoot, value.legacyRoot]) {
    assert.strictEqual(fs.existsSync(lockPath(targetRoot)), false);
  }
}

function addLegacyActivations(value, consent = null) {
  const manifestPath = path.join(value.sourceRoot, 'manifests', 'install-modules.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath));
  manifest.modules.push({ id: 'platform-configs', kind: 'platform', description: 'Inert config fixture.',
    paths: ['.opencode'], targets: ['opencode'], dependencies: [], defaultInstall: false,
    cost: 'light', stability: 'stable' });
  writeJson(manifestPath, manifest);
  const state = readInstallState(value.legacyStatePath);
  state.request.modules.push('platform-configs');
  state.request.hookConsent = consent;
  state.resolution.selectedModules.push('platform-configs');
  for (const [relative, content] of [
    ['opencode.json', '{"plugin":["./plugins"],"userSetting":true}\n'],
    ['plugins/ecc-hooks.ts', 'export default async () => ({ "session.created": () => {} });\n'],
  ]) {
    const sourceRelativePath = `.opencode/${relative}`;
    const sourcePath = path.join(value.sourceRoot, sourceRelativePath);
    const destinationPath = path.join(value.legacyRoot, relative);
    for (const file of [sourcePath, destinationPath]) {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, content);
    }
    state.operations.push({ kind: 'copy-file', moduleId: 'platform-configs', sourceRelativePath,
      destinationPath, ownership: 'managed', scaffoldOnly: false, strategy: 'preserve-relative-path',
      contentSha256: sha256(content) });
  }
  writeInstallState(value.legacyStatePath, state);
  return state;
}

function buildInertPayload(sourceRoot) {
  const dist = path.join(sourceRoot, '.opencode', 'dist');
  fs.mkdirSync(path.join(dist, 'plugins'), { recursive: true });
  fs.mkdirSync(path.join(dist, 'tools'), { recursive: true });
  fs.writeFileSync(path.join(dist, 'index.js'), 'module.exports = {};\n');
}

function runTests() {
  let passed = 0;
  let failed = 0;
  function test(name, callback) {
    try { privateFixture(callback); passed++; console.log(`  PASS ${name}`); }
    catch (error) { failed++; console.error(`  FAIL ${name}: ${error.stack}`); }
  }
  test('legacy repair holds both roots before build and releases them after a throwing builder', value => {
    const beforeState = fs.readFileSync(value.legacyStatePath);
    let builds = 0;
    const result = repair(value, sourceRoot => {
      builds++;
      assert.strictEqual(sourceRoot, value.sourceRoot);
      assertHeldAndIndependentWritersRefused(value);
      throw new Error('Synthetic builder failure before any source mutation');
    });
    assert.strictEqual(builds, 1);
    assert.strictEqual(result.results.length, 1, JSON.stringify(result));
    assert.strictEqual(result.results[0].status, 'error');
    assert.match(result.results[0].error, /Synthetic builder failure before any source mutation/);
    assert.strictEqual(result.results[0].stateRefreshed, undefined);
    assert.deepStrictEqual(fs.readFileSync(value.legacyStatePath), beforeState);
    assert.strictEqual(fs.readFileSync(value.legacyFile, 'utf8'), SKILL_CONTENT);
    assert.strictEqual(fs.existsSync(value.canonicalStatePath), false);
    assert.strictEqual(fs.existsSync(path.join(value.sourceRoot, '.opencode', 'dist')), false);
    assertSourceUnchanged(value);
    assertBothLocksReleased(value);
  });
  test('legacy repair reuses its opaque lease for canonical apply after an inert synthetic build', value => {
    let builds = 0;
    const result = repair(value, sourceRoot => {
      builds++;
      assert.strictEqual(sourceRoot, value.sourceRoot);
      assertHeldAndIndependentWritersRefused(value);
      const dist = path.join(sourceRoot, '.opencode', 'dist');
      fs.mkdirSync(path.join(dist, 'plugins'), { recursive: true });
      fs.mkdirSync(path.join(dist, 'tools'), { recursive: true });
      fs.writeFileSync(path.join(dist, 'index.js'), 'module.exports = {};\n');
    });
    assert.strictEqual(builds, 1);
    assert.strictEqual(result.summary.errorCount, 0, JSON.stringify(result));
    assert.strictEqual(result.results.length, 1, JSON.stringify(result));
    assert.strictEqual(result.results[0].status, 'repaired');
    assert.strictEqual(result.results[0].stateRefreshed, true);
    assert.strictEqual(result.results[0].installStatePath, value.canonicalStatePath);
    const state = readInstallState(value.canonicalStatePath);
    assert.strictEqual(state.target.root, value.canonicalRoot);
    assert.deepStrictEqual(state.resolution.selectedModules, ['workflow-quality']);
    assert.notStrictEqual(state.request.hookConsent, 'enabled');
    assert.strictEqual(state.operations.length, 1);
    assert.strictEqual(state.operations[0].contentSha256, sha256(SKILL_CONTENT));
    assert.strictEqual(fs.readFileSync(path.join(value.canonicalRoot, SOURCE_RELATIVE_PATH), 'utf8'), SKILL_CONTENT);
    assert.strictEqual(fs.existsSync(value.legacyStatePath), false);
    assert.strictEqual(fs.existsSync(value.legacyFile), false);
    assertSourceUnchanged(value);
    assertBothLocksReleased(value);
  });
  for (const unrelated of ['directory', 'file', 'symlink', 'invalid-state', 'malformed-state', 'non-ECC-state']) {
    test(`canonical apply ignores an unrelated legacy ${unrelated} without locking it`, value => {
      fs.rmSync(value.legacyRoot, { recursive: true, force: true });
      if (unrelated === 'file') fs.writeFileSync(value.legacyRoot, 'user file');
      else if (unrelated === 'symlink') {
        fs.mkdirSync(value.canonicalRoot, { recursive: true });
        fs.symlinkSync(value.canonicalRoot, value.legacyRoot, process.platform === 'win32' ? 'junction' : 'dir');
      } else {
        fs.mkdirSync(value.legacyRoot, { recursive: true });
        if (unrelated === 'malformed-state') fs.writeFileSync(value.legacyStatePath, '{malformed');
        if (unrelated === 'invalid-state') writeJson(value.legacyStatePath, { unrelated: true });
        if (unrelated === 'non-ECC-state') {
          const state = { ...value.canonicalPlan.statePreview, target: { id: 'user-tool', target: 'user-tool',
            root: value.legacyRoot, installStatePath: value.legacyStatePath } };
          writeJson(value.legacyStatePath, state);
        }
      }
      const previousLedger = fs.existsSync(value.legacyStatePath)
        ? fs.readFileSync(value.legacyStatePath) : null;
      const original = fileSystem.openSync;
      let legacyLocks = 0;
      fileSystem.openSync = (candidate, ...args) => {
        if (typeof candidate === 'string' && candidate.startsWith(lockPath(value.legacyRoot))) { legacyLocks++; throw new Error('Unrelated legacy root must not be locked'); }
        return original(candidate, ...args);
      };
      try {
        const plan = withHookConsent({ ...value.canonicalPlan, operations: [],
          statePreview: { ...value.canonicalPlan.statePreview, operations: [] } });
        assert.strictEqual(applyInstallPlan(plan).applied, true);
        assert.strictEqual(legacyLocks, 0);
        if (previousLedger) assert.deepStrictEqual(fs.readFileSync(value.legacyStatePath), previousLedger);
        if (unrelated === 'file') assert.strictEqual(fs.readFileSync(value.legacyRoot, 'utf8'), 'user file');
        if (unrelated === 'symlink') assert.ok(fs.lstatSync(value.legacyRoot).isSymbolicLink());
      } finally { fileSystem.openSync = original; }
      assert.strictEqual(fs.existsSync(lockPath(value.canonicalRoot)), false);
    });
  }
  test('unreadable legacy ECC state remains an explicit failure before writes', value => {
    const original = fileSystem.openSync;
    let attempted = false;
    fileSystem.openSync = (candidate, ...args) => {
      if (candidate === value.legacyStatePath) {
        attempted = true;
        throw Object.assign(new Error('Synthetic unreadable legacy state'), { code: 'EACCES' });
      }
      return original(candidate, ...args);
    };
    try {
      assert.throws(() => applyInstallPlan(value.canonicalPlan), /Unable to inspect legacy/);
      assert.ok(attempted);
      assert.strictEqual(fs.existsSync(value.canonicalStatePath), false);
    } finally { fileSystem.openSync = original; }
  });
  for (const boundary of ['beforeInstallStateRead', 'beforeInstallStateWrite']) {
    test(`new valid legacy state at ${boundary} is never cleaned without its lock`, value => {
      const originalState = fs.readFileSync(value.legacyStatePath);
      fs.rmSync(value.legacyRoot, { recursive: true, force: true });
      let injected = false;
      assert.throws(() => applyInstallPlan(value.canonicalPlan, {
        [boundary]() {
          injected = true;
          fs.mkdirSync(path.dirname(value.legacyFile), { recursive: true });
          fs.writeFileSync(value.legacyFile, SKILL_CONTENT);
          fs.writeFileSync(value.legacyStatePath, originalState);
        },
      }), /lease does not cover/);
      assert.ok(injected);
      assert.deepStrictEqual(fs.readFileSync(value.legacyStatePath), originalState);
      assert.strictEqual(fs.readFileSync(value.legacyFile, 'utf8'), SKILL_CONTENT);
      assert.strictEqual(fs.existsSync(lockPath(value.canonicalRoot)), false);
      assert.strictEqual(fs.existsSync(lockPath(value.legacyRoot)), false);
    });
  }
  for (const consent of [null, 'declined']) {
    test(`verified active legacy copies migrate under ${consent || 'default'} consent with no hooks`, value => {
      addLegacyActivations(value, consent);
      const before = fs.readFileSync(value.legacyStatePath);
      const doctor = buildDoctorReport({ repoRoot: value.sourceRoot, homeDir: value.homeDir,
        projectRoot: value.homeDir, targets: ['opencode'], env: {} });
      assert.ok(doctor.results[0].issues.some(issue => issue.code === 'legacy-opencode-layout'));
      assert.ok(!doctor.results[0].issues.some(issue => issue.code === 'opencode-hook-consent-violation'));
      assert.deepStrictEqual(fs.readFileSync(value.legacyStatePath), before);
      let builds = 0;
      const result = repair(value, sourceRoot => {
        builds++;
        for (const target of [value.canonicalRoot, value.legacyRoot]) assert.ok(fs.existsSync(lockPath(target)));
        buildInertPayload(sourceRoot);
      });
      assert.strictEqual(result.results[0].status, 'repaired', JSON.stringify(result));
      assert.strictEqual(builds, 1);
      const state = readInstallState(value.canonicalStatePath);
      assert.ok(!state.resolution.selectedModules.includes('hooks-runtime'));
      assert.notStrictEqual(state.request.hookConsent, 'enabled');
      assert.strictEqual(fs.readFileSync(path.join(value.canonicalRoot, 'plugins/ecc-hooks.ts'), 'utf8'),
        'export default async () => ({});\n');
      assert.deepStrictEqual(JSON.parse(fs.readFileSync(path.join(value.canonicalRoot, 'opencode.json'))).plugin, []);
      for (const relative of ['opencode.json', 'plugins/ecc-hooks.ts', 'ecc-install-state.json']) {
        assert.strictEqual(fs.existsSync(path.join(value.legacyRoot, relative)), false);
      }
      assertBothLocksReleased(value);
    });
  }
  for (const defect of ['modified', 'missing-digest', 'source-mismatch', 'source-missing', 'symlink', 'unrecorded-alias', 'merge-json']) {
    test(`legacy ${defect} activation refuses before build and preserves ownership`, value => {
      const state = addLegacyActivations(value);
      const plugin = path.join(value.legacyRoot, 'plugins/ecc-hooks.ts');
      const source = path.join(value.sourceRoot, '.opencode/plugins/ecc-hooks.ts');
      if (defect === 'modified') fs.writeFileSync(plugin, 'user edit\n');
      if (defect === 'missing-digest') delete state.operations[2].contentSha256;
      if (defect === 'source-mismatch') fs.writeFileSync(source, 'different trusted source\n');
      if (defect === 'source-missing') fs.unlinkSync(source);
      if (defect === 'symlink') { fs.unlinkSync(plugin); fs.symlinkSync(source, plugin); }
      if (defect === 'unrecorded-alias') fs.copyFileSync(source, path.join(value.legacyRoot, 'plugins/index.js'));
      if (defect === 'merge-json') state.operations[1].kind = 'merge-json';
      writeInstallState(value.legacyStatePath, state);
      const before = fs.readFileSync(value.legacyStatePath);
      let builds = 0;
      const result = repair(value, () => { builds++; throw new Error('Must refuse before build'); });
      assert.strictEqual(result.results[0].status, 'error', defect);
      assert.strictEqual(builds, 0);
      assert.deepStrictEqual(fs.readFileSync(value.legacyStatePath), before);
      assert.strictEqual(fs.existsSync(value.canonicalStatePath), false);
      assertBothLocksReleased(value);
    });
  }
  for (const failure of ['late-edit', 'remove-error', 'quarantine-edit']) {
    test(`legacy ${failure} never reports successful deactivation`, value => {
      addLegacyActivations(value);
      const plugin = path.join(value.legacyRoot, 'plugins/ecc-hooks.ts');
      const originalRename = fileSystem.renameSync;
      const before = fs.readFileSync(value.legacyStatePath);
      let failedRemoval = false;
      fileSystem.renameSync = (from, ...args) => {
        if (failure === 'remove-error' && from === plugin) {
          failedRemoval = true;
          throw Object.assign(new Error('Synthetic removal denial'), { code: 'EACCES' });
        }
        if (failure === 'quarantine-edit' && from === plugin) fs.writeFileSync(plugin, 'user edit at quarantine\n');
        return originalRename(from, ...args);
      };
      try {
        const result = repair(value, sourceRoot => {
          buildInertPayload(sourceRoot);
          if (failure === 'late-edit') fs.writeFileSync(plugin, 'user edit after preflight\n');
        });
        assert.strictEqual(result.results[0].status, 'error', JSON.stringify(result));
        assert.notStrictEqual(result.results[0].stateRefreshed, true);
        assert.deepStrictEqual(fs.readFileSync(value.legacyStatePath), before);
        if (failure === 'late-edit') assert.strictEqual(fs.readFileSync(plugin, 'utf8'), 'user edit after preflight\n');
        else if (failure === 'quarantine-edit') assert.strictEqual(fs.readFileSync(plugin, 'utf8'), 'user edit at quarantine\n');
        else assert.ok(failedRemoval, 'The actual cleanup removal was attempted');
      } finally { fileSystem.renameSync = originalRename; }
      assertBothLocksReleased(value);
    });
  }
  for (const boundary of ['existing', 'missing', 'read-error', 'stat-error']) {
    test(`legacy hash uses trusted read-only flags at the ${boundary} boundary`, value => {
      const setupFd = fs.openSync(value.legacyFile, 'r');
      let stat;
      try { stat = fs.fstatSync(setupFd, { bigint: true }); }
      finally { fs.closeSync(setupFd); }
      const opened = new Set();
      const flagsSeen = [];
      const modesSeen = [];
      const contents = [];
      let closes = 0;
      let quarantinePath;
      const injectedError = new Error(`Synthetic ${boundary}`);
      const facade = {
        ...fs,
        constants: { ...fs.constants,
          O_RDONLY: fs.constants.O_RDONLY | fs.constants.O_CREAT | fs.constants.O_TRUNC,
          O_NOFOLLOW: 0 },
        openSync(file, flags, mode) {
          quarantinePath = file;
          flagsSeen.push(flags);
          modesSeen.push(mode);
          if (boundary === 'missing') fs.unlinkSync(file);
          const fd = fs.openSync(file, flags, mode);
          opened.add(fd);
          return fd;
        },
        fstatSync(fd, options) {
          if (boundary === 'stat-error') throw injectedError;
          return fs.fstatSync(fd, options);
        },
        readFileSync(fd) {
          if (boundary === 'read-error') throw injectedError;
          const content = fs.readFileSync(fd);
          contents.push(content.toString('utf8'));
          return content;
        },
        closeSync(fd) {
          assert.ok(opened.has(fd), 'close only an owned hash descriptor');
          fs.closeSync(fd);
          opened.delete(fd);
          closes++;
        },
      };
      try {
        const remove = () => removeVerifiedLegacyFile({ destinationPath: value.legacyFile,
          stat, digest: sha256(SKILL_CONTENT) }, { targetRoot: value.legacyRoot }, facade);
        if (boundary === 'existing') assert.strictEqual(remove(), true);
        else if (boundary === 'missing') assert.throws(remove, error => error.code === 'ENOENT');
        else assert.throws(remove, error => error === injectedError);
        assert.deepStrictEqual(flagsSeen,
          [fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0)]);
        assert.deepStrictEqual(modesSeen, [0o600]);
        assert.strictEqual(opened.size, 0);
        assert.strictEqual(closes, boundary === 'missing' ? 0 : 1);
        if (boundary === 'existing') assert.deepStrictEqual(contents, [SKILL_CONTENT]);
        if (boundary === 'read-error' || boundary === 'stat-error') {
          assertFilePostimage(value.legacyFile, stat, SKILL_CONTENT);
        } else {
          assert.strictEqual(fs.existsSync(value.legacyFile), false);
        }
        assert.strictEqual(fs.existsSync(quarantinePath), false);
      } finally {
        for (const fd of opened) fs.closeSync(fd);
      }
    });
  }
  for (const defect of ['identity', 'bytes', 'path snapshot']) {
    test(`descriptor postimage assertion refuses different ${defect}`, value => {
      const flags = defect === 'bytes' ? fs.constants.O_RDWR : fs.constants.O_RDONLY;
      const fd = fs.openSync(value.legacyFile, flags | (fs.constants.O_NOFOLLOW || 0), 0o600);
      let identity;
      try {
        identity = fs.fstatSync(fd, { bigint: true });
        if (defect === 'bytes') fs.writeFileSync(fd, 'changed private fixture bytes');
      }
      finally { fs.closeSync(fd); }
      if (defect === 'identity') identity = { ...identity, ino: identity.ino + 1n };
      const opened = [];
      const closed = [];
      const facade = { ...fs,
        openSync(...args) { const value = fs.openSync(...args); opened.push(value); return value; },
        closeSync(value) { fs.closeSync(value); closed.push(value); },
      };
      if (defect === 'path snapshot') {
        const otherFd = fs.openSync(path.join(value.legacyRoot, 'different-file'), 'wx', 0o600);
        let otherIdentity;
        try { otherIdentity = fs.fstatSync(otherFd, { bigint: true }); }
        finally { fs.closeSync(otherFd); }
        // Supply a real second-file snapshot without renaming any open Windows file.
        facade.lstatSync = () => otherIdentity;
      }
      assert.throws(() => assertFilePostimage(value.legacyFile, identity, SKILL_CONTENT, facade),
        /postimage (ino|bytes|path ino) must match/);
      assert.strictEqual(opened.length, 1);
      assert.deepStrictEqual(closed, opened, 'a failed assertion still closes its owned descriptor');
    });
  }
  for (const boundary of ['open', 'fstat', 'read', 'identity', 'fstat-close', 'read-close',
    'identity-close', 'close', 'falsy-close']) {
    test(`descriptor postimage assertion preserves the ${boundary} failure and closes once`, value => {
      const setupFd = fs.openSync(value.legacyFile, 'r');
      let identity;
      try { identity = fs.fstatSync(setupFd, { bigint: true }); }
      finally { fs.closeSync(setupFd); }
      const primary = boundary === 'falsy-close' ? undefined : new Error(`Synthetic ${boundary}`);
      const closeFailure = new Error('Synthetic close failure');
      const opened = [];
      const closed = [];
      const facade = { ...fs,
        openSync(...args) {
          if (boundary === 'open') throw primary;
          const fd = fs.openSync(...args);
          opened.push(fd);
          return fd;
        },
        fstatSync(...args) {
          if (boundary.startsWith('fstat')) throw primary;
          return fs.fstatSync(...args);
        },
        readFileSync(...args) {
          if (boundary.startsWith('read') || boundary === 'falsy-close') throw primary;
          return fs.readFileSync(...args);
        },
        closeSync(fd) {
          assert.ok(opened.includes(fd), 'only close an owned descriptor');
          fs.closeSync(fd);
          closed.push(fd);
          if (boundary.endsWith('close')) throw closeFailure;
        },
      };
      if (boundary.startsWith('identity')) identity = { ...identity, ino: identity.ino + 1n };
      let threw = false;
      try {
        assertFilePostimage(value.legacyFile, identity, SKILL_CONTENT, facade);
      } catch (error) {
        threw = true;
        if (boundary.startsWith('identity')) {
          assert.strictEqual(error.code, 'ERR_ASSERTION');
          assert.match(error.message, /postimage ino must match/);
        } else assert.strictEqual(error, boundary === 'close' ? closeFailure : primary);
      }
      assert.ok(threw, 'the failure must propagate');
      assert.strictEqual(opened.length, boundary === 'open' ? 0 : 1);
      assert.deepStrictEqual(closed, opened, 'close each owned descriptor exactly once');
    });
  }
  console.log(`\nResults: Passed: ${passed}, Failed: ${failed}`);
  return { passed, failed };
}

if (require.main === module) process.exitCode = runTests().failed ? 1 : 0;
module.exports = { runTests };
