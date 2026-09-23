/**
 * Tests for GateGuard Evidence Ledger, Recognition Audit, Risk Tiers, and Scope Passes
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const {
  EVIDENCE_TTL_MS,
  EVIDENCE_MAX_ENTRIES,
  SCOPE_PASS_TTL_MS,
  normalizePath,
  extractStem,
  pruneEvidence,
  buildEvidenceEntry,
  matchingEvidence,
  evidenceLevel,
  isTrivialChange,
  riskTier,
  validScopePass,
  grantScopePass,
  recordToolUse
} = require('../../scripts/hooks/gateguard-evidence-ledger');

const runner = path.join(__dirname, '..', '..', 'scripts', 'hooks', 'run-with-flags.js');
const hookScript = path.join(__dirname, '..', '..', 'scripts', 'hooks', 'gateguard-fact-force.js');
const tmpRoot = process.env.TMPDIR || process.env.TEMP || process.env.TMP || '/tmp';
const stateDir = fs.mkdtempSync(path.join(tmpRoot, 'gateguard-evidence-test-'));
const TEST_SESSION_ID = 'gateguard-evidence-test-session';
const stateFile = path.join(stateDir, `state-${TEST_SESSION_ID}.json`);

let passed = 0;
let failed = 0;

process.env.GATEGUARD_STATE_DIR = stateDir;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    return true;
  } catch (error) {
    console.log(`  ✗ ${name}`);
    console.log(`    Error: ${error.message}`);
    return false;
  }
}

function clearState() {
  try {
    if (fs.existsSync(stateDir)) {
      fs.rmSync(stateDir, { recursive: true, force: true });
    }
    fs.mkdirSync(stateDir, { recursive: true });
  } catch (_) {}
}

function writeState(state) {
  fs.mkdirSync(stateDir, { recursive: true });
  fs.writeFileSync(stateFile, JSON.stringify(state, null, 2), 'utf8');
}

function runHook(input, extraEnv = {}) {
  const env = {
    ...process.env,
    ECC_HOOK_PROFILE: 'standard',
    GATEGUARD_STATE_DIR: stateDir,
    CLAUDE_SESSION_ID: TEST_SESSION_ID,
    ...extraEnv
  };

  const proc = spawnSync('node', [runner, 'pre:edit:gateguard-fact-force', 'scripts/hooks/gateguard-fact-force.js', 'standard,strict'], {
    input: JSON.stringify(input),
    encoding: 'utf8',
    env
  });

  return {
    code: proc.status,
    stdout: proc.stdout,
    stderr: proc.stderr
  };
}

function runBashHook(input, extraEnv = {}) {
  const env = {
    ...process.env,
    ECC_HOOK_PROFILE: 'standard',
    GATEGUARD_STATE_DIR: stateDir,
    CLAUDE_SESSION_ID: TEST_SESSION_ID,
    ...extraEnv
  };

  const proc = spawnSync('node', [runner, 'pre:bash:gateguard-fact-force', 'scripts/hooks/gateguard-fact-force.js', 'standard,strict'], {
    input: JSON.stringify(input),
    encoding: 'utf8',
    env
  });

  return {
    code: proc.status,
    stdout: proc.stdout,
    stderr: proc.stderr
  };
}

function parseOutput(stdout) {
  try {
    return JSON.parse(stdout);
  } catch (_) {
    return null;
  }
}

console.log('Testing GateGuard Evidence Ledger & Upstream Improvements...\n');

// 1. Evidence Extraction & Classification
clearState();
if (test('buildEvidenceEntry identifies Read, Grep, Glob, and Investigative Bash', () => {
  const readEntry = buildEvidenceEntry('Read', { file_path: '/src/auth/service.js' });
  assert.strictEqual(readEntry.kind, 'read');
  assert.strictEqual(readEntry.target, '/src/auth/service.js');
  assert.strictEqual(readEntry.stem, 'service');

  const grepEntry = buildEvidenceEntry('Grep', { path: '/src/auth', pattern: 'verifyToken' });
  assert.strictEqual(grepEntry.kind, 'grep');
  assert.strictEqual(grepEntry.pattern, 'verifyToken');

  const globEntry = buildEvidenceEntry('Glob', { path: '/src/auth', pattern: '*.js' });
  assert.strictEqual(globEntry.kind, 'glob');

  const bashEntry = buildEvidenceEntry('Bash', { command: 'rg -i "token" /src' });
  assert.strictEqual(bashEntry.kind, 'bash');

  const nonInvestigative = buildEvidenceEntry('Bash', { command: 'npm start' });
  assert.strictEqual(nonInvestigative, null);

  const nonTargetTool = buildEvidenceEntry('WebSearch', { query: 'test' });
  assert.strictEqual(nonTargetTool, null);
})) passed++; else failed++;

// 2. Evidence Pruning and TTL
clearState();
if (test('pruneEvidence discards expired entries and caps at 200 items', () => {
  const now = Date.now();
  const oldTs = now - (31 * 60 * 1000); // 31 min ago (expired)
  const freshTs = now - (5 * 60 * 1000); // 5 min ago

  const entries = [
    { kind: 'read', target: '/old.js', ts: oldTs },
    { kind: 'read', target: '/fresh.js', ts: freshTs }
  ];

  const pruned = pruneEvidence(entries, now);
  assert.strictEqual(pruned.length, 1);
  assert.strictEqual(pruned[0].target, '/fresh.js');

  const bulk = [];
  for (let i = 0; i < 250; i++) {
    bulk.push({ kind: 'read', target: `/file-${i}.js`, ts: now });
  }
  const capped = pruneEvidence(bulk, now);
  assert.strictEqual(capped.length, EVIDENCE_MAX_ENTRIES);
  assert.strictEqual(capped[capped.length - 1].target, '/file-249.js');
})) passed++; else failed++;

// 3. Evidence Levels (none, touched, deep)
clearState();
if (test('evidenceLevel computes correct level based on read and investigation', () => {
  const now = Date.now();
  const state = {
    read_files: ['/src/users/model.js'],
    evidence: [
      { kind: 'read', target: '/src/users/model.js', stem: 'model', ts: now },
      { kind: 'grep', target: '/src/users', pattern: 'findUserById', ts: now }
    ]
  };

  // Not read at all
  assert.strictEqual(evidenceLevel('/src/other.js', state, now), 'none');

  // Only read, no grep/glob/bash
  const touchedOnlyState = {
    read_files: ['/src/users/model.js'],
    evidence: [{ kind: 'read', target: '/src/users/model.js', stem: 'model', ts: now }]
  };
  assert.strictEqual(evidenceLevel('/src/users/model.js', touchedOnlyState, now), 'touched');

  // Read + grep in same dir/stem -> deep
  assert.strictEqual(evidenceLevel('/src/users/model.js', state, now), 'deep');
})) passed++; else failed++;

// 4. Trivial Change Detection
clearState();
if (test('isTrivialChange detects comment-only and whitespace-only edits', () => {
  // Comment change in JS
  assert.strictEqual(isTrivialChange('Edit', {
    old_string: '// old note\nconst a = 1;',
    new_string: '// updated note\nconst a = 1;'
  }), true);

  // Whitespace change
  assert.strictEqual(isTrivialChange('Edit', {
    old_string: 'const a = 1;\n',
    new_string: '  const a = 1;\n\n'
  }), true);

  // Meaningful code change
  assert.strictEqual(isTrivialChange('Edit', {
    old_string: 'const a = 1;',
    new_string: 'const a = 2;'
  }), false);

  // Missing strings
  assert.strictEqual(isTrivialChange('Edit', {}), false);
})) passed++; else failed++;

// 5. Risk Tiers
clearState();
if (test('riskTier classifies files by sensitivity and signature changes', () => {
  // High risk: sensitive paths
  assert.strictEqual(riskTier('Edit', { old_string: 'a', new_string: 'b' }, '/project/.env'), 'high');
  assert.strictEqual(riskTier('Edit', { old_string: 'a', new_string: 'b' }, '/project/.env.local'), 'high');
  assert.strictEqual(riskTier('Edit', { old_string: 'a', new_string: 'b' }, '/src/auth/tokens.js'), 'high');
  assert.strictEqual(riskTier('Edit', { old_string: 'a', new_string: 'b' }, '/src/payments/stripe.js'), 'high');
  assert.strictEqual(riskTier('Edit', { old_string: 'a', new_string: 'b' }, '/db/migrations/2026_users.sql'), 'high');
  assert.strictEqual(riskTier('Edit', { old_string: 'a', new_string: 'b' }, '/.github/workflows/deploy.yml'), 'high');

  // Elevated risk: signature changes
  assert.strictEqual(riskTier('Edit', {
    old_string: 'function getUser(id) {}',
    new_string: 'function getUser(id, options) {}'
  }, '/src/utils/user.js'), 'elevated');

  assert.strictEqual(riskTier('Edit', {
    old_string: 'export const run = () => {}',
    new_string: 'export const run = async () => {}'
  }, '/src/utils/runner.js'), 'elevated');

  // Normal tier: routine body changes
  assert.strictEqual(riskTier('Edit', {
    old_string: 'const x = 10;',
    new_string: 'const x = 20;'
  }, '/src/utils/math.js'), 'normal');
})) passed++; else failed++;

// 6. Scope Passes
clearState();
if (test('grantScopePass and validScopePass manage directory passes', () => {
  const now = Date.now();
  let state = {};
  grantScopePass(state, '/src/components/Button.jsx', now);

  assert.strictEqual(validScopePass('/src/components/Input.jsx', state, now), true);
  assert.strictEqual(validScopePass('/src/utils/math.js', state, now), false);

  // Expired scope pass
  const future = now + SCOPE_PASS_TTL_MS + 1000;
  assert.strictEqual(validScopePass('/src/components/Input.jsx', state, future), false);
})) passed++; else failed++;

// 7. PostToolUse: recordToolUse silently records evidence into session state
clearState();
if (test('recordToolUse persists evidence into state file', () => {
  const postPayload = {
    session_id: TEST_SESSION_ID,
    tool_name: 'Read',
    tool_input: { file_path: '/src/services/api.js' }
  };

  recordToolUse(postPayload);

  assert.strictEqual(fs.existsSync(stateFile), true);
  const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
  assert.ok(Array.isArray(state.evidence));
  assert.strictEqual(state.evidence.length, 1);
  assert.strictEqual(state.evidence[0].kind, 'read');
  assert.strictEqual(state.evidence[0].target, '/src/services/api.js');
  assert.ok(state.read_files.includes('/src/services/api.js'));
})) passed++; else failed++;

// 8. Integration: PreToolUse bypasses gate when evidence is deep
clearState();
if (test('PreToolUse Edit automatically allows without denial when evidence is deep', () => {
  const now = Date.now();
  writeState({
    checked: [],
    last_active: now,
    read_files: ['/src/services/api.js'],
    evidence: [
      { kind: 'read', target: '/src/services/api.js', stem: 'api', ts: now },
      { kind: 'grep', target: '/src/services', pattern: 'fetchData', ts: now }
    ]
  });

  const result = runHook({
    tool_name: 'Edit',
    tool_input: {
      file_path: '/src/services/api.js',
      old_string: 'const timeout = 1000;',
      new_string: 'const timeout = 2000;'
    }
  });

  assert.strictEqual(result.code, 0);
  const out = parseOutput(result.stdout);
  // Allowed: not denied!
  if (out.hookSpecificOutput) {
    assert.notStrictEqual(out.hookSpecificOutput.permissionDecision, 'deny');
  } else {
    assert.strictEqual(out.tool_name, 'Edit');
  }

  // Check that scope pass was granted to /src/services
  const updatedState = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
  assert.ok(updatedState.checked.includes('/src/services/api.js'));
  assert.ok(validScopePass('/src/services/other.js', updatedState, now));
})) passed++; else failed++;

// 9. Integration: Scope pass allows sibling file that has been touched
clearState();
if (test('Sibling file in scope pass directory is allowed if touched', () => {
  const now = Date.now();
  writeState({
    checked: [],
    last_active: now,
    read_files: ['/src/services/client.js'],
    scope_passes: {
      '/src/services': now + 1800000
    }
  });

  const result = runHook({
    tool_name: 'Edit',
    tool_input: {
      file_path: '/src/services/client.js',
      old_string: 'const port = 80;',
      new_string: 'const port = 443;'
    }
  });

  const out = parseOutput(result.stdout);
  if (out.hookSpecificOutput) {
    assert.notStrictEqual(out.hookSpecificOutput.permissionDecision, 'deny');
  } else {
    assert.strictEqual(out.tool_name, 'Edit');
  }
})) passed++; else failed++;

// 10. Integration: High-risk file is gated even if deep evidence exists
clearState();
if (test('High risk file (.env) is still gated even when deep evidence exists', () => {
  const now = Date.now();
  writeState({
    checked: [],
    last_active: now,
    read_files: ['/src/.env'],
    evidence: [
      { kind: 'read', target: '/src/.env', stem: '.env', ts: now },
      { kind: 'grep', target: '/src', pattern: 'PORT', ts: now }
    ]
  });

  const result = runHook({
    tool_name: 'Edit',
    tool_input: {
      file_path: '/src/.env',
      old_string: 'PORT=3000',
      new_string: 'PORT=4000'
    }
  });

  const out = parseOutput(result.stdout);
  assert.strictEqual(out.hookSpecificOutput?.permissionDecision, 'deny');
  assert.ok(out.hookSpecificOutput?.permissionDecisionReason.includes('Fact-Forcing Gate'));
})) passed++; else failed++;

// 11. Destructive IaC commands (terraform destroy, kubectl delete) are caught
clearState();
if (test('denies terraform destroy and kubectl delete namespace as destructive commands', () => {
  const tfResult = runBashHook({
    tool_name: 'Bash',
    tool_input: { command: 'terraform destroy -auto-approve' }
  });
  const tfOut = parseOutput(tfResult.stdout);
  assert.strictEqual(tfOut.hookSpecificOutput?.permissionDecision, 'deny');
  assert.ok(tfOut.hookSpecificOutput?.permissionDecisionReason.includes('rollback'));

  const k8sResult = runBashHook({
    tool_name: 'Bash',
    tool_input: { command: 'kubectl delete namespace production' }
  });
  const k8sOut = parseOutput(k8sResult.stdout);
  assert.strictEqual(k8sOut.hookSpecificOutput?.permissionDecision, 'deny');
  assert.ok(k8sOut.hookSpecificOutput?.permissionDecisionReason.includes('rollback'));
})) passed++; else failed++;

// Cleanup
clearState();
try {
  fs.rmdirSync(stateDir);
} catch (_) {}

console.log(`\nEvidence Ledger test summary: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
