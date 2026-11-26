'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function verifyCopilotHookInstallOwnership({ project, manifest, installState, enable }) {
  const originalState = fs.readFileSync(installState);
  const destinations = [
    '.github/ecc/scripts/hooks/copilot-lifecycle.js',
    '.github/ecc/scripts/lib/copilot-sessions.js',
    path.relative(project, manifest),
  ];

  for (const relative of destinations) {
    const destination = path.join(project, relative);
    const userContent = destination === manifest ? '{"version":1,"hooks":{}}\n' : '// User-owned fixture\n';
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, userContent, { flag: 'wx' });
    try {
      enable(/Copilot hook activation requires an ECC-managed file/);
      assert.equal(fs.readFileSync(destination, 'utf8'), userContent);
      assert.equal(fs.existsSync(manifest), destination === manifest);
      assert.deepEqual(fs.readFileSync(installState), originalState);
    } finally {
      fs.rmSync(destination);
    }
  }
}

module.exports = { verifyCopilotHookInstallOwnership };
