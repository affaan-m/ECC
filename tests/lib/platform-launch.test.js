'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { openBrowser, openerCommandFor } = require('../../scripts/lib/platform-launch');

// These values are private fixtures; no test reads or changes process.env.
const privateEnvironment = Object.freeze({
  Path: '/synthetic/bin', ECC_BROWSER_URL: 'old-upper',
  ecc_browser_url: 'old-lower', EcC_BrOwSeR_Url: 'old-mixed', FIXTURE_VALUE: 'keep',
});
const expectedWindowsScript = `$ErrorActionPreference = 'Stop'
try {
  $value = [System.Environment]::GetEnvironmentVariable('ECC_BROWSER_URL', 'Process')
  [System.Environment]::SetEnvironmentVariable('ECC_BROWSER_URL', $null, 'Process')
  $uri = $null
  if (-not [System.Uri]::TryCreate($value, [System.UriKind]::Absolute, [ref]$uri) -or @('http', 'https') -notcontains $uri.Scheme -or $uri.UserInfo) { exit 1 }
  $info = New-Object System.Diagnostics.ProcessStartInfo
  $info.FileName = $value
  $info.UseShellExecute = $true
  [void][System.Diagnostics.Process]::Start($info)
} catch { exit 1 }
`;

function fakeChild() {
  return { on() {}, unref() {} };
}

function captureLaunch(url, platform) {
  const calls = [];
  const result = openBrowser(url, platform, (command, args, options) => {
    calls.push({ command, args, options });
    return fakeChild();
  }, privateEnvironment);
  return { result, calls };
}

test('openerCommandFor: darwin returns open', () => {
  assert.deepEqual(openerCommandFor('darwin', 'http://x'), ['open', ['http://x']]);
});

test('openerCommandFor: win32 returns a static encoded PowerShell command', () => {
  const [command, args] = openerCommandFor('win32', 'http://x');
  assert.equal(command, 'powershell.exe');
  assert.deepEqual(args.slice(0, 4), ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand']);
  assert.equal(args.length, 5);
  assert.equal(Buffer.from(args[4], 'base64').toString('utf16le'), expectedWindowsScript);
});

test('openerCommandFor: linux returns xdg-open', () => {
  assert.deepEqual(openerCommandFor('linux', 'http://x'), ['xdg-open', ['http://x']]);
});

test('openerCommandFor: unknown falls through to xdg-open', () => {
  assert.deepEqual(openerCommandFor('freebsd', 'http://x'), ['xdg-open', ['http://x']]);
});

test('openBrowser: invalid url returns invalid-url without spawning', () => {
  let calls = 0;
  const launch = () => { calls += 1; };
  assert.deepEqual(openBrowser('', 'linux', launch), { opened: false, reason: 'invalid-url' });
  assert.deepEqual(openBrowser(null, 'linux', launch), { opened: false, reason: 'invalid-url' });
  assert.equal(calls, 0);
});

test('openBrowser: reports synchronous launcher failures', () => {
  const withCode = () => { throw Object.assign(new Error('missing launcher'), { code: 'ENOENT' }); };
  const withoutCode = () => { throw new Error('launcher failed'); };
  assert.deepEqual(openBrowser('http://localhost:0', 'linux', withCode), {
    opened: false, reason: 'spawn-threw:ENOENT',
  });
  assert.deepEqual(openBrowser('http://localhost:0', 'linux', withoutCode), {
    opened: false, reason: 'spawn-threw:unknown',
  });
});

test('openBrowser: installs an error listener and detaches the launcher', () => {
  const handlers = new Map();
  let unrefCalls = 0;
  let launchCalls = 0;
  const child = {
    on(event, listener) {
      handlers.set(event, listener);
    },
    unref() {
      assert.equal(typeof handlers.get('error'), 'function', 'listen before detaching');
      unrefCalls += 1;
    },
  };

  const result = openBrowser('http://localhost:0', 'linux', (command, args, options) => {
    launchCalls += 1;
    assert.equal(command, 'xdg-open');
    assert.deepEqual(args, ['http://localhost:0/']);
    assert.deepEqual(options, { detached: true, stdio: 'ignore', shell: false });
    return child;
  });

  assert.deepEqual(result, { opened: true, reason: 'spawned' });
  assert.equal(launchCalls, 1);
  assert.equal(unrefCalls, 1);
  assert.equal(typeof handlers.get('error'), 'function');
  assert.doesNotThrow(() => handlers.get('error')({ code: 'ENOENT' }));
});

test('openBrowser: a detach failure does not escape after the listener is installed', () => {
  let listener;
  const result = openBrowser('http://localhost:0', 'linux', () => ({
    on(event, callback) {
      assert.equal(event, 'error');
      listener = callback;
    },
    unref() {
      assert.equal(typeof listener, 'function');
      throw new Error('cannot detach');
    },
  }));
  assert.deepEqual(result, { opened: true, reason: 'spawned' });
  assert.doesNotThrow(() => listener({ code: 'EACCES' }));
});


for (const [name, value] of [
  ['empty', ''], ['null', null], ['undefined', undefined], ['number', 42],
  ['boolean', true], ['array', ['https://example.test']],
  ['boxed string', Object('https://example.test')],
  ['object', { toString() { throw new Error('must not coerce'); } }],
  ['leading whitespace', ' https://example.test'],
  ['trailing whitespace', 'https://example.test '],
  ['tab', 'https://example.test/\tdata'],
  ['newline', 'https://example.test/\ndata'],
  ['carriage return', 'https://example.test/\rdata'],
  ['NUL', 'https://example.test/\u0000data'],
  ['DEL', 'https://example.test/\u007fdata'],
  ['backslash', 'https://example.test/\\data'],
  ['relative', '/example'], ['protocol relative', '//example.test'],
  ['javascript', 'javascript:alert(1)'], ['data', 'data:text/plain,hello'],
  ['file', 'file:///tmp/example'], ['custom protocol', 'app://example'],
  ['missing host', 'https://'], ['missing double slash', 'https:example.test'],
  ['credentials', 'https://user:password@example.test'],
  ['username', 'https://user@example.test'], ['password only', 'https://:password@example.test'],
  ['invalid port', 'https://example.test:65536/'],
  ['invalid IPv6', 'http://::1:3000/'], ['invalid host', 'https://exa mple.test/'],
]) {
  test(`openBrowser: rejects ${name} before every platform dispatch`, () => {
    for (const platform of ['win32', 'darwin', 'linux']) {
      const { result, calls } = captureLaunch(value, platform);
      assert.deepEqual(result, { opened: false, reason: 'invalid-url' });
      assert.equal(calls.length, 0);
    }
  });
}

test('openBrowser: rejects every raw ASCII control byte without coercion', () => {
  for (let code = 0; code < 32; code += 1) {
    const { result, calls } = captureLaunch(`https://example.test/a${String.fromCharCode(code)}b`, 'win32');
    assert.deepEqual(result, { opened: false, reason: 'invalid-url' });
    assert.equal(calls.length, 0);
  }
});

for (const [input, normalized] of [
  ['http://localhost:0', 'http://localhost:0/'],
  ['HTTP://127.0.0.1:3000/test?q=1#frag', 'http://127.0.0.1:3000/test?q=1#frag'],
  ['https://[::1]:443', 'https://[::1]/'],
  ['HTTPS://EXAMPLE.TEST:443', 'https://example.test/'],
  ['https://example.test/a%20b?q=a&x=b#fragment', 'https://example.test/a%20b?q=a&x=b#fragment'],
  ['https://b\u00fccher.example/caf\u00e9', 'https://xn--bcher-kva.example/caf%C3%A9'],
]) {
  test(`openBrowser: normalizes an accepted HTTP/S URL on every platform (${input})`, () => {
    for (const platform of ['darwin', 'linux', 'freebsd', 'win32']) {
      const { result, calls } = captureLaunch(input, platform);
      assert.deepEqual(result, { opened: true, reason: 'spawned' });
      assert.equal(calls.length, 1);
      const { command, args, options } = calls[0];
      assert.equal(options.shell, false);
      assert.equal(options.detached, true);
      assert.equal(options.stdio, 'ignore');
      assert.notEqual(options.windowsVerbatimArguments, true);
      if (platform === 'win32') {
        assert.equal(command, 'powershell.exe');
        assert.equal(options.env.ECC_BROWSER_URL, normalized);
        assert.equal(options.windowsHide, true);
      } else {
        assert.equal(command, platform === 'darwin' ? 'open' : 'xdg-open');
        assert.deepEqual(args, [normalized]);
        assert.equal(Object.hasOwn(options, 'env'), false);
      }
    }
  });
}

test('openBrowser: different untrusted URL data leaves Windows code and argv identical', () => {
  const inputs = [
    'https://example.test/?left=1&right=2',
    `https://example.test/?q="';$(Get-Process);&next=%COMSPEC%&name=caf\u00e9`,
    'https://example.test/?q=%22%26%0d%0a&next=https%3A%2F%2Fexample.test',
  ];
  let firstArgs;
  for (const input of inputs) {
    const { result, calls } = captureLaunch(input, 'win32');
    assert.deepEqual(result, { opened: true, reason: 'spawned' });
    assert.equal(calls.length, 1);
    const { command, args, options } = calls[0];
    assert.equal(command, 'powershell.exe');
    assert.deepEqual(args.slice(0, 4), ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand']);
    assert.equal(args.length, 5);
    assert.equal(Buffer.from(args[4], 'base64').toString('utf16le'), expectedWindowsScript);
    assert.ok(!args.some(arg => arg.includes(input)));
    if (firstArgs) assert.deepEqual(args, firstArgs);
    else firstArgs = args;
    assert.equal(options.env.ECC_BROWSER_URL, new URL(input).href);
    assert.equal(options.shell, false);
  }
  assert.doesNotMatch(expectedWindowsScript, /Invoke-Expression|Start-Process|\.Arguments|cmd|ExecutionPolicy/);
  assert.ok(expectedWindowsScript.indexOf('::SetEnvironmentVariable') < expectedWindowsScript.indexOf('::Start($info)'));
});

test('openBrowser: Windows child environment removes case-insensitive aliases without mutation', () => {
  const before = { ...privateEnvironment };
  const { calls } = captureLaunch('https://example.test/', 'win32');
  assert.equal(calls.length, 1);
  const childEnvironment = calls[0].options.env;
  assert.notEqual(childEnvironment, privateEnvironment);
  assert.deepEqual(Object.keys(childEnvironment).filter(key => key.toLowerCase() === 'ecc_browser_url'), ['ECC_BROWSER_URL']);
  assert.equal(childEnvironment.ECC_BROWSER_URL, 'https://example.test/');
  assert.equal(childEnvironment.Path, before.Path);
  assert.equal(childEnvironment.FIXTURE_VALUE, before.FIXTURE_VALUE);
  assert.deepEqual(privateEnvironment, before);
});

test('openBrowser: default platform still uses the injected launcher and private environment', () => {
  const { result, calls } = captureLaunch('https://example.test', undefined);
  assert.deepEqual(result, { opened: true, reason: 'spawned' });
  assert.equal(calls.length, 1);
  assert.deepEqual([calls[0].command, calls[0].args], openerCommandFor(process.platform, 'https://example.test/'));
});

for (const [error, reason] of [
  [{ code: 'EACCES' }, 'child-error:EACCES'],
  [new Error('no code'), 'child-error:spawn-error'],
]) {
  test(`openBrowser: captures an already-signalled child failure (${reason})`, () => {
    let unrefCalls = 0;
    const result = openBrowser('https://example.test/', 'win32', () => ({
      on(event, listener) { assert.equal(event, 'error'); listener(error); },
      unref() { unrefCalls += 1; },
    }), privateEnvironment);
    assert.deepEqual(result, { opened: false, reason });
    assert.equal(unrefCalls, 1);
  });
}
