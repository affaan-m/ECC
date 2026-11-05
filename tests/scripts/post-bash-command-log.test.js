const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const scriptPath = path.join(__dirname, '..', '..', 'scripts', 'hooks', 'post-bash-command-log.js');
const { sanitizeCommand } = require(scriptPath);

function test(name, fn) {
  try {
    fn();
    console.log(`PASS: ${name}`);
    return true;
  } catch (error) {
    console.log(`FAIL: ${name}`);
    console.log(`  ${error.message}`);
    return false;
  }
}

function runHook(mode, payload, homeDir) {
  return spawnSync('node', [scriptPath, mode], {
    input: JSON.stringify(payload),
    encoding: 'utf8',
    env: {
      ...process.env,
      HOME: homeDir,
      USERPROFILE: homeDir,
    },
  });
}

let passed = 0;
let failed = 0;

if (
  test('sanitizeCommand redacts common secret formats', () => {
    const input = 'gh pr create --token abc123 Authorization: Bearer hello password=swordfish ghp_abc github_pat_xyz';
    const sanitized = sanitizeCommand(input);
    assert.ok(!sanitized.includes('abc123'));
    assert.ok(!sanitized.includes('swordfish'));
    assert.ok(!sanitized.includes('ghp_abc'));
    assert.ok(!sanitized.includes('github_pat_xyz'));
    assert.ok(sanitized.includes('--token=<REDACTED>'));
    assert.ok(sanitized.includes('Authorization:<REDACTED>'));
    assert.ok(sanitized.includes('password=<REDACTED>'));
  })
)
  passed++;
else failed++;

// Synthetic secrets, assembled at runtime so secret scanners do not flag
// this file. None of these are real credentials.
const FAKE_ANTHROPIC_KEY = ['sk', 'ant', 'api03', 'FAKEFAKEFAKEFAKEFAKEFAKEFAKE_x-y'].join('-');
const FAKE_OPENAI_KEY = ['sk', 'proj', 'FAKEfakeFAKEfakeFAKEfakeFAKE'].join('-');
const FAKE_JWT = ['eyJhbGciOiJIUzI1NiJ9', 'eyJzdWIiOiJmYWtlIn0', 'ZmFrZXNpZ25hdHVyZQ'].join('.');
const PEM_BEGIN = ['-----BEGIN', 'PRIVATE', 'KEY-----'].join(' ');
const PEM_END = ['-----END', 'PRIVATE', 'KEY-----'].join(' ');
const FAKE_VALUE = ['not', 'a', 'real', 'value'].join('-');

if (
  test('sanitizeCommand redacts bare sk- API keys wherever they appear (#3846)', () => {
    const commands = [
      `ANTHROPIC_API_KEY=${FAKE_ANTHROPIC_KEY} claude -p hi`,
      `curl -H "x-api-key: ${FAKE_ANTHROPIC_KEY}" https://api.example.com`,
      `echo ${FAKE_ANTHROPIC_KEY} > key.txt`,
      `OPENAI_API_KEY=${FAKE_OPENAI_KEY} node app.js`,
    ];
    for (const command of commands) {
      const sanitized = sanitizeCommand(command);
      assert.ok(!sanitized.includes('FAKEFAKE'), `key leaked: ${sanitized}`);
      assert.ok(!sanitized.includes('FAKEfake'), `key leaked: ${sanitized}`);
      assert.ok(sanitized.includes('<REDACTED>'), `no redaction marker: ${sanitized}`);
    }
    assert.strictEqual(sanitizeCommand(`echo ${FAKE_ANTHROPIC_KEY} > key.txt`), 'echo <REDACTED> > key.txt');
  })
)
  passed++;
else failed++;

if (
  test('sanitizeCommand redacts JWTs and PEM private key blocks (#3846)', () => {
    assert.strictEqual(sanitizeCommand(`export TOKEN_VALUE=${FAKE_JWT}`), 'export TOKEN_VALUE=<REDACTED>');

    const pem = `printf '${PEM_BEGIN}\nMIIEvQIBADANBgkqhkiG9w0BAQEFAASC\n${PEM_END}' > id_rsa`;
    const sanitizedPem = sanitizeCommand(pem);
    assert.ok(!sanitizedPem.includes('MIIEvQ'), sanitizedPem);
    assert.strictEqual(sanitizedPem, "printf '<REDACTED>' > id_rsa");

    const truncated = sanitizeCommand(`echo "${PEM_BEGIN}\nMIIEvQIBADANBgkqhkiG9w0BAQEFAASC`);
    assert.ok(!truncated.includes('MIIEvQ'), truncated);
  })
)
  passed++;
else failed++;

if (
  test('sanitizeCommand redacts JWTs whose header has whitespace after the brace', () => {
    const spacedHeader = Buffer.from('{ "alg": "HS256" }').toString('base64url');
    const newlineHeader = Buffer.from('{\n"alg":"HS256"}').toString('base64url');
    assert.ok(spacedHeader.startsWith('eyA'), spacedHeader);
    assert.ok(newlineHeader.startsWith('ew'), newlineHeader);
    for (const header of [spacedHeader, newlineHeader]) {
      const token = [header, 'eyJzdWIiOiJmYWtlIn0', 'ZmFrZXNpZ25hdHVyZQ'].join('.');
      assert.strictEqual(sanitizeCommand(`export TOKEN_VALUE=${token}`), 'export TOKEN_VALUE=<REDACTED>');
    }

    // Same shape, but the first segment does not decode to a JWT header.
    const notJwt = 'eyesightdata.example.com';
    assert.strictEqual(sanitizeCommand(`ping ${notJwt}`), `ping ${notJwt}`);
  })
)
  passed++;
else failed++;

if (
  test('sanitizeCommand redacts whole quoted assignment values, including escapes', () => {
    assert.strictEqual(
      sanitizeCommand(`app --secret="first\\"${FAKE_VALUE}" --next`),
      'app --secret=<REDACTED> --next'
    );
    assert.strictEqual(
      sanitizeCommand(`app --secret=$'first\\'${FAKE_VALUE}' --next`),
      'app --secret=<REDACTED> --next'
    );
    assert.strictEqual(sanitizeCommand(`app --secret=first\\"${FAKE_VALUE} --next`), 'app --secret=<REDACTED> --next');
    assert.strictEqual(sanitizeCommand(`app --secret="${FAKE_VALUE} unterminated`), 'app --secret=<REDACTED>');
  })
)
  passed++;
else failed++;

if (
  test('sanitizeCommand redacts the whole Bash word when fragments are joined', () => {
    const tail = ['suffix', 'tail', '123'].join('');
    const commands = [
      `app --secret='prefix-'${tail} --next`,
      `app --secret=prefix-"${tail} two" --next`,
      `app --secret=first\\ ${tail} --next`,
      `app --secret=${FAKE_VALUE}\\`,
    ];
    for (const command of commands) {
      const sanitized = sanitizeCommand(command);
      assert.ok(!sanitized.includes(tail) && !sanitized.includes(FAKE_VALUE), `value leaked: ${sanitized}`);
    }
    assert.strictEqual(sanitizeCommand(commands[0]), 'app --secret=<REDACTED> --next');
  })
)
  passed++;
else failed++;

if (
  test('sanitizeCommand keeps the rest of the command when the keyword is searched for', () => {
    const commands = ['grep -n "secret =" settings.py', "rg 'api_key:' config/ --type yaml"];
    for (const command of commands) {
      assert.strictEqual(sanitizeCommand(command), command);
    }
    assert.strictEqual(
      sanitizeCommand(`curl -H "x-api-key: ${FAKE_VALUE}" -d "payload" https://api.example.com`),
      'curl -H "x-api-key: <REDACTED>" -d "payload" https://api.example.com'
    );
  })
)
  passed++;
else failed++;

if (
  test('sanitizeCommand redacts JWTs joined to a hyphenated prefix', () => {
    assert.strictEqual(
      sanitizeCommand(`curl --cookie "session=jwt-${FAKE_JWT}" https://example.com`),
      'curl --cookie "session=jwt-<REDACTED>" https://example.com'
    );
    assert.strictEqual(sanitizeCommand(`echo prefix-${FAKE_JWT}`), 'echo prefix-<REDACTED>');
    assert.strictEqual(sanitizeCommand(`echo ey-${FAKE_JWT}`), 'echo ey-<REDACTED>');
    assert.strictEqual(sanitizeCommand(`open https://x.example.com/a.${FAKE_JWT}`), 'open https://x.example.com/a.<REDACTED>');
    assert.strictEqual(sanitizeCommand('ping eyesightdata.example.com'), 'ping eyesightdata.example.com');
  })
)
  passed++;
else failed++;

if (
  test('sanitizeCommand stays linear on long ey- runs followed by dots', () => {
    const start = Date.now();
    sanitizeCommand(`${'ey-'.repeat(300000)}x.y.z`);
    sanitizeCommand(`${'ew-'.repeat(300000)}x.y.z`);
    sanitizeCommand('ey-ey-ey-ey.'.repeat(80000));
    const elapsed = Date.now() - start;
    assert.ok(elapsed < 2000, `took ${elapsed} ms`);
  })
)
  passed++;
else failed++;

if (
  test('sanitizeCommand stays linear on long dot-free ey- runs', () => {
    const start = Date.now();
    sanitizeCommand('ey-'.repeat(350000));
    sanitizeCommand('eyJ-'.repeat(250000));
    const elapsed = Date.now() - start;
    assert.ok(elapsed < 2000, `took ${elapsed} ms`);
  })
)
  passed++;
else failed++;

if (
  test('sanitizeCommand redacts secret= and api_key= assignments (#3846)', () => {
    assert.strictEqual(
      sanitizeCommand(`app --secret=${FAKE_VALUE} --api_key=${FAKE_VALUE} --api-key="${FAKE_VALUE} two"`),
      'app --secret=<REDACTED> --api_key=<REDACTED> --api-key=<REDACTED>'
    );
    assert.strictEqual(sanitizeCommand(`CLIENT_SECRET=${FAKE_VALUE} run`), 'CLIENT_SECRET=<REDACTED> run');
    assert.strictEqual(
      sanitizeCommand(`curl -H "x-api-key: ${FAKE_VALUE}" https://api.example.com`),
      'curl -H "x-api-key: <REDACTED>" https://api.example.com'
    );
  })
)
  passed++;
else failed++;

if (
  test('sanitizeCommand leaves ordinary commands untouched', () => {
    const commands = [
      'gh secret set DEPLOY_KEY --repo owner/name',
      'git commit -m "rotate the secret handling"',
      'npm run task-runner-with-a-very-long-script-name',
      'cat config/api_key.example.json',
      'grep -rn "eyJ" src/',
    ];
    for (const command of commands) {
      assert.strictEqual(sanitizeCommand(command), command);
    }
  })
)
  passed++;
else failed++;

if (
  test('audit mode does not write bare API keys to the log (#3846)', () => {
    const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-bash-log-'));
    const payload = {
      tool_input: {
        command: `echo ${FAKE_ANTHROPIC_KEY} > key.txt`,
      },
    };

    try {
      const result = runHook('audit', payload, homeDir);
      assert.strictEqual(result.status, 0, result.stdout + result.stderr);

      const logContent = fs.readFileSync(path.join(homeDir, '.claude', 'bash-commands.log'), 'utf8');
      assert.ok(logContent.includes('echo <REDACTED> > key.txt'), logContent);
      assert.ok(!logContent.includes(FAKE_ANTHROPIC_KEY), logContent);
    } finally {
      fs.rmSync(homeDir, { recursive: true, force: true });
    }
  })
)
  passed++;
else failed++;

if (
  test('audit mode logs sanitized bash commands and preserves stdout', () => {
    const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-bash-log-'));
    const payload = {
      tool_input: {
        command: 'git push --token abc123',
      },
    };

    try {
      const result = runHook('audit', payload, homeDir);
      assert.strictEqual(result.status, 0, result.stdout + result.stderr);
      assert.strictEqual(result.stdout, JSON.stringify(payload));

      const logFile = path.join(homeDir, '.claude', 'bash-commands.log');
      const logContent = fs.readFileSync(logFile, 'utf8');
      assert.ok(logContent.includes('--token=<REDACTED>'));
      assert.ok(!logContent.includes('abc123'));
    } finally {
      fs.rmSync(homeDir, { recursive: true, force: true });
    }
  })
)
  passed++;
else failed++;

if (
  test('cost mode writes command metrics log', () => {
    const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-cost-log-'));
    const payload = {
      tool_input: {
        command: 'npm publish',
      },
    };

    try {
      const result = runHook('cost', payload, homeDir);
      assert.strictEqual(result.status, 0, result.stdout + result.stderr);

      const logFile = path.join(homeDir, '.claude', 'cost-tracker.log');
      const logContent = fs.readFileSync(logFile, 'utf8');
      assert.match(logContent, /tool=Bash command=npm publish/);
    } finally {
      fs.rmSync(homeDir, { recursive: true, force: true });
    }
  })
)
  passed++;
else failed++;

console.log(`\nPassed: ${passed}`);
console.log(`Failed: ${failed}`);
process.exit(failed > 0 ? 1 : 0);
