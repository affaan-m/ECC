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
  isPathInsideDirectory,
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
  restoreStateBackup,
  writeStateToDiskAtomic,
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

function restoreEnvironmentVariable(name, value) {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
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

if (test('path containment accepts filesystem roots and rejects sibling prefixes', () => {
  const filesystemRoot = path.parse(path.resolve()).root;
  assert.strictEqual(isPathInsideDirectory(filesystemRoot, path.join(filesystemRoot, 'state.json')), true);
  assert.strictEqual(isPathInsideDirectory('/tmp/state', '/tmp/state/session.json'), true);
  assert.strictEqual(isPathInsideDirectory('/tmp/state', '/tmp/state-backup/session.json'), false);
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

  const bashEntry = buildEvidenceEntry('Bash', { command: 'rg -i "token" /src/auth/service.js' });
  assert.strictEqual(bashEntry.kind, 'bash');
  assert.strictEqual(bashEntry.target, '/src/auth/service.js');
  assert.strictEqual(bashEntry.pattern, 'token');

  const pipedInvestigation = buildEvidenceEntry('Bash', {
    command: 'echo unrelated | rg -i "token" /src/auth/service.js'
  });
  assert.strictEqual(pipedInvestigation.target, '/src/auth/service.js');

  const quotedToolName = buildEvidenceEntry('Bash', { command: 'echo "rg token /src/auth/service.js"' });
  assert.strictEqual(quotedToolName, null);

  const printedToolName = buildEvidenceEntry('Bash', { command: "printf 'cat /src/auth/service.js'" });
  assert.strictEqual(printedToolName, null);

  const searchWithoutTarget = buildEvidenceEntry('Bash', { command: 'rg token' });
  assert.strictEqual(searchWithoutTarget, null);

  const skippedOrSearch = buildEvidenceEntry('Bash', { command: 'true || rg token /src/auth/service.js' });
  assert.strictEqual(skippedOrSearch, null);

  const skippedAndSearch = buildEvidenceEntry('Bash', { command: 'false && rg token /src/auth/service.js' });
  assert.strictEqual(skippedAndSearch, null);

  const changedDirectorySearch = buildEvidenceEntry('Bash', {
    command: 'cd /other && rg token src/auth/service.js'
  });
  assert.strictEqual(changedDirectorySearch, null);

  const gitShowFormatPath = buildEvidenceEntry('Bash', {
    command: 'git show --format=%H:/wrong/file.js HEAD -- src/auth/service.js'
  });
  assert.strictEqual(gitShowFormatPath.target, path.resolve('src/auth/service.js'));

  const nonInvestigative = buildEvidenceEntry('Bash', { command: 'npm start' });
  assert.strictEqual(nonInvestigative, null);

  assert.strictEqual(buildEvidenceEntry('Bash', { command: './rg token /src/auth/service.js' }), null);
  assert.strictEqual(buildEvidenceEntry('Bash', { command: 'PATH=/tmp/fake rg token /src/auth/service.js' }), null);
  assert.strictEqual(buildEvidenceEntry('Bash', { command: 'rg --help parse /src/auth/service.js' }), null);

  const nonTargetTool = buildEvidenceEntry('WebSearch', { query: 'test' });
  assert.strictEqual(nonTargetTool, null);
})) passed++; else failed++;

if (test('records literal tool paths containing framework metacharacters', () => {
  const now = Date.now();
  const readEntry = buildEvidenceEntry('Read', { file_path: '/app/[slug]/page.tsx' });
  const grepEntry = buildEvidenceEntry('Grep', { path: '/app/[slug]', pattern: 'params' });
  const globEntry = buildEvidenceEntry('Glob', { path: '/routes/$id', pattern: '*.tsx' });

  assert.strictEqual(readEntry.target, '/app/[slug]/page.tsx');
  assert.strictEqual(grepEntry.target, '/app/[slug]');
  assert.strictEqual(globEntry.target, '/routes/$id');
  assert.strictEqual(evidenceLevel('/app/[slug]/page.tsx', {
    read_files: { '/app/[slug]/page.tsx': now },
    evidence: [readEntry, grepEntry]
  }, now), 'deep');
})) passed++; else failed++;

if (test('rejects shell investigation paths that require expansion', () => {
  const entry = buildEvidenceEntry('Bash', { command: 'rg params /app/[slug]/page.tsx' });

  assert.strictEqual(entry, null);
})) passed++; else failed++;

if (test('records the searched file after ripgrep --pre consumes its command value', () => {
  const entry = buildEvidenceEntry('Bash', {
    command: 'rg --pre cat needle /tmp/other.js'
  });

  assert.strictEqual(entry.target, path.resolve('/tmp/other.js'));
  assert.strictEqual(entry.pattern, 'needle');
})) passed++; else failed++;

if (test('does not treat ripgrep --pre command as a search target', () => {
  const entry = buildEvidenceEntry('Bash', {
    command: 'rg --pre cat /tmp/victim.js'
  });

  assert.strictEqual(entry, null);
})) passed++; else failed++;

if (test('does not misattribute ripgrep --pre-glob values as searched files', () => {
  const entry = buildEvidenceEntry('Bash', {
    command: "rg --pre-glob '*.md' needle /tmp/other.js"
  });

  assert.strictEqual(entry.target, path.resolve('/tmp/other.js'));
  assert.strictEqual(entry.pattern, 'needle');
})) passed++; else failed++;

if (test('rejects ripgrep evidence when an option is not recognized by the parser', () => {
  const entry = buildEvidenceEntry('Bash', {
    command: 'rg --unknown-value config needle /tmp/other.js'
  });

  assert.strictEqual(entry, null);
})) passed++; else failed++;

clearState();
if (test('does not record destructive find actions as investigation evidence', () => {
  assert.strictEqual(buildEvidenceEntry('Bash', { command: 'find /src -delete' }), null);
  assert.strictEqual(buildEvidenceEntry('Bash', { command: "find /src -exec rm -rf {} ';'" }), null);
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

  const ancestorSearchState = {
    read_files: { '/src/users/model.js': now },
    evidence: [
      { kind: 'read', target: '/src/users/model.js', stem: 'model', ts: now },
      { kind: 'grep', target: '/src', pattern: 'findUserById', ts: now }
    ]
  };
  assert.strictEqual(evidenceLevel('/src/users/model.js', ancestorSearchState, now), 'touched');

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

  const legacyRelativeEvidence = {
    evidence: [
      { kind: 'read', target: 'src/api.js', ts: now },
      { kind: 'grep', target: 'src', pattern: 'handler', ts: now }
    ]
  };
  assert.strictEqual(evidenceLevel('/other/repo/src/api.js', legacyRelativeEvidence, now), 'none');

  const caseMismatchEvidence = {
    read_files: { '/src/Users/model.js': now },
    evidence: [
      { kind: 'read', target: '/src/Users/model.js', ts: now },
      { kind: 'grep', target: '/src/Users', pattern: 'findUserById', ts: now }
    ]
  };
  assert.strictEqual(evidenceLevel('/src/users/model.js', caseMismatchEvidence, now), 'none');

  const legacyRelativeRead = { read_files: { 'src/users/model.js': now } };
  assert.strictEqual(evidenceLevel('/src/users/model.js', legacyRelativeRead, now), 'none');

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
if (test('isTrivialChange bypasses only unambiguous whitespace edits without a parser', () => {
  // Without syntax-aware parsing, comment-shaped lines are not bypassed.
  assert.strictEqual(isTrivialChange('Edit', {
    old_string: '// old note\nconst a = 1;',
    new_string: '// updated note\nconst a = 1;'
  }, '/src/test.js'), false);

  // Whitespace change in JS
  assert.strictEqual(isTrivialChange('Edit', {
    old_string: 'const a = 1;\n',
    new_string: '  const a = 1;\n\n'
  }, '/src/test.js'), true);

  assert.strictEqual(isTrivialChange('Edit', {
    old_string: 'label: New  York',
    new_string: 'label: New York'
  }, '/src/config.yaml'), false);

  assert.strictEqual(isTrivialChange('Edit', {
    old_string: 'GREETING = Hello  world',
    new_string: 'GREETING = Hello world'
  }, '/Makefile'), false);

  assert.strictEqual(isTrivialChange('Edit', {
    old_string: 'A sentence.  \nNext sentence.',
    new_string: 'A sentence.\nNext sentence.'
  }, '/docs/guide.md'), false);

  assert.strictEqual(isTrivialChange('Edit', {
    old_string: 'const text = `first\n// old\nlast`;',
    new_string: 'const text = `first\n// new\nlast`;'
  }, '/src/test.js'), false);

  assert.strictEqual(isTrivialChange('Edit', {
    old_string: 'text = """first\n# old\nlast"""',
    new_string: 'text = """first\n# new\nlast"""'
  }, '/src/script.py'), false);

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
    content: 'export function parseUser(input) { return input; }\n'
  }, '/src/parse-user.js'), 'elevated');

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

if (test('riskTier elevates async Rust and Kotlin public API writes', () => {
  assert.strictEqual(riskTier('Write', {
    content: 'pub async fn fetch() {}'
  }, '/src/lib.rs'), 'elevated');

  assert.strictEqual(riskTier('Write', {
    content: 'pub unsafe fn fetch() {}'
  }, '/src/lib.rs'), 'elevated');

  assert.strictEqual(riskTier('Write', {
    content: 'public suspend fun fetch() {}'
  }, '/src/Api.kt'), 'elevated');

  assert.strictEqual(riskTier('Write', {
    content: 'suspend fun fetch() {}'
  }, '/src/Api.kt'), 'elevated');
})) passed++; else failed++;

// 13. Integration: Public API Write stays gated despite deep evidence.
clearState();
if (test('Public API Write requires fact force ceremony even with deep evidence', () => {
  const now = Date.now();
  writeState({
    checked: [],
    last_active: now,
    read_files: { '/src/services/new-api.js': now },
    evidence: [
      { kind: 'read', target: '/src/services/new-api.js', stem: 'new-api', ts: now },
      { kind: 'grep', target: '/src/services', pattern: 'parseUser', ts: now }
    ]
  });

  const result = runHook({
    tool_name: 'Write',
    tool_input: {
      file_path: '/src/services/new-api.js',
      content: 'export function parseUser(input) { return input; }\n'
    }
  });

  const out = parseOutput(result.stdout);
  assert.strictEqual(out.hookSpecificOutput?.permissionDecision, 'deny');
  assert.ok(out.hookSpecificOutput?.permissionDecisionReason.includes('Fact-Forcing Gate'));
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

clearState();
if (test('mergeState retains the newest read and scope timestamps', () => {
  const now = Date.now();
  const staleState = {
    read_files: { '/src/a.js': now - 1000 },
    scope_passes: { '/src': now + 1000 }
  };
  const freshState = {
    read_files: { '/src/a.js': now },
    scope_passes: { '/src': now + 5000 }
  };

  const merged = mergeState(staleState, freshState, now);

  assert.strictEqual(merged.read_files['/src/a.js'], now);
  assert.strictEqual(merged.scope_passes['/src'], now + 5000);
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

clearState();
if (test('recordToolUse does not revive checked entries from an expired session', () => {
  writeState({
    checked: ['/src/already-checked.js'],
    last_active: Date.now() - EVIDENCE_TTL_MS - 1000,
    evidence: [],
    read_files: {}
  });

  recordToolUse({
    session_id: TEST_SESSION_ID,
    tool_name: 'Read',
    tool_input: { file_path: '/src/recent-read.js' }
  });

  const result = runHook({
    tool_name: 'Edit',
    tool_input: { file_path: '/src/already-checked.js', old_string: 'before', new_string: 'after' }
  });

  assert.strictEqual(parseOutput(result.stdout).hookSpecificOutput.permissionDecision, 'deny');
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

// 14. Integration: high-risk file (.env) is gated even for whitespace changes
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
if (test('denies Terraform apply with destroy mode enabled through an equals flag', () => {
  const result = runBashHook({ tool_name: 'Bash', tool_input: { command: 'terraform apply -destroy=true' } });
  assert.ok(parseOutput(result.stdout).hookSpecificOutput.permissionDecisionReason.includes('rollback'));
})) passed++; else failed++;

clearState();
if (test('denies Terraform apply with the double-dash destroy mode flag', () => {
  const result = runBashHook({ tool_name: 'Bash', tool_input: { command: 'terraform apply --destroy -auto-approve' } }, { GATEGUARD_BASH_ROUTINE_DISABLED: '1' });

  assert.strictEqual(parseOutput(result.stdout).hookSpecificOutput.permissionDecision, 'deny');
})) passed++; else failed++;

clearState();
if (test('denies OpenTofu plan with the double-dash destroy mode flag', () => {
  const result = runBashHook({ tool_name: 'Bash', tool_input: { command: 'tofu plan --destroy' } }, { GATEGUARD_BASH_ROUTINE_DISABLED: '1' });

  assert.strictEqual(parseOutput(result.stdout).hookSpecificOutput.permissionDecision, 'deny');
})) passed++; else failed++;

clearState();
if (test('does not treat an explicitly disabled Terraform destroy flag as destructive', () => {
  const result = runBashHook({ tool_name: 'Bash', tool_input: { command: 'terraform plan -destroy=false' } }, {
    GATEGUARD_BASH_ROUTINE_DISABLED: '1'
  });
  assert.notStrictEqual(parseOutput(result.stdout).hookSpecificOutput?.permissionDecision, 'deny');
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

clearState();
if (test('denies kubectl delete after a short verbosity option value', () => {
  const result = runBashHook({ tool_name: 'Bash', tool_input: { command: 'kubectl -v 8 delete namespace prod' } }, { GATEGUARD_BASH_ROUTINE_DISABLED: '1' });

  assert.strictEqual(parseOutput(result.stdout).hookSpecificOutput.permissionDecision, 'deny');
})) passed++; else failed++;

clearState();
if (test('denies kubectl delete after the long verbosity option value', () => {
  const result = runBashHook({ tool_name: 'Bash', tool_input: { command: 'kubectl --v 8 delete namespace prod' } }, { GATEGUARD_BASH_ROUTINE_DISABLED: '1' });

  assert.strictEqual(parseOutput(result.stdout).hookSpecificOutput.permissionDecision, 'deny');
})) passed++; else failed++;

clearState();
if (test('denies kubectl delete after the vmodule option value', () => {
  const result = runBashHook({ tool_name: 'Bash', tool_input: { command: 'kubectl --vmodule api=2 delete namespace prod' } }, { GATEGUARD_BASH_ROUTINE_DISABLED: '1' });

  assert.strictEqual(parseOutput(result.stdout).hookSpecificOutput.permissionDecision, 'deny');
})) passed++; else failed++;

clearState();
if (test('denies kubectl namespace slash resource deletion', () => {
  const result = runBashHook({ tool_name: 'Bash', tool_input: { command: 'kubectl delete namespace/production' } });
  assert.ok(parseOutput(result.stdout).hookSpecificOutput.permissionDecisionReason.includes('rollback'));
})) passed++; else failed++;

clearState();
if (test('denies namespace deletion after kubectl as-user-extra value', () => {
  const result = runBashHook({
    tool_name: 'Bash',
    tool_input: { command: 'kubectl --as-user-extra alice delete namespace prod' }
  });

  assert.ok(parseOutput(result.stdout).hookSpecificOutput.permissionDecisionReason.includes('rollback'));
})) passed++; else failed++;

clearState();
if (test('denies namespace deletion after kubectl profile-output value', () => {
  const result = runBashHook({
    tool_name: 'Bash',
    tool_input: { command: 'kubectl --profile-output /tmp/profile delete namespace prod' }
  });

  assert.ok(parseOutput(result.stdout).hookSpecificOutput.permissionDecisionReason.includes('rollback'));
})) passed++; else failed++;

clearState();
if (test('denies namespace deletion after kubectl storage-driver option value', () => {
  const result = runBashHook({
    tool_name: 'Bash',
    tool_input: { command: 'kubectl --storage-driver-host db delete namespace prod' }
  });

  assert.ok(parseOutput(result.stdout).hookSpecificOutput.permissionDecisionReason.includes('rollback'));
})) passed++; else failed++;

clearState();
if (test('denies selector-based kubectl namespace deletion', () => {
  const result = runBashHook({ tool_name: 'Bash', tool_input: { command: 'kubectl delete -l app=prod namespace' } });
  assert.ok(parseOutput(result.stdout).hookSpecificOutput.permissionDecisionReason.includes('rollback'));
})) passed++; else failed++;

clearState();
if (test('denies kubectl persistent-volume deletion after namespace option values', () => {
  const result = runBashHook({ tool_name: 'Bash', tool_input: { command: 'kubectl delete --namespace production pvc cache' } });
  assert.ok(parseOutput(result.stdout).hookSpecificOutput.permissionDecisionReason.includes('rollback'));
})) passed++; else failed++;

clearState();
if (test('denies kubectl claim deletion after short namespace option values', () => {
  const result = runBashHook({ tool_name: 'Bash', tool_input: { command: 'kubectl delete -n production persistentvolumeclaim/cache' } });
  assert.ok(parseOutput(result.stdout).hookSpecificOutput.permissionDecisionReason.includes('rollback'));
})) passed++; else failed++;

clearState();
if (test('consumes the kubectl dry-run value before checking the resource type', () => {
  const result = runBashHook({ tool_name: 'Bash', tool_input: { command: 'kubectl delete --dry-run none namespaces/production' } });
  assert.ok(parseOutput(result.stdout).hookSpecificOutput.permissionDecisionReason.includes('rollback'));
})) passed++; else failed++;

clearState();
if (test('gates kubectl raw DELETE requests', () => {
  const result = runBashHook({ tool_name: 'Bash', tool_input: { command: 'kubectl delete --raw /api/v1/namespaces/prod' } });
  assert.ok(parseOutput(result.stdout).hookSpecificOutput.permissionDecisionReason.includes('rollback'));
})) passed++; else failed++;

clearState();
if (test('gates manifest-based kubectl deletes whose resource kinds are unknown', () => {
  const filename = runBashHook({ tool_name: 'Bash', tool_input: { command: 'kubectl delete -f namespace.yaml' } });
  assert.ok(parseOutput(filename.stdout).hookSpecificOutput.permissionDecisionReason.includes('rollback'));
})) passed++; else failed++;

clearState();
if (test('gates kustomize-based kubectl deletes whose resource kinds are unknown', () => {
  const kustomize = runBashHook({ tool_name: 'Bash', tool_input: { command: 'kubectl delete -k overlays/prod' } });
  assert.ok(parseOutput(kustomize.stdout).hookSpecificOutput.permissionDecisionReason.includes('rollback'));
})) passed++; else failed++;

clearState();
if (test('denies kubectl deletes when namespace value equals a subcommand name', () => {
  const result = runBashHook({ tool_name: 'Bash', tool_input: { command: 'kubectl --namespace delete delete ns/production' } });
  assert.ok(parseOutput(result.stdout).hookSpecificOutput.permissionDecisionReason.includes('rollback'));
})) passed++; else failed++;

clearState();
if (test('denies kubectl delete all requests', () => {
  const result = runBashHook({ tool_name: 'Bash', tool_input: { command: 'kubectl delete --all pods' } });
  assert.ok(parseOutput(result.stdout).hookSpecificOutput.permissionDecisionReason.includes('rollback'));
})) passed++; else failed++;

clearState();
if (test('denies kubectl delete when --all follows a safe resource argument', () => {
  const result = runBashHook({ tool_name: 'Bash', tool_input: { command: 'kubectl delete pods --all -A' } }, { GATEGUARD_BASH_ROUTINE_DISABLED: '1' });

  assert.strictEqual(parseOutput(result.stdout).hookSpecificOutput.permissionDecision, 'deny');
})) passed++; else failed++;

clearState();
if (test('denies kubectl delete when a dangerous resource follows a safe resource', () => {
  const result = runBashHook({ tool_name: 'Bash', tool_input: { command: 'kubectl delete pod/tmp namespace/prod' } }, { GATEGUARD_BASH_ROUTINE_DISABLED: '1' });

  assert.strictEqual(parseOutput(result.stdout).hookSpecificOutput.permissionDecision, 'deny');
})) passed++; else failed++;

clearState();
if (test('denies kubectl delete when a manifest option follows the resource', () => {
  const result = runBashHook({ tool_name: 'Bash', tool_input: { command: 'kubectl delete pod x -f ns.yaml' } }, { GATEGUARD_BASH_ROUTINE_DISABLED: '1' });

  assert.strictEqual(parseOutput(result.stdout).hookSpecificOutput.permissionDecision, 'deny');
})) passed++; else failed++;

clearState();
if (test('denies command-wrapped Terraform destroy', () => {
  const result = runBashHook({ tool_name: 'Bash', tool_input: { command: 'command terraform destroy' } });
  assert.ok(parseOutput(result.stdout).hookSpecificOutput.permissionDecisionReason.includes('rollback'));
})) passed++; else failed++;

clearState();
if (test('recognizes command path mode for OpenTofu destroy', () => {
  const result = runBashHook({ tool_name: 'Bash', tool_input: { command: 'command -p -- tofu -chdir=prod destroy' } });
  assert.ok(parseOutput(result.stdout).hookSpecificOutput.permissionDecisionReason.includes('rollback'));
})) passed++; else failed++;

clearState();
if (test('denies Terraform destroy wrapped by time', () => {
  const result = runBashHook({
    tool_name: 'Bash',
    tool_input: { command: 'time -p terraform destroy' }
  });

  assert.ok(parseOutput(result.stdout).hookSpecificOutput.permissionDecisionReason.includes('rollback'));
})) passed++; else failed++;

clearState();
if (test('denies Terraform destroy wrapped by exec', () => {
  const result = runBashHook({
    tool_name: 'Bash',
    tool_input: { command: 'exec terraform destroy' }
  });

  assert.ok(parseOutput(result.stdout).hookSpecificOutput.permissionDecisionReason.includes('rollback'));
})) passed++; else failed++;

clearState();
if (test('denies Terraform destroy inside a shell with combined login and command flags', () => {
  const result = runBashHook({
    tool_name: 'Bash',
    tool_input: { command: "bash -lc 'terraform destroy'" }
  });

  assert.ok(parseOutput(result.stdout).hookSpecificOutput.permissionDecisionReason.includes('rollback'));
})) passed++; else failed++;

clearState();
if (test('denies recursive find delete inside a shell wrapper', () => {
  const result = runBashHook({
    tool_name: 'Bash',
    tool_input: { command: "bash -c 'find /src -delete'" }
  });

  assert.ok(parseOutput(result.stdout).hookSpecificOutput.permissionDecisionReason.includes('rollback'));
})) passed++; else failed++;

clearState();
if (test('denies destructive shell commands invoked by find exec', () => {
  const result = runBashHook({
    tool_name: 'Bash',
    tool_input: { command: "find . -exec sh -c 'rm -rf \"$@\"' sh {} +" }
  });

  assert.ok(parseOutput(result.stdout).hookSpecificOutput.permissionDecisionReason.includes('rollback'));
})) passed++; else failed++;

clearState();
if (test('denies find delete when wrapped by sudo', () => {
  const result = runBashHook({ tool_name: 'Bash', tool_input: { command: 'sudo find /var/cache -delete' } }, { GATEGUARD_BASH_ROUTINE_DISABLED: '1' });

  assert.strictEqual(parseOutput(result.stdout).hookSpecificOutput.permissionDecision, 'deny');
})) passed++; else failed++;

clearState();
if (test('denies find delete when wrapped by time', () => {
  const result = runBashHook({ tool_name: 'Bash', tool_input: { command: 'time find . -delete' } }, { GATEGUARD_BASH_ROUTINE_DISABLED: '1' });

  assert.strictEqual(parseOutput(result.stdout).hookSpecificOutput.permissionDecision, 'deny');
})) passed++; else failed++;

clearState();
if (test('denies find exec when wrapped by env', () => {
  const result = runBashHook({ tool_name: 'Bash', tool_input: { command: 'env find . -exec rm {} \\;' } }, { GATEGUARD_BASH_ROUTINE_DISABLED: '1' });

  assert.strictEqual(parseOutput(result.stdout).hookSpecificOutput.permissionDecision, 'deny');
})) passed++; else failed++;

clearState();
if (test('does not treat delete text inside find exec arguments as a find delete action', () => {
  const result = runBashHook({
    tool_name: 'Bash',
    tool_input: { command: "find . -exec echo -delete {} ';'" }
  }, { GATEGUARD_BASH_ROUTINE_DISABLED: '1' });

  assert.notStrictEqual(parseOutput(result.stdout).hookSpecificOutput?.permissionDecisionReason?.includes('rollback'), true);
})) passed++; else failed++;

clearState();
if (test('does not treat command lookup as Terraform execution', () => {
  const result = runBashHook({ tool_name: 'Bash', tool_input: { command: 'command -v terraform destroy' } });
  const reason = parseOutput(result.stdout).hookSpecificOutput.permissionDecisionReason;
  assert.notStrictEqual(reason.includes('rollback'), true);
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
    oversizedMap[path.resolve(`file-${i}.js`)] = now - i * 10;
  }
  const pruned = pruneReadFiles(oversizedMap, now);
  const keys = Object.keys(pruned);
  assert.strictEqual(keys.length, EVIDENCE_MAX_ENTRIES);
  // Ensure the most recent entries were kept
  assert.ok(keys.includes(path.resolve('file-0.js')));
  assert.ok(!keys.includes(path.resolve('file-249.js')));
  assert.deepStrictEqual(pruneReadFiles({ 'src/relative.js': now }, now), {});
})) passed++; else failed++;

// 17. Persistence failure reports diagnostic to stderr (Greptile P2 review resolution)
if (test('reports diagnostic to stderr when state directory is an uncreatable file', () => {
  const testFileDir = path.resolve(tmpRoot, `gateguard-err-file-${Date.now()}`);
  fs.writeFileSync(testFileDir, 'blocking-file', 'utf8');

  const suiteEnv = process.env.GATEGUARD_STATE_DIR;
  restoreEnvironmentVariable('GATEGUARD_STATE_DIR', undefined);
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
    restoreEnvironmentVariable('GATEGUARD_STATE_DIR', origEnv);
    const restoredEnv = process.env.GATEGUARD_STATE_DIR;
    restoreEnvironmentVariable('GATEGUARD_STATE_DIR', suiteEnv);
    assert.strictEqual(restoredEnv, origEnv);
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

clearState();
if (test('permits echo and printf containing IaC destroy commands without false positives (Greptile P2 review resolution)', () => {
  const echoQuoted = runBashHook({
    tool_name: 'Bash',
    tool_input: { command: 'echo "terraform destroy"' }
  }, { GATEGUARD_BASH_ROUTINE_DISABLED: '1' });
  const echoQuotedOut = parseOutput(echoQuoted.stdout);
  assert.notStrictEqual(echoQuotedOut.hookSpecificOutput?.permissionDecisionReason?.includes('rollback'), true);

  const echoKubectl = runBashHook({
    tool_name: 'Bash',
    tool_input: { command: 'echo "kubectl delete namespace foo"' }
  }, { GATEGUARD_BASH_ROUTINE_DISABLED: '1' });
  const echoKubectlOut = parseOutput(echoKubectl.stdout);
  assert.notStrictEqual(echoKubectlOut.hookSpecificOutput?.permissionDecisionReason?.includes('rollback'), true);

  const echoUnquoted = runBashHook({
    tool_name: 'Bash',
    tool_input: { command: 'echo terraform destroy' }
  }, { GATEGUARD_BASH_ROUTINE_DISABLED: '1' });
  const echoUnquotedOut = parseOutput(echoUnquoted.stdout);
  assert.notStrictEqual(echoUnquotedOut.hookSpecificOutput?.permissionDecisionReason?.includes('rollback'), true);

  const printfIaC = runBashHook({
    tool_name: 'Bash',
    tool_input: { command: 'printf "%s\\n" "terraform destroy"' }
  }, { GATEGUARD_BASH_ROUTINE_DISABLED: '1' });
  const printfOut = parseOutput(printfIaC.stdout);
  assert.notStrictEqual(printfOut.hookSpecificOutput?.permissionDecisionReason?.includes('rollback'), true);
})) passed++; else failed++;

if (test('cleans up staging file when atomic state rename fails', () => {
  const destDir = fs.mkdtempSync(path.join(tmpRoot, 'gateguard-atomic-fail-'));
  const targetFile = path.join(destDir, 'state.json');

  try {
    assert.throws(() => {
      writeStateToDiskAtomic(targetFile, { test: 1 }, () => {
        throw new Error('Simulated atomic rename failure');
      });
    }, /Simulated atomic rename failure/);

    const remainingFiles = fs.readdirSync(destDir);
    assert.strictEqual(remainingFiles.filter(f => f.includes('.tmp.')).length, 0);
  } finally {
    fs.rmSync(destDir, { recursive: true, force: true });
  }
})) passed++; else failed++;

if (test('preserves the prior state when an atomic replacement retry fails', () => {
  const destDir = fs.mkdtempSync(path.join(tmpRoot, 'gateguard-atomic-restore-'));
  const targetFile = path.join(destDir, 'state.json');
  fs.writeFileSync(targetFile, 'prior-state', 'utf8');
  let destinationRenameAttempts = 0;
  const failingReplacement = (source, destination) => {
    if (source.includes('.tmp.') && destination === targetFile) {
      destinationRenameAttempts += 1;
      const error = new Error(`Simulated replacement failure ${destinationRenameAttempts}`);
      error.code = destinationRenameAttempts === 1 ? 'EEXIST' : 'EPERM';
      throw error;
    }
    return fs.renameSync(source, destination);
  };

  try {
    assert.throws(() => writeStateToDiskAtomic(targetFile, { current: true }, failingReplacement), /Simulated replacement failure 2/);
    assert.strictEqual(fs.readFileSync(targetFile, 'utf8'), 'prior-state');
    assert.deepStrictEqual(fs.readdirSync(destDir), ['state.json']);
  } finally {
    fs.rmSync(destDir, { recursive: true, force: true });
  }
})) passed++; else failed++;

if (test('does not move an existing directory during atomic state replacement', () => {
  const destDir = fs.mkdtempSync(path.join(tmpRoot, 'gateguard-atomic-directory-'));
  const targetDir = path.join(destDir, 'state.json');
  const marker = path.join(targetDir, 'keep.txt');
  fs.mkdirSync(targetDir);
  fs.writeFileSync(marker, 'keep', 'utf8');
  const failFirstRename = (source, destination) => {
    if (source.includes('.tmp.') && destination === targetDir) {
      const error = new Error('Simulated destination collision');
      error.code = 'EPERM';
      throw error;
    }
    return fs.renameSync(source, destination);
  };

  try {
    assert.throws(() => writeStateToDiskAtomic(targetDir, { current: true }, failFirstRename), /Simulated destination collision/);
    assert.strictEqual(fs.readFileSync(marker, 'utf8'), 'keep');
    assert.deepStrictEqual(fs.readdirSync(destDir), ['state.json']);
    assert.deepStrictEqual(fs.readdirSync(targetDir), ['keep.txt']);
  } finally {
    fs.rmSync(destDir, { recursive: true, force: true });
  }
})) passed++; else failed++;

if (test('recovers a valid state backup after replacement and restoration both fail', () => {
  const destDir = fs.mkdtempSync(path.join(tmpRoot, 'gateguard-atomic-recover-'));
  const targetFile = path.join(destDir, 'state.json');
  fs.writeFileSync(targetFile, JSON.stringify({ checked: ['/src/prior.js'] }), 'utf8');
  let destinationRenameAttempts = 0;
  const failReplacementAndRestore = (source, destination) => {
    if (source.includes('.tmp.') && destination === targetFile) {
      destinationRenameAttempts += 1;
      const error = new Error(`Simulated replacement failure ${destinationRenameAttempts}`);
      error.code = 'EPERM';
      throw error;
    }
    if (source.includes('.backup.') && destination === targetFile) {
      const error = new Error('Simulated backup restore failure');
      error.code = 'EIO';
      throw error;
    }
    return fs.renameSync(source, destination);
  };

  try {
    assert.throws(
      () => writeStateToDiskAtomic(targetFile, { checked: ['/src/current.js'] }, failReplacementAndRestore),
      /prior state is preserved at/
    );
    assert.strictEqual(fs.existsSync(targetFile), false);
    assert.strictEqual(restoreStateBackup(targetFile), true);
    assert.deepStrictEqual(JSON.parse(fs.readFileSync(targetFile, 'utf8')), { checked: ['/src/prior.js'] });
  } finally {
    fs.rmSync(destDir, { recursive: true, force: true });
  }
})) passed++; else failed++;

// Cleanup
clearState();
if (fs.existsSync(stateDir)) {
  fs.rmSync(stateDir, { recursive: true, force: true });
}

console.log(`\nEvidence Ledger test summary: Passed: ${passed}, Failed: ${failed}`);
process.exit(failed > 0 ? 1 : 0);
