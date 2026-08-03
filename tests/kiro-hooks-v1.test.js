/**
 * Kiro v1 JSON Hook Tests
 *
 * Validates:
 * 1. Schema compliance — every JSON hook parses and has required v1 fields
 * 2. Fresh install — install.sh copies all JSON hooks (not legacy .kiro.hook files)
 * 3. Matcher correctness — positive and negative test cases for regex matchers
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const KIRO_HOOKS_DIR = path.join(__dirname, '..', '.kiro', 'hooks');
const INSTALL_SCRIPT = path.join(__dirname, '..', '.kiro', 'install.sh');

// ─── v1 Schema Definition ─────────────────────────────────────────────────────

const VALID_TRIGGERS = [
    'PreToolUse',
    'PostToolUse',
    'SessionStart',
    'Stop',
    'UserPromptSubmit',
    'PreTaskExec',
    'PostTaskExec',
    'PostFileCreate',
    'PostFileSave',
    'PostFileDelete',
];

const VALID_ACTION_TYPES = ['agent', 'command'];

const EXPECTED_HOOK_COUNT = 13;

// ─── Helpers ───────────────────────────────────────────────────────────────────

function getJsonHookFiles() {
    return fs.readdirSync(KIRO_HOOKS_DIR)
        .filter(f => f.endsWith('.json'))
        .map(f => path.join(KIRO_HOOKS_DIR, f));
}

function createTempDir(prefix) {
    return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function cleanup(dirPath) {
    fs.rmSync(dirPath, { recursive: true, force: true });
}

function loadMatcher(hookFileName) {
    const filePath = path.join(KIRO_HOOKS_DIR, hookFileName);
    const hook = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return hook.hooks[0].matcher;
}

function test(name, fn) {
    try {
        fn();
        process.stdout.write(`  \u2713 ${name}\n`);
        return true;
    } catch (error) {
        process.stdout.write(`  \u2717 ${name}\n`);
        process.stdout.write(`    Error: ${error.message}\n`);
        return false;
    }
}

// ─── Schema Validation Tests ───────────────────────────────────────────────────

function runSchemaTests() {
    console.log('\n=== v1 JSON Hook Schema Validation ===\n');

    let passed = 0;
    let failed = 0;

    const hookFiles = getJsonHookFiles();

    if (test(`discovers all ${EXPECTED_HOOK_COUNT} JSON hook files`, () => {
        assert.strictEqual(hookFiles.length, EXPECTED_HOOK_COUNT,
            `Expected ${EXPECTED_HOOK_COUNT} JSON hook files, found ${hookFiles.length}: ${hookFiles.map(f => path.basename(f)).join(', ')}`);
    })) passed++; else failed++;

    for (const filePath of hookFiles) {
        const fileName = path.basename(filePath);

        if (test(`${fileName}: valid JSON`, () => {
            const content = fs.readFileSync(filePath, 'utf8');
            JSON.parse(content); // throws on invalid JSON
        })) passed++; else failed++;

        if (test(`${fileName}: has version "v1"`, () => {
            const hook = JSON.parse(fs.readFileSync(filePath, 'utf8'));
            assert.strictEqual(hook.version, 'v1', `Expected version "v1", got "${hook.version}"`);
        })) passed++; else failed++;

        if (test(`${fileName}: has non-empty hooks array`, () => {
            const hook = JSON.parse(fs.readFileSync(filePath, 'utf8'));
            assert.ok(Array.isArray(hook.hooks), 'hooks must be an array');
            assert.ok(hook.hooks.length > 0, 'hooks array must not be empty');
        })) passed++; else failed++;

        if (test(`${fileName}: each hook has required fields`, () => {
            const hook = JSON.parse(fs.readFileSync(filePath, 'utf8'));
            for (const h of hook.hooks) {
                assert.ok(typeof h.name === 'string' && h.name.length > 0, 'name must be a non-empty string');
                assert.ok(typeof h.trigger === 'string', 'trigger must be a string');
                assert.ok(VALID_TRIGGERS.includes(h.trigger),
                    `trigger "${h.trigger}" not in valid set: ${VALID_TRIGGERS.join(', ')}`);
                assert.ok(typeof h.action === 'object' && h.action !== null, 'action must be an object');
                assert.ok(VALID_ACTION_TYPES.includes(h.action.type),
                    `action.type "${h.action.type}" not in valid set: ${VALID_ACTION_TYPES.join(', ')}`);
                assert.ok(typeof h.enabled === 'boolean', 'enabled must be a boolean');

                // Validate action content
                if (h.action.type === 'agent') {
                    assert.ok(typeof h.action.prompt === 'string' && h.action.prompt.length > 0,
                        'agent action must have a non-empty prompt');
                }
                if (h.action.type === 'command') {
                    assert.ok(typeof h.action.command === 'string' && h.action.command.length > 0,
                        'command action must have a non-empty command');
                }
            }
        })) passed++; else failed++;

        if (test(`${fileName}: matcher (if present) is a valid regex`, () => {
            const hook = JSON.parse(fs.readFileSync(filePath, 'utf8'));
            for (const h of hook.hooks) {
                if (h.matcher !== undefined) {
                    assert.ok(typeof h.matcher === 'string', 'matcher must be a string');
                    // Verify it compiles as a regex
                    new RegExp(h.matcher);
                }
            }
        })) passed++; else failed++;
    }

    return { passed, failed };
}

// ─── Fresh Install Tests ───────────────────────────────────────────────────────

function runInstallTests() {
    console.log('\n=== Fresh Install Smoke Tests ===\n');

    let passed = 0;
    let failed = 0;

    if (process.platform === 'win32') {
        console.log('  - skipped on Windows (install.sh is bash-only)');
        return { passed, failed };
    }

    if (test('fresh install copies all JSON hook files to target', () => {
        const targetDir = createTempDir('kiro-install-hooks-');

        try {
            execFileSync('bash', [INSTALL_SCRIPT, targetDir], {
                encoding: 'utf8',
                stdio: ['pipe', 'pipe', 'pipe'],
                timeout: 15000,
            });

            const installedHooks = fs.readdirSync(path.join(targetDir, '.kiro', 'hooks'));
            const jsonHooks = installedHooks.filter(f => f.endsWith('.json'));
            const legacyHooks = installedHooks.filter(f => f.endsWith('.kiro.hook'));

            assert.strictEqual(jsonHooks.length, EXPECTED_HOOK_COUNT,
                `Expected ${EXPECTED_HOOK_COUNT} JSON hooks installed, got ${jsonHooks.length}: ${jsonHooks.join(', ')}`);
            assert.strictEqual(legacyHooks.length, 0,
                `Expected 0 legacy .kiro.hook files installed, got ${legacyHooks.length}: ${legacyHooks.join(', ')}`);
        } finally {
            cleanup(targetDir);
        }
    })) passed++; else failed++;

    if (test('fresh install copies hooks README.md', () => {
        const targetDir = createTempDir('kiro-install-readme-');

        try {
            execFileSync('bash', [INSTALL_SCRIPT, targetDir], {
                encoding: 'utf8',
                stdio: ['pipe', 'pipe', 'pipe'],
                timeout: 15000,
            });

            const readmePath = path.join(targetDir, '.kiro', 'hooks', 'README.md');
            assert.ok(fs.existsSync(readmePath), 'README.md should be installed');

            const content = fs.readFileSync(readmePath, 'utf8');
            assert.ok(content.includes('"version": "v1"'), 'README should document v1 format');
            assert.ok(!content.includes('| `Manual`'), 'README should not list Manual as a supported trigger');
        } finally {
            cleanup(targetDir);
        }
    })) passed++; else failed++;

    if (test('fresh install does not overwrite existing hook files', () => {
        const targetDir = createTempDir('kiro-install-nooverwrite-');

        try {
            // Create existing hook with custom content
            fs.mkdirSync(path.join(targetDir, '.kiro', 'hooks'), { recursive: true });
            const existingHook = path.join(targetDir, '.kiro', 'hooks', 'auto-format.json');
            fs.writeFileSync(existingHook, '{"custom": true}');

            execFileSync('bash', [INSTALL_SCRIPT, targetDir], {
                encoding: 'utf8',
                stdio: ['pipe', 'pipe', 'pipe'],
                timeout: 15000,
            });

            const content = fs.readFileSync(existingHook, 'utf8');
            assert.strictEqual(content, '{"custom": true}',
                'Existing hook file should not be overwritten');
        } finally {
            cleanup(targetDir);
        }
    })) passed++; else failed++;

    if (test('installed JSON hooks are valid v1 schema', () => {
        const targetDir = createTempDir('kiro-install-schema-');

        try {
            execFileSync('bash', [INSTALL_SCRIPT, targetDir], {
                encoding: 'utf8',
                stdio: ['pipe', 'pipe', 'pipe'],
                timeout: 15000,
            });

            const hooksDir = path.join(targetDir, '.kiro', 'hooks');
            const jsonFiles = fs.readdirSync(hooksDir).filter(f => f.endsWith('.json'));

            for (const fileName of jsonFiles) {
                const content = fs.readFileSync(path.join(hooksDir, fileName), 'utf8');
                const hook = JSON.parse(content);
                assert.strictEqual(hook.version, 'v1', `${fileName} should have version "v1"`);
                assert.ok(Array.isArray(hook.hooks), `${fileName} should have hooks array`);
            }
        } finally {
            cleanup(targetDir);
        }
    })) passed++; else failed++;

    return { passed, failed };
}

// ─── Matcher Tests ─────────────────────────────────────────────────────────────

function runMatcherTests() {
    console.log('\n=== Matcher Positive/Negative Tests ===\n');

    let passed = 0;
    let failed = 0;

    // security-check-on-create: loaded from hook JSON
    const securityMatcher = loadMatcher('security-check-on-create.json');

    if (test('security matcher: matches "src/auth/login.ts"', () => {
        assert.ok(new RegExp(securityMatcher).test('src/auth/login.ts'));
    })) passed++; else failed++;

    if (test('security matcher: matches "api/users.ts"', () => {
        assert.ok(new RegExp(securityMatcher).test('api/users.ts'));
    })) passed++; else failed++;

    if (test('security matcher: matches "src/middleware/cors.ts"', () => {
        assert.ok(new RegExp(securityMatcher).test('src/middleware/cors.ts'));
    })) passed++; else failed++;

    if (test('security matcher: matches "auth/" (root-level)', () => {
        assert.ok(new RegExp(securityMatcher).test('auth/'));
    })) passed++; else failed++;

    if (test('security matcher: does NOT match "authorization.ts"', () => {
        assert.ok(!new RegExp(securityMatcher).test('authorization.ts'));
    })) passed++; else failed++;

    if (test('security matcher: does NOT match "src/authorization/token.ts"', () => {
        assert.ok(!new RegExp(securityMatcher).test('src/authorization/token.ts'));
    })) passed++; else failed++;

    if (test('security matcher: does NOT match "rapid-api-client.js"', () => {
        assert.ok(!new RegExp(securityMatcher).test('rapid-api-client.js'));
    })) passed++; else failed++;

    if (test('security matcher: does NOT match "apiKey.ts"', () => {
        assert.ok(!new RegExp(securityMatcher).test('apiKey.ts'));
    })) passed++; else failed++;

    if (test('security matcher: does NOT match "src/middlewares/cors.ts"', () => {
        assert.ok(!new RegExp(securityMatcher).test('src/middlewares/cors.ts'));
    })) passed++; else failed++;

    // typecheck-on-edit: loaded from hook JSON
    const typecheckMatcher = loadMatcher('typecheck-on-edit.json');

    if (test('typecheck matcher: matches "src/index.ts"', () => {
        assert.ok(new RegExp(typecheckMatcher).test('src/index.ts'));
    })) passed++; else failed++;

    if (test('typecheck matcher: matches "App.tsx"', () => {
        assert.ok(new RegExp(typecheckMatcher).test('App.tsx'));
    })) passed++; else failed++;

    if (test('typecheck matcher: does NOT match "style.css"', () => {
        assert.ok(!new RegExp(typecheckMatcher).test('style.css'));
    })) passed++; else failed++;

    if (test('typecheck matcher: does NOT match "tsconfig.json"', () => {
        assert.ok(!new RegExp(typecheckMatcher).test('tsconfig.json'));
    })) passed++; else failed++;

    // doc-file-warning: loaded from hook JSON
    const docMatcher = loadMatcher('doc-file-warning.json');

    if (test('doc matcher: matches "README.md"', () => {
        assert.ok(new RegExp(docMatcher).test('README.md'));
    })) passed++; else failed++;

    if (test('doc matcher: matches "docs/guide.md"', () => {
        assert.ok(new RegExp(docMatcher).test('docs/guide.md'));
    })) passed++; else failed++;

    if (test('doc matcher: matches "src/CHANGELOG.md"', () => {
        assert.ok(new RegExp(docMatcher).test('src/CHANGELOG.md'));
    })) passed++; else failed++;

    if (test('doc matcher: does NOT match "src/readme.ts"', () => {
        // Note: README is case-sensitive in this regex
        assert.ok(!new RegExp(docMatcher).test('src/readme.ts'));
    })) passed++; else failed++;

    // git-push-review: loaded from hook JSON
    const gitPushMatcher = loadMatcher('git-push-review.json');

    if (test('git-push matcher: matches "execute_bash"', () => {
        assert.ok(new RegExp(gitPushMatcher).test('execute_bash'));
    })) passed++; else failed++;

    if (test('git-push matcher: does NOT match "read_file"', () => {
        assert.ok(!new RegExp(gitPushMatcher).test('read_file'));
    })) passed++; else failed++;

    // code-review-on-write: loaded from hook JSON
    const codeReviewMatcher = loadMatcher('code-review-on-write.json');

    if (test('code-review matcher: matches "fs_write"', () => {
        assert.ok(new RegExp(codeReviewMatcher).test('fs_write'));
    })) passed++; else failed++;

    if (test('code-review matcher: matches "str_replace"', () => {
        assert.ok(new RegExp(codeReviewMatcher).test('str_replace'));
    })) passed++; else failed++;

    if (test('code-review matcher: matches "fs_append"', () => {
        assert.ok(new RegExp(codeReviewMatcher).test('fs_append'));
    })) passed++; else failed++;

    if (test('code-review matcher: does NOT match "read_file"', () => {
        assert.ok(!new RegExp(codeReviewMatcher).test('read_file'));
    })) passed++; else failed++;

    return { passed, failed };
}

// ─── Main ──────────────────────────────────────────────────────────────────────

function runTests() {
    console.log('\n========================================');
    console.log(' Kiro v1 JSON Hook Migration Tests');
    console.log('========================================');

    const schema = runSchemaTests();
    const install = runInstallTests();
    const matchers = runMatcherTests();

    const totalPassed = schema.passed + install.passed + matchers.passed;
    const totalFailed = schema.failed + install.failed + matchers.failed;

    console.log('\n========================================');
    console.log(` Total: ${totalPassed} passed, ${totalFailed} failed`);
    console.log('========================================\n');

    process.exit(totalFailed > 0 ? 1 : 0);
}

runTests();
