'use strict';

const assert = require('assert');
const {
  classifyPowerShellDestructiveCommand,
} = require('../../scripts/lib/powershell-destructive-command');

const RULES = Object.freeze({
  REMOVE_RECURSE: 'powershell.remove-item.recurse',
  REMOVE_FORCE: 'powershell.remove-item.force',
  REMOVE_WILDCARD: 'powershell.remove-item.wildcard',
  REMOVE_SPLAT: 'powershell.remove-item.splat',
  PIPELINE_RECURSE: 'powershell.remove-item.pipeline-recurse',
  CLEAR_CONTENT: 'powershell.clear-content',
  CLEAR_DISK: 'powershell.clear-disk',
  FORMAT_VOLUME: 'powershell.format-volume',
  DOTNET_DIRECTORY_DELETE: 'powershell.dotnet.directory-delete',
  DOTNET_FILE_DELETE: 'powershell.dotnet.file-delete',
  CMD_RECURSIVE_DELETE: 'powershell.cmd.recursive-delete',
  DYNAMIC_EXECUTION: 'powershell.dynamic-execution',
  SCAN_DEPTH_EXCEEDED: 'powershell.scan-depth-exceeded',
});

console.log('=== Testing powershell-destructive-command.js ===\n');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  PASS ${name}`);
    passed += 1;
  } catch (error) {
    console.log(`  FAIL ${name}`);
    console.log(`    ${error.message}`);
    failed += 1;
  }
}

function classify(command) {
  const findings = classifyPowerShellDestructiveCommand(command);
  assert.ok(Array.isArray(findings), 'classifier must return an array');
  assert.ok(
    findings.every(ruleId => typeof ruleId === 'string' && ruleId.length > 0),
    'every finding must be a non-empty rule-id string'
  );
  assert.strictEqual(
    new Set(findings).size,
    findings.length,
    `findings must be unique: ${JSON.stringify(findings)}`
  );
  return findings;
}

function expectRules(command, expected) {
  const actual = classify(command);
  assert.deepStrictEqual(
    [...actual].sort(),
    [...expected].sort(),
    `unexpected findings for ${JSON.stringify(command)}`
  );
}

function expectSafe(command) {
  expectRules(command, []);
}

console.log('Remove-Item forms:');

test('classifies recursive and force parameters independently', () => {
  expectRules('Remove-Item -Recurse -Force C:/tmp/demo', [
    RULES.REMOVE_RECURSE,
    RULES.REMOVE_FORCE,
  ]);
  expectRules('Remove-Item -Recurse C:/tmp/demo', [RULES.REMOVE_RECURSE]);
  expectRules('Remove-Item -Force C:/tmp/demo', [RULES.REMOVE_FORCE]);
});

test('classifies PowerShell parameter abbreviations case-insensitively', () => {
  expectRules('REMOVE-ITEM -Rec -Fo C:/tmp/demo', [
    RULES.REMOVE_RECURSE,
    RULES.REMOVE_FORCE,
  ]);
});

test('normalizes every PowerShell command-parameter dash character', () => {
  expectRules('Remove-Item –Force C:/tmp/demo', [RULES.REMOVE_FORCE]);
  expectRules('Remove-Item —Recurse C:/tmp/demo', [RULES.REMOVE_RECURSE]);
  expectRules('Remove-Item ―Force C:/tmp/demo', [RULES.REMOVE_FORCE]);
});

test('normalizes PowerShell backtick obfuscation after finding executable ranges', () => {
  expectRules('Rem`ove-Item -Rec`urse C:/tmp/demo', [RULES.REMOVE_RECURSE]);
});

test('classifies recursive Remove-Item aliases', () => {
  for (const alias of ['ri', 'rm', 'rmdir', 'rd', 'del', 'erase']) {
    expectRules(`${alias} -Recurse C:/tmp/demo`, [RULES.REMOVE_RECURSE]);
  }
  expectRules('rp -Force HKCU:/Software/Demo -Name setting', [RULES.REMOVE_FORCE]);
  expectRules('Remove-ItemProperty -Force HKCU:/Software/Demo -Name setting', [
    RULES.REMOVE_FORCE,
  ]);
});

test('classifies wildcard targets, including quoted provider paths', () => {
  expectRules('Remove-Item C:/build/*', [RULES.REMOVE_WILDCARD]);
  expectRules('Remove-Item "C:/build/file?.tmp"', [RULES.REMOVE_WILDCARD]);
});

test('classifies splatted Remove-Item parameters', () => {
  expectRules('Remove-Item @deleteParams', [RULES.REMOVE_SPLAT]);
});

test('returns deterministic, unique rule IDs when a rule matches repeatedly', () => {
  const command = 'Remove-Item -Force C:/one; Remove-Item -Force C:/two';
  const first = classify(command);
  const second = classify(command);

  assert.deepStrictEqual(first, second);
  assert.deepStrictEqual(first, [RULES.REMOVE_FORCE]);
});

console.log('\nAdditional destructive APIs:');

test('classifies Clear-Content, Clear-Disk, and Format-Volume', () => {
  expectRules('Clear-Content C:/tmp/log.txt', [RULES.CLEAR_CONTENT]);
  expectRules('Clear-Disk -Number 2 -RemoveData -Confirm:$false', [RULES.CLEAR_DISK]);
  expectRules('Format-Volume -DriveLetter D -Force', [RULES.FORMAT_VOLUME]);
});

test('classifies .NET directory and file deletion', () => {
  expectRules("[System.IO.Directory]::Delete('C:/tmp/demo', $true)", [
    RULES.DOTNET_DIRECTORY_DELETE,
  ]);
  expectRules("[IO.File]::Delete('C:/tmp/demo.txt')", [
    RULES.DOTNET_FILE_DELETE,
  ]);
  expectRules("[IO.Fi`le]::Delete('C:/tmp/demo.txt')", [
    RULES.DOTNET_FILE_DELETE,
  ]);
});

test('classifies recursive cmd.exe deletion reached through PowerShell', () => {
  expectRules('cmd /c rd /s /q C:/tmp/demo', [RULES.CMD_RECURSIVE_DELETE]);
  expectRules('cmd.exe /c del /s /q C:/tmp/demo/*', [
    RULES.CMD_RECURSIVE_DELETE,
  ]);
  expectRules('cmd /c "rd /s /q C:/tmp/demo"', [RULES.CMD_RECURSIVE_DELETE]);
  expectRules('cmd /c @rd /s /q C:/tmp/demo', [RULES.CMD_RECURSIVE_DELETE]);
  expectRules('cmd /c --% rd /s /q C:/tmp/demo', [RULES.CMD_RECURSIVE_DELETE]);
  expectRules('cmd /c if exist C:/tmp/demo rd /s /q C:/tmp/demo', [
    RULES.CMD_RECURSIVE_DELETE,
  ]);
  expectRules('cmd /c "(rd /s /q C:/tmp/demo)"', [RULES.CMD_RECURSIVE_DELETE]);
  expectRules('cmd /c (rd /s /q C:/tmp/demo)', [RULES.CMD_RECURSIVE_DELETE]);
  expectRules('cmd /c if /i "x"=="x" rd /s /q C:/tmp/demo', [
    RULES.CMD_RECURSIVE_DELETE,
  ]);
  expectRules('cmd /c for %i in (1) do rd /s /q C:/tmp/demo', [
    RULES.CMD_RECURSIVE_DELETE,
  ]);
  expectRules('cmd /c call rd /s /q C:/tmp/demo', [RULES.CMD_RECURSIVE_DELETE]);
  expectRules('cmd /c start /wait rd /s /q C:/tmp/demo', [
    RULES.CMD_RECURSIVE_DELETE,
  ]);
  expectRules('cmd /c if exist C:/never echo safe else rd /s /q C:/tmp/demo', [
    RULES.CMD_RECURSIVE_DELETE,
  ]);
  for (const command of [
    'cmd /c if exist C:/never echo safe else if exist C:/never echo safe else rd /s /q C:/tmp/demo',
    'cmd /c for %i in (1) do if exist C:/never echo safe else rd /s /q C:/tmp/demo',
    'cmd /c call call rd /s /q C:/tmp/demo',
    'cmd /c start "job" /wait cmd /c rd /s /q C:/tmp/demo',
    'cmd /c >nul rd /s /q C:/tmp/demo',
    'cmd /c if /i "x" EQU "x" rd /s /q C:/tmp/demo',
    'cmd /c if 1 NEQ 2 rd /s /q C:/tmp/demo',
    'cmd /c if /i "x" EQU "x" if 1 NEQ 2 rd /s /q C:/tmp/demo',
  ]) {
    expectRules(command, [RULES.CMD_RECURSIVE_DELETE]);
  }
});

test('classifies pipeline recursion evidence upstream of Remove-Item', () => {
  expectRules('Get-ChildItem C:/tmp -Recurse | Remove-Item', [
    RULES.PIPELINE_RECURSE,
  ]);
});

console.log('\nNested shell payloads:');

test('does not resolve earlier invocations from later scalar assignments', () => {
  for (const invocation of [
    'pwsh -Command "$payload"',
    'pwsh -Command:$payload',
    'pwsh -EncodedCommand:$payload',
    'Invoke-Expression $payload',
    '& $payload',
  ]) {
    expectRules(`${invocation}; $payload = 'Write-Output ok'`, [RULES.DYNAMIC_EXECUTION]);
  }
  expectRules('pwsh -Command "$payload"; $payload = "Remove-Item -Force C:/tmp/demo"', [
    RULES.DYNAMIC_EXECUTION,
  ]);
  expectSafe('$payload = "Write-Output ok"; pwsh -Command "$payload"');
});

test('resolves scalar values supplied to aliases and shell stdin', () => {
  for (const command of [
    "$cmd='Remove-Item'; Set-Alias zap $cmd; zap -Force C:/tmp/demo",
    "$cmd='Remove-Item'; New-Alias -Name zap -Value $cmd; zap -Force C:/tmp/demo",
    "$cmd='Remove-Item'; Set-Alias -Name zap -Value:$cmd; zap -Force C:/tmp/demo",
    '$cmd=\'Remove-Item\'; Set-Alias zap "$cmd"; zap -Force C:/tmp/demo',
    "$payload='Remove-Item -Force C:/tmp/demo'; $payload | pwsh -Command -",
    "$payload='Remove-Item -Force C:/tmp/demo'; Write-Output $payload | pwsh -Command -",
    '$payload=\'Remove-Item -Force C:/tmp/demo\'; "$payload" | pwsh -Command -',
    '$payload=\'Remove-Item -Force C:/tmp/demo\'; Write-Output "$payload" | pwsh -Command -',
  ]) {
    expectRules(command, [RULES.REMOVE_FORCE]);
  }
  expectSafe('Set-Alias zap $runtimeCommand');
  expectSafe("$cmd='Write-Output'; Set-Alias zap $cmd; zap ok");
  expectSafe("$payload='Write-Output ok'; $payload | pwsh -Command -");
  expectSafe("$payload='Remove-Item -Force C:/tmp/demo'; '$payload' | pwsh -Command -");
  expectSafe("$cmd='Remove-Item'; Set-Alias zap '$cmd'; zap -Force C:/tmp/demo");
});

test('binds remaining alias positional arguments after named parameters', () => {
  for (const definition of [
    'Set-Alias -Name zap $cmd',
    'New-Alias -Name:zap $cmd',
    'Set-Alias -Value $cmd zap',
    'New-Alias zap -Value:$cmd',
  ]) {
    expectRules(`$cmd='Remove-Item'; ${definition}; zap -Force C:/tmp/demo`, [
      RULES.REMOVE_FORCE,
    ]);
    expectRules(`${definition}; zap -Force C:/tmp/demo`, [RULES.DYNAMIC_EXECUTION]);
    expectRules(`${definition}; zap -Force C:/tmp/demo; $cmd='Write-Output'`, [
      RULES.DYNAMIC_EXECUTION,
    ]);
    expectSafe(`$cmd='Write-Output'; ${definition}; zap ok`);
    expectSafe(definition);
  }
  expectRules('Set-Alias -Name zap Remove-Item; zap -Force C:/tmp/demo', [RULES.REMOVE_FORCE]);
  expectRules('Set-Alias -Value Remove-Item zap; zap -Force C:/tmp/demo', [RULES.REMOVE_FORCE]);
  expectSafe("$cmd='Remove-Item'; Set-Alias -Name zap '$cmd'; zap -Force C:/tmp/demo");
});

test('binds alias auxiliary parameters independently of their layout', () => {
  const parameters = [
    '-Scope Global', '-Sc:Global', '-Description demo', '-Desc:demo',
    '-Option AllScope', '-Opt:AllScope', '-Option ReadOnly, Private',
    '-Force', '-Fo:$false', '-PassThru', '-Pass:$false',
    '-Verbose', '-vb:$false', '-Debug', '-db:$false',
    '-Confirm:$false', '-cf:$false', '-WhatIf:$false', '-wi:$false',
    '-ErrorAction Stop', '-ea:Stop', '-WarningAction Continue', '-wa:Continue',
    '-InformationAction Continue', '-infa:Continue', '-ProgressAction Continue',
    '-proga:Continue', '-ErrorVariable errors', '-ev:errors',
    '-WarningVariable warnings', '-wv:warnings', '-InformationVariable info', '-iv:info',
    '-OutVariable output', '-ov:output', '-OutBuffer 1', '-ob:1',
    '-PipelineVariable item', '-pv:item',
  ];
  for (const command of ['Set-Alias', 'New-Alias', 'sal', 'nal']) {
    for (const parameter of parameters) {
      for (const args of [
        `${parameter} -Name zap $cmd`,
        `-Name zap ${parameter} $cmd`,
        `-Name zap $cmd ${parameter}`,
        `${parameter} zap -Value $cmd`,
        `${parameter} zap $cmd`,
      ]) {
        const definition = `${command} ${args}`;
        expectRules(`$cmd='Remove-Item'; ${definition}; zap -Force C:/tmp/demo`, [RULES.REMOVE_FORCE]);
        expectRules(`${definition}; zap -Force C:/tmp/demo`, [RULES.DYNAMIC_EXECUTION]);
        expectSafe(`$cmd='Write-Output'; ${definition}; zap ok`);
        expectSafe(definition);
      }
    }
  }
  expectRules('Set-Alias -Scope Global -Name zap Remove-Item; zap -Force C:/tmp/demo', [RULES.REMOVE_FORCE]);
});

test('gates invoked aliases with unsupported or ambiguous parameter binding', () => {
  for (const definition of [
    'Set-Alias -Unknown demo -Name zap Write-Output',
    'Set-Alias -Unknown demo zap Write-Output',
    'Set-Alias -Name zap -V Write-Output',
    'Set-Alias -Name zap -Option AllScope extra Write-Output',
    'Set-Alias -Name zap @parameters',
  ]) {
    expectRules(`${definition}; zap ok`, [RULES.DYNAMIC_EXECUTION]);
    expectSafe(`${definition}; Write-Output ok`);
  }
});

test('gates unresolved aliases and stdin without using later or reassigned scalars', () => {
  for (const command of [
    'Set-Alias zap $cmd; zap -Force C:/tmp/demo',
    "Set-Alias zap $cmd; zap -Force C:/tmp/demo; $cmd='Write-Output'",
    "$cmd='Remove-Item'; Set-Alias zap $cmd; $cmd='Write-Output'; zap -Force C:/tmp/demo",
    '$payload | pwsh -Command -',
    'Write-Output $payload | pwsh -Command -',
    "$payload | pwsh -Command -; $payload='Write-Output ok'",
    "$payload='Remove-Item -Force C:/tmp/demo'; $payload | pwsh -Command -; $payload='Write-Output ok'",
  ]) {
    expectRules(command, [RULES.DYNAMIC_EXECUTION]);
  }
});

test('classifies powershell and pwsh command payloads recursively', () => {
  expectRules(
    'powershell -Command "Remove-Item -Recurse C:/tmp/demo"',
    [RULES.REMOVE_RECURSE]
  );
  expectRules(
    "pwsh -c 'Remove-Item -Force C:/tmp/demo'",
    [RULES.REMOVE_FORCE]
  );
  expectRules(
    'cmd /c pwsh -Command "Remove-Item -Force C:/tmp/demo"',
    [RULES.REMOVE_FORCE]
  );
  expectRules(
    "'Remove-Item -Force C:/tmp/demo' | pwsh -Command -",
    [RULES.REMOVE_FORCE]
  );
  expectRules(
    "Write-Output 'Remove-Item -Force C:/tmp/demo' | pwsh -Command -",
    [RULES.REMOVE_FORCE]
  );
  expectRules("@('Remove-Item -Force C:/tmp/demo') | pwsh -Command -", [
    RULES.REMOVE_FORCE,
  ]);
  expectRules("@'\nRemove-Item -Force C:/tmp/demo\n'@ | pwsh -Command -", [
    RULES.REMOVE_FORCE,
  ]);
  expectRules("@'\nRemove-Item -Force C:/tmp/demo\n'@ | pwsh -NoProfile -Command -", [
    RULES.REMOVE_FORCE,
  ]);
  expectRules(
    "Write-Output \"[IO.File]::Delete('C:/tmp/demo')\" | pwsh -Command -",
    [RULES.DOTNET_FILE_DELETE]
  );
  expectRules('pwsh -CommandWithArgs "Remove-Item -Force C:/tmp/demo"', [
    RULES.REMOVE_FORCE,
  ]);
  expectRules('pwsh -cwa "Remove-Item -Force C:/tmp/demo"', [RULES.REMOVE_FORCE]);
  expectRules('pwsh -Command:"Remove-Item -Force C:/tmp/demo"', [RULES.REMOVE_FORCE]);
  expectRules('pwsh -Command:Remove-Item -Force C:/tmp/demo', [RULES.REMOVE_FORCE]);
  expectRules(
    "Start-Process pwsh -ArgumentList '-NoProfile -Command \"Remove-Item -Force C:/tmp/demo\"'",
    [RULES.REMOVE_FORCE]
  );
  for (const command of [
    "Start-Process pwsh -ArgumentList '-NoProfile','-Command','Remove-Item -Force C:/tmp/demo'",
    "Start-Process -FilePath pwsh -ArgumentList '-NoProfile', '-Command', 'Remove-Item -Force C:/tmp/demo'",
    "saps pwsh -ArgumentList '-NoProfile','-c','Remove-Item -Force C:/tmp/demo'",
    "Start-Process pwsh -ArgumentList @('-NoProfile','-Command','Remove-Item -Force C:/tmp/demo')",
    "Start-Process pwsh '-Command \"Remove-Item -Force C:/tmp/demo\"'",
    "Start-Process pwsh -Args '-Command \"Remove-Item -Force C:/tmp/demo\"'",
    "Start-Process -FilePath:pwsh -ArgumentList '-Command \"Remove-Item -Force C:/tmp/demo\"'",
    "Start-Process pwsh -ArgumentList:'-Command \"Remove-Item -Force C:/tmp/demo\"'",
    "Start-Process -Fi:pwsh -Arg:'-Command \"Remove-Item -Force C:/tmp/demo\"'",
    "Start-Process -ArgumentList '-Command \"Remove-Item -Force C:/tmp/demo\"' -FilePath pwsh",
    "Start-Process -WindowStyle Hidden pwsh -ArgumentList '-Command \"Remove-Item -Force C:/tmp/demo\"'",
    "Start-Process -WorkingDirectory C:/tmp pwsh -ArgumentList '-Command \"Remove-Item -Force C:/tmp/demo\"'",
    "Start-Process pwsh '-NoProfile','-Command','Remove-Item -Force C:/tmp/demo'",
    "Start-Process pwsh -ArgumentList @('-NoProfile',('-Command'),('Remove-Item -Force C:/tmp/demo'))",
  ]) {
    expectRules(command, [RULES.REMOVE_FORCE]);
  }
  expectRules("Start-Process cmd -ArgumentList '/c rd /s /q C:/tmp/demo'", [
    RULES.CMD_RECURSIVE_DELETE,
  ]);
  expectRules(
    "$params=@{FilePath='pwsh';ArgumentList='-Command \"Remove-Item -Force C:/tmp/demo\"'}; Start-Process @params",
    [RULES.DYNAMIC_EXECUTION]
  );
  expectRules(
    "$global:params=@{FilePath='pwsh';ArgumentList='-Command \"Remove-Item -Force C:/tmp/demo\"'}; Start-Process @global:params",
    [RULES.DYNAMIC_EXECUTION]
  );
  expectRules(
    "$shell='pwsh'; 'Remove-Item -Force C:/tmp/demo' | & $shell -Command -",
    [RULES.REMOVE_FORCE]
  );
  expectRules("@'\nRemove-Item -Force C:/tmp/demo\n'@ | & pwsh -Command -", [
    RULES.REMOVE_FORCE,
  ]);
});

test('classifies UTF-16LE EncodedCommand payloads', () => {
  const payload = Buffer.from(
    'Remove-Item C:/tmp/demo/*',
    'utf16le'
  ).toString('base64');

  expectRules(`pwsh -EncodedCommand ${payload}`, [RULES.REMOVE_WILDCARD]);
  expectRules(`pwsh -EncodedCommand:${payload}`, [RULES.REMOVE_WILDCARD]);
  expectRules(`$payload='${payload}'; pwsh -EncodedCommand:$payload`, [
    RULES.REMOVE_WILDCARD,
  ]);
  expectRules('pwsh -EncodedCommand $runtimePayload', [RULES.DYNAMIC_EXECUTION]);
  expectSafe(`$payload='${payload}'; pwsh -EncodedCommand:\`$payload`);
  expectSafe(`$payload='${payload}'; pwsh -EncodedCommand:'$payload'`);
});

test('ignores an invalid EncodedCommand payload without throwing', () => {
  assert.doesNotThrow(() => classify('pwsh -EncodedCommand %%%not-base64%%%'));
  expectSafe('pwsh -EncodedCommand %%%not-base64%%%');
});

test('bounds deeply nested encoded commands and reports conservative evidence', () => {
  let command = 'Remove-Item -Recurse C:/tmp/demo';
  for (let depth = 0; depth < 8; depth += 1) {
    const payload = Buffer.from(command, 'utf16le').toString('base64');
    command = `pwsh -EncodedCommand ${payload}`;
  }

  expectRules(command, [RULES.SCAN_DEPTH_EXCEEDED]);
});

test('classifies destructive commands in executable PowerShell containers', () => {
  const commands = [
    '& { Remove-Item -Force C:/tmp/demo }',
    'if ($true) { Remove-Item -Force C:/tmp/demo }',
    'ForEach-Object { Remove-Item -Force C:/tmp/demo }',
    '@(Remove-Item -Force C:/tmp/demo)',
    '(Remove-Item -Force C:/tmp/demo)',
    'pwsh -Command "& { Remove-Item -Force C:/tmp/demo }"',
    'pwsh -Command { Remove-Item -Force C:/tmp/demo }',
    'switch ($x) { default { Remove-Item -Force C:/tmp/demo } }',
    "switch ($x) { 'match' { Remove-Item -Force C:/tmp/demo } }",
    '& ({ Remove-Item -Force C:/tmp/demo })',
    '& $( { Remove-Item -Force C:/tmp/demo } )',
    'Invoke-Command -ScriptBlock ({ Remove-Item -Force C:/tmp/demo })',
    'ForEach-Object -Process ({ Remove-Item -Force C:/tmp/demo })',
    'function cleanup { Remove-Item -Force C:/tmp/demo }; cleanup',
  ];
  for (const command of commands) expectRules(command, [RULES.REMOVE_FORCE]);
});

test('preserves executable context through spacing and nested grouping', () => {
  const commands = [
    `&${' '.repeat(300)}{ Remove-Item -Force C:/tmp/demo }`,
    '& (({ Remove-Item -Force C:/tmp/demo }))',
    'pwsh -Command (({ Remove-Item -Force C:/tmp/demo }))',
    '{ Remove-Item -Force C:/tmp/demo }.Invoke()',
    '{ Remove-Item -Force C:/tmp/demo }.InvokeReturnAsIs()',
    '{ Remove-Item -Force C:/tmp/demo }.Inv`oke()',
    "{ Remove-Item -Force C:/tmp/demo }.'Invoke'()",
    '{ Remove-Item -Force C:/tmp/demo }.InvokeWithContext($null, $null, @())',
    '{ Remove-Item -Force C:/tmp/demo } `\n.Invoke()',
    '{ Remove-Item -Force C:/tmp/demo }.GetNewClosure().Invoke()',
    '{ Remove-Item -Force C:/tmp/demo }.GetNewClosure().GetNewClosure().Invoke()',
    "{ Remove-Item -Force C:/tmp/demo }.'GetNewClosure'().Invoke()",
  ];
  for (const command of commands) expectRules(command, [RULES.REMOVE_FORCE]);
});

test('classifies invoked functions and filters across executable containers', () => {
  const commands = [
    'function cleanup { Remove-Item -Force C:/tmp/demo }; if ($true) { cleanup }',
    'function cleanup { Remove-Item -Force C:/tmp/demo }; $(cleanup)',
    'filter cleanup { Remove-Item -Force C:/tmp/demo }; 1 | cleanup',
    '1 | foreach { Remove-Item -Force C:/tmp/demo }',
    '1 | where { Remove-Item -Force C:/tmp/demo; $true }',
    '1 | Microsoft.PowerShell.Core\\ForEach-Object { Remove-Item -Force C:/tmp/demo }',
  ];
  for (const command of commands) expectRules(command, [RULES.REMOVE_FORCE]);
});

test('classifies invoked static script-block variables but leaves assignments inert', () => {
  expectSafe('$cleanup = { Remove-Item -Force C:/tmp/demo }');
  expectRules('$cleanup = { Remove-Item -Force C:/tmp/demo }; & $cleanup', [
    RULES.REMOVE_FORCE,
  ]);
  expectRules('$cleanup = { Remove-Item -Force C:/tmp/demo }; $cleanup.Invoke()', [
    RULES.REMOVE_FORCE,
  ]);
  expectRules('${cleanup} = { Remove-Item -Force C:/tmp/demo }; & ${cleanup}', [
    RULES.REMOVE_FORCE,
  ]);
  for (const command of [
    '$cleanup = { Remove-Item -Force C:/tmp/demo }; Invoke-Command -ScriptBlock $cleanup',
    '$cleanup = { Remove-Item -Force C:/tmp/demo }; 1 | ForEach-Object -Process $cleanup',
    '$cleanup = { Remove-Item -Force C:/tmp/demo }; Start-Job -ScriptBlock $cleanup',
    '$cleanup = { Remove-Item -Force C:/tmp/demo }; Measure-Command -Expression $cleanup',
    '$cleanup = { Remove-Item -Force C:/tmp/demo }; Register-EngineEvent x -Action $cleanup',
    '$cleanup = { Remove-Item -Force C:/tmp/demo }; Invoke-Command $cleanup',
    '$cleanup = { Remove-Item -Force C:/tmp/demo }; 1 | ForEach-Object $cleanup',
    '$cleanup = { Remove-Item -Force C:/tmp/demo }; Start-Job $cleanup',
    '$cleanup = { Remove-Item -Force C:/tmp/demo }; Measure-Command $cleanup',
    '$cleanup = { Remove-Item -Force C:/tmp/demo }; $cleanup.GetNewClosure().Invoke()',
    '${cleanup} = { Remove-Item -Force C:/tmp/demo }; ${cleanup}.GetNewClosure().Invoke()',
    '$cleanup = { Remove-Item -Force C:/tmp/demo }; icm -ScriptBlock $cleanup',
    '$cleanup = { Remove-Item -Force C:/tmp/demo }; sajb -ScriptBlock $cleanup',
    '$cleanup = { Remove-Item -Force C:/tmp/demo }; Trace-Command demo -Expression $cleanup',
    '$cleanup = { Remove-Item -Force C:/tmp/demo }; Invoke-Command -NoNewScope $cleanup',
    '$cleanup = { Remove-Item -Force C:/tmp/demo }; 1 | ForEach-Object -Begin {} $cleanup',
  ]) {
    expectRules(command, [RULES.REMOVE_FORCE]);
  }
});

test('classifies static command results reached through the call operator', () => {
  expectRules("& ('Remove-Item') -Force C:/tmp/demo", [RULES.REMOVE_FORCE]);
  expectRules("& $('Remove-Item') -Force C:/tmp/demo", [RULES.REMOVE_FORCE]);
  expectRules("& (('Remove-Item')) -Force C:/tmp/demo", [RULES.REMOVE_FORCE]);
  expectRules("& $(( 'Remove-Item')) -Force C:/tmp/demo", [RULES.REMOVE_FORCE]);
});

test('classifies assignments, hashtables, and multiline executable blocks', () => {
  const commands = [
    '$x = Remove-Item -Force C:/tmp/demo',
    '$h = @{ x = $(Remove-Item -Force C:/tmp/demo) }',
    'if ($true)\n{ Remove-Item -Force C:/tmp/demo }',
    'switch ($x)\n{ default { Remove-Item -Force C:/tmp/demo } }',
    'function cleanup\n{ Remove-Item -Force C:/tmp/demo }; cleanup',
    'if ($true) `\n{ Remove-Item -Force C:/tmp/demo }',
  ];
  for (const command of commands) expectRules(command, [RULES.REMOVE_FORCE]);
  expectRules('$null = Clear-Disk -Number 2 -RemoveData -Confirm:$false', [
    RULES.CLEAR_DISK,
  ]);
});

test('classifies compact, scoped, indexed, property, and return execution', () => {
  const commands = [
    '$result=Remove-Item -Force C:/tmp/demo',
    '[object]$result=Remove-Item -Force C:/tmp/demo',
    '$script:x = Remove-Item -Force C:/tmp/demo',
    '${x} = Remove-Item -Force C:/tmp/demo',
    '$x[0] = Remove-Item -Force C:/tmp/demo',
    '$x.Value = Remove-Item -Force C:/tmp/demo',
    '$x,$y = Remove-Item -Force C:/tmp/demo',
    'return Remove-Item -Force C:/tmp/demo',
    '$script:cleanup = { Remove-Item -Force C:/tmp/demo }; & $script:cleanup',
  ];
  for (const command of commands) expectRules(command, [RULES.REMOVE_FORCE]);
});

test('classifies named function blocks and sibling consumer blocks', () => {
  const commands = [
    'function cleanup { begin { Remove-Item -Force C:/tmp/demo } }; cleanup',
    'function cleanup { process { Remove-Item -Force C:/tmp/demo } }; 1 | cleanup',
    'workflow cleanup { Remove-Item -Force C:/tmp/demo }; cleanup',
    '1 | ForEach-Object { Write-Output safe } { Remove-Item -Force C:/tmp/demo }',
    'Trace-Command demo -Expression { Remove-Item -Force C:/tmp/demo }',
    'Register-EngineEvent demo -Action { Remove-Item -Force C:/tmp/demo }',
    'Register-EngineEvent demo -Action:{ Remove-Item -Force C:/tmp/demo }',
    'class Cleanup { static [void] Run() { Remove-Item -Force C:/tmp/demo } }; [Cleanup]::Run()',
    'class Cleanup { Cleanup() { Remove-Item -Force C:/tmp/demo } }; [Cleanup]::new()',
    'class Cleanup { Cleanup() { Remove-Item -Force C:/tmp/demo } }; New-Object -TypeName Cleanup',
    'class Cleanup { Cleanup() { Remove-Item -Force C:/tmp/demo } }; New-Object Cleanup',
    'class Cleanup { Cleanup() { Remove-Item -Force C:/tmp/demo } }; New-Object ([Cleanup])',
    "class Cleanup { Cleanup() { Remove-Item -Force C:/tmp/demo } }; New-Object ('Cleanup')",
    'class Cleanup { Cleanup() { Remove-Item -Force C:/tmp/demo } }; [Activator]::CreateInstance([Cleanup])',
    "$type = 'Cleanup'; class Cleanup { Cleanup() { Remove-Item -Force C:/tmp/demo } }; New-Object $type",
  ];
  for (const command of commands) expectRules(command, [RULES.REMOVE_FORCE]);
});

test('classifies static execution primitives', () => {
  expectRules("iex 'Remove-Item -Force C:/tmp/demo'", [RULES.REMOVE_FORCE]);
  expectRules("Invoke-Expression 'Remove-Item -Force C:/tmp/demo'", [
    RULES.REMOVE_FORCE,
  ]);
  expectRules("& ([scriptblock]::Create('Remove-Item -Force C:/tmp/demo'))", [
    RULES.REMOVE_FORCE,
  ]);
  expectRules("Invoke-Expression @'\nRemove-Item -Force C:/tmp/demo\n'@", [
    RULES.REMOVE_FORCE,
  ]);
  expectRules("[scriptblock]::Create(@'\nRemove-Item -Force C:/tmp/demo\n'@).Invoke()", [
    RULES.REMOVE_FORCE,
  ]);
  expectRules("& (@'\nRemove-Item\n'@) -Force C:/tmp/demo", [RULES.REMOVE_FORCE]);
  for (const command of [
    "$cmd = 'Remove-Item -Force C:/tmp/demo'; Invoke-Expression $cmd",
    "$cmd='Remove-Item -Force C:/tmp/demo'; iex $cmd",
    "$cmd = 'Remove-Item -Force C:/tmp/demo'; & ([scriptblock]::Create($cmd))",
    "$name = 'Remove-Item'; & $name -Force C:/tmp/demo",
    "$args = '-Command \"Remove-Item -Force C:/tmp/demo\"'; Start-Process pwsh -ArgumentList $args",
    "$payload = 'Remove-Item -Force C:/tmp/demo'; pwsh -Command $payload",
    "$payload = 'Remove-Item -Force C:/tmp/demo'; pwsh -Command \"$payload\"",
    "$payload = 'Remove-Item -Force C:/tmp/demo'; pwsh -Command \"Write-Output ready; $payload\"",
    "$payload = 'Remove-Item -Force C:/tmp/demo'; pwsh -Command \"Write-Output ready; $($payload)\"",
    "$payload = 'Remove-Item -Force C:/tmp/demo'; pwsh -Command:$payload",
    "$payload = 'Remove-Item'; pwsh -Command $payload -Force C:/tmp/demo",
    "$payload = \"Remove-Item `\n-Force C:/tmp/demo\"; pwsh -Command $payload",
  ]) {
    expectRules(command, [RULES.REMOVE_FORCE]);
  }
  expectRules('Invoke-Expression $runtimeValue', [RULES.DYNAMIC_EXECUTION]);
  expectRules('pwsh -Command $runtimeValue', [RULES.DYNAMIC_EXECUTION]);
  expectRules('pwsh -Command "Write-Output ready; $runtimeValue"', [
    RULES.DYNAMIC_EXECUTION,
  ]);
  expectRules('pwsh -Command "Write-Output ready; $($runtimeValue)"', [
    RULES.DYNAMIC_EXECUTION,
  ]);
  expectRules('pwsh -Command $runtimeValue -Force C:/tmp/demo', [
    RULES.DYNAMIC_EXECUTION,
  ]);
  expectSafe("$payload = 'Remove-Item -Force C:/tmp/demo'; pwsh -Command '$payload'");
  expectSafe("$payload = 'Remove-Item -Force C:/tmp/demo'; pwsh -Command \"Write-Output `$payload\"");
  expectSafe("$payload = 'Remove-Item -Force C:/tmp/demo'; pwsh -Command:`$payload");
  expectSafe("$payload = 'Remove-Item -Force C:/tmp/demo'; pwsh -Command:'$payload'");
  expectRules('Start-Process pwsh -ArgumentList $runtimeArgs', [RULES.DYNAMIC_EXECUTION]);
  expectRules("$cmd='Remove-'; $cmd+='Item'; & $cmd -Force C:/tmp/demo", [
    RULES.DYNAMIC_EXECUTION,
  ]);
  expectRules(
    '$verb=\'Remove\'; $cmd="${verb}-Item"; & $cmd -Force C:/tmp/demo',
    [RULES.DYNAMIC_EXECUTION]
  );
  expectRules('& (Get-Command Remove-Item) -Force C:/tmp/demo', [
    RULES.DYNAMIC_EXECUTION,
  ]);
  expectRules("iex ('Remove-'+'Item -Force C:/tmp/demo')", [
    RULES.DYNAMIC_EXECUTION,
  ]);
  expectRules("iex ('{0}-Item -Force C:/tmp/demo' -f 'Remove')", [
    RULES.DYNAMIC_EXECUTION,
  ]);
  expectRules(
    '$cleanup={ Remove-Item -Force C:/tmp/demo }; Invoke-Command -ScriptBlock (Get-Variable cleanup -ValueOnly)',
    [RULES.DYNAMIC_EXECUTION]
  );
  expectRules('Set-Alias zap Remove-Item; zap -Force C:/tmp/demo', [
    RULES.REMOVE_FORCE,
  ]);
  expectRules('New-Alias -Name zap -Value Remove-Item; zap -Force C:/tmp/demo', [
    RULES.REMOVE_FORCE,
  ]);
  expectRules(
    "$ExecutionContext.InvokeCommand.InvokeScript('Remove-Item -Force C:/tmp/demo')",
    [RULES.REMOVE_FORCE]
  );
  expectRules(
    "${ExecutionContext}.InvokeCommand.InvokeScript('Remove-Item -Force C:/tmp/demo')",
    [RULES.REMOVE_FORCE]
  );
  expectRules(
    "$ExecutionContext.InvokeCommand.InvokeScript(\"Write-Output safe; `\nRemove-Item -Force C:/tmp/demo\")",
    [RULES.REMOVE_FORCE]
  );
  expectRules(
    "$ExecutionContext.InvokeCommand.InvokeScript(\"Write-Output safe; `\rRemove-Item -Force C:/tmp/demo\")",
    [RULES.REMOVE_FORCE]
  );
});

test('scans malformed InvokeScript string arguments in bounded time', () => {
  const command = `$ExecutionContext.InvokeCommand.InvokeScript("${'`!'.repeat(10000)}`;
  const assignment = '$payload = "' + '`!'.repeat(10000);
  const startedAt = Date.now();
  expectRules(command, [RULES.DYNAMIC_EXECUTION]);
  expectSafe(assignment);
  assert.ok(Date.now() - startedAt < 4000, 'malformed string scan should remain below hook timeout');
});

test('classifies command names composed from static subexpression output', () => {
  expectRules('Remove-$(Write-Output Item) -Force C:/tmp/demo', [RULES.REMOVE_FORCE]);
  expectRules('Clear-$(echo Disk) -Number 2', [RULES.CLEAR_DISK]);
  expectRules('Format-$(echo Volume) -DriveLetter D', [RULES.FORMAT_VOLUME]);
  expectRules('r$(echo m) -Force C:/tmp/demo', [RULES.REMOVE_FORCE]);
});

test('classifies executable containers inside EncodedCommand payloads', () => {
  const payload = Buffer.from(
    '& { Remove-Item -Force C:/tmp/demo }',
    'utf16le'
  ).toString('base64');
  expectRules(`pwsh -EncodedCommand ${payload}`, [RULES.REMOVE_FORCE]);
});

console.log('\nPowerShell subexpressions:');

test('classifies destructive commands in unquoted subexpressions', () => {
  expectRules('Write-Output $(Remove-Item -Force C:/tmp/demo)', [
    RULES.REMOVE_FORCE,
  ]);
});

test('classifies destructive commands in double-quoted subexpressions', () => {
  expectRules('Write-Output "$(Remove-Item -Recurse C:/tmp/demo)"', [
    RULES.REMOVE_RECURSE,
  ]);
});

test('classifies recursively nested subexpressions', () => {
  expectRules(
    'Write-Output "$(Write-Output $(Remove-Item -Force C:/tmp/demo))"',
    [RULES.REMOVE_FORCE]
  );
});

test('classifies sibling subexpressions without duplicating rule IDs', () => {
  expectRules(
    'Write-Output $(Remove-Item -Force C:/one) $(Remove-Item -Force C:/two)',
    [RULES.REMOVE_FORCE]
  );
});

test('keeps quoted delimiters inside subexpressions from splitting commands', () => {
  expectRules(
    'Write-Output $(Write-Output "safe;|&"; Remove-Item -Force "C:/tmp/a;b/*")',
    [RULES.REMOVE_FORCE, RULES.REMOVE_WILDCARD]
  );
});

test('keeps a quoted closing parenthesis inside a subexpression body', () => {
  expectRules(
    'Write-Output $(Write-Output ")"; Remove-Item -Force C:/tmp/demo)',
    [RULES.REMOVE_FORCE]
  );
});

test('keeps double-quoted apostrophes from suppressing executable subexpressions', () => {
  expectRules(
    'Write-Output "it\'s $(Remove-Item -Force C:/tmp/demo)"',
    [RULES.REMOVE_FORCE]
  );
});

test('treats subexpression text inside single quotes as literal', () => {
  expectSafe("Write-Output '$(Remove-Item -Force C:/tmp/demo)'");
});

test('treats a backtick-escaped subexpression inside double quotes as literal', () => {
  expectSafe('Write-Output "`$(Remove-Item -Force C:/tmp/demo)"');
});

test('respects literal and expandable PowerShell here-strings', () => {
  expectSafe("@'\nliteral's Remove-Item -Force C:/tmp/demo\n'@");
  expectSafe('Write-Output "@\'\nRemove-Item -Force C:/tmp/demo\n\'@"');
  expectRules('@"\n$(Remove-Item -Force C:/tmp/demo)\n"@', [
    RULES.REMOVE_FORCE,
  ]);
  expectRules('@"\n" # $(Remove-Item -Force C:/tmp/demo)\n"@', [
    RULES.REMOVE_FORCE,
  ]);
  expectSafe('@"\n" # literal Remove-Item -Force C:/tmp/demo\n"@');
});

test('normalizes PowerShell smart quotes before lexical analysis', () => {
  expectRules('& ‘Remove-Item’ -Force C:/tmp/demo', [RULES.REMOVE_FORCE]);
  expectRules('& ‚Remove-Item‚ -Force C:/tmp/demo', [RULES.REMOVE_FORCE]);
  expectRules('& ‛Remove-Item‛ -Force C:/tmp/demo', [RULES.REMOVE_FORCE]);
  expectRules('& „Remove-Item„ -Force C:/tmp/demo', [RULES.REMOVE_FORCE]);
  expectSafe('Write-Output ‘$(Remove-Item -Force C:/tmp/demo)’');
  expectSafe('Write-Output ‚$(Remove-Item -Force C:/tmp/demo)‚');
});

test('does not treat a backslash as an escape for an executable subexpression', () => {
  expectRules('Write-Output \\$(Remove-Item -Force C:/tmp/demo)', [
    RULES.REMOVE_FORCE,
  ]);
});

test('handles backtick line continuations before destructive parameters', () => {
  expectRules('Remove-Item `\n-Force C:/tmp/demo', [RULES.REMOVE_FORCE]);
  expectRules('Remove-Item `\r\n-Force C:/tmp/demo', [RULES.REMOVE_FORCE]);
});

test('ignores comment syntax without letting it poison following parser state', () => {
  expectRules('# (\nRemove-Item -Force C:/tmp/demo', [RULES.REMOVE_FORCE]);
  expectRules('<# ( #>\nRemove-Item -Force C:/tmp/demo', [RULES.REMOVE_FORCE]);
  expectRules('<# ignored <# #> Remove-Item -Force C:/tmp/demo', [RULES.REMOVE_FORCE]);
  expectSafe('Write-Output safe # ; Remove-Item -Force C:/tmp/demo');
  expectSafe('Write-Output safe# | Remove-Item -Force C:/tmp/demo');
  expectSafe("# [IO.File]::Delete('C:/tmp/demo')");
  expectRules('# @"\nRemove-Item -Force C:/tmp/demo\n"@', [RULES.REMOVE_FORCE]);
  expectRules('${a#b}=1; Remove-Item -Force C:/tmp/demo', [RULES.REMOVE_FORCE]);
  expectRules('${a<#b}=1; Remove-Item -Force C:/tmp/demo', [RULES.REMOVE_FORCE]);
});

test('scans large comments and unmatched openers in bounded time', () => {
  const started = Date.now();
  expectRules(`<# ${'$('.repeat(40000)} #>\nRemove-Item -Force C:/tmp/demo`, [
    RULES.REMOVE_FORCE,
  ]);
  expectSafe('$('.repeat(40000));
  expectSafe('()'.repeat(10000));
  assert.ok(Date.now() - started < 2000, 'large malformed input should remain bounded');
});

test('resolves long invoked-function chains within the hook time budget', () => {
  const definitions = [];
  for (let index = 0; index < 20001; index += 1) {
    const body = index === 20000
      ? 'Remove-Item -Force C:/tmp/demo'
      : `f${index + 1}`;
    definitions.push(`function f${index} { ${body} }`);
  }
  const started = Date.now();
  expectRules(`${definitions.join('; ')}; f0`, [RULES.REMOVE_FORCE]);
  assert.ok(Date.now() - started < 4000, 'function resolution should remain below hook timeout');
});

test('scans many sibling executable containers within the hook time budget', () => {
  const command = Array.from(
    { length: 40000 },
    (_, index) => index === 39999
      ? '$(Remove-Item -Force C:/tmp/demo)'
      : '$(Write-Output safe)'
  ).join(' ');
  const started = Date.now();
  expectRules(command, [RULES.REMOVE_FORCE]);
  assert.ok(Date.now() - started < 4000, 'sibling containers should remain bounded');
});

console.log('\nBenign controls:');

test('allows plain non-recursive, non-forced, non-wildcard Remove-Item', () => {
  expectSafe('Remove-Item C:/tmp/notes.txt');
});

test('allows benign PowerShell and non-recursive cmd commands', () => {
  expectSafe('Get-ChildItem C:/tmp');
  expectSafe('Get-Date');
  expectSafe('cmd /c del C:/tmp/notes.txt');
  expectSafe('cmd /c echo rd /s /q C:/tmp/demo');
  expectSafe('cmd /c "echo safe ^& rd /s /q C:/tmp/demo"');
  expectSafe("function cleanup { Remove-Item -Force C:/tmp/demo }; 'cleanup'");
  expectSafe('Write-Output safe`nRemove-Item -Force C:/tmp/demo');
});

test('allows explicitly false destructive switches and inert script blocks', () => {
  expectSafe('Remove-Item -Force:$false C:/tmp/demo');
  expectSafe('Remove-Item -Force:$null C:/tmp/demo');
  expectSafe('Remove-Item -Recurse:$false C:/tmp/demo');
  expectSafe("Remove-Item '-Force'");
  expectSafe("Remove-Item -LiteralPath 'C:/tmp/file*.txt'");
  expectSafe('{ Remove-Item -Force C:/tmp/demo }');
  expectSafe('function cleanup { Remove-Item -Force C:/tmp/demo }');
});

test('treats backticks literally inside single-quoted strings', () => {
  expectRules("Write-Output 'safe`'; Remove-Item -Force C:/tmp/demo", [
    RULES.REMOVE_FORCE,
  ]);
});

test('handles empty and non-string commands', () => {
  expectSafe('');
  expectSafe(null);
  expectSafe(undefined);
});

test('handles a trailing backtick without throwing or inventing a finding', () => {
  assert.doesNotThrow(() => classify('Write-Output safe`'));
  expectSafe('Write-Output safe`');
});

console.log(`\nResults: Passed: ${passed}, Failed: ${failed}`);
if (failed > 0) {
  process.exit(1);
}
