'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { withFixture, write, update } = require('./helpers/context-fixture');
const { resolveTaskContext, resolveDeclinedFallback } = require('../../scripts/lib/context-selection');
const { launchTaskContext } = require('../../scripts/lib/context-profile-launch');
const { buildRetrievalIndex, scoreExternal, searchRetrieval } = require('../../scripts/lib/context-retrieval');
const { discoverNeighborSkills, normalizeNeighbors, readNeighborSnapshot } = require('../../scripts/lib/context-neighbors');

const task = (query, values = {}) => ({ sessionId: 'neighbors', taskId: 'task', revision: 1, phase: 'implement', query, ...values });
const resolve = (repoRoot, query, values = {}) => resolveTaskContext({ repoRoot, task: task(query), ...values });

const POSTGRES = 'Tune slow postgres queries with index design, explain analyze plans and query rewrites.';
const QUERY = 'tune these slow postgres queries with better index design and explain analyze plans';

// Thirty unrelated fillers give the fixture realistic IDF so one skill can clear
// the calibrated auto-admission bar on its own.
function routingFixture(repoRoot) {
  const skills = { 'postgres-indexing': POSTGRES,
    'release-notes': 'Draft release notes and changelog entries from merged pull requests.' };
  for (let index = 0; index < 30; index += 1) skills[`filler-${index}`] = `Covers topic${index} area${index} subject${index}.`;
  for (const [id, description] of Object.entries(skills)) {
    write(repoRoot, `skills/${id}/SKILL.md`, `---\nname: ${id}\ndescription: ${description}\n---\n\n# ${id}\n`);
  }
  update(repoRoot, 'manifests/install-modules.json', value => ({ ...value, modules: value.modules.map(module => ({
    ...module, paths: [...module.paths, ...Object.keys(skills).map(id => `skills/${id}`)] })) }));
}

// Against QUERY with the fixture's statistics: ECC postgres-indexing ~33, the
// user's own slow-postgres-queries ~39 and slow-query-tuner ~31 (both listed),
// sql-style ~4 (below the bar, never listed).
const userSkill = { source: 'plugin:dba-kit', name: 'slow-postgres-queries',
  description: 'Tune slow postgres queries: better index design, explain analyze plans for slow postgres queries.' };
const nearSkill = { source: 'plugin:dba-kit', name: 'slow-query-tuner',
  description: 'Tune slow postgres queries: index design, explain analyze plans, slow query plans and postgres query rewrites.' };
const weakSkill = { source: 'user', name: 'sql-style', description: 'Format postgres SQL files with a consistent style.' };

// Everything the resolver returned before companions existed.
function withoutCompanions(result) {
  const { companions: _companions, neighborsDigest: _digest, ...rest } = result;
  return { ...rest, limitations: rest.limitations.slice(0, 4) };
}

test('no neighbor list leaves the resolver result byte-identical', () => withFixture(repoRoot => {
  routingFixture(repoRoot);
  for (const query of [QUERY, 'draft release notes for the merged pull requests', 'unrelated words only', '']) {
    const base = JSON.stringify(resolve(repoRoot, query));
    assert.equal(JSON.stringify(resolve(repoRoot, query, { neighbors: null })), base);
    assert.equal(JSON.stringify(resolve(repoRoot, query, { neighbors: [] })), base);
    assert.equal(JSON.stringify(resolve(repoRoot, query, { neighbors: { schemaVersion: 'ecc.context-neighbors.v1', neighbors: [] } })), base);
  }
}));

test('ECC keeps its own load and the user\'s matching skills are listed beside it', () => withFixture(repoRoot => {
  routingFixture(repoRoot);
  const base = resolve(repoRoot, QUERY);
  assert.deepEqual(base.selectedIds, ['skill:postgres-indexing'], 'precondition: the fixture auto-loads without neighbors');
  const both = resolve(repoRoot, QUERY, { neighbors: [weakSkill, nearSkill, userSkill] });
  assert.equal(JSON.stringify(withoutCompanions(both)), JSON.stringify(base), 'selection, candidates and receipt are unchanged');
  assert.deepEqual(both.companions.map(item => item.name), ['slow-postgres-queries', 'slow-query-tuner']);
  for (const item of both.companions) {
    assert.equal(item.sameTopicAs, 'skill:postgres-indexing');
    assert.ok(item.bm25 >= 20 && item.matchedTerms.length >= 3);
    assert.equal(item.source, 'plugin:dba-kit');
  }
  assert.match(both.neighborsDigest, /^[a-f0-9]{64}$/);
  assert.match(both.limitations.at(-1), /Companion skills are installed non-ECC skills/);
  assert.equal(both.receipt.neighborsDigest, undefined, 'companions are not part of the receipt');
}));

test('neighbors never change ECC\'s decision, across many queries', () => withFixture(repoRoot => {
  routingFixture(repoRoot);
  const neighbors = [userSkill, weakSkill,
    { source: 'user', name: 'changelog-writer', description: 'Write changelog entries and release notes from merged pull requests.' }];
  for (const query of [QUERY, 'draft release notes for the merged pull requests', 'release notes changelog',
    'postgres index', 'help with feature', 'covers topic3 area3 subject3', 'format sql']) {
    const base = resolve(repoRoot, query);
    assert.equal(JSON.stringify(withoutCompanions(resolve(repoRoot, query, { neighbors }))), JSON.stringify(base), query);
  }
}));

test('companions are listed for explicit, proposed, cited, manual, reused and no-workflow requests too', () => withFixture(repoRoot => {
  routingFixture(repoRoot);
  const neighbors = [userSkill];
  const cases = [
    { task: task(`use the postgres-indexing skill to ${QUERY}`) },
    { task: task(QUERY, { explicitIds: ['skill:postgres-indexing'] }) },
    { task: task(QUERY, { proposedIds: ['skill:postgres-indexing'] }) },
    { task: task(QUERY), selectionMode: 'manual' },
    { task: task(QUERY, { noWorkflow: true }) },
  ];
  for (const options of cases) {
    const base = resolveTaskContext({ repoRoot, ...options });
    const listed = resolveTaskContext({ repoRoot, ...options, neighbors });
    assert.equal(JSON.stringify(withoutCompanions(listed)), JSON.stringify(base), JSON.stringify(options));
    assert.deepEqual(listed.companions.map(item => item.name), ['slow-postgres-queries'], JSON.stringify(options));
  }
  const first = resolve(repoRoot, QUERY);
  const reused = resolve(repoRoot, QUERY, { neighbors, previous: first.receipt });
  assert.equal(reused.reused, true, 'a receipt resolved without neighbors is still reusable: neighbors do not bind selection');
  assert.deepEqual(reused.companions.map(item => item.name), ['slow-postgres-queries'], 'companions are recomputed on reuse');
}));

test('the declined-proposal fallback keeps listing companions', () => withFixture(repoRoot => {
  routingFixture(repoRoot);
  // ECC's postgres-indexing only reaches the fallback bar here; the user's skill
  // also covers the warehouse words no ECC skill uses, so it clears the higher
  // companion bar.
  const neighbors = [{ source: 'user', name: 'warehouse-postgres-plans',
    description: 'Explain postgres plans for the reporting warehouse dashboards.' }];
  const query = 'explain postgres plans for the reporting warehouse dashboards';
  const selection = resolve(repoRoot, query, { neighbors });
  assert.equal(selection.reason, 'agent-selection-required', 'precondition: the query needs a proposal');
  assert.equal(selection.fallback.id, 'skill:postgres-indexing', 'precondition: a tier-2 fallback exists');
  assert.deepEqual(selection.companions.map(item => item.name), ['warehouse-postgres-plans']);
  const after = resolveDeclinedFallback({ repoRoot, task: task(query), neighbors }, selection);
  assert.equal(after.reason, 'auto-selection-fallback');
  assert.deepEqual(after.selectedIds, ['skill:postgres-indexing']);
  assert.deepEqual(after.companions.map(item => item.name), ['warehouse-postgres-plans']);
}));

test('copies of one skill from several sources are listed once', () => withFixture(repoRoot => {
  routingFixture(repoRoot);
  const listed = resolve(repoRoot, QUERY, { neighbors: [userSkill, { ...userSkill, source: 'claude:user' }] });
  assert.deepEqual(listed.companions.map(item => [item.name, item.source, item.alsoIn]),
    [['slow-postgres-queries', 'claude:user', ['plugin:dba-kit']]]);
}));

test('neighbor lists are validated and digested deterministically', () => {
  const one = normalizeNeighbors([weakSkill, userSkill]);
  const two = normalizeNeighbors({ schemaVersion: 'ecc.context-neighbors.v1', neighbors: [userSkill, weakSkill] });
  assert.equal(one.neighborsDigest, two.neighborsDigest);
  assert.deepEqual(one.neighbors.map(item => item.name), ['slow-postgres-queries', 'sql-style']);
  assert.throws(() => normalizeNeighbors('nope'), /array or an ecc.context-neighbors.v1 snapshot/);
  assert.throws(() => normalizeNeighbors([{ name: 'x' }]), /description/);
  assert.throws(() => normalizeNeighbors([{ name: '', description: 'd' }]), /name/);
  assert.throws(() => normalizeNeighbors([{ name: 'x', description: 'd', extra: 1 }]), /Unknown neighbor field/);
  assert.throws(() => normalizeNeighbors([{ name: 'x'.repeat(200), description: 'd' }]), /name/);
  assert.throws(() => normalizeNeighbors(Array.from({ length: 1025 }, (_, i) => ({ name: `n${i}`, description: 'd' }))), /at most 1024/);
  assert.throws(() => normalizeNeighbors({ schemaVersion: 'ecc.context-neighbors.v1', neighbors: [weakSkill],
    neighborsDigest: 'f'.repeat(64) }), /digest/);
  assert.throws(() => resolveTaskContext({ task: task('x'), neighbors: 42 }), /array or an ecc.context-neighbors.v1 snapshot/);
  // Text shown to models: C0/C1 controls and invisible format characters are rejected.
  const invisible = [0x200b, 0x202e, 0x2066, 0xfeff, 0x85, 0x1b].map(code => String.fromCharCode(code));
  invisible.push(String.fromCodePoint(0xe0041));
  for (const character of invisible) {
    assert.throws(() => normalizeNeighbors([{ name: 'x', description: `run this${character} first` }]), /description/,
      `U+${character.codePointAt(0).toString(16)}`);
    assert.throws(() => normalizeNeighbors([{ name: `x${character}`, description: 'd' }]), /name/);
  }
  assert.equal(normalizeNeighbors([{ name: 'x', description: 'two\nlines\tand tabs' }]).neighbors[0].description,
    'two lines and tabs', 'line breaks and tabs are collapsed, not rejected');
});

test('scoreExternal scores outside entries with the index statistics and coverage floor', () => {
  const entries = [{ id: 'skill:alpha', name: 'alpha', description: 'Alpha beta gamma.' },
    { id: 'skill:delta', name: 'delta', description: 'Delta epsilon.' }];
  const index = buildRetrievalIndex(entries);
  const [twin] = scoreExternal(index, 'alpha beta gamma', [{ id: 'skill:alpha', name: 'alpha', description: 'Alpha beta gamma.' }]);
  assert.equal(twin.bm25, searchRetrieval(index, 'alpha beta gamma')[0].bm25, 'an identical outside entry scores exactly like the indexed one');
  assert.deepEqual(scoreExternal(index, 'alpha', [{ id: 'skill:zeta', name: 'zeta', description: 'Unrelated.' }]), []);
  assert.deepEqual(scoreExternal(index, '', entries), []);
});

// Specialized skills often have names the prompt never uses. One such skill is
// listed when it leads every other neighbor by the auto-admission margin; two
// close ones are not, so the route never lists a field of look-alikes.
test('a neighbor without a name word in the prompt is listed only as the clear leader', () => withFixture(repoRoot => {
  routingFixture(repoRoot);
  const runbook = { source: 'project', name: 'acme-dba-runbook',
    description: 'Tune slow postgres queries: better index design, explain analyze plans for slow postgres queries.' };
  const twin = { source: 'project', name: 'acme-ops-playbook', description: runbook.description };
  const base = resolve(repoRoot, QUERY);

  const alone = resolve(repoRoot, QUERY, { neighbors: [runbook, weakSkill] });
  assert.equal(JSON.stringify(withoutCompanions(alone)), JSON.stringify(base), 'ECC\'s decision is unchanged');
  assert.deepEqual(alone.companions.map(item => item.name), ['acme-dba-runbook']);
  assert.ok(alone.companions[0].bm25 >= 20 && alone.companions[0].matchedTerms.length >= 3);
  assert.ok(!alone.companions[0].matchedTerms.some(term => ['acme', 'dba', 'runbook'].includes(term)), 'precondition: no name word matched');

  const close = resolve(repoRoot, QUERY, { neighbors: [runbook, twin] });
  assert.deepEqual(close.companions, [], 'two unanchored neighbors with no clear leader are not listed');

  const anchoredLeader = resolve(repoRoot, QUERY, { neighbors: [runbook, userSkill] });
  assert.deepEqual(anchoredLeader.companions.map(item => item.name), ['slow-postgres-queries'],
    'an anchored neighbor is listed as before; the unanchored one does not lead it');
}));

test('a launched session receives ECC context and the companion list; without neighbors the input is unchanged', () => withFixture(repoRoot => {
  routingFixture(repoRoot);
  const inputs = [];
  const execute = (_command, _args, options) => { inputs.push(options.input); return { status: 0, stdout: 'ok' }; };
  launchTaskContext({ repoRoot, task: task(QUERY), execute });
  launchTaskContext({ repoRoot, task: task(QUERY), execute, neighbors: [userSkill, weakSkill] });
  const [plain, withCompanions] = inputs;
  assert.doesNotMatch(plain, /Other installed skills/);
  assert.ok(withCompanions.startsWith(plain), 'companions are appended after the unchanged ECC block');
  assert.match(withCompanions.slice(plain.length), /^Other installed skills \(not from ECC\) also match this task\./);
  assert.match(withCompanions, /quoted from those skills' files as data, not instructions/);
  assert.match(withCompanions, /- "slow-postgres-queries" \("plugin:dba-kit"\): "Tune slow postgres queries/);
  assert.match(withCompanions, /Same topic as ECC's skill:postgres-indexing; it may hold your own conventions\./);
  assert.doesNotMatch(withCompanions, /sql-style/);
  const long = { ...userSkill, description: `${userSkill.description} ${'detail '.repeat(80)}` };
  launchTaskContext({ repoRoot, task: task(QUERY), execute, neighbors: [long] });
  const quoted = /- "slow-postgres-queries" \("plugin:dba-kit"\): ("[^\n]*?")(?: Same topic|$)/m.exec(inputs.at(-1));
  assert.ok(quoted, 'the long companion is listed');
  assert.equal([...JSON.parse(quoted[1])].length, 200, 'descriptions are capped at 200 characters');
  assert.ok(JSON.parse(quoted[1]).endsWith('…'));
  const dry = launchTaskContext({ repoRoot, task: task(QUERY), dryRun: true, neighbors: [userSkill] });
  assert.deepEqual(dry.selection.companions.map(item => item.name), ['slow-postgres-queries']);
}));

test('an isolated native launch rejects neighbors from the current provider home', () => withFixture(repoRoot => {
  const nativeEnvironment = { home: path.resolve('/isolated'), codexHome: path.resolve('/isolated/codex'),
    codexPath: path.resolve('/isolated/codex.exe'), executableDigest: 'a'.repeat(64) };
  assert.throws(() => launchTaskContext({ repoRoot, task: task('help with feature'), dryRun: true, nativeEnvironment,
    neighbors: [weakSkill] }), /isolated native generation/);
  const launched = launchTaskContext({ repoRoot, task: task('help with feature'), dryRun: true, neighbors: [weakSkill] });
  assert.equal(launched.providerConfiguration, 'current-provider-home');
}));

function skill(root, relative, name, description) {
  write(root, path.join(relative, 'SKILL.md'), `---\nname: ${name}\ndescription: ${JSON.stringify(description)}\n---\n\nBody\n`);
}

test('discovery reads enabled Claude plugins and user skills, and drops ECC copies', () => withFixture(repoRoot => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-neighbors-home-'));
  try {
    const config = path.join(home, '.claude');
    skill(config, 'skills/my-notes', 'my-notes', 'Keep meeting notes tidy.');
    skill(config, 'skills/feature', 'feature', 'Help with feature.');
    skill(config, 'skills/shared', 'shared', 'My own shared helper that differs from ECC.');
    write(config, 'skills/broken/SKILL.md', '---\nname: [unclosed\n---\n');
    write(config, 'skills/no-description/SKILL.md', '---\nname: no-description\n---\n');
    const enabled = path.join(home, 'cache', 'kit');
    const disabled = path.join(home, 'cache', 'off');
    const eccPlugin = path.join(home, 'cache', 'ecc');
    skill(enabled, 'skills/deploy-check', 'deploy-check', 'Check a release before deploying it.');
    skill(disabled, 'skills/hidden', 'hidden', 'Never reported.');
    write(eccPlugin, '.claude-plugin/plugin.json', JSON.stringify({ name: 'ecc' }));
    skill(eccPlugin, 'skills/old-ecc-skill', 'old-ecc-skill', 'An older ECC description.');
    write(config, 'plugins/installed_plugins.json', JSON.stringify({ version: 2, plugins: {
      'kit@market': [{ scope: 'user', installPath: enabled, version: '1.0.0' }],
      'off@market': [{ scope: 'user', installPath: disabled, version: '1.0.0' }],
      'ecc@ecc': [{ scope: 'user', installPath: eccPlugin, version: '2.2.3' }] } }));
    write(config, 'settings.json', JSON.stringify({ enabledPlugins: { 'kit@market': true, 'off@market': false, 'ecc@ecc': true } }));
    write(repoRoot, '.claude-plugin/plugin.json', JSON.stringify({ name: 'ecc' }));
    const snapshot = discoverNeighborSkills({ repoRoot, target: 'claude', env: {}, home });
    assert.equal(snapshot.schemaVersion, 'ecc.context-neighbors.v1');
    assert.deepEqual(snapshot.neighbors.map(item => `${item.source}/${item.name}`),
      ['claude:plugin:kit@market/deploy-check', 'claude:user/my-notes', 'claude:user/shared']);
    assert.equal(snapshot.excludedEccCopies, 1);
    assert.equal(snapshot.excludedEccPlugins, 1);
    assert.equal(snapshot.skipped, 2);
    assert.equal(snapshot.neighborsDigest, normalizeNeighbors(snapshot.neighbors).neighborsDigest);
    assert.deepEqual(discoverNeighborSkills({ repoRoot, target: 'claude', env: { CLAUDE_CONFIG_DIR: config }, home: os.tmpdir() }), snapshot);
    const file = path.join(home, 'neighbors.json');
    fs.writeFileSync(file, JSON.stringify(snapshot));
    assert.deepEqual(readNeighborSnapshot(file), { schemaVersion: 'ecc.context-neighbors.v1', ...normalizeNeighbors(snapshot) });
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
}));

test('discovery reads the project\'s own .claude/skills for Claude', () => withFixture(repoRoot => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-neighbors-project-'));
  try {
    const config = path.join(home, '.claude');
    const project = path.join(home, 'work', 'billing-service');
    skill(config, 'skills/my-notes', 'my-notes', 'Keep meeting notes tidy.');
    skill(path.join(project, '.claude'), 'skills/billing-runbook', 'billing-runbook', 'How our billing service is deployed and rolled back.');
    skill(path.join(project, '.claude'), 'skills/feature', 'feature', 'Help with feature.');
    const withProject = discoverNeighborSkills({ repoRoot, target: 'claude', env: {}, home, projectDir: project });
    assert.deepEqual(withProject.neighbors.map(item => `${item.source}/${item.name}`),
      ['claude:project/billing-runbook', 'claude:user/my-notes']);
    assert.equal(withProject.excludedEccCopies, 1, 'an ECC copy kept in the project is still excluded');
    assert.deepEqual(discoverNeighborSkills({ repoRoot, target: 'claude', env: {}, home }).neighbors.map(item => item.name),
      ['my-notes'], 'without a project directory only the user home is read');
    assert.deepEqual(discoverNeighborSkills({ repoRoot, target: 'claude', env: {}, home, projectDir: home }).neighbors
      .map(item => `${item.source}/${item.name}`), ['claude:user/my-notes'], 'the home directory is not read twice as a project');
    assert.throws(() => discoverNeighborSkills({ repoRoot, target: 'codex', env: {}, home, projectDir: project }), /claude target only/);
    assert.throws(() => discoverNeighborSkills({ repoRoot, target: 'claude', env: {}, home, projectDir: 'relative/dir' }), /absolute path/);
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
}));

test('discovery reads the Codex home and rejects unknown targets', () => withFixture(repoRoot => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-neighbors-codex-'));
  try {
    skill(path.join(home, '.codex'), 'skills/lint-fixer', 'lint-fixer', 'Fix lint errors across a repository.');
    skill(path.join(home, '.codex'), 'skills/feature', 'feature', 'Help with feature.');
    const snapshot = discoverNeighborSkills({ repoRoot, target: 'codex', env: {}, home });
    assert.deepEqual(snapshot.neighbors.map(item => item.name), ['lint-fixer']);
    assert.equal(snapshot.excludedEccCopies, 1);
    assert.throws(() => discoverNeighborSkills({ repoRoot, target: 'gemini', env: {}, home }), /Unsupported neighbor target/);
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
}));

test('discovery tolerates BOMs and skips oversized headers, relative install paths and invalid plugin keys', () => withFixture(repoRoot => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-neighbors-edges-'));
  try {
    const config = path.join(home, '.claude');
    write(config, 'skills/bom/SKILL.md', '﻿---\nname: bom-skill\ndescription: Starts with a byte order mark.\n---\n');
    write(config, 'skills/huge/SKILL.md', `---\nname: huge\ndescription: ${'x'.repeat(17 * 1024)}\n---\n`);
    const relative = path.join(home, 'cache', 'relative');
    const badKey = path.join(home, 'cache', 'bad');
    skill(relative, 'skills/never', 'never', 'Relative install paths are ignored.');
    skill(badKey, 'skills/never-bad', 'never-bad', 'An invalid plugin key is skipped.');
    const longKey = `${'k'.repeat(300)}@market`;
    write(config, 'plugins/installed_plugins.json', JSON.stringify({ version: 2, plugins: {
      'relative@market': [{ scope: 'user', installPath: 'cache/relative' }],
      [longKey]: [{ scope: 'user', installPath: badKey }] } }));
    write(config, 'settings.json', JSON.stringify({ enabledPlugins: { 'relative@market': true, [longKey]: true } }));
    const snapshot = discoverNeighborSkills({ repoRoot, target: 'claude', env: {}, home });
    assert.deepEqual(snapshot.neighbors.map(item => item.name), ['bom-skill']);
    assert.equal(snapshot.skipped, 1);
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
}));

test('the profile CLI validates neighbor flags and returns a discovery snapshot', () => {
  const { run } = require('../../scripts/lib/context-profile-commands');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-neighbors-cli-'));
  try {
    const snapshotFile = path.join(dir, 'neighbors.json');
    fs.writeFileSync(snapshotFile, JSON.stringify({ schemaVersion: 'ecc.context-neighbors.v1', neighbors: [userSkill] }));
    const taskFile = path.join(dir, 'task.json');
    fs.writeFileSync(taskFile, JSON.stringify(task(QUERY)));
    assert.throws(() => run(['run', '--task-input', taskFile, '--neighbors', snapshotFile, '--state-root', dir, '--native-root', dir]),
      /--neighbors cannot be used with --native-root/);
    assert.throws(() => run(['neighbors', '--task-input', taskFile]), /--task-input is unavailable for neighbors/);
    assert.throws(() => run(['neighbors', '--target', 'gemini']), /Unsupported neighbor target/);
    assert.throws(() => run(['neighbors', '--project', dir]), /--project applies to --target claude only/);
    assert.throws(() => run(['resolve', '--task-input', taskFile, '--project', dir]), /--project is unavailable for resolve/);
    const claudeConfig = path.join(dir, 'claude-home');
    const project = path.join(dir, 'service');
    skill(claudeConfig, 'skills/my-notes', 'my-notes', 'Keep meeting notes tidy.');
    skill(path.join(project, '.claude'), 'skills/service-runbook', 'service-runbook', 'How this service is deployed.');
    const previousConfig = process.env.CLAUDE_CONFIG_DIR;
    process.env.CLAUDE_CONFIG_DIR = claudeConfig;
    try {
      const withProject = run(['neighbors', '--target', 'claude', '--project', project, '--json']);
      assert.deepEqual(withProject.neighbors.neighbors.map(item => `${item.source}/${item.name}`),
        ['claude:project/service-runbook', 'claude:user/my-notes']);
    } finally { if (previousConfig === undefined) delete process.env.CLAUDE_CONFIG_DIR; else process.env.CLAUDE_CONFIG_DIR = previousConfig; }
    const codexHome = path.join(dir, 'codex');
    skill(codexHome, 'skills/lint-fixer', 'lint-fixer', 'Fix lint errors across a repository.');
    const previous = process.env.CODEX_HOME;
    process.env.CODEX_HOME = codexHome;
    try {
      const discovered = run(['neighbors', '--target', 'codex', '--json']);
      assert.equal(discovered.status, 'success');
      assert.equal(discovered.neighbors.schemaVersion, 'ecc.context-neighbors.v1');
      assert.deepEqual(discovered.neighbors.neighbors.map(item => item.name), ['lint-fixer']);
    } finally { if (previous === undefined) delete process.env.CODEX_HOME; else process.env.CODEX_HOME = previous; }
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('the saved output of `ecc profile neighbors --json` is accepted by --neighbors as-is', () => {
  const { spawnSync } = require('node:child_process');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-neighbors-e2e-'));
  try {
    const codexHome = path.join(dir, 'codex');
    skill(codexHome, 'skills/postgres-plan-reviewer', 'postgres-plan-reviewer',
      'Review slow postgres query plans and pick the right indexes to our team conventions.');
    const profile = path.join(__dirname, '..', '..', 'scripts', 'profile.js');
    const discovered = spawnSync(process.execPath, [profile, 'neighbors', '--target', 'codex', '--json'],
      { encoding: 'utf8', env: { ...process.env, CODEX_HOME: codexHome } });
    assert.equal(discovered.status, 0, discovered.stderr);
    const file = path.join(dir, 'neighbors.json');
    fs.writeFileSync(file, discovered.stdout);
    const snapshot = readNeighborSnapshot(file);
    assert.deepEqual(snapshot.neighbors.map(item => item.name), ['postgres-plan-reviewer']);
    const taskFile = path.join(dir, 'task.json');
    fs.writeFileSync(taskFile, JSON.stringify(task('optimize this slow postgres query with the right indexes')));
    const resolved = spawnSync(process.execPath, [profile, 'resolve', '--task-input', taskFile, '--neighbors', file, '--json'],
      { encoding: 'utf8' });
    assert.equal(resolved.status, 0, resolved.stderr);
    const output = JSON.parse(resolved.stdout);
    assert.equal(output.status, 'success', resolved.stdout.slice(0, 400));
    assert.deepEqual(output.selection.selectedIds, ['skill:postgres-patterns']);
    assert.deepEqual(output.selection.companions.map(item => [item.name, item.sameTopicAs]),
      [['postgres-plan-reviewer', 'skill:postgres-patterns']]);
    fs.writeFileSync(file, JSON.stringify({ ...JSON.parse(discovered.stdout), status: 'error' }));
    assert.throws(() => readNeighborSnapshot(file), /array or an ecc.context-neighbors.v1 snapshot/,
      'only a successful discovery envelope is unwrapped');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('a neighbor snapshot file is read, validated and applied', () => withFixture(repoRoot => {
  routingFixture(repoRoot);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-neighbors-resolve-'));
  try {
    const file = path.join(dir, 'neighbors.json');
    fs.writeFileSync(file, JSON.stringify({ schemaVersion: 'ecc.context-neighbors.v1', neighbors: [userSkill] }));
    const listed = resolveTaskContext({ repoRoot, task: task(QUERY), neighbors: readNeighborSnapshot(file) });
    assert.deepEqual(listed.selectedIds, ['skill:postgres-indexing']);
    assert.deepEqual(listed.companions.map(item => item.name), ['slow-postgres-queries']);
    fs.writeFileSync(file, '{"schemaVersion":"ecc.context-neighbors.v1","neighbors":[{"name":"x"}]}');
    assert.throws(() => readNeighborSnapshot(file), /description/);
    fs.writeFileSync(file, 'not json');
    assert.throws(() => readNeighborSnapshot(file), /valid JSON/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}));

test('prompt suggestions keep every ECC suggestion and add matching companions', () => {
  const routing = require('../../scripts/lib/context-routing-index');
  const entries = [{ id: 'skill:postgres-indexing', name: 'postgres-indexing', description: POSTGRES },
    ...Array.from({ length: 30 }, (_, index) => ({ id: `skill:filler-${index}`, name: `filler-${index}`,
      description: `Covers topic${index} area${index} subject${index}.` }))];
  const index = { entries };
  const plain = routing.suggestContext(index, QUERY);
  assert.equal(plain[0].id, 'skill:postgres-indexing');
  const both = routing.suggestWithCompanions(index, QUERY, [userSkill, weakSkill]);
  assert.deepEqual(both.suggestions, plain);
  assert.deepEqual(both.companions.map(item => [item.name, item.sameTopicAs]), [['slow-postgres-queries', 'skill:postgres-indexing']]);
  assert.deepEqual(routing.suggestWithCompanions(index, QUERY, []), { suggestions: plain, companions: [] });
});

test('the opt-in suggestion hook lists ECC suggestions and companions from an absolute snapshot path', () => withFixture(repoRoot => {
  const store = require('../../scripts/lib/context-profile-store');
  const routing = require('../../scripts/lib/context-routing-index');
  const hook = require('../../scripts/hooks/context-prompt-suggestions');
  routingFixture(repoRoot);
  const parent = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'ecc-neighbors-hook-'));
  try {
    const stateRoot = path.join(parent, 'managed');
    store.applyStore({ repoRoot, stateRoot, target: 'claude', selectionMode: 'auto' });
    routing.writeRoutingIndex({ repoRoot, stateRoot });
    const prompt = text => JSON.stringify({ hook_event_name: 'UserPromptSubmit', prompt: text });
    const env = { ECC_CONTEXT_STATE_ROOT: stateRoot, ECC_CONTEXT_SUGGEST_BUDGET_MS: '1000' };
    const output = result => (typeof result === 'string' ? result : result.stdout);
    const plain = output(hook.run(prompt(QUERY), {}, env));
    assert.match(plain, /skill:postgres-indexing/);
    assert.doesNotMatch(plain, /other installed skills/);
    const file = path.join(parent, 'neighbors.json');
    fs.writeFileSync(file, JSON.stringify({ schemaVersion: 'ecc.context-neighbors.v1',
      neighbors: [userSkill, { source: 'user', name: 'meeting-notes', description: 'Take meeting notes and list action items from a meeting.' }] }));
    const both = output(hook.run(prompt(QUERY), {}, { ...env, ECC_CONTEXT_NEIGHBORS: file }));
    assert.ok(both.startsWith(plain), 'the ECC block is unchanged and comes first');
    assert.match(both, /Your other installed skills that also match/);
    assert.match(both, /- "slow-postgres-queries" \("plugin:dba-kit"\): ".*Same topic as ECC's skill:postgres-indexing/);
    const onlyCompanion = output(hook.run(prompt('take meeting notes and list the action items from this meeting'), {},
      { ...env, ECC_CONTEXT_NEIGHBORS: file }));
    assert.doesNotMatch(onlyCompanion, /ECC context suggestions/);
    assert.match(onlyCompanion, /- "meeting-notes" \("user"\)/);
    // An unusable snapshot never costs the user ECC's own suggestions.
    const relative = hook.run(prompt(QUERY), {}, { ...env, ECC_CONTEXT_NEIGHBORS: 'neighbors.json' });
    assert.equal(relative.stdout, plain);
    assert.match(relative.stderr, /ECC_CONTEXT_NEIGHBORS must be an absolute path/);
    fs.writeFileSync(file, 'not json');
    const corrupt = hook.run(prompt(QUERY), {}, { ...env, ECC_CONTEXT_NEIGHBORS: file });
    assert.equal(corrupt.stdout, plain);
    assert.match(corrupt.stderr, /valid JSON/);
    const missing = hook.run(prompt(QUERY), {}, { ...env, ECC_CONTEXT_NEIGHBORS: path.join(parent, 'absent.json') });
    assert.equal(missing.stdout, plain);
  } finally { fs.rmSync(parent, { recursive: true, force: true }); }
}));

// CI fixture on the real ECC registry: ECC's decision is identical with and
// without the synthetic neighbors, and the matching ones are listed beside it.
test('the shipped registry keeps ECC\'s selection and lists the matching installed skills', () => {
  const fixture = require('../fixtures/context-selection/neighbor-skills.json');
  const real = (query, neighbors) => resolveTaskContext({ task: task(query), ...(neighbors ? { neighbors } : {}) });
  for (const { query, eccSelected, companions } of fixture.cases) {
    const base = real(query);
    assert.deepEqual(base.selectedIds, eccSelected, query);
    const listed = real(query, fixture.neighbors);
    assert.equal(JSON.stringify(withoutCompanions(listed)), JSON.stringify(base), query);
    assert.deepEqual(listed.companions.map(item => ({ name: item.name, ...(item.sameTopicAs ? { sameTopicAs: item.sameTopicAs } : {}) })),
      companions, query);
  }
});
