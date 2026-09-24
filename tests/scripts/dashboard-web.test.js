/**
 * Tests for scripts/dashboard-web.js
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const net = require('net');

const SCRIPT = path.join(__dirname, '..', '..', 'scripts', 'dashboard-web.js');

let testRoot;
let testPassed = 0;
let testFailed = 0;
const asyncTests = [];
const REQUEST_TIMEOUT_MS = 5000;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    testPassed++;
    return true;
  } catch (error) {
    console.log(`  ✗ ${name}`);
    console.log(`    Error: ${error.message}`);
    testFailed++;
    return false;
  }
}

function asyncTest(name, fn) {
  asyncTests.push({ name, fn });
}

function createTempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function cleanup(dirPath) {
  fs.rmSync(dirPath, { recursive: true, force: true });
}

function withTempDir(prefix, fn) {
  const dirPath = createTempDir(prefix);
  try {
    return fn(dirPath);
  } finally {
    cleanup(dirPath);
  }
}

test('withTempDir removes temp directories when the callback throws', () => {
  let createdDir = '';
  assert.throws(() => {
    withTempDir('ecc-test-', dirPath => {
      createdDir = dirPath;
      assert.ok(fs.existsSync(createdDir));
      throw new Error('fixture failure');
    });
  }, /fixture failure/);

  assert.ok(createdDir);
  assert.ok(!fs.existsSync(createdDir));
});

function writeFile(rootDir, relativePath, content) {
  const targetPath = path.join(rootDir, relativePath);
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.writeFileSync(targetPath, content);
}

function requestDashboard(port, options = {}) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let request;
    const settle = (callback, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      callback(value);
    };
    const timeout = setTimeout(() => {
      const error = new Error(
        `Dashboard request timed out after ${REQUEST_TIMEOUT_MS}ms`
      );
      if (request) request.destroy();
      settle(reject, error);
    }, REQUEST_TIMEOUT_MS);

    request = http.request({
      host: '127.0.0.1',
      port,
      method: options.method || 'GET',
      path: options.path || '/',
      headers: options.headers || {},
      setHost: options.setHost !== false,
    }, (response) => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => {
        body += chunk;
      });
      response.on('error', error => settle(reject, error));
      response.on('end', () => {
        settle(resolve, {
          body,
          headers: response.headers,
          statusCode: response.statusCode,
        });
      });
    });
    request.on('error', error => settle(reject, error));
    request.end();
  });
}

function requestDashboardWithoutHost(port) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: '127.0.0.1', port });
    let raw = '';
    let settled = false;
    const settle = (callback, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      callback(value);
    };
    const timeout = setTimeout(() => {
      const error = new Error(
        `Host-less request timed out after ${REQUEST_TIMEOUT_MS}ms`
      );
      socket.destroy();
      settle(reject, error);
    }, REQUEST_TIMEOUT_MS);

    socket.setEncoding('utf8');
    socket.on('connect', () => {
      socket.write('GET / HTTP/1.0\r\n\r\n');
    });
    socket.on('data', (chunk) => {
      raw += chunk;
    });
    socket.on('end', () => {
      const [head, body = ''] = raw.split('\r\n\r\n');
      const lines = head.split('\r\n');
      const statusCode = Number.parseInt(lines[0].split(' ')[1], 10);
      const headers = {};
      for (const line of lines.slice(1)) {
        const separator = line.indexOf(':');
        if (separator < 1) continue;
        headers[line.slice(0, separator).toLowerCase()] = line.slice(separator + 1).trim();
      }
      settle(resolve, { body, headers, statusCode });
    });
    socket.on('error', error => settle(reject, error));
    socket.on('close', hadError => {
      if (!hadError && !settled) {
        settle(reject, new Error('Host-less request closed before completion'));
      }
    });
  });
}

async function withDashboardServer(fn, serverOptions = {}) {
  const { createDashboardServer } = require(SCRIPT);
  const testServer = createDashboardServer({
    host: '127.0.0.1',
    ...serverOptions,
  });
  await new Promise((resolve, reject) => {
    testServer.once('error', reject);
    testServer.listen(0, '127.0.0.1', () => {
      testServer.off('error', reject);
      resolve();
    });
  });

  try {
    await fn(testServer.address().port);
  } finally {
    await new Promise((resolve, reject) => {
      testServer.close(error => (error ? reject(error) : resolve()));
    });
  }
}

// ===================== parsePort =====================

test('parsePort returns 3456 for undefined', () => {
  const { parsePort } = require(SCRIPT);
  assert.strictEqual(parsePort(undefined), 3456);
});

test('parsePort returns numeric port for valid string', () => {
  const { parsePort } = require(SCRIPT);
  assert.strictEqual(parsePort('8080'), 8080);
  assert.strictEqual(parsePort('3456'), 3456);
});

test('parsePort returns numeric port for numeric input', () => {
  const { parsePort } = require(SCRIPT);
  assert.strictEqual(parsePort(8080), 8080);
});

test('parsePort returns 3456 for port below 1', () => {
  const { parsePort } = require(SCRIPT);
  assert.strictEqual(parsePort('-1'), 3456);
  assert.strictEqual(parsePort('0'), 3456);
});

test('parsePort returns 3456 for port above 65535', () => {
  const { parsePort } = require(SCRIPT);
  assert.strictEqual(parsePort('70000'), 3456);
  assert.strictEqual(parsePort('65536'), 3456);
});

test('parsePort accepts boundary ports 1 and 65535', () => {
  const { parsePort } = require(SCRIPT);
  assert.strictEqual(parsePort('1'), 1);
  assert.strictEqual(parsePort('65535'), 65535);
});

test('parsePort returns 3456 for non-numeric string', () => {
  const { parsePort } = require(SCRIPT);
  assert.strictEqual(parsePort('abc'), 3456);
  assert.strictEqual(parsePort(''), 3456);
});

// ===================== readFrontmatter =====================

test('readFrontmatter parses simple frontmatter', () => {
  const { readFrontmatter } = require(SCRIPT);
  testRoot = createTempDir('ecc-test-');
  writeFile(testRoot, 'test.md', [
    '---',
    'name: test-agent',
    'description: A test agent description',
    'model: claude-sonnet-4-6',
    '---',
    '# Body content',
    'This is the body.',
  ].join('\n'));

  const fm = readFrontmatter(path.join(testRoot, 'test.md'));
  assert.strictEqual(fm.name, 'test-agent');
  assert.strictEqual(fm.description, 'A test agent description');
  assert.strictEqual(fm.model, 'claude-sonnet-4-6');
  assert.ok(fm._body.includes('# Body content'));
  cleanup(testRoot);
});

test('readFrontmatter parses array tools field', () => {
  const { readFrontmatter } = require(SCRIPT);
  testRoot = createTempDir('ecc-test-');
  writeFile(testRoot, 'agent.md', [
    '---',
    'name: array-agent',
    'tools: [Bash, Read, Write]',
    '---',
    'body',
  ].join('\n'));

  const fm = readFrontmatter(path.join(testRoot, 'agent.md'));
  assert.strictEqual(fm.name, 'array-agent');
  assert.ok(Array.isArray(fm.tools));
  assert.deepStrictEqual(fm.tools, ['Bash', 'Read', 'Write']);
  cleanup(testRoot);
});

test('readFrontmatter preserves scoped tools in legacy flow sequences', () => {
  const { readFrontmatter } = require(SCRIPT);
  withTempDir('ecc-test-', tempDir => {
    writeFile(tempDir, 'agent.md', [
      '---',
      'name: scoped-agent',
      'tools: [Agent(worker, researcher), Read, Bash(git commit:*, git status:*)]',
      '---',
      'body',
    ].join('\n'));

    const fm = readFrontmatter(path.join(tempDir, 'agent.md'));
    assert.deepStrictEqual(fm.tools, [
      'Agent(worker, researcher)',
      'Read',
      'Bash(git commit:*, git status:*)',
    ]);
  });
});

test('readFrontmatter normalizes comma-separated scalar tools to an array', () => {
  const { readFrontmatter } = require(SCRIPT);
  testRoot = createTempDir('ecc-test-');
  writeFile(testRoot, 'agent.md', [
    '---',
    'name: test-agent',
    'tools: Bash, Read, Write',
    '---',
    '# Body',
  ].join('\n'));

  const fm = readFrontmatter(path.join(testRoot, 'agent.md'));
  assert.ok(Array.isArray(fm.tools));
  assert.deepStrictEqual(fm.tools, ['Bash', 'Read', 'Write']);
  cleanup(testRoot);
});

test('readFrontmatter handles quoted values', () => {
  const { readFrontmatter } = require(SCRIPT);
  testRoot = createTempDir('ecc-test-');
  writeFile(testRoot, 'test.md', [
    '---',
    'name: "quoted-name"',
    "description: 'single-quoted-desc'",
    '---',
    'body',
  ].join('\n'));

  const fm = readFrontmatter(path.join(testRoot, 'test.md'));
  assert.strictEqual(fm.name, 'quoted-name');
  assert.strictEqual(fm.description, 'single-quoted-desc');
  cleanup(testRoot);
});

test('readFrontmatter returns empty object for file without frontmatter', () => {
  const { readFrontmatter } = require(SCRIPT);
  testRoot = createTempDir('ecc-test-');
  writeFile(testRoot, 'no-fm.md', '# Just a heading\nNo frontmatter here.');

  const fm = readFrontmatter(path.join(testRoot, 'no-fm.md'));
  assert.deepStrictEqual(fm, {});
  cleanup(testRoot);
});

test('readFrontmatter returns empty object for missing file', () => {
  const { readFrontmatter } = require(SCRIPT);
  const fm = readFrontmatter('/nonexistent/path/test.md');
  assert.deepStrictEqual(fm, {});
});

// ===================== readSkill =====================

test('readSkill parses skill frontmatter and body', () => {
  const { readSkill } = require(SCRIPT);
  testRoot = createTempDir('ecc-test-');
  writeFile(testRoot, 'SKILL.md', [
    '---',
    'name: test-skill',
    'description: A test skill',
    '---',
    '# Skill Workflow',
    'Step 1: Do this.',
  ].join('\n'));

  const skill = readSkill(path.join(testRoot, 'SKILL.md'));
  assert.strictEqual(skill.d, 'A test skill');
  assert.ok(skill.b.includes('# Skill Workflow'));
  assert.ok(!skill.b.includes('---')); // frontmatter stripped from body
  cleanup(testRoot);
});

test('readSkill returns empty defaults for missing file', () => {
  const { readSkill } = require(SCRIPT);
  const skill = readSkill('/nonexistent/skill/SKILL.md');
  assert.strictEqual(skill.d, '');
  assert.strictEqual(skill.b, '');
});

// ===================== loadAgents =====================

test('loadAgents returns empty array for missing directory', () => {
  const { loadAgents } = require(SCRIPT);
  const agents = loadAgents('/nonexistent/path');
  assert.deepStrictEqual(agents, []);
});

test('loadAgents loads agent markdown files', () => {
  const { loadAgents } = require(SCRIPT);
  testRoot = createTempDir('ecc-test-');
  writeFile(testRoot, 'agents/typescript-reviewer.md', [
    '---',
    'name: typescript-reviewer',
    'description: Reviews TypeScript code',
    'model: claude-sonnet-4-6',
    'tools: Bash, Read, Write, Grep',
    '---',
    '# TypeScript Reviewer',
    'You are a TypeScript code reviewer.',
  ].join('\n'));
  writeFile(testRoot, 'agents/python-reviewer.md', [
    '---',
    'name: python-reviewer',
    'description: Reviews Python code',
    'model: claude-opus-4-8',
    'tools: Bash, Read',
    '---',
    '# Python Reviewer',
  ].join('\n'));

  const agents = loadAgents(testRoot);
  assert.strictEqual(agents.length, 2);
  assert.strictEqual(agents[0].n, 'python-reviewer'); // alphabetical sort
  assert.strictEqual(agents[1].n, 'typescript-reviewer');
  assert.strictEqual(agents[1].m, 'claude-sonnet-4-6');
  assert.strictEqual(agents[1].d, 'Reviews TypeScript code');
  assert.deepStrictEqual(agents[1].t, ['Bash', 'Read', 'Write', 'Grep']);
  assert.ok(agents[1].b.length > 0);
  cleanup(testRoot);
});

test('loadAgents defaults missing fields', () => {
  const { loadAgents } = require(SCRIPT);
  testRoot = createTempDir('ecc-test-');
  writeFile(testRoot, 'agents/minimal.md', [
    '# Minimal Agent',
    'No frontmatter at all.',
  ].join('\n'));

  const agents = loadAgents(testRoot);
  assert.strictEqual(agents.length, 1);
  assert.strictEqual(agents[0].n, 'minimal');
  assert.strictEqual(agents[0].m, 'default');
  assert.strictEqual(agents[0].d, '');
  assert.deepStrictEqual(agents[0].t, []);
  cleanup(testRoot);
});

test('loadAgents ignores non-markdown files', () => {
  const { loadAgents } = require(SCRIPT);
  testRoot = createTempDir('ecc-test-');
  writeFile(testRoot, 'agents/agent.md', '---\nname: real-agent\n---\nbody');
  writeFile(testRoot, 'agents/README.txt', 'not an agent');

  const agents = loadAgents(testRoot);
  assert.strictEqual(agents.length, 1);
  assert.strictEqual(agents[0].n, 'real-agent');
  cleanup(testRoot);
});

// ===================== loadSkills =====================

test('loadSkills returns empty array for missing directory', () => {
  const { loadSkills } = require(SCRIPT);
  const skills = loadSkills('/nonexistent/path');
  assert.deepStrictEqual(skills, []);
});

test('loadSkills loads skill directories with SKILL.md', () => {
  const { loadSkills } = require(SCRIPT);
  testRoot = createTempDir('ecc-test-');
  writeFile(testRoot, 'skills/seo-audit/SKILL.md', [
    '---',
    'name: seo-audit',
    'description: Full website SEO audit',
    '---',
    '# SEO Audit Workflow',
  ].join('\n'));
  writeFile(testRoot, 'skills/code-review/SKILL.md', [
    '---',
    'name: code-review',
    'description: Review code changes',
    '---',
    '# Code Review Workflow',
  ].join('\n'));

  const skills = loadSkills(testRoot);
  assert.strictEqual(skills.length, 2);
  assert.strictEqual(skills[0].n, 'code-review'); // alphabetical sort
  assert.strictEqual(skills[1].n, 'seo-audit');
  assert.strictEqual(skills[1].d, 'Full website SEO audit');
  assert.ok(skills[1].b.length > 0);
  cleanup(testRoot);
});

test('loadSkills ignores non-directories', () => {
  const { loadSkills } = require(SCRIPT);
  testRoot = createTempDir('ecc-test-');
  writeFile(testRoot, 'skills/README.md', 'no skill here');
  writeFile(testRoot, 'skills/real-skill/SKILL.md', '---\ndescription: A real skill\n---\nbody');

  const skills = loadSkills(testRoot);
  assert.strictEqual(skills.length, 1);
  assert.strictEqual(skills[0].n, 'real-skill');
  cleanup(testRoot);
});

// ===================== loadCommands =====================

test('loadCommands returns empty array for missing directory', () => {
  const { loadCommands } = require(SCRIPT);
  const commands = loadCommands('/nonexistent/path');
  assert.deepStrictEqual(commands, []);
});

test('loadCommands loads command markdown files with category detection', () => {
  const { loadCommands } = require(SCRIPT);
  testRoot = createTempDir('ecc-test-');
  writeFile(testRoot, 'commands/pr.md', [
    '---',
    'description: Create a pull request',
    '---',
    'body',
  ].join('\n'));
  writeFile(testRoot, 'commands/go-test.md', [
    '---',
    'description: Run Go tests',
    '---',
    'body',
  ].join('\n'));
  writeFile(testRoot, 'commands/unknown-cmd.md', [
    '---',
    'description: Some unknown command',
    '---',
    'body',
  ].join('\n'));

  const commands = loadCommands(testRoot);
  assert.strictEqual(commands.length, 3);

  const prCmd = commands.find(c => c.n === '/pr');
  assert.ok(prCmd);
  assert.strictEqual(prCmd.c, 'Git & PR');
  assert.strictEqual(prCmd.d, 'Create a pull request');

  const goCmd = commands.find(c => c.n === '/go-test');
  assert.ok(goCmd);
  assert.strictEqual(goCmd.c, 'Languages');

  const unknownCmd = commands.find(c => c.n === '/unknown-cmd');
  assert.ok(unknownCmd);
  assert.strictEqual(unknownCmd.c, 'Other');
  cleanup(testRoot);
});

// ===================== loadRules =====================

test('loadRules returns empty array for missing directory', () => {
  const { loadRules } = require(SCRIPT);
  const rules = loadRules('/nonexistent/path');
  assert.deepStrictEqual(rules, []);
});

test('loadRules loads language directories with rule files', () => {
  const { loadRules } = require(SCRIPT);
  testRoot = createTempDir('ecc-test-');
  writeFile(testRoot, 'rules/python/coding-style.md', '');
  writeFile(testRoot, 'rules/python/testing.md', '');
  writeFile(testRoot, 'rules/python/patterns.md', '');
  writeFile(testRoot, 'rules/typescript/coding-style.md', '');
  writeFile(testRoot, 'rules/typescript/testing.md', '');

  const rules = loadRules(testRoot);
  assert.strictEqual(rules.length, 2);

  const pyRules = rules.find(r => r.l === 'python');
  assert.ok(pyRules);
  assert.strictEqual(pyRules.f.length, 3);
  assert.ok(pyRules.f.includes('coding-style'));
  assert.ok(pyRules.f.includes('testing'));
  assert.ok(pyRules.f.includes('patterns'));

  const tsRules = rules.find(r => r.l === 'typescript');
  assert.ok(tsRules);
  assert.strictEqual(tsRules.f.length, 2);
  cleanup(testRoot);
});

test('loadRules ignores non-directories in rules folder', () => {
  const { loadRules } = require(SCRIPT);
  testRoot = createTempDir('ecc-test-');
  writeFile(testRoot, 'rules/README.md', 'no rules here');
  writeFile(testRoot, 'rules/go/testing.md', '');

  const rules = loadRules(testRoot);
  assert.strictEqual(rules.length, 1);
  assert.strictEqual(rules[0].l, 'go');
  assert.strictEqual(rules[0].f.length, 1);
  assert.strictEqual(rules[0].f[0], 'testing');
  cleanup(testRoot);
});

// ===================== loadMcps =====================

test('loadMcps returns empty array when no configs exist', () => {
  const { loadMcps } = require(SCRIPT);
  testRoot = createTempDir('ecc-test-');

  const mcps = loadMcps(testRoot);
  assert.deepStrictEqual(mcps, []);
  cleanup(testRoot);
});

test('loadMcps loads .mcp.json config', () => {
  const { loadMcps } = require(SCRIPT);
  testRoot = createTempDir('ecc-test-');
  writeFile(testRoot, '.mcp.json', JSON.stringify({
    mcpServers: {
      'test-server': {
        command: 'node',
        args: ['server.js'],
        env: { SECRET: 'real-secret' },
        type: 'stdio',
      },
    },
  }));

  const mcps = loadMcps(testRoot);
  assert.strictEqual(mcps.length, 1);
  assert.strictEqual(mcps[0].f, '.mcp.json');
  assert.strictEqual(mcps[0].s.length, 1);
  assert.strictEqual(mcps[0].s[0].n, 'test-server');
  assert.strictEqual(mcps[0].s[0].cmd, 'node');
  assert.deepStrictEqual(mcps[0].s[0].args, ['server.js']);
  assert.strictEqual(mcps[0].s[0].type, 'stdio');
  // Env vars should be masked
  assert.strictEqual(mcps[0].s[0].env.SECRET, '••••••');
  cleanup(testRoot);
});

test('loadMcps loads mcp-configs/ directory files', () => {
  const { loadMcps } = require(SCRIPT);
  testRoot = createTempDir('ecc-test-');
  writeFile(testRoot, 'mcp-configs/brave.json', JSON.stringify({
    mcpServers: {
      'brave-search': {
        command: 'npx',
        args: ['@anthropic/mcp-brave'],
        type: 'stdio',
      },
    },
  }));

  const mcps = loadMcps(testRoot);
  assert.strictEqual(mcps.length, 1);
  assert.strictEqual(mcps[0].f, 'brave.json');
  assert.strictEqual(mcps[0].s.length, 1);
  assert.strictEqual(mcps[0].s[0].n, 'brave-search');
  cleanup(testRoot);
});

test('loadMcps masks environment variables', () => {
  const { loadMcps } = require(SCRIPT);
  testRoot = createTempDir('ecc-test-');
  writeFile(testRoot, 'mcp-configs/with-env.json', JSON.stringify({
    mcpServers: {
      server: {
        command: 'python',
        env: { API_KEY: 'super-secret-key', DEBUG: 'true' },
      },
    },
  }));

  const mcps = loadMcps(testRoot);
  assert.strictEqual(mcps[0].s[0].env.API_KEY, '••••••');
  assert.strictEqual(mcps[0].s[0].env.DEBUG, '••••••');
  cleanup(testRoot);
});

test('loadMcps handles url-based MCP servers', () => {
  const { loadMcps } = require(SCRIPT);
  testRoot = createTempDir('ecc-test-');
  writeFile(testRoot, '.mcp.json', JSON.stringify({
    mcpServers: {
      'remote-server': {
        url: 'https://example.com/mcp',
        type: 'sse',
      },
    },
  }));

  const mcps = loadMcps(testRoot);
  assert.strictEqual(mcps[0].s[0].cmd, 'https://example.com/mcp');
  assert.strictEqual(mcps[0].s[0].type, 'sse');
  cleanup(testRoot);
});

test('loadMcps handles malformed JSON gracefully', () => {
  const { loadMcps } = require(SCRIPT);
  testRoot = createTempDir('ecc-test-');
  writeFile(testRoot, '.mcp.json', '{not valid json}');

  const mcps = loadMcps(testRoot);
  assert.deepStrictEqual(mcps, []); // returns empty array on parse error
  cleanup(testRoot);
});

// ===================== loadHooks =====================

test('loadHooks returns empty array when hooks.json missing', () => {
  const { loadHooks } = require(SCRIPT);
  testRoot = createTempDir('ecc-test-');

  const hooks = loadHooks(testRoot);
  assert.deepStrictEqual(hooks, []);
  cleanup(testRoot);
});

test('loadHooks loads hook definitions', () => {
  const { loadHooks } = require(SCRIPT);
  testRoot = createTempDir('ecc-test-');
  writeFile(testRoot, 'hooks/hooks.json', JSON.stringify({
    hooks: {
      'post-commit': [
        { matcher: '*.js', id: 'lint-js', description: 'Lint JS files after commit' },
        { matcher: '*.py', id: 'lint-py', description: 'Lint Python files' },
      ],
      'pre-push': [
        { matcher: '*', id: 'run-tests', description: 'Run all tests before push' },
      ],
    },
  }));

  const hooks = loadHooks(testRoot);
  assert.strictEqual(hooks.length, 3);
  const lintJs = hooks.find(h => h.id === 'lint-js');
  assert.ok(lintJs);
  assert.strictEqual(lintJs.ev, 'post-commit');
  assert.strictEqual(lintJs.m, '*.js');
  assert.strictEqual(lintJs.d, 'Lint JS files after commit');
  cleanup(testRoot);
});

test('loadHooks exposes consolidated PostToolUse child IDs', () => {
  const { loadHooks } = require(SCRIPT);
  const repoRoot = path.join(__dirname, '..', '..');
  const hooks = loadHooks(repoRoot);

  assert.ok(hooks.some(hook => hook.id === 'post:dispatcher:sync'));
  assert.ok(hooks.some(hook => hook.id === 'post:dispatcher:async'));
  assert.ok(hooks.some(hook => hook.id === 'post:quality-gate'));
  assert.ok(hooks.some(hook => hook.id === 'post:edit:accumulator'));
  assert.ok(hooks.some(hook => hook.id === 'post:ecc-context-monitor'));
});

test('loadHooks handles malformed JSON gracefully', () => {
  const { loadHooks } = require(SCRIPT);
  testRoot = createTempDir('ecc-test-');
  writeFile(testRoot, 'hooks/hooks.json', '{invalid}');

  const hooks = loadHooks(testRoot);
  assert.deepStrictEqual(hooks, []);
  cleanup(testRoot);
});

// ===================== LANG =====================

test('LANG object has all expected language keys', () => {
  const { LANG, LANG_KEYS } = require(SCRIPT);
  assert.ok(LANG_KEYS.length >= 10); // at least 10 languages
  // Verify key languages are present
  assert.ok(LANG.en);
  assert.ok(LANG.pt);
  assert.ok(LANG.zh);
  assert.ok(LANG.de);
  assert.strictEqual(LANG_KEYS.length, Object.keys(LANG).length);
});

test('LANG English has all required keys', () => {
  const { LANG } = require(SCRIPT);
  const en = LANG.en;
  assert.ok(en.title);
  assert.ok(en.search);
  assert.ok(en.agents);
  assert.ok(en.skills);
  assert.ok(en.commands);
  assert.ok(en.rules);
  assert.ok(en.mcps);
  assert.ok(en.hooks);
  assert.ok(en.all);
  assert.ok(en.description);
  assert.ok(en.tools);
  assert.ok(en.copied);
});

// ===================== renderHTML =====================

test('renderHTML returns valid HTML string', () => {
  const { renderHTML } = require(SCRIPT);
  const data = {
    agents: [],
    skills: [],
    commands: [],
    rules: [],
    mcps: [],
    hooks: [],
  };
  const html = renderHTML(data);
  assert.ok(typeof html === 'string');
  assert.ok(html.startsWith('<!DOCTYPE html>'));
  assert.ok(html.includes('</html>'));
});

test('renderHTML includes agent data as JSON', () => {
  const { renderHTML } = require(SCRIPT);
  const data = {
    agents: [{ n: 'test-agent', d: 'Test desc', m: 'claude-sonnet-4-6', t: ['Bash'], b: 'body', f: 'test.md' }],
    skills: [],
    commands: [],
    rules: [],
    mcps: [],
    hooks: [],
  };
  const html = renderHTML(data);
  assert.ok(html.includes('test-agent'));
  assert.ok(html.includes('claude-sonnet-4-6'));
});

test('renderHTML escapes HTML in data values', () => {
  const { renderHTML } = require(SCRIPT);
  const data = {
    agents: [],
    skills: [{ n: '<script>alert("xss")</script>', d: 'Skill & description', b: '' }],
    commands: [],
    rules: [],
    mcps: [],
    hooks: [],
  };
  const html = renderHTML(data);
  // The JSON serialization with .replace(/</g, '\\u003c') converts < to < in JS strings
  // So the rendered HTML contains <script> not <script> for data values
  assert.ok(html.includes('\\u003cscript'));
  assert.ok(html.includes('\\u003c/script'));
});

test('renderHTML includes LANG and LANG_KEYS in the output', () => {
  const { renderHTML } = require(SCRIPT);
  const data = { agents: [], skills: [], commands: [], rules: [], mcps: [], hooks: [] };
  const html = renderHTML(data);
  assert.ok(html.includes('ECC Capabilities'));
  assert.ok(html.includes('const L ='));
  assert.ok(html.includes('const LANG_KEYS'));
});

test('renderHTML includes the dashboard title and footer', () => {
  const { renderHTML } = require(SCRIPT);
  const data = { agents: [], skills: [], commands: [], rules: [], mcps: [], hooks: [] };
  const html = renderHTML(data);
  assert.ok(html.includes('ECC Capabilities'));
  assert.ok(html.includes('github.com/affaan-m/ECC'));
});

// ===================== Server / HTTP =====================

test('resolveDashboardHost defaults to IPv4 loopback', () => {
  const { resolveDashboardHost } = require(SCRIPT);
  assert.strictEqual(resolveDashboardHost({}), '127.0.0.1');
  assert.strictEqual(resolveDashboardHost({ ECC_DASHBOARD_HOST: '' }), '127.0.0.1');
});

test('resolveDashboardHost accepts only normalized loopback hosts', () => {
  const { resolveDashboardHost } = require(SCRIPT);
  assert.strictEqual(
    resolveDashboardHost({ ECC_DASHBOARD_HOST: ' LOCALHOST ' }),
    'localhost'
  );
  assert.strictEqual(
    resolveDashboardHost({ ECC_DASHBOARD_HOST: '::1' }),
    '::1'
  );
  assert.strictEqual(
    resolveDashboardHost({ ECC_DASHBOARD_HOST: '[::1]' }),
    '::1'
  );
});

test('resolveDashboardHost rejects wildcard, LAN, and arbitrary hosts', () => {
  const { resolveDashboardHost } = require(SCRIPT);
  for (const host of ['0.0.0.0', '::', '192.168.1.10', 'dashboard.internal', '127.0.0.1:3456']) {
    assert.throws(
      () => resolveDashboardHost({ ECC_DASHBOARD_HOST: host }),
      /ECC_DASHBOARD_HOST must be loopback-only/
    );
  }
});

test('listenDashboardServer always passes an explicit loopback host to listen', () => {
  const { listenDashboardServer } = require(SCRIPT);
  const calls = [];
  const fakeServer = {
    listen(...args) {
      calls.push(args);
      return this;
    },
  };
  const onListening = () => {};

  assert.strictEqual(
    listenDashboardServer(fakeServer, {
      host: '127.0.0.1',
      onListening,
      port: 3456,
    }),
    fakeServer
  );
  assert.deepStrictEqual(calls, [[3456, '127.0.0.1', onListening]]);
  assert.throws(
    () => listenDashboardServer(fakeServer, { host: '0.0.0.0', port: 3456 }),
    /ECC_DASHBOARD_HOST must be loopback-only/
  );
  assert.strictEqual(calls.length, 1);
});

asyncTest('server returns no-store HTML on GET /', async () => {
  await withDashboardServer(async (port) => {
    const response = await requestDashboard(port);
    assert.strictEqual(response.statusCode, 200);
    assert.strictEqual(response.headers['content-type'], 'text/html; charset=utf-8');
    assert.strictEqual(response.headers['cache-control'], 'no-store');
    assert.ok(response.body.includes('<!DOCTYPE html>'));
    assert.ok(response.body.includes('ECC Capabilities'));
  });
});

asyncTest('server returns no-store JSON on GET /api/data', async () => {
  await withDashboardServer(async (port) => {
    const response = await requestDashboard(port, { path: '/api/data' });
    assert.strictEqual(response.statusCode, 200);
    assert.strictEqual(response.headers['content-type'], 'application/json');
    assert.strictEqual(response.headers['cache-control'], 'no-store');
    const parsed = JSON.parse(response.body);
    assert.ok(Array.isArray(parsed.agents));
    assert.ok(Array.isArray(parsed.skills));
    assert.ok(Array.isArray(parsed.commands));
    assert.ok(Array.isArray(parsed.rules));
    assert.ok(Array.isArray(parsed.mcps));
    assert.ok(Array.isArray(parsed.hooks));
  });
});

asyncTest('server returns a generic no-store 500 for data failures and remains usable', async () => {
  let loadCount = 0;
  const loggedErrors = [];
  const emptyData = {
    agents: [],
    skills: [],
    commands: [],
    rules: [],
    mcps: [],
    hooks: [],
  };

  await withDashboardServer(async (port) => {
    const failedResponse = await requestDashboard(port, { path: '/api/data' });
    assert.strictEqual(failedResponse.statusCode, 500);
    assert.strictEqual(failedResponse.headers['cache-control'], 'no-store');
    assert.deepStrictEqual(JSON.parse(failedResponse.body), {
      error: 'Internal server error',
    });
    assert.ok(!failedResponse.body.includes('sensitive loader detail'));

    const followUpResponse = await requestDashboard(port, { path: '/api/data' });
    assert.strictEqual(followUpResponse.statusCode, 200);
    assert.deepStrictEqual(JSON.parse(followUpResponse.body), emptyData);
    assert.strictEqual(loggedErrors.length, 1);
    assert.strictEqual(loggedErrors[0].error.message, 'sensitive loader detail');
  }, {
    loadData: () => {
      loadCount++;
      if (loadCount === 1) {
        throw new Error('sensitive loader detail');
      }
      return emptyData;
    },
    reportError: (message, error) => {
      loggedErrors.push({ error, message });
    },
  });
});

asyncTest('server returns a generic no-store 500 for render failures and remains usable', async () => {
  const { renderHTML } = require(SCRIPT);
  let renderCount = 0;
  const loggedErrors = [];
  const emptyData = {
    agents: [],
    skills: [],
    commands: [],
    rules: [],
    mcps: [],
    hooks: [],
  };

  await withDashboardServer(async (port) => {
    const failedResponse = await requestDashboard(port);
    assert.strictEqual(failedResponse.statusCode, 500);
    assert.strictEqual(failedResponse.headers['cache-control'], 'no-store');
    assert.strictEqual(
      failedResponse.body,
      '<!DOCTYPE html><p>Dashboard unavailable.</p>'
    );
    assert.ok(!failedResponse.body.includes('sensitive render detail'));

    const followUpResponse = await requestDashboard(port);
    assert.strictEqual(followUpResponse.statusCode, 200);
    assert.ok(followUpResponse.body.includes('ECC Capabilities'));
    assert.strictEqual(loggedErrors.length, 1);
    assert.strictEqual(loggedErrors[0].error.message, 'sensitive render detail');
  }, {
    loadData: () => emptyData,
    render: (data) => {
      renderCount++;
      if (renderCount === 1) {
        throw new Error('sensitive render detail');
      }
      return renderHTML(data);
    },
    reportError: (message, error) => {
      loggedErrors.push({ error, message });
    },
  });
});

asyncTest('server rejects a missing or DNS-rebinding Host before routing', async () => {
  await withDashboardServer(async (port) => {
    const missingHost = await requestDashboardWithoutHost(port);
    assert.strictEqual(missingHost.statusCode, 421);
    assert.strictEqual(missingHost.headers['cache-control'], 'no-store');

    const reboundHost = await requestDashboard(port, {
      headers: { Host: 'dashboard.attacker.example' },
      path: '/api/data',
    });
    assert.strictEqual(reboundHost.statusCode, 421);
    assert.strictEqual(reboundHost.headers['cache-control'], 'no-store');
  });
});

asyncTest('server rejects an allowed hostname with an invalid port without crashing', async () => {
  await withDashboardServer(async (port) => {
    const response = await requestDashboard(port, {
      headers: { Host: 'localhost:99999' },
      path: '/api/data',
    });
    assert.strictEqual(response.statusCode, 421);
    assert.strictEqual(response.headers['cache-control'], 'no-store');
  });
});

asyncTest('server returns a generic no-store 400 for a malformed absolute request target and remains usable', async () => {
  await withDashboardServer(async (port) => {
    const malformedResponse = await requestDashboard(port, {
      path: 'http://attacker.example:99999/',
    });
    assert.strictEqual(malformedResponse.statusCode, 400);
    assert.strictEqual(malformedResponse.headers['cache-control'], 'no-store');
    assert.deepStrictEqual(JSON.parse(malformedResponse.body), {
      error: 'Bad request',
    });

    const followUpResponse = await requestDashboard(port, {
      path: '/api/data',
    });
    assert.strictEqual(followUpResponse.statusCode, 200);
    assert.strictEqual(followUpResponse.headers['cache-control'], 'no-store');
  });
});

asyncTest('server rejects cross-origin requests before routing', async () => {
  await withDashboardServer(async (port) => {
    const response = await requestDashboard(port, {
      headers: { Origin: 'https://attacker.example' },
      path: '/api/data',
    });
    assert.strictEqual(response.statusCode, 403);
    assert.strictEqual(response.headers['cache-control'], 'no-store');
  });
});

// ===================== esc function (via HTML output) =====================

test('HTML output escapes angle brackets in renderHTML', () => {
  const { renderHTML } = require(SCRIPT);
  const data = {
    agents: [],
    skills: [{ n: 'bad<script>', d: '<img onerror=alert(1)>', b: '' }],
    commands: [],
    rules: [],
    mcps: [],
    hooks: [],
  };
  const html = renderHTML(data);
  // The < in data values are escaped to < in JS string literals
  // So we should find the escaped form in the output
  assert.ok(html.includes('bad\\u003cscript>'));
  assert.ok(html.includes('\\u003cimg onerror'));
});

// ===================== Edge Cases =====================

test('parsePort handles whitespace', () => {
  const { parsePort } = require(SCRIPT);
  // parseInt handles whitespace naturally
  assert.strictEqual(parsePort(' 8080 '), 8080);
});

test('readFrontmatter handles empty file', () => {
  const { readFrontmatter } = require(SCRIPT);
  testRoot = createTempDir('ecc-test-');
  writeFile(testRoot, 'empty.md', '');

  const fm = readFrontmatter(path.join(testRoot, 'empty.md'));
  assert.deepStrictEqual(fm, {});
  cleanup(testRoot);
});

test('readFrontmatter handles malformed frontmatter', () => {
  const { readFrontmatter } = require(SCRIPT);
  testRoot = createTempDir('ecc-test-');
  writeFile(testRoot, 'malformed.md', [
    '---',
    'name: test',
    'this is not a key value',
    '---',
    'body',
  ].join('\n'));

  const fm = readFrontmatter(path.join(testRoot, 'malformed.md'));
  assert.strictEqual(fm.name, 'test');
  assert.ok(fm._body.includes('body'));
  cleanup(testRoot);
});

test('loadAgents handles empty agents directory', () => {
  const { loadAgents } = require(SCRIPT);
  testRoot = createTempDir('ecc-test-');
  fs.mkdirSync(path.join(testRoot, 'agents'));

  const agents = loadAgents(testRoot);
  assert.deepStrictEqual(agents, []);
  cleanup(testRoot);
});

test('loadSkills handles empty skills directory', () => {
  const { loadSkills } = require(SCRIPT);
  testRoot = createTempDir('ecc-test-');
  fs.mkdirSync(path.join(testRoot, 'skills'));

  const skills = loadSkills(testRoot);
  assert.deepStrictEqual(skills, []);
  cleanup(testRoot);
});

test('loadMcps handles empty mcp-configs directory', () => {
  const { loadMcps } = require(SCRIPT);
  testRoot = createTempDir('ecc-test-');
  fs.mkdirSync(path.join(testRoot, 'mcp-configs'));

  const mcps = loadMcps(testRoot);
  assert.deepStrictEqual(mcps, []);
  cleanup(testRoot);
});

// ===================== Results =====================

async function runAsyncTests() {
  for (const { name, fn } of asyncTests) {
    try {
      await fn();
      console.log(`  ✓ ${name}`);
      testPassed++;
    } catch (error) {
      console.log(`  ✗ ${name}`);
      console.log(`    Error: ${error.message}`);
      testFailed++;
    }
  }

  console.log(`\nResults: Passed: ${testPassed}, Failed: ${testFailed}`);
  process.exitCode = testFailed > 0 ? 1 : 0;
}

runAsyncTests();
