#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { applyStore, rollbackStore } = require('../../scripts/lib/context-profile-store');
const { prepareNativeProfile, rollbackNativeProfile, getNativeProfileStatus, recoverNativeProfile } = require('../../scripts/lib/context-profile-native');

const repoRoot = path.resolve(__dirname, '../..');
const temp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-native-switch-')));
const options = { stateRoot: path.join(temp, 'managed'), nativeRoot: path.join(temp, 'native'),
  codexPath: process.env.ECC_NATIVE_CODEX || 'codex' };
try {
  const cases = []; let full;
  for (const [index, profileId] of ['full@1', 'lean@1', 'full@1'].entries()) {
    const managed = index === 2 ? rollbackStore({ stateRoot: options.stateRoot })
      : applyStore({ repoRoot, stateRoot: options.stateRoot, target: 'codex', selectionMode: 'auto',
        profileId, exclude: profileId === 'full@1' ? ['skill:python-patterns'] : [] });
    const native = index === 2 ? rollbackNativeProfile(options) : prepareNativeProfile(options);
    assert.equal(native.ready, true);
    assert.equal(native.carrierDigest, managed.carrierDigest);
    assert.equal(native.storeRevision, managed.revision);
    assert.equal(native.active, false);
    assert.equal(getNativeProfileStatus(options).ready, true);
    if (index === 0) {
      full = native;
      fs.writeFileSync(path.join(full.home, 'unrelated.txt'), 'Unrelated user bytes');
    }
    if (index === 1) assert.notEqual(native.home, full.home);
    if (index === 2) assert.equal(native.home, full.home);
    assert.equal(fs.readFileSync(path.join(full.home, 'unrelated.txt'), 'utf8'), 'Unrelated user bytes');
    cases.push({ profileId, storeRevision: native.storeRevision, nativeRevision: native.revision,
      skills: native.selectedIds.length, carrierDigest: native.carrierDigest });
  }
  assert.equal(recoverNativeProfile(options).ready, true);
  process.stdout.write(`${JSON.stringify({ kind: 'native-managed-switch', provider: 'codex-cli 0.154.0',
    productAdapter: 'isolated-native-generations', cases, unrelatedBytesPreserved: true,
    discovery: 'verified', modelCalls: 0, credentialsCopied: false, invocation: 'unobserved' })}\n`);
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}
