/**
 * Tests for governance event capture hook.
 */

const assert = require('assert');

const {
  detectSecrets,
  detectApprovalRequired,
  detectSensitivePath,
  analyzeForGovernanceEvents,
  run,
} = require('../../scripts/hooks/governance-capture');

async function test(name, fn) {
  try {
    await fn();
    console.log(`  \u2713 ${name}`);
    return true;
  } catch (error) {
    console.log(`  \u2717 ${name}`);
    console.log(`    Error: ${error.message}`);
    return false;
  }
}

async function runTests() {
  console.log('\n=== Testing governance-capture ===\n');

  let passed = 0;
  let failed = 0;

  // ── detectSecrets ──────────────────────────────────────────

  if (await test('detectSecrets finds AWS access keys', async () => {
    const findings = detectSecrets('my key is AKIAIOSFODNN7EXAMPLE');
    assert.ok(findings.length > 0);
    assert.ok(findings.some(f => f.name === 'aws_key'));
  })) passed += 1; else failed += 1;

  if (await test('detectSecrets finds generic secrets', async () => {
    const findings = detectSecrets('api_key = "sk-proj-abcdefghij1234567890"');
    assert.ok(findings.length > 0);
    assert.ok(findings.some(f => f.name === 'generic_secret'));
  })) passed += 1; else failed += 1;

  if (await test('detectSecrets finds private keys', async () => {
    const findings = detectSecrets('-----BEGIN RSA PRIVATE KEY-----\nMIIE...');
    assert.ok(findings.length > 0);
    assert.ok(findings.some(f => f.name === 'private_key'));
  })) passed += 1; else failed += 1;

  if (await test('detectSecrets finds GitHub tokens', async () => {
    const findings = detectSecrets('token: ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghij');
    assert.ok(findings.length > 0);
    assert.ok(findings.some(f => f.name === 'github_token'));
  })) passed += 1; else failed += 1;

  if (await test('detectSecrets returns empty array for clean text', async () => {
    const findings = detectSecrets('This is a normal log message with no secrets.');
    assert.strictEqual(findings.length, 0);
  })) passed += 1; else failed += 1;

  if (await test('detectSecrets handles null and undefined', async () => {
    assert.deepStrictEqual(detectSecrets(null), []);
    assert.deepStrictEqual(detectSecrets(undefined), []);
    assert.deepStrictEqual(detectSecrets(''), []);
  })) passed += 1; else failed += 1;

  // ── detectApprovalRequired ─────────────────────────────────

  if (await test('detectApprovalRequired flags force push', async () => {
    const findings = detectApprovalRequired('git push origin main --force');
    assert.ok(findings.length > 0);
  })) passed += 1; else failed += 1;

  if (await test('detectApprovalRequired flags hard reset', async () => {
    const findings = detectApprovalRequired('git reset --hard HEAD~3');
    assert.ok(findings.length > 0);
  })) passed += 1; else failed += 1;

  if (await test('detectApprovalRequired flags rm -rf', async () => {
    const findings = detectApprovalRequired('rm -rf /tmp/important');
    assert.ok(findings.length > 0);
  })) passed += 1; else failed += 1;

  if (await test('detectApprovalRequired flags DROP TABLE', async () => {
    const findings = detectApprovalRequired('DROP TABLE users');
    assert.ok(findings.length > 0);
  })) passed += 1; else failed += 1;

  if (await test('detectApprovalRequired allows safe commands', async () => {
    const findings = detectApprovalRequired('git status');
    assert.strictEqual(findings.length, 0);
  })) passed += 1; else failed += 1;

  if (await test('detectApprovalRequired handles null', async () => {
    assert.deepStrictEqual(detectApprovalRequired(null), []);
    assert.deepStrictEqual(detectApprovalRequired(''), []);
  })) passed += 1; else failed += 1;

  // ── detectSensitivePath ────────────────────────────────────

  if (await test('detectSensitivePath identifies .env files', async () => {
    assert.ok(detectSensitivePath('.env'));
    assert.ok(detectSensitivePath('.env.local'));
    assert.ok(detectSensitivePath('/project/.env.production'));
  })) passed += 1; else failed += 1;

  if (await test('detectSensitivePath identifies credential files', async () => {
    assert.ok(detectSensitivePath('credentials.json'));
    assert.ok(detectSensitivePath('/home/user/.ssh/id_rsa'));
    assert.ok(detectSensitivePath('server.key'));
    assert.ok(detectSensitivePath('cert.pem'));
  })) passed += 1; else failed += 1;

  if (await test('detectSensitivePath returns false for normal files', async () => {
    assert.ok(!detectSensitivePath('index.js'));
    assert.ok(!detectSensitivePath('README.md'));
    assert.ok(!detectSensitivePath('package.json'));
  })) passed += 1; else failed += 1;

  if (await test('detectSensitivePath handles null', async () => {
    assert.ok(!detectSensitivePath(null));
    assert.ok(!detectSensitivePath(''));
  })) passed += 1; else failed += 1;

  // ── analyzeForGovernanceEvents ─────────────────────────────

  if (await test('analyzeForGovernanceEvents detects secrets in tool input', async () => {
    const events = analyzeForGovernanceEvents({
      tool_name: 'Write',
      tool_input: {
        file_path: '/tmp/config.js',
        content: 'const key = "AKIAIOSFODNN7EXAMPLE";',
      },
    });

    assert.ok(events.length > 0);
    const secretEvent = events.find(e => e.eventType === 'secret_detected');
    assert.ok(secretEvent);
    assert.strictEqual(secretEvent.payload.severity, 'critical');
  })) passed += 1; else failed += 1;

  if (await test('analyzeForGovernanceEvents detects approval-required commands', async () => {
    const events = analyzeForGovernanceEvents({
      tool_name: 'Bash',
      tool_input: {
        command: 'git push origin main --force',
      },
    });

    assert.ok(events.length > 0);
    const approvalEvent = events.find(e => e.eventType === 'approval_requested');
    assert.ok(approvalEvent);
    assert.strictEqual(approvalEvent.payload.severity, 'high');
  })) passed += 1; else failed += 1;

  if (await test('approval events fingerprint commands instead of storing raw command text', async () => {
    const command = 'git push origin main --force';
    const events = analyzeForGovernanceEvents({
      tool_name: 'Bash',
      tool_input: { command },
    });

    const approvalEvent = events.find(e => e.eventType === 'approval_requested');
    assert.ok(approvalEvent);
    assert.strictEqual(approvalEvent.payload.commandName, 'git');
    assert.ok(/^[a-f0-9]{12}$/.test(approvalEvent.payload.commandFingerprint), 'Expected short command fingerprint');
    assert.ok(!Object.prototype.hasOwnProperty.call(approvalEvent.payload, 'command'), 'Should not store raw command text');
  })) passed += 1; else failed += 1;

  if (await test('security findings fingerprint elevated commands instead of storing raw command text', async () => {
    const command = 'sudo chmod 600 ~/.ssh/id_rsa';
    const events = analyzeForGovernanceEvents({
      tool_name: 'Bash',
      tool_input: { command },
    }, {
      hookPhase: 'post',
    });

    const securityEvent = events.find(e => e.eventType === 'security_finding');
    assert.ok(securityEvent);
    assert.strictEqual(securityEvent.payload.commandName, 'sudo');
    assert.ok(/^[a-f0-9]{12}$/.test(securityEvent.payload.commandFingerprint), 'Expected short command fingerprint');
    assert.ok(!Object.prototype.hasOwnProperty.call(securityEvent.payload, 'command'), 'Should not store raw command text');
  })) passed += 1; else failed += 1;

  if (await test('PowerShell approval events contain exact destructive rule IDs without raw commands', async () => {
    const encodedPayload = Buffer.from(
      'Remove-Item C:/private/encoded-command-sentinel/*',
      'utf16le'
    ).toString('base64');
    const cases = [
      {
        command: 'Remove-Item -Recurse -Force C:/private/remove-command-sentinel',
        expectedRules: [
          'powershell.remove-item.recurse',
          'powershell.remove-item.force',
        ],
      },
      {
        command: 'Remove-Item C:/private/wildcard-command-sentinel/*',
        expectedRules: ['powershell.remove-item.wildcard'],
      },
      {
        command: 'Remove-Item @deleteParams',
        expectedRules: ['powershell.remove-item.splat'],
      },
      {
        command: 'Get-ChildItem C:/private/pipeline-command-sentinel -Recurse | Remove-Item',
        expectedRules: ['powershell.remove-item.pipeline-recurse'],
      },
      {
        command: 'Clear-Content C:/private/clear-command-sentinel.txt',
        expectedRules: ['powershell.clear-content'],
      },
      {
        command: 'Clear-Disk -Number 2 -RemoveData -Confirm:$false',
        expectedRules: ['powershell.clear-disk'],
      },
      {
        command: 'Format-Volume -DriveLetter D -Force',
        expectedRules: ['powershell.format-volume'],
      },
      {
        command: "[System.IO.Directory]::Delete('C:/private/dotnet-command-sentinel', $true)",
        expectedRules: ['powershell.dotnet.directory-delete'],
      },
      {
        command: "[IO.File]::Delete('C:/private/file-command-sentinel.txt')",
        expectedRules: ['powershell.dotnet.file-delete'],
      },
      {
        command: 'cmd /c rd /s /q C:/private/cmd-command-sentinel',
        expectedRules: ['powershell.cmd.recursive-delete'],
      },
      {
        command: 'pwsh -Command "Remove-Item -Force C:/private/nested-command-sentinel"',
        expectedRules: ['powershell.remove-item.force'],
      },
      {
        command: 'pwsh -Command:"Remove-Item -Force C:/private/inline-command-sentinel"',
        expectedRules: ['powershell.remove-item.force'],
      },
      {
        command: "$payload='Remove-Item -Force C:/private/expanded-command-sentinel'; pwsh -Command \"Write-Output ready; $payload\"",
        expectedRules: ['powershell.remove-item.force'],
      },
      {
        command: "$cmd='Remove-Item'; Set-Alias zap $cmd; zap -Force C:/private/alias-command-sentinel",
        expectedRules: ['powershell.remove-item.force'],
      },
      {
        command: "$cmd='Remove-Item'; Set-Alias -Name zap $cmd; zap -Force C:/private/alias-command-sentinel",
        expectedRules: ['powershell.remove-item.force'],
      },
      {
        command: 'Set-Alias -Name zap Remove-Item; zap -Force C:/private/alias-command-sentinel',
        expectedRules: ['powershell.remove-item.force'],
      },
      {
        command: 'Set-Alias -Name zap $cmd; zap -Force C:/private/alias-command-sentinel',
        expectedRules: ['powershell.dynamic-execution'],
      },
      {
        command: "$cmd='Remove-Item'; Set-Alias -Scope Global -Name zap $cmd; zap -Force C:/private/alias-command-sentinel",
        expectedRules: ['powershell.remove-item.force'],
      },
      {
        command: "$cmd='Remove-Item'; New-Alias -Description demo -Name zap $cmd; zap -Force C:/private/alias-command-sentinel",
        expectedRules: ['powershell.remove-item.force'],
      },
      {
        command: "$cmd='Remove-Item'; sal -Option AllScope -Name zap $cmd; zap -Force C:/private/alias-command-sentinel",
        expectedRules: ['powershell.remove-item.force'],
      },
      {
        command: 'Set-Alias -Unknown demo -Name zap Write-Output; zap ok',
        expectedRules: ['powershell.dynamic-execution'],
      },
      {
        command: "$payload='Remove-Item -Force C:/private/stdin-command-sentinel'; $payload | pwsh -Command -",
        expectedRules: ['powershell.remove-item.force'],
      },
      {
        command: "Set-Alias zap $cmd; zap -Force C:/private/alias-command-sentinel; $cmd='Write-Output'",
        expectedRules: ['powershell.dynamic-execution'],
      },
      {
        command: "$payload | pwsh -Command -; $payload='Write-Output ok'",
        expectedRules: ['powershell.dynamic-execution'],
      },
      {
        command: 'pwsh -Command "Write-Output ready; $runtimePayload"',
        expectedRules: ['powershell.dynamic-execution'],
      },
      {
        command: 'pwsh -Command "$payload"; $payload = "Write-Output ok"',
        expectedRules: ['powershell.dynamic-execution'],
      },
      {
        command: 'pwsh -Command $runtimePayload -Force C:/private/runtime-command-sentinel',
        expectedRules: ['powershell.dynamic-execution'],
      },
      {
        command: `pwsh -EncodedCommand ${encodedPayload}`,
        expectedRules: ['powershell.remove-item.wildcard'],
      },
      {
        command: `pwsh -EncodedCommand:${encodedPayload}`,
        expectedRules: ['powershell.remove-item.wildcard'],
      },
      {
        command: 'Write-Output "$(Remove-Item -Force C:/private/subexpression-command-sentinel)"',
        expectedRules: ['powershell.remove-item.force'],
      },
      {
        command: '<# ignored <# #> Remove-Item -Force C:/private/comment-command-sentinel',
        expectedRules: ['powershell.remove-item.force'],
      },
      {
        command: 'function cleanup { Remove-Item -Force C:/private/function-command-sentinel }; $(cleanup)',
        expectedRules: ['powershell.remove-item.force'],
      },
      {
        command: 'cmd /c pwsh -Command "Remove-Item -Force C:/private/cmd-pwsh-sentinel"',
        expectedRules: ['powershell.remove-item.force'],
      },
      {
        command: 'Invoke-Expression $runtimeValue',
        expectedRules: ['powershell.dynamic-execution'],
      },
      {
        command: 'git switch --discard-changes',
        expectedRules: ['gateguard.bash-compatible-destructive'],
      },
    ];

    for (const { command, expectedRules } of cases) {
      const events = analyzeForGovernanceEvents({
        tool_name: 'PowerShell',
        tool_input: { command },
      }, {
        hookPhase: 'pre',
      });
      const approvalEvent = events.find(event => event.eventType === 'approval_requested');

      assert.ok(approvalEvent, `${command} should raise approval_requested`);
      assert.strictEqual(approvalEvent.payload.toolName, 'PowerShell');
      assert.deepStrictEqual(
        [...approvalEvent.payload.matchedPatterns].sort(),
        [...expectedRules].sort(),
        `${command} should preserve exact classifier rule IDs`
      );
      assert.ok(
        /^[a-f0-9]{12}$/.test(approvalEvent.payload.commandFingerprint),
        'Expected short command fingerprint'
      );
      assert.ok(
        !Object.prototype.hasOwnProperty.call(approvalEvent.payload, 'command'),
        'Should not store raw command text'
      );
      assert.ok(
        !JSON.stringify(approvalEvent).includes(JSON.stringify(command).slice(1, -1)),
        'Serialized governance evidence should not leak the raw command'
      );
    }
  })) passed += 1; else failed += 1;

  if (await test('PowerShell governance ignores literal and benign delete text', async () => {
    const commands = [
      'Get-ChildItem C:/tmp',
      'Get-Date',
      'Remove-Item C:/tmp/notes.txt',
      "Write-Output '$(Remove-Item -Force C:/tmp/demo)'",
      'Write-Output "`$(Remove-Item -Force C:/tmp/demo)"',
    ];

    for (const command of commands) {
      const events = analyzeForGovernanceEvents({
        tool_name: 'PowerShell',
        tool_input: { command },
      }, {
        hookPhase: 'pre',
      });

      assert.ok(
        !events.some(event => event.eventType === 'approval_requested'),
        `${command} should not raise approval_requested`
      );
    }
  })) passed += 1; else failed += 1;

  if (await test('PowerShell governance normalizes tool casing and redacts assignment prefixes', async () => {
    const command = "$label='governance-private-marker'; Remove-Item -Force C:/tmp/demo";
    for (const toolName of ['PowerShell', 'powershell', 'POWERSHELL']) {
      const events = analyzeForGovernanceEvents({
        tool_name: toolName,
        tool_input: { command },
      }, {
        hookPhase: 'pre',
      });
      const approvalEvent = events.find(event => event.eventType === 'approval_requested');
      assert.ok(approvalEvent, `${toolName} should raise approval_requested`);
      assert.strictEqual(approvalEvent.payload.toolName, 'PowerShell');
      assert.strictEqual(approvalEvent.payload.commandName, null);
      assert.ok(!JSON.stringify(events).includes('governance-private-marker'));
    }
  })) passed += 1; else failed += 1;

  if (await test('PowerShell governance redacts quoted expression prefixes', async () => {
    const command = "'quoted-private-marker' ; Remove-Item -Force C:/tmp/demo";
    const events = analyzeForGovernanceEvents({
      tool_name: 'PowerShell',
      tool_input: { command },
    }, {
      hookPhase: 'pre',
    });
    const approvalEvent = events.find(event => event.eventType === 'approval_requested');
    assert.ok(approvalEvent, 'quoted prefix should still raise approval_requested');
    assert.strictEqual(approvalEvent.payload.commandName, null);
    assert.ok(!JSON.stringify(events).includes('quoted-private-marker'));
  })) passed += 1; else failed += 1;

  if (await test('PowerShell elevation events are captured without raw command leakage', async () => {
    const commands = [
      'Start-Process -Verb RunAs cmd -ArgumentList elevation-command-sentinel',
      'Start-Process –Verb RunAs cmd',
      'Start-Process -Verb $("RunAs") cmd',
      'Start-Process -Verb ("RunAs") cmd',
      'saps pwsh -Verb RunAs',
      'start pwsh -Verb RunAs',
      'runas.exe /user:Administrator cmd',
      'sudo chmod 600 C:/private/native-elevation-sentinel',
      '$script:aclResult = Set-Acl -Path C:/private/scoped-assignment-sentinel -AclObject $acl',
      'Set-Acl -Path C:/private/acl-command-sentinel -AclObject $acl',
      'takeown /f C:/private/ownership-command-sentinel',
      "& 'Set-Acl' -Path C:/private/call-operator-sentinel -AclObject $acl",
      'Microsoft.PowerShell.Security\\Set-Acl -Path C:/private/module-sentinel -AclObject $acl',
      'Set`-Acl -Path C:/private/backtick-sentinel -AclObject $acl',
      'Write-Output $(Set-Acl -Path C:/private/subexpression-sentinel -AclObject $acl)',
    ];

    for (const command of commands) {
      const events = analyzeForGovernanceEvents({
        tool_name: 'PowerShell',
        tool_input: { command },
      }, {
        hookPhase: 'post',
      });
      const securityEvent = events.find(event => event.eventType === 'security_finding');

      assert.ok(securityEvent, `${command} should raise a security_finding`);
      assert.strictEqual(securityEvent.payload.toolName, 'PowerShell');
      assert.strictEqual(securityEvent.payload.reason, 'elevated_privilege_command');
      assert.ok(
        /^[a-f0-9]{12}$/.test(securityEvent.payload.commandFingerprint),
        'Expected short command fingerprint'
      );
      assert.ok(
        !Object.prototype.hasOwnProperty.call(securityEvent.payload, 'command'),
        'Should not store raw command text'
      );
      assert.ok(
        !JSON.stringify(securityEvent).includes(JSON.stringify(command).slice(1, -1)),
        'Serialized governance evidence should not leak the raw command'
      );
    }

    const literalEvents = analyzeForGovernanceEvents({
      tool_name: 'PowerShell',
      tool_input: { command: "Write-Output 'Start-Process -Verb RunAs cmd'" },
    }, {
      hookPhase: 'post',
    });
    assert.ok(
      !literalEvents.some(event => event.eventType === 'security_finding'),
      'quoted elevation prose should not raise a security finding'
    );
  })) passed += 1; else failed += 1;

  if (await test('analyzeForGovernanceEvents detects sensitive file access', async () => {
    const events = analyzeForGovernanceEvents({
      tool_name: 'Edit',
      tool_input: {
        file_path: '/project/.env.production',
        old_string: 'DB_URL=old',
        new_string: 'DB_URL=new',
      },
    });

    assert.ok(events.length > 0);
    const policyEvent = events.find(e => e.eventType === 'policy_violation');
    assert.ok(policyEvent);
    assert.strictEqual(policyEvent.payload.reason, 'sensitive_file_access');
  })) passed += 1; else failed += 1;

  if (await test('analyzeForGovernanceEvents detects elevated privilege commands', async () => {
    const events = analyzeForGovernanceEvents({
      tool_name: 'Bash',
      tool_input: { command: 'sudo rm -rf /etc/something' },
    }, {
      hookPhase: 'post',
    });

    const securityEvent = events.find(e => e.eventType === 'security_finding');
    assert.ok(securityEvent);
    assert.strictEqual(securityEvent.payload.reason, 'elevated_privilege_command');
  })) passed += 1; else failed += 1;

  if (await test('analyzeForGovernanceEvents returns empty for clean inputs', async () => {
    const events = analyzeForGovernanceEvents({
      tool_name: 'Read',
      tool_input: { file_path: '/project/src/index.js' },
    });
    assert.strictEqual(events.length, 0);
  })) passed += 1; else failed += 1;

  if (await test('analyzeForGovernanceEvents populates session ID from context', async () => {
    const events = analyzeForGovernanceEvents({
      tool_name: 'Write',
      tool_input: {
        file_path: '/project/.env',
        content: 'DB_URL=test',
      },
    }, {
      sessionId: 'test-session-123',
    });

    assert.ok(events.length > 0);
    assert.strictEqual(events[0].sessionId, 'test-session-123');
  })) passed += 1; else failed += 1;

  if (await test('analyzeForGovernanceEvents generates unique event IDs', async () => {
    const events1 = analyzeForGovernanceEvents({
      tool_name: 'Write',
      tool_input: { file_path: '.env', content: '' },
    });
    const events2 = analyzeForGovernanceEvents({
      tool_name: 'Write',
      tool_input: { file_path: '.env.local', content: '' },
    });

    if (events1.length > 0 && events2.length > 0) {
      assert.notStrictEqual(events1[0].id, events2[0].id);
    }
  })) passed += 1; else failed += 1;

  // ── run() function ─────────────────────────────────────────

  if (await test('run() passes through input when feature flag is off', async () => {
    const original = process.env.ECC_GOVERNANCE_CAPTURE;
    delete process.env.ECC_GOVERNANCE_CAPTURE;

    try {
      const input = JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'git push --force' } });
      const result = run(input);
      assert.strictEqual(result, input);
    } finally {
      if (original !== undefined) {
        process.env.ECC_GOVERNANCE_CAPTURE = original;
      }
    }
  })) passed += 1; else failed += 1;

  if (await test('run() passes through input when feature flag is on', async () => {
    const original = process.env.ECC_GOVERNANCE_CAPTURE;
    process.env.ECC_GOVERNANCE_CAPTURE = '1';

    try {
      const input = JSON.stringify({ tool_name: 'Read', tool_input: { file_path: 'index.js' } });
      const result = run(input);
      assert.strictEqual(result, input);
    } finally {
      if (original !== undefined) {
        process.env.ECC_GOVERNANCE_CAPTURE = original;
      } else {
        delete process.env.ECC_GOVERNANCE_CAPTURE;
      }
    }
  })) passed += 1; else failed += 1;

  if (await test('run() handles invalid JSON gracefully', async () => {
    const original = process.env.ECC_GOVERNANCE_CAPTURE;
    process.env.ECC_GOVERNANCE_CAPTURE = '1';

    try {
      const result = run('not valid json');
      assert.strictEqual(result, 'not valid json');
    } finally {
      if (original !== undefined) {
        process.env.ECC_GOVERNANCE_CAPTURE = original;
      } else {
        delete process.env.ECC_GOVERNANCE_CAPTURE;
      }
    }
  })) passed += 1; else failed += 1;

  if (await test('run() emits hook_input_truncated event without logging raw command text', async () => {
    const original = process.env.ECC_GOVERNANCE_CAPTURE;
    const originalHookEvent = process.env.CLAUDE_HOOK_EVENT_NAME;
    const originalWrite = process.stderr.write;
    const stderr = [];
    process.env.ECC_GOVERNANCE_CAPTURE = '1';
    process.env.CLAUDE_HOOK_EVENT_NAME = 'PreToolUse';
    process.stderr.write = (chunk, encoding, callback) => {
      stderr.push(String(chunk));
      if (typeof encoding === 'function') encoding();
      if (typeof callback === 'function') callback();
      return true;
    };

    try {
      const input = JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'rm -rf /tmp/important' } });
      const result = run(input, { truncated: true, maxStdin: 1024 });
      assert.strictEqual(result, input);
    } finally {
      process.stderr.write = originalWrite;
      if (original !== undefined) {
        process.env.ECC_GOVERNANCE_CAPTURE = original;
      } else {
        delete process.env.ECC_GOVERNANCE_CAPTURE;
      }
      if (originalHookEvent !== undefined) {
        process.env.CLAUDE_HOOK_EVENT_NAME = originalHookEvent;
      } else {
        delete process.env.CLAUDE_HOOK_EVENT_NAME;
      }
    }

    const combined = stderr.join('');
    assert.ok(combined.includes('"eventType":"hook_input_truncated"'), 'Should emit truncation event');
    assert.ok(combined.includes('"sizeLimitBytes":1024'), 'Should record the truncation limit');
    assert.ok(!combined.includes('rm -rf /tmp/important'), 'Should not leak raw command text to governance logs');
  })) passed += 1; else failed += 1;
  if (await test('run() can detect multiple event types in one input', async () => {
    // Bash command with force push AND secret in command
    const events = analyzeForGovernanceEvents({
      tool_name: 'Bash',
      tool_input: {
        command: 'API_KEY="AKIAIOSFODNN7EXAMPLE" git push --force',
      },
    });

    const eventTypes = events.map(e => e.eventType);
    assert.ok(eventTypes.includes('secret_detected'));
    assert.ok(eventTypes.includes('approval_requested'));
  })) passed += 1; else failed += 1;

  console.log(`\nResults: Passed: ${passed}, Failed: ${failed}`);
  process.exit(failed > 0 ? 1 : 0);
}

runTests();
