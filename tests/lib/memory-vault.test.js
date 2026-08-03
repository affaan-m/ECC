'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const {
  MAX_DIAGNOSTICS,
  MAX_FILES,
  MAX_SCAN_BYTES,
  MEMORY_SCHEMA_VERSION,
  MEMORY_KINDS,
  doctorMemoryVault,
  findPotentialSecrets,
  initializeVault,
  parseMemoryDocument,
  readMemoryById,
  readRegularTextFile,
  resolveVaultRoots,
  saveMemory,
  searchMemories,
  serializeMemoryDocument,
} = require('../../scripts/lib/memory-vault');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  PASS ${name}`);
    passed += 1;
  } catch (error) {
    console.log(`  FAIL ${name}`);
    console.log(`    ${error.stack || error.message}`);
    failed += 1;
  }
}

function createFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-memory-vault-'));
  const projectRoot = path.join(root, 'project');
  const nested = path.join(projectRoot, 'packages', 'app');
  const homeDir = path.join(root, 'home');
  fs.mkdirSync(path.join(projectRoot, '.git'), { recursive: true });
  fs.mkdirSync(nested, { recursive: true });
  fs.mkdirSync(homeDir, { recursive: true });
  const roots = resolveVaultRoots({ cwd: nested, homeDir, env: {} });
  return { root, projectRoot, nested, homeDir, roots };
}

function fixedOptions(roots, id = 'mem_20260726_01kexample') {
  return {
    roots,
    now: () => '2026-07-26T20:00:00.000Z',
    idFactory: () => id,
  };
}

function baseMemory(overrides = {}) {
  return {
    schema: MEMORY_SCHEMA_VERSION,
    id: 'mem_20260726_01kexample',
    title: 'Authentication migration handoff',
    kind: 'handoff',
    scope: 'project',
    trust: 'unreviewed',
    status: 'active',
    sourceHarness: 'codex',
    targetHarnesses: ['claude'],
    tags: ['auth', 'migration'],
    links: ['mem_20260725_01kolder'],
    createdAt: '2026-07-26T20:00:00.000Z',
    updatedAt: '2026-07-26T20:00:00.000Z',
    body: 'Tests pass. Continue with token rotation.',
    ...overrides,
  };
}

console.log('\n=== Testing ECC memory vault core ===\n');

test('resolves project, team, and user roots from the nearest project boundary', () => {
  const fixture = createFixture();
  try {
    assert.strictEqual(
      fixture.roots.project,
      path.join(fixture.projectRoot, '.ecc', 'memory', 'project')
    );
    assert.strictEqual(
      fixture.roots.team,
      path.join(fixture.projectRoot, '.ecc', 'memory', 'team')
    );
    assert.strictEqual(
      fixture.roots.user,
      path.join(fixture.homeDir, '.ecc', 'memory')
    );
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('uses the working directory for non-git projects instead of a global bucket', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-memory-no-git-'));
  const homeDir = path.join(root, 'home');
  fs.mkdirSync(homeDir);
  try {
    const roots = resolveVaultRoots({ cwd: root, homeDir, env: {} });
    assert.strictEqual(roots.project, path.join(root, '.ecc', 'memory', 'project'));
    assert.strictEqual(roots.team, path.join(root, '.ecc', 'memory', 'team'));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('honors explicit project and user vault root overrides', () => {
  const fixture = createFixture();
  try {
    const projectVault = path.join(fixture.root, 'shared-memory');
    const userVault = path.join(fixture.root, 'personal-memory');
    const roots = resolveVaultRoots({
      cwd: fixture.nested,
      homeDir: fixture.homeDir,
      env: {
        ECC_MEMORY_PROJECT_ROOT: projectVault,
        ECC_MEMORY_USER_ROOT: userVault,
      },
    });
    assert.strictEqual(roots.project, path.join(projectVault, 'project'));
    assert.strictEqual(roots.team, path.join(projectVault, 'team'));
    assert.strictEqual(roots.user, userVault);
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('initializes every memory kind without creating opaque database files', () => {
  const fixture = createFixture();
  try {
    const initialized = initializeVault({ roots: fixture.roots, scopes: ['project', 'user'] });
    assert.deepStrictEqual(initialized.scopes, ['project', 'user']);
    for (const scope of initialized.scopes) {
      for (const kind of MEMORY_KINDS) {
        assert.ok(fs.statSync(path.join(fixture.roots[scope], `${kind}s`)).isDirectory());
      }
    }
    assert.strictEqual(
      fs.readdirSync(fixture.roots.project)
        .some(file => file.endsWith('.db')),
      false
    );
    assert.strictEqual(
      fs.readFileSync(path.join(fixture.roots.project, '.gitignore'), 'utf8'),
      '*\n!.gitignore\n'
    );
    assert.strictEqual(
      fs.existsSync(path.join(fixture.roots.user, '.gitignore')),
      false
    );
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('round-trips the strict ecc.memory.v1 Markdown frontmatter contract', () => {
  const original = baseMemory();
  const serialized = serializeMemoryDocument(original);
  assert.ok(serialized.startsWith('---\nschema: "ecc.memory.v1"\n'));
  assert.ok(serialized.includes('target_harnesses: ["claude"]'));
  assert.ok(serialized.endsWith('Tests pass. Continue with token rotation.\n'));
  assert.deepStrictEqual(parseMemoryDocument(serialized, 'handoff.md'), original);
});

test('accepts CRLF frontmatter delimiters and line endings', () => {
  const original = baseMemory();
  const serialized = serializeMemoryDocument(original).replace(/\n/g, '\r\n');
  assert.deepStrictEqual(parseMemoryDocument(serialized, 'windows.md'), original);
});

test('requires the closing frontmatter marker to occupy an exact delimiter line', () => {
  const malformed = serializeMemoryDocument(baseMemory())
    .replace('\n---\n\n', '\n---NOT-A-DELIMITER\n\n');
  assert.throws(
    () => parseMemoryDocument(malformed, 'malformed-closing.md'),
    /closing frontmatter|frontmatter line/i
  );
});

test('rejects malformed, unknown-schema, and invalid metadata documents', () => {
  assert.throws(() => parseMemoryDocument('not frontmatter', 'bad.md'), /frontmatter/i);
  assert.throws(
    () => parseMemoryDocument(
      serializeMemoryDocument(baseMemory()).replace('ecc.memory.v1', 'ecc.memory.v999'),
      'bad.md'
    ),
    /Unsupported memory schema/
  );
  assert.throws(
    () => serializeMemoryDocument(baseMemory({ targetHarnesses: ['../../escape'] })),
    /target harness/i
  );
  assert.throws(
    () => serializeMemoryDocument(baseMemory({ sourceHarness: 'Claude' })),
    /source harness/i
  );
  assert.throws(
    () => serializeMemoryDocument(baseMemory({ tags: ['auth', 'auth'] })),
    /duplicate/i
  );
  assert.throws(
    () => serializeMemoryDocument(baseMemory({ createdAt: '2026-07-26' })),
    /ISO-8601/i
  );
  assert.throws(
    () => serializeMemoryDocument(baseMemory({ trust: 'reviewed' })),
    /memory trust/i
  );
});

test('creates an unreviewed memory in the scope and kind directory', () => {
  const fixture = createFixture();
  try {
    const saved = saveMemory({
      title: 'Authentication migration handoff',
      body: 'Tests pass. Continue with token rotation.',
      kind: 'handoff',
      scope: 'project',
      sourceHarness: 'codex',
      targetHarnesses: ['claude'],
      tags: ['auth', 'migration'],
    }, fixedOptions(fixture.roots));

    assert.strictEqual(saved.memory.trust, 'unreviewed');
    assert.strictEqual(saved.memory.status, 'active');
    assert.strictEqual(
      saved.path,
      path.join(
        fixture.roots.project,
        'handoffs',
        'mem_20260726_01kexample.md'
      )
    );
    assert.deepStrictEqual(
      parseMemoryDocument(fs.readFileSync(saved.path, 'utf8'), saved.path),
      saved.memory
    );
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('never overwrites a duplicate ID', () => {
  const fixture = createFixture();
  try {
    const options = fixedOptions(fixture.roots);
    saveMemory({ title: 'First', body: 'one' }, options);
    assert.throws(
      () => saveMemory({ title: 'Second', body: 'two' }, options),
      /already exists/i
    );
    const result = readMemoryById('mem_20260726_01kexample', { roots: fixture.roots });
    assert.strictEqual(result.memory.title, 'First');
    assert.strictEqual(result.memory.body, 'one');
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('never follows a pre-existing destination symlink during create-only publication', () => {
  const fixture = createFixture();
  const outside = path.join(fixture.root, 'outside.md');
  try {
    const notes = path.join(fixture.roots.project, 'notes');
    fs.mkdirSync(notes, { recursive: true });
    fs.writeFileSync(outside, 'outside sentinel');
    const destination = path.join(notes, 'mem_20260726_01kexample.md');
    fs.symlinkSync(outside, destination);

    assert.throws(
      () => saveMemory(
        { title: 'Must not overwrite', body: 'create-only content' },
        fixedOptions(fixture.roots)
      ),
      /already exists|create-only|outside|refusing/i
    );
    assert.strictEqual(fs.readFileSync(outside, 'utf8'), 'outside sentinel');
    assert.strictEqual(fs.lstatSync(destination).isSymbolicLink(), true);
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('fails closed when the project memory gitignore is preseeded with unsafe rules', () => {
  const fixture = createFixture();
  try {
    fs.mkdirSync(fixture.roots.project, { recursive: true });
    fs.writeFileSync(path.join(fixture.roots.project, '.gitignore'), '');
    assert.throws(
      () => saveMemory(
        { title: 'Must remain local', body: 'Sensitive project context.' },
        fixedOptions(fixture.roots)
      ),
      /gitignore.*fail-closed/i
    );
    assert.strictEqual(
      fs.existsSync(path.join(
        fixture.roots.project,
        'notes',
        'mem_20260726_01kexample.md'
      )),
      false
    );
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('the canonical project guard is honored by git status and check-ignore', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-memory-git-ignore-'));
  const projectRoot = path.join(root, 'project');
  const homeDir = path.join(root, 'home');
  fs.mkdirSync(projectRoot);
  fs.mkdirSync(homeDir);
  try {
    const initialized = spawnSync('git', ['init', '-q'], {
      cwd: projectRoot,
      encoding: 'utf8',
    });
    assert.strictEqual(initialized.status, 0, initialized.stderr);
    const roots = resolveVaultRoots({ cwd: projectRoot, homeDir, env: {} });
    const saved = saveMemory(
      { title: 'Ignored context', body: 'Must not enter git status.' },
      fixedOptions(roots)
    );
    const relativePath = path.relative(projectRoot, saved.path);
    const ignored = spawnSync('git', ['check-ignore', '-q', relativePath], {
      cwd: projectRoot,
      encoding: 'utf8',
    });
    assert.strictEqual(ignored.status, 0, ignored.stderr);
    const status = spawnSync('git', ['status', '--porcelain'], {
      cwd: projectRoot,
      encoding: 'utf8',
    });
    assert.strictEqual(status.status, 0, status.stderr);
    assert.strictEqual(status.stdout.includes(saved.memory.id), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('rejects a vault path that traverses a symlink before creating directories', () => {
  const fixture = createFixture();
  const outside = path.join(fixture.root, 'outside');
  fs.mkdirSync(outside);
  fs.symlinkSync(outside, path.join(fixture.projectRoot, '.ecc'));
  try {
    assert.throws(
      () => saveMemory(
        { title: 'Escaped note', body: 'must stay in the project' },
        fixedOptions(fixture.roots)
      ),
      /symlink/i
    );
    assert.strictEqual(fs.existsSync(path.join(outside, 'memory')), false);
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('rejects a symlinked ancestor when roots come back from initializeVault', () => {
  const fixture = createFixture();
  const outside = path.join(fixture.root, 'outside');
  fs.mkdirSync(outside);
  try {
    const initialized = initializeVault({ roots: fixture.roots, scopes: ['project'] });
    fs.rmSync(path.join(fixture.projectRoot, '.ecc'), { recursive: true, force: true });
    fs.symlinkSync(outside, path.join(fixture.projectRoot, '.ecc'));

    assert.throws(
      () => saveMemory(
        { title: 'Escaped note', body: 'must stay in the project' },
        { ...fixedOptions(fixture.roots), roots: initialized.roots }
      ),
      /symlink|outside|trusted/i
    );
    assert.strictEqual(fs.existsSync(path.join(outside, 'memory')), false);
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('fails closed when callers provide roots without a boundary policy', () => {
  const fixture = createFixture();
  try {
    const rootsWithoutPolicy = {
      project: fixture.roots.project,
      team: fixture.roots.team,
      user: fixture.roots.user,
    };
    assert.throws(
      () => saveMemory(
        { title: 'Untrusted roots', body: 'must not be written' },
        fixedOptions(rootsWithoutPolicy)
      ),
      /boundary policy|trusted boundary/i
    );
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('rejects traversal IDs, oversized bodies, NUL bytes, and suspected secrets', () => {
  const fixture = createFixture();
  try {
    assert.throws(
      () => saveMemory({ id: '../../escape', title: 'Bad', body: 'bad' }, {
        ...fixedOptions(fixture.roots),
        idFactory: undefined,
      }),
      /memory id/i
    );
    assert.throws(
      () => saveMemory({ title: 'Too large', body: 'x'.repeat(70 * 1024) }, fixedOptions(fixture.roots)),
      /body.*too large/i
    );
    assert.throws(
      () => saveMemory({ title: 'Nul', body: 'before\0after' }, fixedOptions(fixture.roots)),
      /control|NUL/i
    );
    assert.throws(
      () => saveMemory({ title: 'Empty', body: ' \n\t' }, fixedOptions(fixture.roots)),
      /non-whitespace context/i
    );
    const token = `sk-${'A1'.repeat(12)}`;
    assert.throws(
      () => saveMemory({ title: 'Secret', body: `token ${token}` }, fixedOptions(fixture.roots)),
      /suspected secret/i
    );
    assert.ok(findPotentialSecrets(`-----BEGIN PRIVATE KEY-----\nabc`).length > 0);
    const metadataToken = `ghp_${'a1'.repeat(12)}`;
    assert.throws(
      () => saveMemory({
        title: 'Metadata secret',
        body: 'The body is otherwise safe.',
        tags: [metadataToken],
      }, fixedOptions(fixture.roots)),
      /suspected secret/i
    );
    assert.throws(
      () => saveMemory({
        title: 'Terminal\u001b[31m injection',
        body: 'unsafe title',
      }, fixedOptions(fixture.roots)),
      /control/i
    );
    assert.throws(
      () => saveMemory({
        title: 'Terminal injection',
        body: 'unsafe\u001b]52;c;YQ==\u0007 body',
      }, fixedOptions(fixture.roots)),
      /control/i
    );
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('quarantines imported secrets and metadata that disagrees with its vault location', () => {
  const fixture = createFixture();
  try {
    const notes = path.join(fixture.roots.project, 'notes');
    fs.mkdirSync(notes, { recursive: true });
    const importedToken = `npm_${'a1'.repeat(12)}`;
    fs.writeFileSync(
      path.join(notes, 'secret.md'),
      serializeMemoryDocument(baseMemory({
        id: 'mem_20260726_secret',
        kind: 'note',
        links: [],
        body: `Imported token: ${importedToken}`,
      }))
    );
    fs.writeFileSync(
      path.join(notes, 'wrong-location.md'),
      serializeMemoryDocument(baseMemory({
        id: 'mem_20260726_wrong_location',
        kind: 'decision',
        links: [],
      }))
    );

    const report = doctorMemoryVault({
      roots: fixture.roots,
      scopes: ['project'],
    });
    assert.strictEqual(report.invalidFileCount, 2);
    assert.deepStrictEqual(
      report.invalidFiles.map(item => item.code).sort(),
      ['location-mismatch', 'suspected-secret']
    );
    assert.strictEqual(
      JSON.stringify(report).includes(importedToken),
      false
    );
    assert.throws(
      () => readMemoryById('mem_20260726_secret', {
        roots: fixture.roots,
        scopes: ['project'],
      }),
      /not found/i
    );
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('opens regular text files without following a stable symlink', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-memory-file-'));
  const target = path.join(root, 'target.md');
  const link = path.join(root, 'link.md');
  try {
    fs.writeFileSync(target, 'safe');
    fs.symlinkSync(target, link);
    assert.strictEqual(readRegularTextFile(target, { maxBytes: 16 }), 'safe');
    assert.throws(
      () => readRegularTextFile(link, { maxBytes: 16 }),
      /non-symlink|symbolic link|symlink/i
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('rejects malformed UTF-8 instead of altering durable text', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-memory-utf8-'));
  const target = path.join(root, 'invalid.md');
  try {
    fs.writeFileSync(target, Buffer.from([0x61, 0xc3, 0x28, 0x62]));
    assert.throws(
      () => readRegularTextFile(target, { maxBytes: 16 }),
      /valid UTF-8/i
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('opens a file descriptor before inspecting path metadata', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-memory-open-first-'));
  const target = path.join(root, 'target.md');
  const originalOpenSync = fs.openSync;
  const originalLstatSync = fs.lstatSync;
  let descriptorOpened = false;
  try {
    fs.writeFileSync(target, 'safe');
    fs.openSync = (...args) => {
      const descriptor = originalOpenSync(...args);
      descriptorOpened = true;
      return descriptor;
    };
    fs.lstatSync = (...args) => {
      assert.strictEqual(
        descriptorOpened,
        true,
        'path metadata must not be used as a precondition for opening the file'
      );
      return originalLstatSync(...args);
    };

    assert.strictEqual(readRegularTextFile(target, { maxBytes: 16 }), 'safe');
  } finally {
    fs.openSync = originalOpenSync;
    fs.lstatSync = originalLstatSync;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('rejects a FIFO body path without blocking', () => {
  if (process.platform === 'win32') return;

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-memory-fifo-'));
  const fifo = path.join(root, 'body.pipe');
  try {
    const created = spawnSync('mkfifo', [fifo], { encoding: 'utf8' });
    assert.strictEqual(created.status, 0, created.stderr || created.error?.message);
    const modulePath = require.resolve('../../scripts/lib/memory-vault');
    const childScript = `
      const { readRegularTextFile } = require(${JSON.stringify(modulePath)});
      try {
        readRegularTextFile(${JSON.stringify(fifo)}, { maxBytes: 16 });
        process.exitCode = 2;
      } catch (error) {
        if (!/regular|non-symlink/i.test(error.message)) process.exitCode = 3;
      }
    `;
    const result = spawnSync(process.execPath, ['-e', childScript], {
      encoding: 'utf8',
      timeout: 2_000,
    });
    assert.strictEqual(
      result.status,
      0,
      result.error?.message || result.stderr || 'FIFO read did not fail safely'
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('requires explicit user scope for recall', () => {
  const fixture = createFixture();
  try {
    saveMemory({
      title: 'Operator preference',
      body: 'Use concise handoffs.',
      scope: 'user',
    }, fixedOptions(fixture.roots, 'mem_20260726_user'));
    assert.throws(
      () => readMemoryById('mem_20260726_user', { roots: fixture.roots }),
      /not found/i
    );
    const recalled = readMemoryById('mem_20260726_user', {
      roots: fixture.roots,
      scopes: ['user'],
    });
    assert.strictEqual(recalled.memory.scope, 'user');
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('search ranks title and tags above body-only matches and filters harness targets', () => {
  const fixture = createFixture();
  try {
    saveMemory({
      title: 'Authentication design',
      body: 'Primary decision',
      kind: 'decision',
      sourceHarness: 'claude',
      targetHarnesses: ['all'],
      tags: ['auth'],
    }, fixedOptions(fixture.roots, 'mem_20260726_auth'));
    saveMemory({
      title: 'Background note',
      body: 'Authentication is mentioned once in the body.',
      kind: 'note',
      sourceHarness: 'hermes',
      targetHarnesses: ['hermes'],
    }, fixedOptions(fixture.roots, 'mem_20260726_background'));
    const superseded = baseMemory({
      id: 'mem_20260726_superseded',
      title: 'Authentication legacy note',
      kind: 'note',
      status: 'superseded',
      links: [],
    });
    fs.writeFileSync(
      path.join(fixture.roots.project, 'notes', 'superseded.md'),
      serializeMemoryDocument(superseded)
    );

    const all = searchMemories('authentication', { roots: fixture.roots });
    assert.deepStrictEqual(
      all.results.map(result => result.memory.id),
      ['mem_20260726_auth', 'mem_20260726_background']
    );
    assert.ok(all.results[0].score > all.results[1].score);
    assert.strictEqual(Object.hasOwn(all.results[0].memory, 'body'), false);

    const forClaude = searchMemories('authentication', {
      roots: fixture.roots,
      targetHarness: 'claude',
    });
    assert.deepStrictEqual(
      forClaude.results.map(result => result.memory.id),
      ['mem_20260726_auth']
    );
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('reads backlinks derived from links without mutating either document', () => {
  const fixture = createFixture();
  try {
    saveMemory(
      { title: 'Original decision', body: 'Use SQLite.', kind: 'decision' },
      fixedOptions(fixture.roots, 'mem_20260726_original')
    );
    saveMemory(
      {
        title: 'Follow-up',
        body: 'Keep the file vault as source of truth.',
        links: ['mem_20260726_original'],
      },
      fixedOptions(fixture.roots, 'mem_20260726_followup')
    );
    fs.writeFileSync(
      path.join(fixture.roots.project, 'notes', 'rejected-backlink.md'),
      serializeMemoryDocument(baseMemory({
        id: 'mem_20260726_rejected_backlink',
        title: 'Rejected follow-up',
        kind: 'note',
        status: 'rejected',
        links: ['mem_20260726_original'],
      }))
    );

    const result = readMemoryById('mem_20260726_original', { roots: fixture.roots });
    assert.deepStrictEqual(
      result.backlinks.map(memory => memory.id),
      ['mem_20260726_followup']
    );
    assert.strictEqual(Object.hasOwn(result.backlinks[0], 'body'), false);
    assert.strictEqual(result.backlinksTruncated, false);
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('doctor reports malformed files, broken links, duplicate IDs, and skipped symlinks', () => {
  const fixture = createFixture();
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-memory-outside-'));
  try {
    saveMemory(
      {
        title: 'Broken link',
        body: 'References a missing memory.',
        links: ['mem_20260726_missing'],
      },
      fixedOptions(fixture.roots, 'mem_20260726_broken')
    );

    const duplicate = baseMemory({
      id: 'mem_20260726_broken',
      title: 'Duplicate',
      kind: 'fact',
      scope: 'team',
      links: [],
    });
    fs.mkdirSync(path.join(fixture.roots.team, 'facts'), { recursive: true });
    fs.writeFileSync(
      path.join(fixture.roots.team, 'facts', 'duplicate.md'),
      serializeMemoryDocument(duplicate)
    );
    fs.mkdirSync(path.join(fixture.roots.project, 'notes'), { recursive: true });
    fs.writeFileSync(path.join(fixture.roots.project, 'notes', 'malformed.md'), 'not memory');
    const malformedSecret = `ghp_${'Z9'.repeat(12)}`;
    fs.writeFileSync(
      path.join(fixture.roots.project, 'notes', 'malformed-secret.md'),
      `---\n${malformedSecret}: nope\n---\n`
    );

    const outsideFile = path.join(outside, 'outside.md');
    fs.writeFileSync(outsideFile, serializeMemoryDocument(baseMemory({ links: [] })));
    try {
      fs.symlinkSync(outsideFile, path.join(fixture.roots.project, 'notes', 'linked.md'));
    } catch {
      // Symlink creation can be unavailable on Windows CI.
    }

    const report = doctorMemoryVault({ roots: fixture.roots });
    assert.strictEqual(report.ok, false);
    assert.ok(report.invalidFiles.some(item => item.path.endsWith('malformed.md')));
    assert.strictEqual(JSON.stringify(report).includes(malformedSecret), false);
    assert.deepStrictEqual(report.duplicateIds[0].id, 'mem_20260726_broken');
    assert.deepStrictEqual(report.brokenLinks[0].targetId, 'mem_20260726_missing');
    if (fs.existsSync(path.join(fixture.roots.project, 'notes', 'linked.md'))) {
      assert.ok(report.skippedSymlinks.some(item => item.endsWith('linked.md')));
    }
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  }
});

test('doctor caps traversal before an oversized directory can dominate recall', () => {
  const fixture = createFixture();
  const notes = path.join(fixture.roots.project, 'notes');
  try {
    fs.mkdirSync(notes, { recursive: true });
    for (let index = 0; index < MAX_FILES + 1; index += 1) {
      fs.writeFileSync(path.join(notes, `noise-${index}.txt`), '');
    }
    const report = doctorMemoryVault({
      roots: fixture.roots,
      scopes: ['project'],
    });
    assert.strictEqual(report.truncated, true);
    assert.strictEqual(report.memoryCount, 0);
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('doctor caps hostile diagnostics and reports total counts', () => {
  const fixture = createFixture();
  const notes = path.join(fixture.roots.project, 'notes');
  try {
    fs.mkdirSync(notes, { recursive: true });
    const invalidFileTotal = MAX_DIAGNOSTICS + 20;
    for (let index = 0; index < invalidFileTotal; index += 1) {
      fs.writeFileSync(path.join(notes, `malformed-${index}.md`), 'not memory');
    }
    const missingLinks = Array.from(
      { length: 64 },
      (_, index) => `mem_missing_${String(index).padStart(3, '0')}`
    );
    const linkDocumentCount = Math.ceil((MAX_DIAGNOSTICS + 1) / missingLinks.length);
    for (let index = 0; index < linkDocumentCount; index += 1) {
      fs.writeFileSync(
        path.join(notes, `links-${index}.md`),
        serializeMemoryDocument(baseMemory({
          id: `mem_links_${String(index).padStart(3, '0')}`,
          kind: 'note',
          links: missingLinks.map(link => `${link}_${index}`),
        }))
      );
    }

    const report = doctorMemoryVault({
      roots: fixture.roots,
      scopes: ['project'],
    });
    assert.strictEqual(report.invalidFileCount, invalidFileTotal);
    assert.strictEqual(report.invalidFiles.length, MAX_DIAGNOSTICS);
    assert.strictEqual(report.brokenLinkCount, linkDocumentCount * missingLinks.length);
    assert.strictEqual(report.brokenLinks.length, MAX_DIAGNOSTICS);
    assert.strictEqual(report.diagnosticsTruncated, true);
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('doctor enforces one aggregate scan-byte budget across a request', () => {
  const fixture = createFixture();
  const notes = path.join(fixture.roots.project, 'notes');
  try {
    fs.mkdirSync(notes, { recursive: true });
    const bodyBytes = 63 * 1024;
    const fileTotal = Math.ceil(MAX_SCAN_BYTES / bodyBytes) + 2;
    for (let index = 0; index < fileTotal; index += 1) {
      const id = `mem_scan_${String(index).padStart(4, '0')}`;
      fs.writeFileSync(
        path.join(notes, `${id}.md`),
        serializeMemoryDocument(baseMemory({
          id,
          kind: 'note',
          links: [],
          body: 'x'.repeat(bodyBytes),
        }))
      );
    }
    const report = doctorMemoryVault({
      roots: fixture.roots,
      scopes: ['project'],
    });
    assert.strictEqual(report.truncated, true);
    assert.ok(report.scannedBytes <= MAX_SCAN_BYTES);
    assert.ok(report.memoryCount < fileTotal);
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

console.log(`\nResults: Passed: ${passed}, Failed: ${failed}`);
if (failed > 0) {
  process.exit(1);
}
