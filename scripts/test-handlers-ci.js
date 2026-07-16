// scripts/test-handlers-ci.js
// CI-friendly test: run a subset of critical handlers in --dry-run and ensure they succeed or have working fallback scripts.

import { spawnSync } from 'child_process';
import { resolve } from 'path';
import fs from 'fs';

const root = process.cwd();
const scriptsDir = resolve(root, 'scripts');
const node = process.execPath;

function findScriptForBase(base) {
  try {
    const entries = fs.readdirSync(scriptsDir);
    const exact = entries.find(f => f.toLowerCase() === `${base}.js`.toLowerCase());
    if (exact) return resolve(scriptsDir, exact);
    const prefer = [`${base}-output.js`, `${base}_output.js`, `${base}.mjs`, `${base}-output.mjs`];
    for (const p of prefer) {
      const found = entries.find(f => f.toLowerCase() === p.toLowerCase());
      if (found) return resolve(scriptsDir, found);
    }
    // improved fuzzy match
    const normalize = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
    const baseNorm = normalize(base);
    for (const f of entries) {
      const fn = f.toLowerCase();
      if (!(fn.endsWith('.js') || fn.endsWith('.mjs'))) continue;
      const fNorm = normalize(f);
      if (fNorm === baseNorm) return resolve(scriptsDir, f);
      if (fNorm.includes(baseNorm) || fNorm.replace(/s/g, '').includes(baseNorm.replace(/s/g, ''))) return resolve(scriptsDir, f);
    }
  } catch (e) {
    return null;
  }
  return null;
}

function runEccDry(cmd) {
  const parts = cmd.split(/\s+/);
  const base = parts[0];
  const args = ['--dry-run', base, ...parts.slice(1)];
  const script = resolve(root, 'scripts', 'ecc.js');
  return spawnSync(node, [script, ...args], { cwd: root, encoding: 'utf8' });
}

function runScript(scriptPath, extraArgs=[]) {
  return spawnSync(node, [scriptPath, ...extraArgs], { cwd: root, encoding: 'utf8' });
}

const toTest = [
  'plan',
  'sessions',
  'loop-status',
  'skill-health',
  'repo-scan',
  'plan-canvas',
  'install-plan --list-profiles',
  'status',
  'update-docs',
  'security-scan',
  'auto-update',
  'skill-create',
];
let failed = [];

for (const c of toTest) {
  console.log('Testing', c);
  const res = runEccDry(c);
  if (res.status === 0) {
    console.log('OK (dry-run passed)');
    continue;
  }
  // try fallback script
  const script = findScriptForBase(c);
  if (script) {
    console.log('Attempting fallback script:', script);
    const r2 = runScript(script);
    if (r2.status === 0) { console.log('OK (fallback passed)'); continue; }
    console.error('Fallback failed. stdout:', r2.stdout, 'stderr:', r2.stderr);
  } else {
    console.error('No fallback script found for', c);
  }
  failed.push(c);
}

if (failed.length) {
  console.error('Some handlers failed:', failed.join(', '));
  process.exit(2);
}
console.log('All tested handlers OK');
process.exit(0);
