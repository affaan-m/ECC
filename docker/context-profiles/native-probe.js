#!/usr/bin/env node
'use strict';

// Opt-in, credential-free native discovery. Never starts a thread or model turn.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');

function run(command, args, options) {
  const result = spawnSync(command, args, { ...options, encoding: 'utf8', timeout: 60000,
    maxBuffer: 16 * 1024 * 1024 });
  assert.equal(result.status, 0, `${command}: ${result.error || result.stderr || result.stdout}`);
  return result.stdout.trim();
}

async function listSkills() {
  const server = spawn(process.env.ECC_NATIVE_CODEX || 'codex', ['app-server', '--stdio'], {
    cwd: process.cwd(), env: process.env, stdio: ['pipe', 'pipe', 'pipe'],
  });
  let buffer = '';
  let stderr = '';
  const pending = new Map();
  let nextId = 0;
  server.stderr.on('data', chunk => { stderr += chunk; });
  server.stdout.on('data', chunk => {
    buffer += chunk;
    let end;
    while ((end = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, end);
      buffer = buffer.slice(end + 1);
      if (!line.trim()) continue;
      const message = JSON.parse(line);
      const handler = pending.get(message.id);
      if (handler) {
        pending.delete(message.id);
        if (message.error) handler.reject(new Error(JSON.stringify(message.error)));
        else handler.resolve(message.result);
      }
    }
  });
  const fail = error => { for (const handler of pending.values()) handler.reject(error); };
  server.on('error', fail);
  server.on('exit', code => fail(new Error(`App server exited ${code}: ${stderr}`)));
  const timer = setTimeout(() => { fail(new Error('Native discovery timed out')); server.kill(); }, 45000);
  const request = (method, params) => new Promise((resolve, reject) => {
    const id = ++nextId;
    pending.set(id, { resolve, reject });
    server.stdin.write(`${JSON.stringify({ id, method, params })}\n`);
  });
  try {
    const initialized = await request('initialize', {
      clientInfo: { name: 'ecc-context-native-probe', version: '1.0.0' },
      capabilities: { experimentalApi: true },
    });
    server.stdin.write(`${JSON.stringify({ method: 'initialized' })}\n`);
    const skills = await request('skills/list', { cwds: [process.cwd()], forceReload: true });
    process.stdout.write(`${JSON.stringify({ initialized, skills })}\n`);
  } finally {
    clearTimeout(timer);
    server.kill();
  }
}

function probe(options) {
  const repoRoot = path.resolve(process.env.ECC_NATIVE_PACKAGE_ROOT || path.join(__dirname, '../..'));
  const { planContextCarrier } = require(path.join(repoRoot, 'scripts/lib/context-carriers'));
  const { compileContextProfile } = require(path.join(repoRoot, 'scripts/lib/context-profiles'));
  // The independent structural oracle remains source-only test infrastructure.
  const { withCarrierFixture } = require('../../tests/lib/helpers/context-carrier-fixture');
  const artifact = planContextCarrier({ repoRoot, ...options });
  const expectedPlan = compileContextProfile({ repoRoot, ...options });
  return withCarrierFixture({ repoRoot, artifact, expectedPlan }, ({ root, verify }) => {
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-context-native-'));
    try {
      const home = path.join(temp, 'home');
      const codexHome = path.join(home, '.codex');
      const cwd = path.join(temp, 'project');
      const marketplace = path.join(temp, 'marketplace');
      for (const dir of [codexHome, cwd, path.join(marketplace, '.agents/plugins')]) {
        fs.mkdirSync(dir, { recursive: true });
      }
      const env = { PATH: process.env.PATH, HOME: home, CODEX_HOME: codexHome,
        CLAUDE_CONFIG_DIR: path.join(home, '.claude'), LANG: 'C.UTF-8',
        DISABLE_TELEMETRY: '1', DISABLE_AUTOUPDATER: '1',
        ECC_NATIVE_CODEX: process.env.ECC_NATIVE_CODEX || 'codex' };
      const commandOptions = { cwd, env };
      if (options.target === 'claude') {
        const version = run('claude', ['--version'], commandOptions);
        const validation = run('claude', ['plugin', 'validate', root], commandOptions);
        const details = run('claude', ['--setting-sources', '', '--plugin-dir', root,
          'plugin', 'details', 'ecc-context-carrier'], commandOptions);
        const names = details.match(/Skills \(\d+\)\s+([^\n]+)/);
        assert.ok(names, 'Claude did not report the skill inventory');
        const nativeNames = names[1].split(', ').sort();
        assert.deepEqual(nativeNames, artifact.entries.map(skill => skill.name).sort());
        for (const component of ['Agents', 'Hooks', 'MCP servers', 'LSP servers']) {
          assert.ok(details.includes(`${component} (0)`), `Unexpected native ${component}`);
        }
        verify();
        return { provider: version, profileId: artifact.profileId,
          selectedIds: artifact.selectedIds, excludedIds: artifact.excludedIds,
          nativeNames, discovery: 'verified-component-inventory',
          validation, projectedTokens: details.match(/Always-on:\s+([^\n]+)/)?.[1],
          carrierDigest: artifact.carrierDigest,
          invocation: 'unobserved', modelCalls: 0, credentialsCopied: false };
      }
      const codex = env.ECC_NATIVE_CODEX;
      const version = run(codex, ['--version'], commandOptions);
      fs.cpSync(root, path.join(marketplace, 'carrier'), { recursive: true });
      fs.writeFileSync(path.join(marketplace, '.agents/plugins/marketplace.json'), JSON.stringify({
        name: 'ecc-context-probe', plugins: [{ name: 'ecc-context-carrier',
          source: { source: 'local', path: './carrier' },
          policy: { installation: 'AVAILABLE', authentication: 'ON_INSTALL' } }],
      }));
      const added = JSON.parse(run(codex, ['plugin', 'marketplace', 'add', marketplace, '--json'], commandOptions));
      const installed = JSON.parse(run(codex, ['plugin', 'add', 'ecc-context-carrier@ecc-context-probe', '--json'], commandOptions));
      // Discovery must survive removal of the marketplace's source skill tree.
      fs.rmSync(path.join(marketplace, 'carrier'), { recursive: true });
      const observed = JSON.parse(run(process.execPath, [__filename, '--list-skills'], commandOptions));
      assert.equal(observed.skills.data.length, 1);
      const entry = observed.skills.data[0];
      assert.deepEqual(entry.errors, [], 'Native parser rejected a selected skill');
      const nativeSkills = entry.skills.filter(skill => skill.pluginId === 'ecc-context-carrier@ecc-context-probe');
      const expectedNames = artifact.entries.map(skill => `ecc-context-carrier:${skill.name}`).sort();
      const actualNames = nativeSkills.map(skill => skill.name).sort();
      assert.deepEqual(actualNames, expectedNames, `Native skill selection mismatch: ${JSON.stringify(entry)}`);
      let resourceCount = 0;
      for (const skill of nativeSkills) {
        assert.equal(skill.enabled, true);
        assert.ok(skill.path.startsWith(`${fs.realpathSync(codexHome)}${path.sep}`), 'Skill escaped isolated Codex home');
        const expected = artifact.entries.find(item => `ecc-context-carrier:${item.name}` === skill.name);
        for (const file of artifact.files.filter(item => item.skillId === expected.id)) {
          const relative = file.destinationPath.slice(`skills/${expected.name}/`.length);
          const bytes = fs.readFileSync(path.join(path.dirname(skill.path), relative));
          const digest = require('node:crypto').createHash('sha256').update(bytes).digest('hex');
          assert.equal(digest, file.digest, 'Installed resource bytes changed');
          resourceCount++;
        }
      }
      verify();
      assert.equal(fs.existsSync(path.join(codexHome, 'auth.json')), false);
      return { provider: version, profileId: artifact.profileId, selectedIds: artifact.selectedIds,
        excludedIds: artifact.excludedIds, discovery: 'verified', resources: resourceCount,
        relocation: 'verified-after-source-removal', carrierDigest: artifact.carrierDigest,
        nativeNames: actualNames, systemSkills: entry.skills.filter(skill => !skill.pluginId).map(skill => skill.name),
        marketplaceAdded: !!added, installed: !!installed, invocation: 'unobserved',
        modelCalls: 0, credentialsCopied: false };
    } finally {
      fs.rmSync(temp, { recursive: true, force: true });
    }
  });
}

if (process.argv.includes('--list-skills')) {
  listSkills().catch(error => { console.error(error); process.exitCode = 1; });
} else {
  const cases = process.argv.includes('--claude') ? [
    { profileId: 'lean@1', target: 'claude' },
    { profileId: 'full@1', target: 'claude', exclude: ['skill:python-patterns'] },
  ] : [
    { profileId: 'lean@1', target: 'codex' },
    { profileId: 'lean@1', target: 'codex', include: ['skill:angular-developer'] },
    { profileId: 'full@1', target: 'codex', exclude: ['skill:python-patterns'] },
  ];
  for (const options of cases) process.stdout.write(`${JSON.stringify(probe(options))}\n`);
}
