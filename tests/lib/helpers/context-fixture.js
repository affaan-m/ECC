'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const KERNEL = ['configure-ecc', 'context-budget', 'ecc-guide'];

function write(root, relativePath, content) {
  const destination = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.writeFileSync(destination, typeof content === 'string' ? content : JSON.stringify(content));
}

function update(root, relativePath, transform) {
  const value = JSON.parse(fs.readFileSync(path.join(root, relativePath), 'utf8'));
  write(root, relativePath, transform(value));
}

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-context-contract-'));
  const ids = [...KERNEL, 'feature', 'shared'];
  for (const id of ids) {
    write(root, `skills/${id}/SKILL.md`, `---\nname: ${id}\ndescription: Help with ${id}.\n---\n\n# ${id}\n\nInstructions remain on demand.\n`);
  }
  write(root, 'skills/feature/references/details.md', 'Resource content.\n');
  write(root, 'manifests/install-modules.json', {
    version: 1,
    modules: [{
      id: 'workflow-quality', kind: 'skills',
      paths: ids.map(id => `skills/${id}`), targets: ['claude', 'codex'],
      dependencies: [], defaultInstall: true, cost: 'light', stability: 'stable',
    }],
  });
  write(root, 'manifests/context-packs/skill-registry@1.json', {
    schemaVersion: 1, id: 'skill-registry@1',
    inventory: { source: 'manifests/install-modules.json', skillsRoot: 'skills' },
    overrides: [],
  });
  for (const id of ['lean@1', 'full@1']) {
    write(root, `manifests/context-profiles/${id}.json`, {
      schemaVersion: 1, id, description: `${id} discovery projection.`,
      registryId: 'skill-registry@1',
      selection: {
        eager: id === 'full@1' ? 'all' : KERNEL.map(name => `skill:${name}`),
        required: KERNEL.map(name => `skill:${name}`), remainder: 'routed',
      },
      budget: { tokens: 8000, mode: id === 'full@1' ? 'report-only' : 'blocking' },
    });
  }
  return root;
}

function withFixture(fn) {
  const root = fixture();
  try { return fn(root); } finally { fs.rmSync(root, { recursive: true, force: true }); }
}

module.exports = { KERNEL, fixture, update, withFixture, write };
