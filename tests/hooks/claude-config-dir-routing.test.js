/**
 * Tests that the hooks route profile state through CLAUDE_CONFIG_DIR
 *
 * Run with: node tests/hooks/claude-config-dir-routing.test.js
 *
 * These spawn the hooks rather than calling the shared resolver. The four hooks
 * below cannot require scripts/lib/agent-data-home.js: managed installs ship a
 * top-level scripts/ without scripts/lib/ (#3259), so each carries its own copy
 * of the resolver. A resolver test therefore cannot show where a hook writes.
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawnSync } = require('child_process');

const hooksDir = path.join(__dirname, '..', '..', 'scripts', 'hooks');
const libSessions = path.join(__dirname, '..', '..', 'scripts', 'lib', 'plan-canvas', 'sessions.js');

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    return true;
  } catch (err) {
    console.log(`  ✗ ${name}`);
    console.log(`    Error: ${err.message}`);
    return false;
  }
}

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'config-dir-routing-'));
}

/**
 * A profile that is not the home directory, so a hook that ignored
 * CLAUDE_CONFIG_DIR would write somewhere this returns.
 */
function makeProfile() {
  const root = makeTempDir();
  return {
    home: path.join(root, 'home'),
    profile: path.join(root, 'profile', '.claude-work'),
  };
}

// No ECC_* override is passed anywhere here: an override would route the hook
// before it reached the CLAUDE_CONFIG_DIR fallback under test.
function runHook(hookFile, { profile, home, stdin = '{}', args = [], env = {} }) {
  fs.mkdirSync(home, { recursive: true });
  return spawnSync('node', [path.join(hooksDir, hookFile), ...args], {
    input: stdin,
    encoding: 'utf8',
    env: {
      ...process.env,
      HOME: home,
      USERPROFILE: home,
      CLAUDE_CONFIG_DIR: profile,
      ECC_PLAN_CANVAS_STATE_DIR: undefined,
      ECC_MCP_HEALTH_STATE_PATH: undefined,
      ...env,
    },
  });
}

/**
 * plan-canvas-pending.js exports run() and is required by the lifecycle hook
 * bootstrap rather than spawned, so it is driven here in a child process. The
 * child is what makes CLAUDE_CONFIG_DIR meaningful: requiring it in-process,
 * the way tests/hooks/plan-canvas-pending-hook.test.js does with
 * ECC_PLAN_CANVAS_STATE_DIR, cannot reach the fallback under test.
 */
function runPendingHook({ profile, home, payload }) {
  fs.mkdirSync(home, { recursive: true });
  const result = spawnSync('node', ['-e', `
    require(${JSON.stringify(path.join(hooksDir, 'plan-canvas-pending.js'))})
      .run(${JSON.stringify(JSON.stringify(payload))})
      .then(out => process.stdout.write(out.stdout));
  `], {
    encoding: 'utf8',
    env: {
      ...process.env,
      HOME: home,
      USERPROFILE: home,
      CLAUDE_CONFIG_DIR: profile,
      ECC_PLAN_CANVAS_STATE_DIR: undefined,
    },
  });
  assert.strictEqual(result.status, 0, `pending hook failed: ${result.stderr}`);
  return result.stdout;
}

function writeSessions(stateDir, sessions) {
  fs.mkdirSync(stateDir, { recursive: true });
  fs.writeFileSync(path.join(stateDir, 'sessions.json'), JSON.stringify({ sessions }, null, 2));
}

function runTests() {
  console.log('\n🧪 Testing CLAUDE_CONFIG_DIR routing in hooks\n');
  let passed = 0;
  let failed = 0;
  const record = ok => { if (ok) passed++; else failed++; };

  console.log('post-bash-command-log.js');

  record(test('writes the audit log under CLAUDE_CONFIG_DIR', () => {
    const { home, profile } = makeProfile();
    runHook('post-bash-command-log.js', {
      home,
      profile,
      args: ['audit'],
      stdin: JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'echo routed' } }),
    });
    const log = path.join(profile, 'bash-commands.log');
    assert.ok(fs.existsSync(log), `expected ${log} to exist`);
    assert.match(fs.readFileSync(log, 'utf8'), /echo routed/);
    assert.ok(
      !fs.existsSync(path.join(home, '.claude', 'bash-commands.log')),
      'the log must not also land in ~/.claude'
    );
  }));

  record(test('writes the cost log under CLAUDE_CONFIG_DIR', () => {
    const { home, profile } = makeProfile();
    runHook('post-bash-command-log.js', {
      home,
      profile,
      args: ['cost'],
      stdin: JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'echo costed' } }),
    });
    assert.match(fs.readFileSync(path.join(profile, 'cost-tracker.log'), 'utf8'), /echo costed/);
  }));

  record(test('falls back to ~/.claude when CLAUDE_CONFIG_DIR is unset', () => {
    const { home } = makeProfile();
    fs.mkdirSync(home, { recursive: true });
    spawnSync('node', [path.join(hooksDir, 'post-bash-command-log.js'), 'audit'], {
      input: JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'echo default' } }),
      encoding: 'utf8',
      env: { ...process.env, HOME: home, USERPROFILE: home, CLAUDE_CONFIG_DIR: undefined },
    });
    assert.match(
      fs.readFileSync(path.join(home, '.claude', 'bash-commands.log'), 'utf8'),
      /echo default/
    );
  }));

  record(test('expands a tilde profile instead of creating a "~" directory', () => {
    // path.resolve('~/.claude-work') would make ./~/.claude-work under the cwd,
    // splitting the hook off from scripts/lib/agent-data-home.js, which expands.
    const { home } = makeProfile();
    runHook('post-bash-command-log.js', {
      home,
      profile: '~/.claude-work',
      args: ['audit'],
      stdin: JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'echo tilde' } }),
    });
    assert.match(
      fs.readFileSync(path.join(home, '.claude-work', 'bash-commands.log'), 'utf8'),
      /echo tilde/
    );
  }));

  console.log('\nmcp-health-check.js');

  record(test('writes the health cache under CLAUDE_CONFIG_DIR', () => {
    const { home, profile } = makeProfile();
    fs.mkdirSync(home, { recursive: true });
    // Without a configured server the hook skips the probe and never writes.
    // The command does not exist, so the probe fails and the result is cached.
    fs.writeFileSync(path.join(home, '.claude.json'), JSON.stringify({
      mcpServers: { routing_probe: { command: 'ecc-no-such-mcp-binary', args: [] } },
    }));
    runHook('mcp-health-check.js', {
      home,
      profile,
      stdin: JSON.stringify({ tool_name: 'mcp__routing_probe__ping', tool_input: {} }),
    });
    const cache = path.join(profile, 'mcp-health-cache.json');
    assert.ok(fs.existsSync(cache), `expected ${cache} to exist`);
    assert.ok(
      !fs.existsSync(path.join(home, '.claude', 'mcp-health-cache.json')),
      'the cache must not also land in ~/.claude'
    );
  }));

  console.log('\nplan-canvas-sessions.js (SessionStart)');

  record(test('reports open sessions recorded under CLAUDE_CONFIG_DIR', () => {
    const { home, profile } = makeProfile();
    writeSessions(path.join(profile, 'plan-canvas'), {
      k1: { file: '/work/plan.md', status: 'open', pendingFeedback: [] },
    });
    const result = runHook('plan-canvas-sessions.js', { home, profile });
    assert.match(result.stdout, /\/work\/plan\.md/);
  }));

  record(test('does not read ~/.claude when a profile is set', () => {
    const { home, profile } = makeProfile();
    // Only the home copy holds a session. A hook that ignored the profile
    // would announce it; the right answer here is silence.
    writeSessions(path.join(home, '.claude', 'plan-canvas'), {
      k1: { file: '/work/leaked.md', status: 'open', pendingFeedback: [] },
    });
    const result = runHook('plan-canvas-sessions.js', { home, profile });
    assert.strictEqual(result.stdout.trim(), '');
  }));

  console.log('\nplan-canvas-pending.js (Stop)');

  record(test('blocks on feedback queued under CLAUDE_CONFIG_DIR', () => {
    const { home, profile } = makeProfile();
    const cwd = makeTempDir();
    const artifact = path.join(cwd, 'plan.md');
    fs.writeFileSync(artifact, '# plan\n');
    writeSessions(path.join(profile, 'plan-canvas'), {
      k1: {
        key: 'k1',
        file: artifact,
        status: 'feedback',
        pendingFeedback: [{ kind: 'verdict', verdict: 'request-changes', text: 'tighten step 2' }],
      },
    });
    const decision = JSON.parse(runPendingHook({ home, profile, payload: { cwd } }));
    assert.strictEqual(decision.decision, 'block');
    assert.match(decision.reason, /tighten step 2/);
  }));

  console.log('\nproducer to consumer');

  record(test('a session the library records is found by both hooks', () => {
    // The regression this guards: the library wrote ~/.claude/plan-canvas while
    // the hooks read CLAUDE_CONFIG_DIR/plan-canvas, so under a second profile
    // SessionStart missed open reviews and Stop let a turn end with feedback
    // still queued. Both ends are exercised with no state-directory override.
    const { home, profile } = makeProfile();
    const cwd = makeTempDir();
    const artifact = path.join(cwd, 'design.md');
    fs.writeFileSync(artifact, '# design\n');
    fs.mkdirSync(home, { recursive: true });

    const producer = spawnSync('node', ['-e', `
      const store = require(${JSON.stringify(libSessions)}).createSessionStore();
      const { session } = store.open(${JSON.stringify(artifact)});
      store.queueFeedback(session.key, [{ kind: 'verdict', verdict: 'request-changes', text: 'needs a rollback plan' }]);
    `], {
      encoding: 'utf8',
      env: {
        ...process.env,
        HOME: home,
        USERPROFILE: home,
        CLAUDE_CONFIG_DIR: profile,
        ECC_PLAN_CANVAS_STATE_DIR: undefined,
      },
    });
    assert.strictEqual(producer.status, 0, `producer failed: ${producer.stderr}`);
    assert.ok(
      fs.existsSync(path.join(profile, 'plan-canvas', 'sessions.json')),
      'the library must record the session under the profile'
    );

    const sessionStart = runHook('plan-canvas-sessions.js', { home, profile });
    assert.match(sessionStart.stdout, /design\.md/, 'SessionStart must see the open review');

    const decision = JSON.parse(runPendingHook({ home, profile, payload: { cwd } }));
    assert.strictEqual(decision.decision, 'block');
    assert.match(decision.reason, /needs a rollback plan/);
  }));

  console.log(`\n${'='.repeat(50)}`);
  console.log(`Passed: ${passed}`);
  console.log(`Failed: ${failed}`);
  console.log('='.repeat(50));
  if (failed > 0) process.exit(1);
}

runTests();
