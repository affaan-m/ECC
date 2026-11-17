'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const { getInstallTargetAdapter } = require('../../scripts/lib/install-targets/registry');
const { createManifestInstallPlan } = require('../../scripts/lib/install/plan');
const { applyInstallPlan } = require('../../scripts/lib/install/apply');

for (const target of ['antigravity', 'antigravity-home']) {
  test(`${target} persists the selected hook profile in managed setup`, () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-hook-profile-'));
    try {
      const operations = getInstallTargetAdapter(target).planOperations({
        repoRoot: root, projectRoot: root, homeDir: root,
        env: { ECC_HOOK_PROFILE: 'minimal' },
        modules: [{ id: 'hooks-runtime', paths: ['hooks'] }],
      });
      const setup = operations.find(op => op.destinationPath.endsWith(path.join('ecc', 'setup.json')));
      assert.ok(setup, 'Hook installation must persist its runtime profile');
      assert.deepEqual(setup.mergePayload, { hooks: { enabled: true, profile: 'minimal' } });
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test(`${target} does not promote executable repository MCP definitions`, () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-mcp-policy-'));
    try {
      fs.writeFileSync(path.join(root, '.mcp.json'), JSON.stringify({
        mcpServers: { untrusted: { command: 'untrusted-command', args: ['run'], env: { SOURCE_ONLY: 'value' } } },
      }));
      const operations = getInstallTargetAdapter(target).planOperations({
        repoRoot: root, projectRoot: root, homeDir: root,
        modules: [{ id: 'platform-configs', paths: ['.mcp.json'] }],
      });
      const config = operations.find(op => path.basename(op.destinationPath) === 'mcp_config.json');
      assert.deepEqual(Object.keys(config.mergePayload.mcpServers), ['ecc-memory']);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  for (const disabled of [false, true]) {
    test(`${target} preserves user servers and ${disabled ? 'suppresses disabled' : 'adds'} ECC memory`, () => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-mcp-install-policy-'));
      const previous = process.env.ECC_DISABLED_MCPS;
      try {
        if (disabled) process.env.ECC_DISABLED_MCPS = 'ecc-memory';
        else delete process.env.ECC_DISABLED_MCPS;
        const projectRoot = path.join(root, 'project');
        fs.mkdirSync(projectRoot);
        const plan = createManifestInstallPlan({
          moduleIds: ['platform-configs'], target, homeDir: root, projectRoot,
        });
        const configPath = path.join(plan.targetRoot, 'mcp_config.json');
        const userServer = { command: 'user-selected-server', args: ['--user-option'] };
        fs.mkdirSync(plan.targetRoot, { recursive: true });
        fs.writeFileSync(configPath, JSON.stringify({ mcpServers: { 'user-server': userServer } }));
        applyInstallPlan(plan);
        const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        assert.deepEqual(config.mcpServers['user-server'], userServer);
        assert.equal(Object.hasOwn(config.mcpServers, 'ecc-memory'), !disabled);
        assert.deepEqual(Object.keys(config.mcpServers).sort(), disabled
          ? ['user-server'] : ['ecc-memory', 'user-server']);
      } finally {
        if (previous === undefined) delete process.env.ECC_DISABLED_MCPS;
        else process.env.ECC_DISABLED_MCPS = previous;
        fs.rmSync(root, { recursive: true, force: true });
      }
    });
  }
}
