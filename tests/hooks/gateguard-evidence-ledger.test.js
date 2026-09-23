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
  pruneReadFiles,
  buildEvidenceEntry,
  matchingEvidence,
  evidenceLevel,
  isTrivialChange,
  riskTier,
  validScopePass,
  grantScopePass,
  mergeState,
  recordToolUse
} = require('../../scripts/hooks/gateguard-evidence-ledger');

const runner = path.join(__dirname, '..', '..', 'scripts', 'hooks', 'run-with-flags.js');
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
  if (fs.existsSync(stateDir)) {
    fs.rmSync(stateDir, { recursive: true, force: true });
  }
  fs.mkdirSync(stateDir, { recursive: true });
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
  } catch (_err) {
    return null;
  }
}

console.log('Testing GateGuard Evidence Ledger & Upstream Improvements...\n');

// 1. Evidence Extraction & Path Utilities
clearState();
if (test('normalizePath and extractStem handle path variations', () => {
  assert.strictEqual(normalizePath('src\\utils\\test.js'), 'src/utils/test.js');
  assert.strictEqual(extractStem('/src/utils/test.js'), 'test');
  assert.strictEqual(extractStem('Dockerfile'), 'Dockerfile');
})) passed++; else failed++;

// 2. Evidence Extraction & Classification
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

// 3. Evidence Pruning and TTL
clearState();
if (test('pruneEvidence discards expired entries and caps at 200 items', () => {
  const now = Date.now();
  const oldTs = now - (EVIDENCE_TTL_MS + 1000); // expired
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

// 4. Evidence Levels & Strict Matching
clearState();
if (test('evidenceLevel computes correct level and isolates unrelated directories', () => {
  const now = Date.now();
  const state = {
    read_files: {
      '/src/users/model.js': now
    },
    evidence: [
      { kind: 'read', target: '/src/users/model.js', stem: 'model', ts: now },
      { kind: 'grep', target: '/src/users', pattern: 'findUserById', ts: now }
    ]
  };

  // Not read at all
  assert.strictEqual(evidenceLevel('/src/other.js', state, now), 'none');

  // Read + grep in same dir -> deep
  assert.strictEqual(evidenceLevel('/src/users/model.js', state, now), 'deep');

  // Greptile Issue 2: Evidence in docs/config.js does NOT match src/config.js
  const docState = {
    read_files: { '/docs/config.js': now },
    evidence: [
      { kind: 'read', target: '/docs/config.js', stem: 'config', ts: now },
      { kind: 'grep', target: '/docs', pattern: 'config', ts: now }
    ]
  };
  const matched = matchingEvidence('/src/config.js', docState, now);
  assert.strictEqual(matched.length, 0);
  assert.strictEqual(evidenceLevel('/src/config.js', docState, now), 'none');

  // Greptile Issue 3: Stale direct read older than 30 minutes expires
  const expiredState = {
    read_files: {
      '/src/users/model.js': now - (EVIDENCE_TTL_MS + 5000)
    },
    evidence: [
      { kind: 'read', target: '/src/users/model.js', stem: 'model', ts: now - (EVIDENCE_TTL_MS + 5000) },
      { kind: 'grep', target: '/src/users', pattern: 'findUserById', ts: now }
    ]
  };
  assert.strictEqual(evidenceLevel('/src/users/model.js', expiredState, now), 'none');
})) passed++; else failed++;

// 5. Trivial Change Detection & Language Awareness
clearState();
if (test('isTrivialChange detects comment/whitespace edits and respects syntax sensitivity', () => {
  // Comment change in JS
  assert.strictEqual(isTrivialChange('Edit', {
    old_string: '// old note\nconst a = 1;',
    new_string: '// updated note\nconst a = 1;'
  }, '/src/test.js'), true);

  // Whitespace change in JS
  assert.strictEqual(isTrivialChange('Edit', {
    old_string: 'const a = 1;\n',
    new_string: '  const a = 1;\n\n'
  }, '/src/test.js'), true);

  // Greptile Issue 1: Indentation change in Python is NOT trivial
  assert.strictEqual(isTrivialChange('Edit', {
    old_string: 'def run():\n    pass',
    new_string: 'def run():\n        pass'
  }, '/src/script.py'), false);

  // Greptile Issue 1: Preprocessor directive #define in C is NOT a comment
  assert.strictEqual(isTrivialChange('Edit', {
    old_string: '#define MAX_SIZE 100\nint a = 1;',
    new_string: '#define MAX_SIZE 200\nint a = 1;'
  }, '/src/main.c'), false);

  // Meaningful code change
  assert.strictEqual(isTrivialChange('Edit', {
    old_string: 'const a = 1;',
    new_string: 'const a = 2;'
  }, '/src/test.js'), false);
})) passed++; else failed++;

// 6. Risk Tiers & Public API Signature Detection
clearState();
if (test('riskTier classifies sensitive paths and multi-language public signatures', () => {
  // High risk: sensitive paths
  assert.strictEqual(riskTier('Edit', { old_string: 'a', new_string: 'b' }, '/project/.env'), 'high');
  assert.strictEqual(riskTier('Edit', { old_string: 'a', new_string: 'b' }, '/project/.env.local'), 'high');
  assert.strictEqual(riskTier('Edit', { old_string: 'a', new_string: 'b' }, '/src/auth/tokens.js'), 'high');
  assert.strictEqual(riskTier('Edit', { old_string: 'a', new_string: 'b' }, '/src/payments/stripe.js'), 'high');
  assert.strictEqual(riskTier('Edit', { old_string: 'a', new_string: 'b' }, '/db/migrations/2026_users.sql'), 'high');
  assert.strictEqual(riskTier('Edit', { old_string: 'a', new_string: 'b' }, '/.github/workflows/deploy.yml'), 'high');

  // Elevated risk: JS/TS signatures
  assert.strictEqual(riskTier('Edit', {
    old_string: 'function getUser(id) {}',
    new_string: 'function getUser(id, options) {}'
  }, '/src/utils/user.js'), 'elevated');

  // Greptile Issue 5: Write tool with public Java/Go/Rust signatures
  assert.strictEqual(riskTier('Write', {
    content: 'package main\n\nfunc ExportedHandler() {}\n'
  }, '/src/handler.go'), 'elevated');

  assert.strictEqual(riskTier('Write', {
    content: 'public class UserService {\n  public void execute() {}\n}\n'
  }, '/src/UserService.java'), 'elevated');

  assert.strictEqual(riskTier('Write', {
    content: 'pub fn calculate_hash() -> String {}\n'
  }, '/src/crypto.rs'), 'elevated');

  // Normal tier: routine body changes
  assert.strictEqual(riskTier('Edit', {
    old_string: 'const x = 10;',
    new_string: 'const x = 20;'
  }, '/src/utils/math.js'), 'normal');
})) passed++; else failed++;

// 7. Scope Passes Immutability
clearState();
if (test('grantScopePass returns new object without mutating caller state', () => {
  const now = Date.now();
  const state = { scope_passes: { '/src/old': now + 50000 } };
  const updated = grantScopePass(state, '/src/components/Button.jsx', now);

  assert.notStrictEqual(state, updated);
  assert.strictEqual(validScopePass('/src/components/Input.jsx', updated, now), true);
  assert.strictEqual(validScopePass('/src/components/Input.jsx', state, now), false);

  // Expired scope pass
  const future = now + SCOPE_PASS_TTL_MS + 1000;
  assert.strictEqual(validScopePass('/src/components/Input.jsx', updated, future), false);
})) passed++; else failed++;

// 8. Concurrency Merging
clearState();
if (test('mergeState merges concurrent evidence and scope passes without losing data', () => {
  const now = Date.now();
  const diskState = {
    checked: ['/src/a.js'],
    evidence: [{ kind: 'read', target: '/src/a.js', ts: now }],
    scope_passes: { '/src': now + 10000 }
  };
  const memoryState = {
    checked: ['/src/b.js'],
    evidence: [{ kind: 'grep', target: '/src', pattern: 'init', ts: now }],
    scope_passes: { '/lib': now + 20000 }
  };

  const merged = mergeState(diskState, memoryState, now);
  assert.strictEqual(merged.evidence.length, 2);
  assert.ok(merged.checked.includes('/src/a.js'));
  assert.ok(merged.checked.includes('/src/b.js'));
  assert.strictEqual(merged.scope_passes['/src'], now + 10000);
  assert.strictEqual(merged.scope_passes['/lib'], now + 20000);
})) passed++; else failed++;

// 9. PostToolUse: recordToolUse silently records evidence into session state
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
  assert.ok(state.read_files['/src/services/api.js']);
})) passed++; else failed++;

// 10. Integration: PreToolUse bypasses gate when evidence is deep for normal risk
clearState();
if (test('PreToolUse Edit automatically allows without denial when evidence is deep', () => {
  const now = Date.now();
  writeState({
    checked: [],
    last_active: now,
    read_files: { '/src/services/api.js': now },
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

// 11. Integration: Scope pass allows sibling file that has been touched
clearState();
if (test('Sibling file in scope pass directory is allowed if touched', () => {
  const now = Date.now();
  writeState({
    checked: [],
    last_active: now,
    read_files: { '/src/services/client.js': now },
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

// 12. Integration: Greptile Issue 4 - Elevated public signature edit is NOT silently bypassed
clearState();
if (test('Elevated risk public signature edit requires fact force ceremony even with deep evidence', () => {
  const now = Date.now();
  writeState({
    checked: [],
    last_active: now,
    read_files: { '/src/services/api.js': now },
    evidence: [
      { kind: 'read', target: '/src/services/api.js', stem: 'api', ts: now },
      { kind: 'grep', target: '/src/services', pattern: 'fetchData', ts: now }
    ]
  });

  const result = runHook({
    tool_name: 'Edit',
    tool_input: {
      file_path: '/src/services/api.js',
      old_string: 'export function fetchData() {}',
      new_string: 'export function fetchData(options) {}'
    }
  });

  const out = parseOutput(result.stdout);
  assert.strictEqual(out.hookSpecificOutput?.permissionDecision, 'deny');
  assert.ok(out.hookSpecificOutput?.permissionDecisionReason.includes('Fact-Forcing Gate'));
})) passed++; else failed++;

// 13. Integration: Greptile Issue 1 - High-risk file (.env) is gated even for trivial edits
clearState();
if (test('High-risk file (.env) is gated even for whitespace or comment edits', () => {
  const result = runHook({
    tool_name: 'Edit',
    tool_input: {
      file_path: '/src/.env',
      old_string: '# comment 1\nPORT=3000',
      new_string: '# comment 2\nPORT=3000'
    }
  });

  const out = parseOutput(result.stdout);
  assert.strictEqual(out.hookSpecificOutput?.permissionDecision, 'deny');
  assert.ok(out.hookSpecificOutput?.permissionDecisionReason.includes('Fact-Forcing Gate'));
})) passed++; else failed++;

// 14. Destructive IaC commands with flags (atomic tests adhering to AAA pattern)
clearState();
if (test('denies terraform destroy with chdir flag', () => {
  const result = runBashHook({
    tool_name: 'Bash',
    tool_input: { command: 'terraform -chdir=prod destroy -auto-approve' }
  });
  const out = parseOutput(result.stdout);
  assert.strictEqual(out.hookSpecificOutput?.permissionDecision, 'deny');
  assert.ok(out.hookSpecificOutput?.permissionDecisionReason.includes('rollback'));
})) passed++; else failed++;

clearState();
if (test('denies tofu destroy with chdir flag', () => {
  const result = runBashHook({
    tool_name: 'Bash',
    tool_input: { command: 'tofu -chdir=prod destroy' }
  });
  const out = parseOutput(result.stdout);
  assert.strictEqual(out.hookSpecificOutput?.permissionDecision, 'deny');
  assert.ok(out.hookSpecificOutput?.permissionDecisionReason.includes('rollback'));
})) passed++; else failed++;

clearState();
if (test('denies kubectl delete namespace with context flag', () => {
  const result = runBashHook({
    tool_name: 'Bash',
    tool_input: { command: 'kubectl --context=prod delete namespace production' }
  });
  const out = parseOutput(result.stdout);
  assert.strictEqual(out.hookSpecificOutput?.permissionDecision, 'deny');
  assert.ok(out.hookSpecificOutput?.permissionDecisionReason.includes('rollback'));
})) passed++; else failed++;

// 15. Risk tier classification for extended environment filenames
if (test('classifies .envrc and .env-production as high-risk', () => {
  assert.strictEqual(riskTier('Edit', {}, '.envrc'), 'high');
  assert.strictEqual(riskTier('Edit', {}, '/path/to/.env-production'), 'high');
  assert.strictEqual(riskTier('Edit', {}, 'packages/backend/.env.local'), 'high');
})) passed++; else failed++;

// 16. pruneReadFiles entry count cap
if (test('caps active read entries to EVIDENCE_MAX_ENTRIES', () => {
  const now = Date.now();
  const oversizedMap = {};
  for (let i = 0; i < 250; i++) {
    oversizedMap[`file-${i}.js`] = now - i * 10;
  }
  const pruned = pruneReadFiles(oversizedMap, now);
  const keys = Object.keys(pruned);
  assert.strictEqual(keys.length, EVIDENCE_MAX_ENTRIES);
  // Ensure the most recent entries were kept
  assert.ok(keys.includes('file-0.js'));
  assert.ok(!keys.includes('file-249.js'));
})) passed++; else failed++;

// 17. Persistence failure reports diagnostic to stderr (Greptile P2 review resolution)
if (test('reports diagnostic to stderr when state directory is an uncreatable file', () => {
  const testFileDir = path.join(tmpRoot, `gateguard-err-file-${Date.now()}`);
  fs.writeFileSync(testFileDir, 'blocking-file', 'utf8');

  const origEnv = process.env.GATEGUARD_STATE_DIR;
  process.env.GATEGUARD_STATE_DIR = testFileDir;

  let stderrOutput = '';
  const originalStderrWrite = process.stderr.write;
  process.stderr.write = (chunk) => {
    stderrOutput += String(chunk);
    return true;
  };

  try {
    const res = recordToolUse({
      tool_name: 'Read',
      tool_input: { file_path: '/path/to/test.js' }
    });

    assert.strictEqual(res.exitCode, 0);
    assert.ok(stderrOutput.includes('[GateGuard] Failed to persist evidence state'));
    assert.ok(res.stderr.includes('Failed to persist evidence state'));
  } finally {
    process.stderr.write = originalStderrWrite;
    process.env.GATEGUARD_STATE_DIR = origEnv;
    try { fs.unlinkSync(testFileDir); } catch (_) { void 0; }
  }
})) passed++; else failed++;

clearState();
if (test('denies quoted and subshell-wrapped terraform destroy (CodeRabbit CWE-693 resolution)', () => {
  const result = runBashHook({
    tool_name: 'Bash',
    tool_input: { command: 'bash -c "terraform destroy"' }
  });
  const out = parseOutput(result.stdout);
  assert.strictEqual(out.hookSpecificOutput?.permissionDecision, 'deny');
  assert.ok(out.hookSpecificOutput?.permissionDecisionReason.includes('rollback'));
})) passed++; else failed++;

// Cleanup
clearState();
if (fs.existsSync(stateDir)) {
  fs.rmSync(stateDir, { recursive: true, force: true });
}

console.log(`\nEvidence Ledger test summary: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
