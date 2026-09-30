/**
 * Tests for scripts/hooks/gateguard-fact-force.js via run-with-flags.js
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const runner = path.join(__dirname, '..', '..', 'scripts', 'hooks', 'run-with-flags.js');
const hookScript = path.join(__dirname, '..', '..', 'scripts', 'hooks', 'gateguard-fact-force.js');
const externalStateDir = process.env.GATEGUARD_STATE_DIR;
const tmpRoot = process.env.TMPDIR || process.env.TEMP || process.env.TMP || '/tmp';
const baseStateDir = externalStateDir || tmpRoot;
const stateDir = fs.mkdtempSync(path.join(baseStateDir, 'gateguard-test-'));
// Use a fixed session ID so test process and spawned hook process share the same state file
const TEST_SESSION_ID = 'gateguard-test-session';
const stateFile = path.join(stateDir, `state-${TEST_SESSION_ID}.json`);
const READ_HEARTBEAT_MS = 60 * 1000;

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
  } catch (err) {
    console.error(`  [clearState] failed to remove state files in ${stateDir}: ${err.message}`);
  }
}

function writeExpiredState() {
  try {
    fs.mkdirSync(stateDir, { recursive: true });
    const expired = {
      checked: ['some_file.js', '__bash_session__'],
      last_active: Date.now() - (8 * 60 + 1) * 60 * 1000
    };
    fs.writeFileSync(stateFile, JSON.stringify(expired), 'utf8');
  } catch (_) {
    /* ignore */
  }
}

function writeState(state) {
  fs.mkdirSync(stateDir, { recursive: true });
  fs.writeFileSync(stateFile, JSON.stringify(state), 'utf8');
}

function runHook(input, env = {}) {
  const rawInput = typeof input === 'string' ? input : JSON.stringify(input);
  const result = spawnSync('node', [runner, 'pre:edit-write:gateguard-fact-force', 'scripts/hooks/gateguard-fact-force.js', 'standard,strict'], {
    input: rawInput,
    encoding: 'utf8',
    env: {
      ...process.env,
      ECC_HOOK_PROFILE: 'standard',
      GATEGUARD_STATE_DIR: stateDir,
      CLAUDE_SESSION_ID: TEST_SESSION_ID,
      ...env
    },
    timeout: 15000,
    stdio: ['pipe', 'pipe', 'pipe']
  });

  return {
    code: Number.isInteger(result.status) ? result.status : 1,
    stdout: result.stdout || '',
    stderr: result.stderr || ''
  };
}

function runBashHook(input, env = {}) {
  const rawInput = typeof input === 'string' ? input : JSON.stringify(input);
  const result = spawnSync('node', [runner, 'pre:bash:gateguard-fact-force', 'scripts/hooks/gateguard-fact-force.js', 'standard,strict'], {
    input: rawInput,
    encoding: 'utf8',
    env: {
      ...process.env,
      ECC_HOOK_PROFILE: 'standard',
      GATEGUARD_STATE_DIR: stateDir,
      CLAUDE_SESSION_ID: TEST_SESSION_ID,
      ...env
    },
    timeout: 15000,
    stdio: ['pipe', 'pipe', 'pipe']
  });

  return {
    code: Number.isInteger(result.status) ? result.status : 1,
    stdout: result.stdout || '',
    stderr: result.stderr || ''
  };
}

function runPowerShellHook(input, env = {}) {
  const rawInput = typeof input === 'string' ? input : JSON.stringify(input);
  const result = spawnSync(
    'node',
    [
      runner,
      'pre:powershell:gateguard-fact-force',
      'scripts/hooks/gateguard-fact-force.js',
      'standard,strict'
    ],
    {
      input: rawInput,
      encoding: 'utf8',
      env: {
        ...process.env,
        ECC_HOOK_PROFILE: 'standard',
        GATEGUARD_STATE_DIR: stateDir,
        CLAUDE_SESSION_ID: TEST_SESSION_ID,
        ...env
      },
      timeout: 15000,
      stdio: ['pipe', 'pipe', 'pipe']
    }
  );

  return {
    code: Number.isInteger(result.status) ? result.status : 1,
    stdout: result.stdout || '',
    stderr: result.stderr || ''
  };
}

function parseOutput(stdout) {
  try {
    return JSON.parse(stdout);
  } catch (_) {
    return null;
  }
}

// Canonical state keys fold separators and case on Windows-style paths, so lookups go through this.
const WINDOWS_STYLE_PATH = /^[a-z]:[\\/]|^\\\\/i;
function stateKey(p) {
  return WINDOWS_STYLE_PATH.test(p) ? p.replace(/\\/g, '/').toLowerCase() : p;
}

function loadDirectHook(env = {}) {
  delete require.cache[require.resolve(hookScript)];
  Object.assign(process.env, {
    GATEGUARD_STATE_DIR: stateDir,
    CLAUDE_SESSION_ID: TEST_SESSION_ID,
    ...env
  });
  return require(hookScript);
}


// Fast, pure classification matrix. These strings are input data, never shell commands.
function runDdRegressionTests() {
  const environment = {
    GATEGUARD_STATE_DIR: stateDir,
    CLAUDE_SESSION_ID: TEST_SESSION_ID,
    GATEGUARD_DISABLED: '',
    ECC_GATEGUARD: 'on',
    GATEGUARD_BASH_EXTRA_DESTRUCTIVE: '',
    GATEGUARD_BASH_ROUTINE_DISABLED: '1',
    GATEGUARD_EXEMPT_GLOBS: '',
    ECC_HOOKS_ENABLED: 'true',
    ECC_HOOK_PROFILE: 'standard',
    ECC_DISABLED_HOOKS: '',
    ECC_DRY_RUN: '0',
    ECC_HOOK_CONFIG: path.join(stateDir, 'no-managed-config.json'),
    CLAUDE_PLUGIN_ROOT: path.resolve(__dirname, '../..'),
    ECC_PLUGIN_ROOT: path.resolve(__dirname, '../..')
  };
  const original = Object.fromEntries(Object.keys(environment).map(key => [key, process.env[key]]));
  Object.assign(process.env, environment);
  let hook;
  let passed = 0;
  let failed = 0;
  const check = (name, fn) => {
    if (test(name, fn)) passed++;
    else failed++;
  };
  const destructive = [
    // GNU external time option names, prefixes and values stay distinct.
    "/usr/bin/time -q dd of=output",
    "/usr/bin/time --quiet dd if=input",
    "/usr/bin/time --output-file report dd of=output",
    "/usr/bin/time --output-file=report dd of=output",
    "/usr/bin/time --output-file=dd dd of=output",
    "/usr/bin/time --q dd of=output",
    "/usr/bin/time --qui dd if=input",
    "/usr/bin/time --output-f=report dd of=output",
    "/usr/bin/time --o dd dd of=output",
    "/usr/bin/time --a --f dd --o report --p --q --verb dd of=output",
    "/usr/bin/time -qfFORMAT dd of=output",
    "/usr/bin/time -apqvfdd dd if=input",
    "/usr/bin/time -qo dd dd of=output",
    "/usr/bin/time --quiet -- dd of=output",
    "/usr/bin/time --format= --output-file=report --append --portability --quiet --verbose dd of=output",
    "'time' '--quiet' dd of=output",
    "command time --q dd of=output",
    "env time --output-f=report dd of=output",
    "sudo time -q dd of=output",
    "find . -exec time --q dd of=output \\;",
    "timeout 2 /usr/bin/time --q sh -c 'dd of=output'",
    "/usr/bin/time --output-file='dd of=output' sh -c 'dd if=input'",
    "/usr/bin/time --f='dd of=output' stdbuf -oL dd of=output",
    "sh -c '\"time\" --q dd of=output'",
    "time -- /usr/bin/time --q dd of=output",
    // Current Bash reserved-time syntax keeps raw option identity.
    "time -- dd of=output",
    "time -p -- dd of=output",
    "time -- command -p dd of=output",
    "time -p -- exec dd if=input",
    "time -- A=1 dd of=output",
    "time -p -- sh -c 'dd of=output'",
    "time -p -- time -- dd of=output",
    "'time' '-p' '--' dd of=output",
    "env time -p -- dd of=output",
    "time -\\\np -- dd of=output",
    // Literal launcher argv cases; these strings are never executed.
    "time dd if=input",
    "time -p dd of=output",
    "time command -p dd if=input",
    "time -p exec dd of=output",
    "time A=1 dd of=output",
    "/usr/bin/time dd if=input",
    "/usr/bin/time -f dd dd of=output",
    "/usr/bin/time -o dd -apv dd of=output",
    "/usr/bin/time --format=dd --output=dd --append --portability --verbose dd of=output",
    "\"time\" -f \"%e\" dd of=output",
    "'time' -o report dd if=input",
    "\\time -f dd dd of=output",
    "command time -f dd dd of=output",
    "env time -f dd dd of=output",
    "sudo time -p dd of=output",
    "find . -exec time -f dd dd of=output \\;",
    "time -p sh -c 'dd of=output'",
    "'time' -f dd sh -c 'dd if=input'",
    "stdbuf -i0 -oL -e0 dd of=output",
    "stdbuf --input=0 --output=L --error=0 dd if=input",
    "stdbuf -o L -- dd if=input",
    "ionice dd of=output",
    "ionice -c 2 -n 7 -t dd if=input",
    "ionice -tc2 -n7 dd of=output",
    "ionice --class=idle --classdata=7 --ignore dd of=output",
    "ionice -- dd if=input",
    "setsid dd of=output",
    "setsid -cfw dd if=input",
    "setsid --ctty --fork --wait -- dd of=output",
    "stdbuf -oL sh -c 'dd of=output'",
    "ionice -c2 sh -c 'dd of=output'",
    "setsid -w sh -c 'dd of=output'",
    "time -p stdbuf -oL ionice -c2 setsid -f env -S 'dd of=output'",
    "sudo -u root stdbuf -oL ionice -c2 setsid dd of=output",
    "find . -exec stdbuf -oL setsid dd of=output \\;",
    "find . -exec ionice -c2 setsid dd if=input \\;",
    "sh -c 'time -p stdbuf -oL dd of=output'",
    "setsid sh -c 'cat <<EOF\n$(dd of=output)\nEOF'",
    'dd if=/dev/zero of=/dev/sda',
    'dd of=/dev/sda bs=1M',
    'cat /dev/zero | dd of=/dev/sda',
    'sudo dd of=/dev/sda < /dev/zero',
    'dd bs=1M of="./output"',
    "timeout 60 bash -c 'dd if=/dev/zero of=/dev/sda'",
    "nohup sh -c 'dd if=input'",
    "nice -n 5 sh -c 'dd if=input'",
    "xargs sh -c 'dd if=input'",
    "timeout 2 sh -c 'dd of=output'",
    "nohup sh -c 'echo $(dd of=output)'",
    "nice -n 5 sh -c 'cat <<EOF\n$(dd of=output)\nEOF'",
    'find . -exec dd of=output \\;',
    'dd if=./image of=./out',
    'dd of=./out bs=1M if="./image"',
    "'/bin/dd' if=input of=output",
    'sudo -u root dd if=input',
    'command dd if=input of=output',
    'xargs dd if=input of=output',
    'xargs -- dd if=input',
    'xargs -0 -I{} dd if=input',
    'xargs -n 2 -P4 dd if=input',
    'xargs -a input --delimiter=, dd if=input',
    'xargs --max-args 2 dd if=input',
    'xargs -e dd if=input',
    'xargs -i dd if=input',
    'xargs --replace dd if=input',
    'xargs -J{} dd if=input',
    'timeout 2 dd if=input of=output',
    'timeout -k 1 -s TERM 2s dd if=input',
    'timeout --kill-after=1 --signal=TERM --foreground 2 dd if=input',
    'timeout -- 2 dd if=input',
    'nice dd if=input of=output',
    'nice -n 5 dd if=input',
    'nice --adjustment=-5 dd if=input',
    'nice -5 dd if=input',
    'nice --5 dd if=input',
    'nohup dd if=input of=output',
    'nohup -- dd if=input',
    'command nice -n 2 timeout 3 env A=1 dd if=input',
    'command -p dd if=input',
    'command -- dd if=input',
    'exec dd if=input of=output',
    'exec -a ddname dd if=input',
    'exec -addname dd if=input',
    'exec -cl dd if=input',
    'exec -- dd if=input',
    'A=1 command -p exec -a ddname dd if=input',
    'sudo --user=root dd if=input',
    'sudo -uroot dd if=input',
    'sudo -nu root dd if=input',
    'sudo -nuroot dd if=input',
    'doas -nu root dd if=input',
    'sudo -g staff dd if=input',
    'sudo --group staff dd if=input',
    'sudo -C 3 dd if=input',
    'sudo -D /tmp dd if=input',
    'sudo -- dd if=input',
    'doas -u root dd if=input',
    'doas -C /tmp/doas.conf dd if=input',
    'env -u FOO dd if=input',
    'env -uFOO dd if=input',
    'env -C /tmp dd if=input',
    'env -C/tmp dd if=input',
    'env --argv0 ddname dd if=input',
    'env -a ddname dd if=input',
    'env -addname dd if=input',
    'env --unset=FOO --chdir=/tmp --argv0=ddname dd if=input',
    'A=1 env B=2 sudo -u root dd if=input',
    'sudo A=1 dd if=input',
    "env -S 'dd if=input of=output'",
    "env --split-string='dd if=input'",
    'env -Sdd if=input',
    "env -iS 'dd if=input'",
    'env -iuFOO dd if=input',
    "env -S 'sudo -u root dd' if=input",
    "env -S 'sh -c \"dd if=input\"'",
    "env -S 'env -S \"dd if=input\"'",
    "env -S 'dd\\_if=input'",
    "env -S 'dd if=input # trailing comment'",
    String.raw`env -S 'dd "if=input\_file"'`,
    String.raw`env -S 'dd "if=input\"quote"'`,
    'echo $(dd if=input of=output)',
    'echo "$(dd if=./input)"',
    'echo `dd if=input`',
    '(dd if=input)',
    '{ dd if=input; }',
    'echo $({ (dd if=input); })',
    "sh -c 'echo $(dd if=input)'",
    "sh -c 'echo `dd if=input`'",
    "sh -c '(dd if=input)'",
    "sh -c 'cat <<EOF\n$(dd if=input)\nEOF'",
    "sh -c 'sh <<EOF\ndd if=input\nEOF'",
    'find . -exec dd if=input of=output \\;',
    'printf note; find . -exec dd if=input \\;',
    'echo "note; passive text"; find . -exec dd if=input \\;',
    "sh -c 'printf note; find . -exec dd if=input \\;'",
    'find . -exec sudo -u root dd if=input \\;',
    'find . -exec echo {} \\; -exec dd if=input of=output \\;',
    'find . -exec echo {} + -exec dd if=input \\;',
    'find . -exec echo + -exec dd if=argument \\; -exec dd if=actual \\;',
    'find . -execdir dd if=input \\;',
    'find . -ok dd if=input \\;',
    'find . -okdir dd if=input \\;',
    'find . -name -exec -exec dd if=input \\;',
    "find . -printf '-exec' -exec dd if=input \\;",
    "find . -fprintf '-exec' '-exec' -exec dd if=input \\;",
    ['cat <<EOF', '$(dd if=input)', 'EOF'].join('\n'),
    ['sh <<EOF', 'dd if=input', 'EOF'].join('\n'),
    ["cat <<'EOF'", 'dd if=input', 'EOF', 'dd if=after'].join('\n'),
    'sudo -u postgres psql -c "drop table users"',
    "env -S 'sudo -u postgres psql' -c 'drop table users'",
    "sh -c 'psql -c \"drop table users\"'",
    'git push --force origin main',
    'git push --force-with-lease origin main',
    `${'env '.repeat(40)}dd if=input`,
    'git reset --hard',
    'git stash clear',
    'git restore tracked.txt',
    "find . -exec 'rm' {} \\;"
  ];
  const passive = [
    // GNU external time option names, prefixes and values stay distinct.
    "/usr/bin/time --v dd of=output",
    "/usr/bin/time --ver dd of=output",
    "/usr/bin/time --quiet=value dd of=output",
    "/usr/bin/time --q=value dd of=output",
    "/usr/bin/time --append=dd dd of=output",
    "/usr/bin/time --portability=dd dd of=output",
    "/usr/bin/time --verbose=dd dd of=output",
    "/usr/bin/time --help dd of=output",
    "/usr/bin/time --h dd of=output",
    "/usr/bin/time --he dd of=output",
    "/usr/bin/time --version dd of=output",
    "/usr/bin/time --vers dd of=output",
    "/usr/bin/time -qV dd of=output",
    "/usr/bin/time --q --help dd of=output",
    "/usr/bin/time --output-file dd echo of=output",
    "/usr/bin/time --output-file=dd echo of=output",
    "/usr/bin/time --output-f=dd echo of=output",
    "/usr/bin/time --o dd echo of=output",
    "/usr/bin/time -qfdd echo of=output",
    "/usr/bin/time --f=dd echo of=output",
    "/usr/bin/time --output-file dd of=output",
    "/usr/bin/time --output-file",
    "/usr/bin/time --quiet --output-file",
    "/usr/bin/time --unknown dd of=output",
    "/usr/bin/time --quieter dd of=output",
    "/usr/bin/time --=dd dd of=output",
    "/usr/bin/time -- -q dd of=output",
    "/usr/bin/time echo --quiet dd of=output",
    "/usr/bin/time --q command dd of=output",
    "/usr/bin/time --q echo 'dd of=output'",
    "/usr/bin/time --output-file='sh -c dd of=output' echo safe",
    "/usr/bin/time -q sh -c 'echo \"dd of=output\"'",
    "echo '/usr/bin/time --q dd of=output'",
    "find . -name 'time --q dd of=output' -print",
    "find . -exec echo time --q dd of=output \\;",
    "time -q dd of=output",
    "time --quiet dd of=output",
    "time --output-file=report dd of=output",
    // Current Bash reserved-time syntax keeps raw option identity.
    "time '-p' dd of=output",
    "time \"-p\" dd of=output",
    "time \\-p dd of=output",
    "time -\\p dd of=output",
    "time '--' dd of=output",
    "time \"--\" dd of=output",
    "time \\-- dd of=output",
    "time -p '--' dd of=output",
    "time -p \\-- dd of=output",
    "time -- -p dd of=output",
    "time -p -p dd of=output",
    "time -p'' dd of=output",
    "time --'' dd of=output",
    "time -- command -v dd of=output",
    "time -- echo 'dd of=output'",
    // Literal launcher argv cases; these strings are never executed.
    "time echo dd if=input",
    "time -p command -v dd if=input",
    "time command -pV dd of=output",
    "time -p exec -a dd echo of=output",
    "time -f dd of=output",
    "/usr/bin/time -f dd echo of=output",
    "/usr/bin/time --format=dd echo if=input",
    "/usr/bin/time -o dd echo of=output",
    "/usr/bin/time --output=dd echo if=input",
    "/usr/bin/time -afdd echo if=input",
    "/usr/bin/time --help dd of=output",
    "/usr/bin/time --version dd if=input",
    "'time' -f dd echo of=output",
    "\\time -o dd echo if=input",
    "command time -f dd echo if=input",
    "env time command dd of=output",
    "A=1 time command dd of=output",
    "/usr/bin/time command dd of=output",
    "'time' command dd of=output",
    "stdbuf -o dd echo if=input",
    "stdbuf --input=dd echo of=output",
    "stdbuf -edd echo of=output",
    "stdbuf --help dd if=input",
    "stdbuf --version dd of=output",
    "stdbuf -oL echo 'dd of=output'",
    "stdbuf -oL command dd if=input",
    "ionice -c dd echo of=output",
    "ionice --classdata=dd echo if=input",
    "ionice -p 1 dd of=output",
    "ionice -p1 dd if=input",
    "ionice --pid=1 dd of=output",
    "ionice -P 1 dd if=input",
    "ionice --pgid 1 dd of=output",
    "ionice -u 1 dd if=input",
    "ionice --uid=1 dd of=output",
    "ionice -tc2 -p1 dd of=output",
    "ionice -h dd if=input",
    "ionice --help dd of=output",
    "ionice -V dd of=output",
    "ionice --version dd if=input",
    "ionice -c2 echo 'dd if=input'",
    "ionice -c2 command dd of=output",
    "setsid -h dd if=input",
    "setsid --help dd of=output",
    "setsid -V dd of=output",
    "setsid --version dd if=input",
    "setsid -w echo dd of=output",
    "setsid command dd if=input",
    "time -p stdbuf -oL ionice -c2 setsid echo 'dd of=output'",
    "setsid -w sh -c 'echo \"dd of=output\"'",
    "time -p sh -c 'cat <<EOF\ndd of=output\nEOF'",
    "echo 'time dd if=input; setsid dd of=output'",
    "printf '%s' 'stdbuf -oL dd if=input'",
    "find . -name \"time -p dd of=output\" -print",
    "find . -exec echo setsid dd of=output \\;",
    "env -S 'echo time dd if=input; setsid dd of=output'",
    'echo dd if=input',
    'echo dd of=/dev/sda',
    'grep dd of=output file',
    "printf '%s' 'dd of=output'",
    'dd count=0',
    "timeout 2 echo 'sh -c dd of=output'",
    "timeout 2 sh -c 'echo \"dd of=output\"'",
    "nohup sh -c 'cat <<EOF\ndd of=output\nEOF'",
    "nice -n 5 echo 'dd of=output'",
    "xargs echo 'sh -c dd of=output'",
    'echo "note; find . -exec dd of=output \\;"',
    'command -v dd',
    'command -v dd if=input',
    'command -V dd if=input',
    'command -V dd',
    'command -pv dd',
    'command -pV dd if=input',
    'command echo dd if=input',
    'xargs echo dd if=input',
    'xargs -I dd echo if=input',
    'xargs -d dd echo if=input',
    'xargs --arg-file dd echo if=input',
    'xargs -edd echo if=input',
    'xargs --replace=dd echo if=input',
    'xargs --help dd if=input',
    'timeout 2 echo dd if=input',
    'timeout -s dd 2 echo if=input',
    'timeout --help dd if=input',
    'nice -n 2 echo dd if=input',
    'nice --version dd if=input',
    'nohup echo dd if=input',
    'nohup --help dd if=input',
    'xargs command dd if=input',
    'timeout 2 command dd if=input',
    'exec -a dd echo if=input',
    'exec -add echo if=input',
    'exec echo dd if=input',
    'command A=1 dd if=input',
    "echo 'command dd if=input'",
    "echo 'exec dd if=input'",
    'sudo command dd if=input',
    'env command dd if=input',
    'exec command dd if=input',
    'grep dd if=/dev/zero file',
    "printf '%s' 'dd if=input'",
    'echo add if=1',
    'echo truncated',
    'sudo -u dd echo if=input',
    'sudo --user=dd echo if=input',
    'sudo -udd echo if=input',
    'sudo -nu dd echo if=input',
    'doas -nu dd echo if=input',
    'env -iu dd echo if=input',
    'doas -u dd echo if=input',
    'env -u dd echo if=input',
    'env -C dd echo if=input',
    'env --argv0 dd echo if=input',
    'env -a dd echo if=input',
    'env -- -u dd if=input',
    'A=dd echo if=input',
    'echo sudo -u root dd if=input',
    "env -S 'echo dd if=input'",
    String.raw`env -S 'echo "dd if=input\"quote"'`,
    "env -S 'echo ok; dd if=input'",
    "env -S 'echo ok | dd if=input'",
    "env -S 'echo ok & dd if=input'",
    "env -S 'echo $(dd if=input)'",
    "env -S 'echo `dd if=input`'",
    "env -S 'echo # dd if=input'",
    "env -S 'echo\\c dd if=input'",
    "env -S 'echo \\$(dd if=input)'",
    "echo 'env -S dd if=input'",
    "env -S ''",
    'env -S',
    "env -S '\"dd if=input'",
    "env -S 'dd if=input\\q'",
    "env -S '${UNREAD_HOST_COMMAND} if=input'",
    "echo '$(dd if=input)'",
    "echo '`dd if=input`'",
    "echo '(dd if=input)'",
    "echo '{ dd if=input; }'",
    "sh -c 'echo \"dd if=input\"'",
    "sh -c 'cat <<EOF\ndd if=input\nEOF'",
    ["cat <<'EOF'", 'dd if=input; $(dd if=input)', 'EOF'].join('\n'),
    ['cat <<EOF', 'dd if=input', 'EOF'].join('\n'),
    ['cat <<EOF', '\\$(dd if=input)', 'EOF'].join('\n'),
    'psql -c "SELECT \'drop table\' FROM audit_log"',
    'echo "drop table users"',
    'git commit -m "drop table users"',
    'git push --force-with-lease origin feature-branch',
    'echo "note; find . -exec dd if=input \\;"',
    "printf '%s' 'note; find . -exec dd if=input \\;'",
    'echo "note | find . -exec dd if=input \\;"',
    'echo "note & find . -exec dd if=input \\;"',
    "find . -name 'x -exec dd if=input' -print",
    'find . -exec echo -exec dd if=input \\;',
    'find . -exec echo + -exec dd if=input \\;',
    "find . -exec echo '-exec dd if=input' \\;",
    'find . -execdir echo dd if=input \\;',
    'find . -ok echo -exec dd if=input \\;',
    'find . -okdir echo dd if=input \\;',
    'find . -exec command dd if=input \\;',
    'git status',
    'git diff --stat',
    'git restore --staged tracked.txt'
  ];
  try {
    hook = loadDirectHook();
    // Launcher operands stay data; only the resolved SQL client consumes SQL.
    const wrappedSqlDestructive = [
      'timeout 5 psql -c "drop table users"',
      'time psql -c "truncate audit_log"',
      '/usr/bin/time -f "%E" psql -c "drop table users"',
      '/usr/bin/time -q --output-file timing.log mysql -e "delete from sessions"',
      'nice -n 5 mariadb -e "delete from sessions"',
      'nohup sqlite3 fixture.db "drop table users"',
      'stdbuf -oL psql -c "truncate audit_log"',
      'ionice -c 2 -n 4 psql -c "drop table users"',
      'setsid -w sqlcmd -Q "drop table users"',
      'xargs -r -n 1 psql -c "drop table users"',
      "env -S 'timeout 5 psql' -c 'drop table users'",
      'timeout 5 nice -n 1 nohup psql -c "drop table users"',
      'time -p command -- psql -c "truncate audit_log"',
      "timeout 5 sh -c 'psql -c \"drop table users\"'"
    ];
    const wrappedSqlPassive = [
      'timeout 5 echo "psql -c drop table users"',
      'time -p printf "%s" "truncate audit_log"',
      '/usr/bin/time -f "psql drop table" echo ok',
      '/usr/bin/time -o psql echo "drop table users"',
      'nice -n psql echo "drop table users"',
      'ionice -c psql echo "drop table users"',
      'stdbuf -o psql echo "drop table users"',
      'xargs -I psql echo "drop table users"',
      'xargs -E psql echo "drop table users"',
      'setsid --help psql -c "drop table users"',
      'ionice -p 123 psql -c "drop table users"',
      '/usr/bin/time --help psql -c "drop table users"',
      '/usr/bin/time --version psql -c "drop table users"',
      'command -v psql "drop table users"',
      'timeout 5 psql -c "SELECT \'drop table\' AS label"',
      "time '-p' psql -c 'drop table users'",
      'env time command psql -c "drop table users"',
      'echo "timeout 5 psql -c drop table users"'
    ];
    for (const [commands, expected] of [
      [wrappedSqlDestructive, ['gateguard.bash-compatible-destructive']],
      [wrappedSqlPassive, []]
    ]) {
      for (const command of commands) {
        check(`SQL launcher classification: ${JSON.stringify(command)}`, () => {
          assert.deepStrictEqual(hook.classifyDestructiveCommand('Bash', command), expected);
        });
      }
    }
    for (const command of destructive) {
      check(`dd/preservation destructive: ${JSON.stringify(command)}`, () => {
        assert.deepStrictEqual(hook.classifyDestructiveCommand('Bash', command), [
          'gateguard.bash-compatible-destructive'
        ]);
      });
    }
    for (const command of passive) {
      check(`dd/preservation passive: ${JSON.stringify(command)}`, () => {
        assert.deepStrictEqual(hook.classifyDestructiveCommand('Bash', command), []);
      });
    }
    for (const [command, denied] of [
      ['sudo -u root dd if=input', true],
      ["sh -c 'echo $(dd if=input)'", true],
      ['sudo -u dd echo if=input', false],
      ["env -S 'echo ok; dd if=input'", false],
      ['find . -exec echo {} \\; -exec dd if=input \\;', true],
      ['command -pv dd', false],
      ["timeout 2 sh -c 'dd if=input'", true],
      ['cat /dev/zero | dd of=/dev/sda', true]
    ]) {
      check(`dd hook-input contract: ${command}`, () => {
        fs.rmSync(stateDir, { recursive: true, force: true });
        fs.mkdirSync(stateDir, { recursive: true });
        const input = { tool_name: 'Bash', tool_input: { command } };
        const result = spawnSync(process.execPath, [runner, 'pre:bash:gateguard-fact-force',
          'scripts/hooks/gateguard-fact-force.js', 'standard,strict'], {
          input: JSON.stringify(input), encoding: 'utf8', timeout: 15000,
          env: { ...process.env, ...environment }, stdio: ['pipe', 'pipe', 'pipe']
        });
        assert.ifError(result.error);
        assert.strictEqual(result.status, 0, result.stderr);
        const output = JSON.parse(result.stdout);
        if (denied) {
          assert.strictEqual(output.hookSpecificOutput.permissionDecision, 'deny');
          assert.match(output.hookSpecificOutput.permissionDecisionReason, /Destructive/);
        } else {
          assert.deepStrictEqual(output, input, 'allow must be actual JSON pass-through, not silence');
        }
      });
    }
    check('main batch warning and invisible-path sanitizer stay intact', () => {
      fs.rmSync(stateDir, { recursive: true, force: true });
      fs.mkdirSync(stateDir, { recursive: true });
      const result = hook.run({ tool_name: 'Write', tool_input: { file_path: '/src/a\u0091b\u200bc.js' } });
      assert.strictEqual(result.exitCode, 0);
      const output = JSON.parse(result.stdout).hookSpecificOutput;
      assert.strictEqual(output.permissionDecision, 'deny');
      assert.match(output.permissionDecisionReason, /parallel batch/);
      assert.ok(!output.permissionDecisionReason.includes('\u0091'));
      assert.ok(!output.permissionDecisionReason.includes('\u200b'));
      assert.match(output.permissionDecisionReason, /c\.js/);
    });
    check('disabled hook remains silent through the routing wrapper', () => {
      const result = spawnSync(process.execPath, [runner, 'pre:bash:gateguard-fact-force',
        'scripts/hooks/gateguard-fact-force.js', 'standard,strict'], {
        input: JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'dd if=input' } }),
        encoding: 'utf8', timeout: 15000,
        env: { ...process.env, ...environment, ECC_DISABLED_HOOKS: 'pre:bash:gateguard-fact-force' },
        stdio: ['pipe', 'pipe', 'pipe']
      });
      assert.ifError(result.error);
      assert.strictEqual(result.status, 0, result.stderr);
      assert.strictEqual(result.stdout, '');
    });
    return { passed, failed };
  } finally {
    fs.rmSync(stateDir, { recursive: true, force: true });
    for (const [key, value] of Object.entries(original)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    delete require.cache[require.resolve(hookScript)];
  }
}

function runTests() {
  console.log('\n=== Testing gateguard-fact-force ===\n');

  let passed = 0;
  let failed = 0;

  // --- Test 1: denies first Edit per file ---
  clearState();
  if (
    test('denies first Edit per file with fact-forcing message', () => {
      const input = {
        tool_name: 'Edit',
        tool_input: { file_path: '/src/app.js', old_string: 'export function foo() {', new_string: 'export function bar() {' }
      };
      const result = runHook(input);
      assert.strictEqual(result.code, 0, 'exit code should be 0');
      const output = parseOutput(result.stdout);
      assert.ok(output, 'should produce JSON output');
      assert.strictEqual(output.hookSpecificOutput.permissionDecision, 'deny');
      assert.ok(output.hookSpecificOutput.permissionDecisionReason.includes('Fact-Forcing Gate'));
      assert.ok(output.hookSpecificOutput.permissionDecisionReason.includes('import/require'));
      assert.ok(output.hookSpecificOutput.permissionDecisionReason.includes('/src/app.js'));
      assert.ok(output.hookSpecificOutput.permissionDecisionReason.includes('GATEGUARD_EXEMPT_GLOBS'), 'Edit denial should show the path-scoped exemption control');
      assert.ok(!output.hookSpecificOutput.permissionDecisionReason.includes('GATEGUARD_BASH_ROUTINE_DISABLED'), 'Edit denial should not suggest the routine Bash control');
    })
  )
    passed++;
  else failed++;

  // --- Test 2: allows second Edit on same file ---
  if (
    test('allows second Edit on same file (gate already passed)', () => {
      const input = {
        tool_name: 'Edit',
        tool_input: { file_path: '/src/app.js', old_string: 'foo', new_string: 'bar' }
      };
      const result = runHook(input);
      assert.strictEqual(result.code, 0, 'exit code should be 0');
      const output = parseOutput(result.stdout);
      assert.ok(output, 'should produce valid JSON output');
      // When allowed, the hook passes through the raw input (no hookSpecificOutput)
      // OR if hookSpecificOutput exists, it must not be deny
      if (output.hookSpecificOutput) {
        assert.notStrictEqual(output.hookSpecificOutput.permissionDecision, 'deny', 'should not deny second edit on same file');
      } else {
        // Pass-through: output matches original input (allow)
        assert.strictEqual(output.tool_name, 'Edit', 'pass-through should preserve input');
      }
    })
  )
    passed++;
  else failed++;

  // --- Test 3: denies first Write per file ---
  clearState();
  if (
    test('denies first Write per file with fact-forcing message', () => {
      const input = {
        tool_name: 'Write',
        tool_input: { file_path: '/src/new-file.js', content: 'console.log("hello")' }
      };
      const result = runHook(input);
      assert.strictEqual(result.code, 0, 'exit code should be 0');
      const output = parseOutput(result.stdout);
      assert.ok(output, 'should produce JSON output');
      assert.strictEqual(output.hookSpecificOutput.permissionDecision, 'deny');
      assert.ok(output.hookSpecificOutput.permissionDecisionReason.includes('creating'));
      assert.ok(output.hookSpecificOutput.permissionDecisionReason.includes('call this new file'));
    })
  )
    passed++;
  else failed++;

  // --- Test 3b: fails open when retry state cannot be persisted ---
  clearState();
  if (
    test('fails open with warning when state path cannot be persisted', () => {
      const invalidStateDir = path.join(stateDir, 'not-a-directory');
      fs.writeFileSync(invalidStateDir, 'not a directory', 'utf8');

      const input = {
        tool_name: 'Write',
        tool_input: { file_path: '/src/state-failure.js', content: 'module.exports = {};' }
      };
      const result = runHook(input, { GATEGUARD_STATE_DIR: invalidStateDir });
      assert.strictEqual(result.code, 0, 'exit code should be 0');
      assert.strictEqual(result.stdout, '', 'fail-open result without an explicit decision must stay silent');
      assert.ok(result.stderr.includes('GateGuard state could not be persisted'), 'should warn that state persistence failed');
    })
  )
    passed++;
  else failed++;

  // --- Test 4: denies destructive Bash, allows retry ---
  clearState();
  if (
    test('denies destructive Bash commands, allows retry after facts presented', () => {
      const input = {
        tool_name: 'Bash',
        tool_input: { command: 'rm -rf /important/data' }
      };

      // First call: should deny
      const result1 = runBashHook(input);
      assert.strictEqual(result1.code, 0, 'first call exit code should be 0');
      const output1 = parseOutput(result1.stdout);
      assert.ok(output1, 'first call should produce JSON output');
      assert.strictEqual(output1.hookSpecificOutput.permissionDecision, 'deny');
      assert.ok(output1.hookSpecificOutput.permissionDecisionReason.includes('Destructive'));
      assert.ok(output1.hookSpecificOutput.permissionDecisionReason.includes('rollback'));

      // Second call (retry after facts presented): should allow
      const result2 = runBashHook(input);
      assert.strictEqual(result2.code, 0, 'second call exit code should be 0');
      const output2 = parseOutput(result2.stdout);
      assert.ok(output2, 'second call should produce valid JSON output');
      if (output2.hookSpecificOutput) {
        assert.notStrictEqual(output2.hookSpecificOutput.permissionDecision, 'deny', 'should not deny destructive bash retry after facts presented');
      } else {
        assert.strictEqual(output2.tool_name, 'Bash', 'pass-through should preserve input');
      }
    })
  )
    passed++;
  else failed++;

  // --- Test 4b: dd targets that do not start with a word character ---
  /**
   * #2642: DESTRUCTIVE_SQL_DD carried one trailing \b across every alternation
   * arm. `dd\s+if=` ends in `=`, so that \b demanded the NEXT character be a
   * word character: `dd if=x` was denied while the disk-wipe spelling
   * `dd if=/dev/zero of=/dev/sda` and the relative `dd if=./img` were allowed.
   * These run through the real hook, since the report is specifically that the
   * published hook lets the slash-prefixed form through.
   */
  for (const command of [
    'dd if=/dev/zero of=/dev/sda',
    'dd if=./disk.img of=/dev/sdb',
    'dd if="/dev/zero" of=/dev/sda',
    // Wrapped invocations must still resolve to the dd command word.
    'sudo dd if=/dev/zero of=/dev/sda',
    // dd operands are order-free; a text pattern anchored on `dd if=` missed
    // both the reversed and the intervening-option spellings.
    'dd of=/dev/sda if=/dev/zero',
    'dd bs=1M if=/dev/zero of=/dev/sda'
  ]) {
    clearState();
    if (
      test(`denies dd whose input path is not word-initial: ${command}`, () => {
        const result = runBashHook({ tool_name: 'Bash', tool_input: { command } });
        assert.strictEqual(result.code, 0, `hook should exit successfully for ${command}`);
        const output = parseOutput(result.stdout);
        assert.ok(output, 'hook should produce JSON output');
        assert.ok(output.hookSpecificOutput, 'hook should return a permission decision');
        assert.strictEqual(
          output.hookSpecificOutput.permissionDecision,
          'deny',
          `${command} must be gated as destructive`
        );
        assert.ok(output.hookSpecificOutput.permissionDecisionReason.includes('Destructive'));
      })
    )
      passed++;
    else failed++;
  }

  // --- Test 4c: widening the dd arm must not gate ordinary commands ---
  /**
   * SQL keywords retain their word boundaries; dd is checked only at command
   * position. `truncated`, `add if=` and prose mentioning dd stay passive.
   */
  for (const command of [
    'echo add if=1',
    'echo truncated output',
    'git status',
    // `dd if=` as another command's argument runs no dd at all. The old text
    // match gated these; the command-word check is what keeps them out.
    'echo dd if=/dev/zero',
    'grep dd if=/dev/zero file',
    'echo dd if=x'
  ]) {
    clearState();
    if (
      test(`does not gate as destructive: ${command}`, () => {
        // Prime the session so the separate first-command routine gate cannot
        // be mistaken for a destructive denial.
        runBashHook({ tool_name: 'Bash', tool_input: { command: 'printf ready' } });
        const result = runBashHook({ tool_name: 'Bash', tool_input: { command } });
        // Assert the hook actually answered before reading the decision: a
        // crashed or silent hook makes parseOutput return null, and a bare
        // `if (output)` would let this case pass without testing anything.
        assert.strictEqual(result.code, 0, `hook should exit 0 for ${command}`);
        const output = parseOutput(result.stdout);
        assert.ok(output, `hook should produce JSON output for ${command}`);
        const decision = output.hookSpecificOutput;
        if (decision) {
          const reason = decision.permissionDecisionReason || '';
          assert.ok(
            decision.permissionDecision !== 'deny' || !reason.includes('Destructive'),
            `${command} must not be gated as destructive`
          );
        } else {
          // Pass-through echoes the input back unchanged.
          assert.strictEqual(output.tool_name, 'Bash', 'pass-through should preserve input');
        }
      })
    )
      passed++;
    else failed++;
  }

  // --- Test 5: denies first routine Bash, allows second ---
  clearState();
  if (
    test('allows safe git push --force-with-lease without destructive gate', () => {
      writeState({
        checked: ['__bash_session__'],
        last_active: Date.now()
      });

      const input = {
        tool_name: 'Bash',
        tool_input: { command: 'git push --force-with-lease origin feature-branch' }
      };
      const result = runBashHook(input);
      assert.strictEqual(result.code, 0, 'exit code should be 0');
      const output = parseOutput(result.stdout);
      assert.ok(output, 'should produce valid JSON output');
      if (output.hookSpecificOutput) {
        assert.notStrictEqual(output.hookSpecificOutput.permissionDecision, 'deny', 'safe lease-protected force push should not be denied');
      } else {
        assert.strictEqual(output.tool_name, 'Bash', 'pass-through should preserve input');
      }
    })
  )
    passed++;
  else failed++;

  // --- Test 6: gates amend as destructive Bash ---
  clearState();
  if (
    test('denies git commit --amend as destructive Bash', () => {
      const input = {
        tool_name: 'Bash',
        tool_input: { command: 'git commit --amend --no-edit' }
      };
      const result = runBashHook(input);
      assert.strictEqual(result.code, 0, 'exit code should be 0');
      const output = parseOutput(result.stdout);
      assert.ok(output, 'should produce JSON output');
      assert.strictEqual(output.hookSpecificOutput.permissionDecision, 'deny');
      assert.ok(output.hookSpecificOutput.permissionDecisionReason.includes('Destructive'));
      assert.ok(output.hookSpecificOutput.permissionDecisionReason.includes('rollback'));
    })
  )
    passed++;
  else failed++;

  // --- Test 7: still gates plain force push as destructive Bash ---
  clearState();
  if (
    test('denies plain git push --force as destructive Bash', () => {
      const input = {
        tool_name: 'Bash',
        tool_input: { command: 'git push --force origin feature-branch' }
      };
      const result = runBashHook(input);
      assert.strictEqual(result.code, 0, 'exit code should be 0');
      const output = parseOutput(result.stdout);
      assert.ok(output, 'should produce JSON output');
      assert.strictEqual(output.hookSpecificOutput.permissionDecision, 'deny');
      assert.ok(output.hookSpecificOutput.permissionDecisionReason.includes('Destructive'));
      assert.ok(output.hookSpecificOutput.permissionDecisionReason.includes('rollback'));
    })
  )
    passed++;
  else failed++;

  /**
   * Test 7b: `git checkout -f <branch>` (force checkout) discards uncommitted
   * working-tree changes, so it must be gated as destructive Bash.
   */
  clearState();
  if (
    test('denies git checkout -f as destructive Bash', () => {
      const input = {
        tool_name: 'Bash',
        tool_input: { command: 'git checkout -f main' }
      };
      const result = runBashHook(input);
      assert.strictEqual(result.code, 0, 'exit code should be 0');
      const output = parseOutput(result.stdout);
      assert.ok(output, 'should produce JSON output');
      assert.strictEqual(output.hookSpecificOutput.permissionDecision, 'deny');
      assert.ok(output.hookSpecificOutput.permissionDecisionReason.includes('Destructive'));
      assert.ok(output.hookSpecificOutput.permissionDecisionReason.includes('rollback'));
    })
  )
    passed++;
  else failed++;

  // --- Test 8: denies first routine Bash, allows second ---
  clearState();
  if (
    test('denies first routine Bash, allows second', () => {
      const input = {
        tool_name: 'Bash',
        tool_input: { command: 'npm test' }
      };

      // First call: should deny
      const result1 = runBashHook(input);
      assert.strictEqual(result1.code, 0, 'first call exit code should be 0');
      const output1 = parseOutput(result1.stdout);
      assert.ok(output1, 'first call should produce JSON output');
      assert.strictEqual(output1.hookSpecificOutput.permissionDecision, 'deny');

      // Second call: should allow
      const result2 = runBashHook(input);
      assert.strictEqual(result2.code, 0, 'second call exit code should be 0');
      const output2 = parseOutput(result2.stdout);
      assert.ok(output2, 'second call should produce valid JSON output');
      if (output2.hookSpecificOutput) {
        assert.notStrictEqual(output2.hookSpecificOutput.permissionDecision, 'deny', 'should not deny second routine bash');
      } else {
        assert.strictEqual(output2.tool_name, 'Bash', 'pass-through should preserve input');
      }
    })
  )
    passed++;
  else failed++;

  // --- Test 6: session state resets after timeout ---
  if (
    test('session state resets after the idle window', () => {
      writeExpiredState();
      const input = {
        tool_name: 'Edit',
        tool_input: { file_path: 'some_file.js', old_string: 'a', new_string: 'b' }
      };
      const result = runHook(input);
      assert.strictEqual(result.code, 0, 'exit code should be 0');
      const output = parseOutput(result.stdout);
      assert.ok(output, 'should produce JSON output after expired state');
      assert.strictEqual(output.hookSpecificOutput.permissionDecision, 'deny', 'should deny again after session timeout (state was reset)');
    })
  )
    passed++;
  else failed++;

  // --- Test 7: allows unknown tool names ---
  clearState();
  if (
    test('allows unknown tool names through', () => {
      const input = {
        tool_name: 'Read',
        tool_input: { file_path: '/src/app.js' }
      };
      const result = runHook(input);
      assert.strictEqual(result.code, 0, 'exit code should be 0');
      const output = parseOutput(result.stdout);
      assert.ok(output, 'should produce valid JSON output');
      if (output.hookSpecificOutput) {
        assert.notStrictEqual(output.hookSpecificOutput.permissionDecision, 'deny', 'should not deny unknown tool');
      } else {
        assert.strictEqual(output.tool_name, 'Read', 'pass-through should preserve input');
      }
    })
  )
    passed++;
  else failed++;

  // --- Test 8: sanitizes file paths with newlines ---
  clearState();
  if (
    test('sanitizes file paths containing newlines', () => {
      const input = {
        tool_name: 'Edit',
        tool_input: { file_path: '/src/app.js\ninjected content', old_string: 'a', new_string: 'b' }
      };
      const result = runHook(input);
      assert.strictEqual(result.code, 0, 'exit code should be 0');
      const output = parseOutput(result.stdout);
      assert.ok(output, 'should produce JSON output');
      assert.strictEqual(output.hookSpecificOutput.permissionDecision, 'deny');
      const reason = output.hookSpecificOutput.permissionDecisionReason;
      // The file path portion of the reason must not contain any raw newlines
      // (sanitizePath replaces \n and \r with spaces)
      const pathLine = reason.split('\n').find(l => l.includes('/src/app.js'));
      assert.ok(pathLine, 'reason should mention the file path');
      assert.ok(!pathLine.includes('\n'), 'file path line must not contain raw newlines');
      assert.ok(!reason.includes('/src/app.js\n'), 'newline after file path should be sanitized');
      assert.ok(!reason.includes('\ninjected'), 'injected content must not appear on its own line');
    })
  )
    passed++;
  else failed++;

  // --- Test 9: respects ECC_DISABLED_HOOKS ---
  clearState();
  if (
    test('respects ECC_DISABLED_HOOKS (skips when disabled)', () => {
      const input = {
        tool_name: 'Edit',
        tool_input: { file_path: '/src/disabled.js', old_string: 'a', new_string: 'b' }
      };
      const result = runHook(input, {
        ECC_DISABLED_HOOKS: 'pre:edit-write:gateguard-fact-force'
      });

      assert.strictEqual(result.code, 0, 'exit code should be 0');
      assert.strictEqual(result.stdout, '', 'disabled wrapper hook must stay silent');
    })
  )
    passed++;
  else failed++;

  // --- Test 10: respects direct GateGuard env disable for recovery sessions ---
  clearState();
  if (
    test('respects ECC_GATEGUARD=off without writing gate state', () => {
      const input = {
        tool_name: 'Write',
        tool_input: { file_path: '/src/env-disabled.js', content: 'export const ok = true;' }
      };
      const result = runHook(input, { ECC_GATEGUARD: 'off' });
      const output = parseOutput(result.stdout);

      assert.ok(output, 'should produce valid JSON output');
      assert.strictEqual(output.tool_name, 'Write', 'disabled gate should pass through raw input');
      assert.ok(!output.hookSpecificOutput, 'disabled gate should not deny the operation');
      assert.ok(!fs.existsSync(stateFile), 'disabled gate should not create or mutate gate state');
    })
  )
    passed++;
  else failed++;

  // --- Test 11: respects legacy GATEGUARD_DISABLED env disable ---
  clearState();
  if (
    test('respects GATEGUARD_DISABLED=1 for Bash recovery', () => {
      const input = {
        tool_name: 'Bash',
        tool_input: { command: 'npm test' }
      };
      const result = runBashHook(input, { GATEGUARD_DISABLED: '1' });
      const output = parseOutput(result.stdout);

      assert.ok(output, 'should produce valid JSON output');
      assert.strictEqual(output.tool_name, 'Bash', 'disabled gate should pass Bash through raw input');
      assert.ok(!output.hookSpecificOutput, 'disabled gate should not deny Bash');
      assert.ok(!fs.existsSync(stateFile), 'disabled gate should not create or mutate gate state');
    })
  )
    passed++;
  else failed++;

  // --- Test 12: legacy GATEGUARD_DISABLED compatibility is scoped to =1 ---
  clearState();
  if (
    test('does not treat GATEGUARD_DISABLED=true as a disable flag', () => {
      const input = {
        tool_name: 'Bash',
        tool_input: { command: 'npm test' }
      };
      const result = runBashHook(input, { GATEGUARD_DISABLED: 'true' });
      const output = parseOutput(result.stdout);

      assert.strictEqual(output.hookSpecificOutput.permissionDecision, 'deny');
      assert.ok(output.hookSpecificOutput.permissionDecisionReason.includes('current user request'));
    })
  )
    passed++;
  else failed++;

  // --- Test 13: denial messages show an escape hatch ---
  clearState();
  if (
    test('denial messages include direct recovery escape hatch', () => {
      const input = {
        tool_name: 'Write',
        tool_input: { file_path: '/src/recovery-hint.js', content: 'export const ok = true;' }
      };
      const result = runHook(input);
      const output = parseOutput(result.stdout);

      assert.strictEqual(output.hookSpecificOutput.permissionDecision, 'deny');
      assert.ok(output.hookSpecificOutput.permissionDecisionReason.includes('ECC_GATEGUARD=off'), 'denial reason should show the direct recovery env toggle');
      assert.ok(output.hookSpecificOutput.permissionDecisionReason.includes('ECC_DISABLED_HOOKS'), 'denial reason should mention the existing hook-id disable control');
      assert.ok(output.hookSpecificOutput.permissionDecisionReason.includes('GATEGUARD_EXEMPT_GLOBS'), 'Edit/Write denial should show the path-scoped exemption control');
      assert.ok(!output.hookSpecificOutput.permissionDecisionReason.includes('GATEGUARD_BASH_ROUTINE_DISABLED'), 'Edit/Write denial should not suggest the routine Bash control');
    })
  )
    passed++;
  else failed++;

  // --- Test 14: routine Bash denial messages show the Bash hook escape hatch ---
  clearState();
  if (
    test('routine Bash denials include Bash hook disable id', () => {
      const input = {
        tool_name: 'Bash',
        tool_input: { command: 'npm test' }
      };
      const result = runBashHook(input);
      const output = parseOutput(result.stdout);
      const reason = output.hookSpecificOutput.permissionDecisionReason;

      assert.strictEqual(output.hookSpecificOutput.permissionDecision, 'deny');
      assert.ok(reason.includes('pre:bash:gateguard-fact-force'), 'routine Bash denial should show the Bash hook ID');
      assert.ok(!reason.includes('pre:edit-write:gateguard-fact-force'), 'routine Bash denial should not show the Edit/Write hook ID as the targeted disable');
      assert.ok(reason.includes('GATEGUARD_BASH_ROUTINE_DISABLED=1'), 'routine Bash denial should show the narrow routine-gate control');
      assert.ok(reason.includes('destructive Bash checks remain active'), 'routine Bash denial should preserve the destructive-check safety boundary');
      assert.ok(!reason.includes('GATEGUARD_EXEMPT_GLOBS'), 'routine Bash denial should not suggest the Edit/Write path control');
    })
  )
    passed++;
  else failed++;

  // --- Test 15: destructive Bash denials do not advertise the recovery escape hatch ---
  clearState();
  if (
    test('destructive Bash denials omit recovery escape hatch', () => {
      const input = {
        tool_name: 'Bash',
        tool_input: { command: 'rm -rf /tmp/demo' }
      };
      const result = runBashHook(input);
      const output = parseOutput(result.stdout);

      assert.strictEqual(output.hookSpecificOutput.permissionDecision, 'deny');
      assert.ok(output.hookSpecificOutput.permissionDecisionReason.includes('Destructive command detected'));
      assert.ok(!output.hookSpecificOutput.permissionDecisionReason.includes('ECC_GATEGUARD=off'), 'destructive gate should not advertise disabling GateGuard');
      assert.ok(!output.hookSpecificOutput.permissionDecisionReason.includes('ECC_DISABLED_HOOKS'), 'destructive gate should not advertise disabling its hook');
      assert.ok(!output.hookSpecificOutput.permissionDecisionReason.includes('GATEGUARD_BASH_ROUTINE_DISABLED'), 'destructive gate should not advertise the routine-only bypass');
      assert.ok(!output.hookSpecificOutput.permissionDecisionReason.includes('GATEGUARD_EXEMPT_GLOBS'), 'destructive gate should not advertise the Edit/Write path exemption');
    })
  )
    passed++;
  else failed++;

  // --- Test 16: MultiEdit gates first unchecked file ---
  clearState();
  if (
    test('denies first MultiEdit with unchecked file', () => {
      const input = {
        tool_name: 'MultiEdit',
        tool_input: {
          edits: [
            { file_path: '/src/multi-a.js', old_string: 'a', new_string: 'b' },
            { file_path: '/src/multi-b.js', old_string: 'c', new_string: 'd' }
          ]
        }
      };
      const result = runHook(input);
      assert.strictEqual(result.code, 0, 'exit code should be 0');
      const output = parseOutput(result.stdout);
      assert.ok(output, 'should produce JSON output');
      assert.strictEqual(output.hookSpecificOutput.permissionDecision, 'deny');
      assert.ok(output.hookSpecificOutput.permissionDecisionReason.includes('Fact-Forcing Gate'));
      assert.ok(output.hookSpecificOutput.permissionDecisionReason.includes('/src/multi-a.js'));
      assert.ok(output.hookSpecificOutput.permissionDecisionReason.includes('GATEGUARD_EXEMPT_GLOBS'), 'MultiEdit denial should show the path-scoped exemption control');
    })
  )
    passed++;
  else failed++;

  // --- Test 11: MultiEdit allows after all files gated ---
  if (
    test('allows MultiEdit after all files gated', () => {
      // multi-a.js was gated in test 10; gate multi-b.js
      const input2 = {
        tool_name: 'MultiEdit',
        tool_input: { edits: [{ file_path: '/src/multi-b.js', old_string: 'c', new_string: 'd' }] }
      };
      runHook(input2); // gates multi-b.js

      // Now both files are gated — retry should allow
      const input3 = {
        tool_name: 'MultiEdit',
        tool_input: {
          edits: [
            { file_path: '/src/multi-a.js', old_string: 'a', new_string: 'b' },
            { file_path: '/src/multi-b.js', old_string: 'c', new_string: 'd' }
          ]
        }
      };
      const result3 = runHook(input3);
      const output3 = parseOutput(result3.stdout);
      assert.ok(output3, 'should produce valid JSON');
      if (output3.hookSpecificOutput) {
        assert.notStrictEqual(output3.hookSpecificOutput.permissionDecision, 'deny', 'should allow MultiEdit after all files gated');
      }
    })
  )
    passed++;
  else failed++;

  // --- Test 12: hot-path reads do not rewrite state within heartbeat ---
  clearState();
  if (
    test('does not rewrite state on hot-path reads within heartbeat window', () => {
      const recentlyActive = Date.now() - (READ_HEARTBEAT_MS - 10 * 1000);
      writeState({
        checked: ['/src/keep-alive.js'],
        last_active: recentlyActive
      });

      const beforeStat = fs.statSync(stateFile);
      const before = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
      assert.strictEqual(before.last_active, recentlyActive, 'seed state should use the expected timestamp');

      const result = runHook({
        tool_name: 'Edit',
        tool_input: { file_path: '/src/keep-alive.js', old_string: 'a', new_string: 'b' }
      });
      const output = parseOutput(result.stdout);
      assert.ok(output, 'should produce valid JSON output');
      if (output.hookSpecificOutput) {
        assert.notStrictEqual(output.hookSpecificOutput.permissionDecision, 'deny', 'already-checked file should still be allowed');
      }

      const afterStat = fs.statSync(stateFile);
      const after = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
      assert.strictEqual(after.last_active, recentlyActive, 'read should not touch last_active within heartbeat');
      assert.strictEqual(afterStat.mtimeMs, beforeStat.mtimeMs, 'read should not rewrite the state file within heartbeat');
    })
  )
    passed++;
  else failed++;

  // --- Test 13: reads refresh stale active state after heartbeat ---
  clearState();
  if (
    test('refreshes last_active after heartbeat elapses', () => {
      const staleButActive = Date.now() - (READ_HEARTBEAT_MS + 5 * 1000);
      writeState({
        checked: ['/src/keep-alive.js'],
        last_active: staleButActive
      });

      const result = runHook({
        tool_name: 'Edit',
        tool_input: { file_path: '/src/keep-alive.js', old_string: 'a', new_string: 'b' }
      });
      const output = parseOutput(result.stdout);
      assert.ok(output, 'should produce valid JSON output');
      if (output.hookSpecificOutput) {
        assert.notStrictEqual(output.hookSpecificOutput.permissionDecision, 'deny', 'already-checked file should still be allowed');
      }

      const after = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
      assert.ok(after.last_active > staleButActive, 'read should refresh last_active after heartbeat');
    })
  )
    passed++;
  else failed++;

  // --- Test 14: pruning preserves routine bash gate marker ---
  clearState();
  if (
    test('preserves __bash_session__ when pruning oversized state', () => {
      const checked = ['__bash_session__'];
      for (let i = 0; i < 80; i++) checked.push(`__destructive__${i}`);
      for (let i = 0; i < 700; i++) checked.push(`/src/file-${i}.js`);
      writeState({ checked, last_active: Date.now() });

      runHook({
        tool_name: 'Edit',
        tool_input: { file_path: '/src/newly-gated.js', old_string: 'a', new_string: 'b' }
      });

      const result = runBashHook({
        tool_name: 'Bash',
        tool_input: { command: 'npm test' }
      });
      const output = parseOutput(result.stdout);
      assert.ok(output, 'should produce valid JSON output');
      if (output.hookSpecificOutput) {
        assert.notStrictEqual(output.hookSpecificOutput.permissionDecision, 'deny', 'routine bash marker should survive pruning');
      }

      const persisted = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
      assert.ok(persisted.checked.includes('__bash_session__'), 'pruned state should retain __bash_session__');
      assert.ok(persisted.checked.length <= 500, 'pruned state should still honor the checked-entry cap');
    })
  )
    passed++;
  else failed++;

  // --- Test 15: raw input session IDs provide stable retry state without env vars ---
  clearState();
  if (
    test('uses raw input session_id when hook env vars are missing', () => {
      const input = {
        session_id: 'raw-session-1234',
        tool_name: 'Bash',
        tool_input: { command: 'npm test' }
      };

      const first = runBashHook(input, {
        CLAUDE_SESSION_ID: '',
        ECC_SESSION_ID: ''
      });
      const firstOutput = parseOutput(first.stdout);
      assert.strictEqual(firstOutput.hookSpecificOutput.permissionDecision, 'deny');

      const second = runBashHook(input, {
        CLAUDE_SESSION_ID: '',
        ECC_SESSION_ID: ''
      });
      const secondOutput = parseOutput(second.stdout);
      if (secondOutput.hookSpecificOutput) {
        assert.notStrictEqual(secondOutput.hookSpecificOutput.permissionDecision, 'deny', 'retry should be allowed when raw session_id is stable');
      } else {
        assert.strictEqual(secondOutput.tool_name, 'Bash');
      }
    })
  )
    passed++;
  else failed++;

  // --- Test 16: allows Claude settings edits so the hook can be disabled safely ---
  clearState();
  if (
    test('allows edits to .claude/settings.json without gating', () => {
      const input = {
        tool_name: 'Edit',
        tool_input: { file_path: '/workspace/app/.claude/settings.json', old_string: '{}', new_string: '{"hooks":[]}' }
      };
      const result = runHook(input);
      const output = parseOutput(result.stdout);
      assert.ok(output, 'should produce valid JSON output');
      if (output.hookSpecificOutput) {
        assert.notStrictEqual(output.hookSpecificOutput.permissionDecision, 'deny', 'settings edits must not be blocked by gateguard');
      } else {
        assert.strictEqual(output.tool_name, 'Edit');
      }
    })
  )
    passed++;
  else failed++;

  // --- Test 17: allows read-only git introspection without first-bash gating ---
  clearState();
  if (
    test('allows read-only git status without first-bash gating', () => {
      const input = {
        tool_name: 'Bash',
        tool_input: { command: 'git status --short' }
      };
      const result = runBashHook(input);
      const output = parseOutput(result.stdout);
      assert.ok(output, 'should produce valid JSON output');
      if (output.hookSpecificOutput) {
        assert.notStrictEqual(output.hookSpecificOutput.permissionDecision, 'deny', 'read-only git introspection should not be blocked');
      } else {
        assert.strictEqual(output.tool_name, 'Bash');
      }
    })
  )
    passed++;
  else failed++;

  // --- Test 18: rejects mutating git commands that only share a prefix ---
  clearState();
  if (
    test('does not treat mutating git commands as read-only introspection', () => {
      const input = {
        tool_name: 'Bash',
        tool_input: { command: 'git status && rm -rf /tmp/demo' }
      };
      const result = runBashHook(input);
      const output = parseOutput(result.stdout);
      assert.ok(output, 'should produce valid JSON output');
      assert.strictEqual(output.hookSpecificOutput.permissionDecision, 'deny');
      assert.ok(output.hookSpecificOutput.permissionDecisionReason.includes('current instruction'));
    })
  )
    passed++;
  else failed++;

  // --- Test 19: long raw session IDs hash instead of collapsing to project fallback ---
  clearState();
  if (
    test('uses a stable hash for long raw session ids', () => {
      const longSessionId = `session-${'x'.repeat(120)}`;
      const input = {
        session_id: longSessionId,
        tool_name: 'Bash',
        tool_input: { command: 'npm test' }
      };

      const first = runBashHook(input, {
        CLAUDE_SESSION_ID: '',
        ECC_SESSION_ID: ''
      });
      const firstOutput = parseOutput(first.stdout);
      assert.strictEqual(firstOutput.hookSpecificOutput.permissionDecision, 'deny');

      const stateFiles = fs.readdirSync(stateDir).filter(entry => entry.startsWith('state-') && entry.endsWith('.json'));
      assert.strictEqual(stateFiles.length, 1, 'long raw session id should still produce a dedicated state file');
      assert.ok(/state-sid-[a-f0-9]{24}\.json$/.test(stateFiles[0]), 'long raw session ids should hash to a bounded sid-* key');

      const second = runBashHook(input, {
        CLAUDE_SESSION_ID: '',
        ECC_SESSION_ID: ''
      });
      const secondOutput = parseOutput(second.stdout);
      if (secondOutput.hookSpecificOutput) {
        assert.notStrictEqual(secondOutput.hookSpecificOutput.permissionDecision, 'deny', 'retry should be allowed when long raw session_id is stable');
      } else {
        assert.strictEqual(secondOutput.tool_name, 'Bash');
      }
    })
  )
    passed++;
  else failed++;

  // --- Test 20: malformed JSON passes through unchanged ---
  clearState();
  if (
    test('passes malformed JSON input through unchanged', () => {
      const rawInput = '{ not valid json';
      const result = runHook(rawInput);

      assert.strictEqual(result.code, 0, 'exit code should be 0');
      assert.strictEqual(result.stdout, rawInput, 'malformed JSON should pass through unchanged');
    })
  )
    passed++;
  else failed++;

  // --- Test 21: read-only git allowlist covers supported subcommands ---
  clearState();
  if (
    test('allows read-only git introspection subcommands without first-bash gating', () => {
      const commands = [
        'git status --porcelain --branch',
        'git diff',
        'git diff --name-only',
        'git log --oneline --max-count=1',
        'git show HEAD:README.md',
        'git show HEAD:"docs/install guide.md"',
        '/usr/bin/git status --short',
        'git branch --show-current',
        'git rev-parse --abbrev-ref HEAD'
      ];

      for (const command of commands) {
        const result = runBashHook({
          tool_name: 'Bash',
          tool_input: { command }
        });
        const output = parseOutput(result.stdout);
        assert.ok(output, `should produce JSON output for ${command}`);
        if (output.hookSpecificOutput) {
          assert.notStrictEqual(output.hookSpecificOutput.permissionDecision, 'deny', `${command} should not be denied`);
        } else {
          assert.strictEqual(output.tool_name, 'Bash', `${command} should pass through`);
        }
      }
    })
  )
    passed++;
  else failed++;

  // --- Test 22: unsupported git commands still flow through routine Bash gate ---
  clearState();
  if (
    test('gates non-allowlisted git commands as routine Bash', () => {
      const result = runBashHook({
        tool_name: 'Bash',
        tool_input: { command: 'git remote -v' }
      });
      const output = parseOutput(result.stdout);
      assert.ok(output, 'should produce JSON output');
      assert.strictEqual(output.hookSpecificOutput.permissionDecision, 'deny');
      assert.ok(output.hookSpecificOutput.permissionDecisionReason.includes('current user request'));
    })
  )
    passed++;
  else failed++;

  // --- Test 23: quoted shell separators are not read-only git bypasses
  clearState();
  if (
    test('checks a quoted separator in a git argument as one command after destructive detection', () => {
      const result = runBashHook({
        tool_name: 'Bash',
        tool_input: { command: 'git show HEAD:"docs/a;b.md"' }
      });
      const output = parseOutput(result.stdout);
      assert.ok(output, 'should produce valid JSON output');
      assert.ok(!output.hookSpecificOutput, 'read-only first command passes');
      const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
      assert.strictEqual(state.routine_readonly_passes, 1, 'passed by the read-only check, not the early git allowlist');
      assert.ok(!state.checked.includes('__bash_session__'), 'routine gate stays unchecked');

      const routine = parseOutput(runBashHook({ tool_name: 'Bash', tool_input: { command: 'git show HEAD:"docs/a;b.md" > out.txt' } }).stdout);
      assert.strictEqual(routine.hookSpecificOutput.permissionDecision, 'deny');
      assert.ok(routine.hookSpecificOutput.permissionDecisionReason.includes('current user request'));
    })
  )
    passed++;
  else failed++;

  // --- Test 24: module-load pruning removes old state files only ---
  clearState();
  if (
    test('prunes stale state files while keeping fresh state files', () => {
      const staleFile = path.join(stateDir, 'state-stale-session.json');
      const freshFile = path.join(stateDir, 'state-fresh-session.json');
      fs.writeFileSync(staleFile, JSON.stringify({ checked: [], last_active: Date.now() }), 'utf8');
      fs.writeFileSync(freshFile, JSON.stringify({ checked: [], last_active: Date.now() }), 'utf8');

      const staleTime = new Date(Date.now() - 17 * 60 * 60 * 1000);
      fs.utimesSync(staleFile, staleTime, staleTime);

      const result = runHook({
        tool_name: 'Read',
        tool_input: { file_path: '/src/app.js' }
      });
      const output = parseOutput(result.stdout);
      assert.ok(output, 'should produce valid JSON output');

      assert.ok(!fs.existsSync(staleFile), 'stale state file should be pruned at module load');
      assert.ok(fs.existsSync(freshFile), 'fresh state file should not be pruned');
    })
  )
    passed++;
  else failed++;

  // --- Test 24: transcript path fallback provides a stable session key ---
  clearState();
  if (
    test('uses transcript_path fallback when session ids are absent', () => {
      const input = {
        transcript_path: path.join(stateDir, 'session.jsonl'),
        tool_name: 'Bash',
        tool_input: { command: 'npm test' }
      };

      const first = runBashHook(input, {
        CLAUDE_SESSION_ID: '',
        ECC_SESSION_ID: '',
        CLAUDE_TRANSCRIPT_PATH: ''
      });
      const firstOutput = parseOutput(first.stdout);
      assert.strictEqual(firstOutput.hookSpecificOutput.permissionDecision, 'deny');

      const stateFiles = fs.readdirSync(stateDir).filter(entry => entry.startsWith('state-') && entry.endsWith('.json'));
      assert.strictEqual(stateFiles.length, 1, 'transcript path should produce one state file');
      assert.ok(/state-tx-[a-f0-9]{24}\.json$/.test(stateFiles[0]), 'transcript path should hash to a tx-* key');

      const second = runBashHook(input, {
        CLAUDE_SESSION_ID: '',
        ECC_SESSION_ID: '',
        CLAUDE_TRANSCRIPT_PATH: ''
      });
      const secondOutput = parseOutput(second.stdout);
      if (secondOutput.hookSpecificOutput) {
        assert.notStrictEqual(secondOutput.hookSpecificOutput.permissionDecision, 'deny', 'retry should be allowed when transcript_path is stable');
      } else {
        assert.strictEqual(secondOutput.tool_name, 'Bash');
      }
    })
  )
    passed++;
  else failed++;

  // --- Test 25: project directory fallback provides a stable session key ---
  clearState();
  if (
    test('uses project directory fallback when no session or transcript id exists', () => {
      const input = {
        tool_name: 'Bash',
        tool_input: { command: 'npm test' }
      };
      const fallbackEnv = {
        CLAUDE_SESSION_ID: '',
        ECC_SESSION_ID: '',
        CLAUDE_TRANSCRIPT_PATH: '',
        CLAUDE_PROJECT_DIR: path.join(stateDir, 'project-root')
      };

      const first = runBashHook(input, fallbackEnv);
      const firstOutput = parseOutput(first.stdout);
      assert.strictEqual(firstOutput.hookSpecificOutput.permissionDecision, 'deny');

      const stateFiles = fs.readdirSync(stateDir).filter(entry => entry.startsWith('state-') && entry.endsWith('.json'));
      assert.strictEqual(stateFiles.length, 1, 'project fallback should produce one state file');
      assert.ok(/state-proj-[a-f0-9]{24}\.json$/.test(stateFiles[0]), 'project fallback should hash to a proj-* key');

      const second = runBashHook(input, fallbackEnv);
      const secondOutput = parseOutput(second.stdout);
      if (secondOutput.hookSpecificOutput) {
        assert.notStrictEqual(secondOutput.hookSpecificOutput.permissionDecision, 'deny', 'retry should be allowed when project fallback is stable');
      } else {
        assert.strictEqual(secondOutput.tool_name, 'Bash');
      }
    })
  )
    passed++;
  else failed++;

  // --- Test 26: direct run() accepts object input and default fields ---
  clearState();
  if (
    test('direct run handles object input and missing optional fields', () => {
      const hook = loadDirectHook();

      const readInput = { tool_name: 'Read', tool_input: { file_path: '/src/app.js' } };
      assert.strictEqual(hook.run(readInput), readInput, 'object input should pass through unchanged');

      const editWithoutInput = { tool_name: 'Edit' };
      assert.strictEqual(hook.run(editWithoutInput), editWithoutInput, 'missing tool_input should allow Edit');

      const multiWithoutEdits = { tool_name: 'MultiEdit', tool_input: {} };
      assert.strictEqual(hook.run(multiWithoutEdits), multiWithoutEdits, 'missing edits array should allow MultiEdit');

      const bashWithoutCommand = { tool_name: 'Bash', tool_input: {} };
      const bashResult = hook.run(bashWithoutCommand);
      const bashOutput = JSON.parse(bashResult.stdout);
      assert.strictEqual(bashOutput.hookSpecificOutput.permissionDecision, 'deny', 'missing Bash command should still use routine Bash gate');
    })
  )
    passed++;
  else failed++;

  // --- Test 27: bidi controls are stripped from file paths ---
  clearState();
  if (
    test('sanitizes bidi override characters in gated file paths', () => {
      const bidiOverride = String.fromCharCode(0x202e);
      const input = {
        tool_name: 'Edit',
        tool_input: { file_path: `/src/${bidiOverride}evil.js`, old_string: 'a', new_string: 'b' }
      };

      const result = runHook(input);
      const output = parseOutput(result.stdout);
      assert.ok(output, 'should produce JSON output');
      const reason = output.hookSpecificOutput.permissionDecisionReason;
      assert.ok(!reason.includes(bidiOverride), 'bidi override must not appear in denial reason');
      assert.ok(reason.includes('evil.js'), 'sanitized path should retain visible filename text');
    })
  )
    passed++;
  else failed++;

  // --- Test 28: saveState preserves concurrent disk updates ---
  clearState();
  if (
    test('merges state written by another process during save', () => {
      const hook = loadDirectHook();
      const originalMkdirSync = fs.mkdirSync;
      let injected = false;

      fs.mkdirSync = function patchedMkdirSync(target) {
        const result = originalMkdirSync.apply(fs, arguments);
        if (!injected && path.resolve(String(target)) === path.resolve(stateDir)) {
          injected = true;
          fs.writeFileSync(
            stateFile,
            JSON.stringify({
              checked: ['/src/concurrent.js'],
              last_active: Date.now()
            }),
            'utf8'
          );
        }
        return result;
      };

      try {
        const result = hook.run({
          tool_name: 'Edit',
          tool_input: { file_path: '/src/new-edit.js', old_string: 'a', new_string: 'b' }
        });
        const output = parseOutput(result.stdout);
        assert.strictEqual(output.hookSpecificOutput.permissionDecision, 'deny', 'first edit should still be gated');
      } finally {
        fs.mkdirSync = originalMkdirSync;
      }

      const persisted = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
      assert.ok(persisted.checked.includes('/src/concurrent.js'), 'concurrent disk entry should be preserved');
      assert.ok(
        persisted.checked.some(k => k === '/src/new-edit.js' || /^[a-z]:\/src\/new-edit\.js$/.test(k)),
        'new in-memory entry should be persisted'
      );
    })
  )
    passed++;
  else failed++;

  // --- Test 29: stale temp files from interrupted writes are pruned ---
  clearState();
  if (
    test('prunes stale state temp files at module load', () => {
      fs.mkdirSync(stateDir, { recursive: true });
      const staleTmp = path.join(stateDir, `${path.basename(stateFile)}.tmp.1234.abcd`);
      const freshState = path.join(stateDir, 'state-fresh-session.json');
      fs.writeFileSync(staleTmp, '{}', 'utf8');
      fs.writeFileSync(freshState, '{}', 'utf8');
      const staleTime = new Date(Date.now() - 61 * 60 * 1000);
      fs.utimesSync(staleTmp, staleTime, staleTime);

      loadDirectHook();

      assert.ok(!fs.existsSync(staleTmp), 'stale temp state file should be pruned');
      assert.ok(fs.existsSync(freshState), 'fresh state file should remain');
    })
  )
    passed++;
  else failed++;

  function runFreshSessionEdit(filePath, extra = {}) {
    return runHook(
      {
        tool_name: 'Edit',
        tool_input: { file_path: filePath, old_string: 'a', new_string: 'b' },
        session_id: 'subagent-fresh-session',
        ...extra
      },
      { CLAUDE_SESSION_ID: '', ECC_SESSION_ID: '' }
    );
  }

  function runFreshSessionBash(command, extra = {}) {
    return runBashHook(
      {
        tool_name: 'Bash',
        tool_input: { command },
        session_id: 'subagent-fresh-session',
        ...extra
      },
      { CLAUDE_SESSION_ID: '', ECC_SESSION_ID: '' }
    );
  }

  // --- Test 30: top-level Edit denies; subagent Edit allows ---
  clearState();
  if (
    test('A/B: same Edit denies at top level and allows with agent_id', () => {
      const topLevel = runFreshSessionEdit('/src/subagent-edit.js');
      const topOut = parseOutput(topLevel.stdout);
      assert.ok(topOut, 'top-level edit should produce JSON output');
      assert.strictEqual(topOut.hookSpecificOutput.permissionDecision, 'deny');

      clearState();
      const subagent = runFreshSessionEdit('/src/subagent-edit.js', { agent_id: 'agent-abc-123' });
      const subOut = parseOutput(subagent.stdout);
      assert.ok(subOut, 'subagent edit should produce JSON output');
      assert.ok(!subOut.hookSpecificOutput || subOut.hookSpecificOutput.permissionDecision !== 'deny', 'subagent edit should bypass the first-touch file gate');
    })
  )
    passed++;
  else failed++;

  // --- Test 31: top-level Write denies; subagent Write allows ---
  clearState();
  if (
    test('A/B: same Write denies at top level and allows with agent_id', () => {
      const topLevel = runHook(
        {
          tool_name: 'Write',
          tool_input: { file_path: '/src/subagent-write.js', content: 'module.exports = {};' },
          session_id: 'subagent-fresh-session'
        },
        { CLAUDE_SESSION_ID: '', ECC_SESSION_ID: '' }
      );
      const topOut = parseOutput(topLevel.stdout);
      assert.ok(topOut, 'top-level write should produce JSON output');
      assert.strictEqual(topOut.hookSpecificOutput.permissionDecision, 'deny');

      clearState();
      const subagent = runHook(
        {
          tool_name: 'Write',
          tool_input: { file_path: '/src/subagent-write.js', content: 'module.exports = {};' },
          session_id: 'subagent-fresh-session',
          agent_id: 'agent-abc-123'
        },
        { CLAUDE_SESSION_ID: '', ECC_SESSION_ID: '' }
      );
      const subOut = parseOutput(subagent.stdout);
      assert.ok(subOut, 'subagent write should produce JSON output');
      assert.ok(!subOut.hookSpecificOutput || subOut.hookSpecificOutput.permissionDecision !== 'deny', 'subagent write should bypass the first-touch file gate');
    })
  )
    passed++;
  else failed++;

  // --- Test 32: top-level MultiEdit denies; subagent MultiEdit allows ---
  clearState();
  if (
    test('A/B: same MultiEdit denies at top level and allows with agent_id', () => {
      const edits = [
        { file_path: '/src/subagent-multi-a.js', old_string: 'a', new_string: 'b' },
        { file_path: '/src/subagent-multi-b.js', old_string: 'c', new_string: 'd' }
      ];

      const topLevel = runHook(
        {
          tool_name: 'MultiEdit',
          tool_input: { edits },
          session_id: 'subagent-fresh-session'
        },
        { CLAUDE_SESSION_ID: '', ECC_SESSION_ID: '' }
      );
      const topOut = parseOutput(topLevel.stdout);
      assert.ok(topOut, 'top-level MultiEdit should produce JSON output');
      assert.strictEqual(topOut.hookSpecificOutput.permissionDecision, 'deny');

      clearState();
      const subagent = runHook(
        {
          tool_name: 'MultiEdit',
          tool_input: { edits },
          session_id: 'subagent-fresh-session',
          agent_id: 'agent-abc-123'
        },
        { CLAUDE_SESSION_ID: '', ECC_SESSION_ID: '' }
      );
      const subOut = parseOutput(subagent.stdout);
      assert.ok(subOut, 'subagent MultiEdit should produce JSON output');
      assert.ok(!subOut.hookSpecificOutput || subOut.hookSpecificOutput.permissionDecision !== 'deny', 'subagent MultiEdit should bypass the first-touch file gate');
    })
  )
    passed++;
  else failed++;

  // --- Test 33: Bash stays gated inside subagents ---
  clearState();
  if (
    test('routine Bash remains gated in subagent context', () => {
      const result = runFreshSessionBash('npm test', { agent_id: 'agent-abc-123' });
      const output = parseOutput(result.stdout);
      assert.ok(output, 'subagent Bash should produce JSON output');
      assert.strictEqual(output.hookSpecificOutput.permissionDecision, 'deny');
      assert.ok(output.hookSpecificOutput.permissionDecisionReason.includes('current user request'));
    })
  )
    passed++;
  else failed++;

  // --- Test 34: destructive Bash stays gated inside subagents ---
  clearState();
  if (
    test('destructive Bash remains gated in subagent context', () => {
      const result = runFreshSessionBash('rm -rf /tmp/demo-path', { agent_id: 'agent-abc-123' });
      const output = parseOutput(result.stdout);
      assert.ok(output, 'subagent destructive Bash should produce JSON output');
      assert.strictEqual(output.hookSpecificOutput.permissionDecision, 'deny');
      assert.ok(output.hookSpecificOutput.permissionDecisionReason.includes('Destructive command detected'));
    })
  )
    passed++;
  else failed++;

  // --- Test 35: parent tool IDs also mark subagent context ---
  clearState();
  if (
    test('parent_tool_use_id and parentToolUseId mark subagent file edits', () => {
      const snake = runFreshSessionEdit('/src/subagent-parent-snake.js', { parent_tool_use_id: 'toolu_parent_01' });
      const snakeOut = parseOutput(snake.stdout);
      assert.ok(snakeOut, 'snake-case parent marker should produce JSON output');
      assert.ok(!snakeOut.hookSpecificOutput || snakeOut.hookSpecificOutput.permissionDecision !== 'deny', 'parent_tool_use_id should bypass the first-touch file gate');

      clearState();
      const camel = runFreshSessionEdit('/src/subagent-parent-camel.js', { parentToolUseId: 'toolu_parent_02' });
      const camelOut = parseOutput(camel.stdout);
      assert.ok(camelOut, 'camel-case parent marker should produce JSON output');
      assert.ok(!camelOut.hookSpecificOutput || camelOut.hookSpecificOutput.permissionDecision !== 'deny', 'parentToolUseId should bypass the first-touch file gate');
    })
  )
    passed++;
  else failed++;

  // --- Test 36: only non-empty string markers count ---
  clearState();
  if (
    test('empty and non-string subagent markers do not bypass file gates', () => {
      const cases = [
        ['empty', { agent_id: '' }],
        ['whitespace', { agent_id: '   ' }],
        ['numeric', { agent_id: 12345 }],
        ['null', { agent_id: null }]
      ];

      for (const [name, extra] of cases) {
        clearState();
        const result = runFreshSessionEdit(`/src/subagent-marker-${name}.js`, extra);
        const output = parseOutput(result.stdout);
        assert.ok(output, `${name} marker should produce JSON output`);
        assert.strictEqual(output.hookSpecificOutput.permissionDecision, 'deny', `${name} marker should not bypass the first-touch file gate`);
      }
    })
  )
    passed++;
  else failed++;

  // --- Test 37: two sequential subagent Edits on different files pass ---
  clearState();
  if (
    test('two sequential subagent Edits on different files both pass', () => {
      const first = runFreshSessionEdit('/src/subagent-seq-a.js', { agent_id: 'agent-seq' });
      const firstOut = parseOutput(first.stdout);
      assert.ok(firstOut, 'first subagent edit should produce JSON output');
      assert.ok(!firstOut.hookSpecificOutput || firstOut.hookSpecificOutput.permissionDecision !== 'deny', 'first subagent edit should pass');

      const second = runFreshSessionEdit('/src/subagent-seq-b.js', { agent_id: 'agent-seq' });
      const secondOut = parseOutput(second.stdout);
      assert.ok(secondOut, 'second subagent edit should produce JSON output');
      assert.ok(!secondOut.hookSpecificOutput || secondOut.hookSpecificOutput.permissionDecision !== 'deny', 'second subagent edit should pass even on a new file');
    })
  )
    passed++;
  else failed++;

  // --- Shell-words tokenizer: bypasses the old regex missed ---

  function expectDestructiveDeny(command, label) {
    clearState();
    const input = { tool_name: 'Bash', tool_input: { command } };
    const result = runBashHook(input);
    assert.strictEqual(result.code, 0, `${label}: exit code should be 0`);
    const output = parseOutput(result.stdout);
    assert.ok(output, `${label}: should produce JSON output`);
    assert.strictEqual(output.hookSpecificOutput.permissionDecision, 'deny', `${label}: should deny`);
    assert.ok(output.hookSpecificOutput.permissionDecisionReason.includes('Destructive'), `${label}: reason should mention "Destructive"`);
  }

  function expectAllow(command, label) {
    clearState();
    writeState({ checked: ['__bash_session__'], last_active: Date.now() });
    const input = { tool_name: 'Bash', tool_input: { command } };
    const result = runBashHook(input);
    assert.strictEqual(result.code, 0, `${label}: exit code should be 0`);
    const output = parseOutput(result.stdout);
    assert.ok(output, `${label}: should produce JSON output`);
    if (output.hookSpecificOutput) {
      assert.notStrictEqual(output.hookSpecificOutput.permissionDecision, 'deny', `${label}: should not deny`);
    } else {
      assert.strictEqual(output.tool_name, 'Bash', `${label}: pass-through should preserve input`);
    }
  }

  if (
    test('denies short-form git push -f as destructive', () => {
      expectDestructiveDeny('git push -f origin main', 'git push -f');
    })
  )
    passed++;
  else failed++;

  if (
    test('denies git reset --hard even with intervening -c global option', () => {
      expectDestructiveDeny('git -c core.foo=bar reset --hard', 'git -c ... reset --hard');
    })
  )
    passed++;
  else failed++;

  if (
    test('denies rm -fr (reverse flag order)', () => {
      expectDestructiveDeny('rm -fr /tmp/junk', 'rm -fr');
    })
  )
    passed++;
  else failed++;

  if (
    test('denies rm -r -f (split flag form)', () => {
      expectDestructiveDeny('rm -r -f /tmp/junk', 'rm -r -f');
    })
  )
    passed++;
  else failed++;

  if (
    test('denies rm --recursive --force (long flag form)', () => {
      expectDestructiveDeny('rm --recursive --force /tmp/junk', 'rm --recursive --force');
    })
  )
    passed++;
  else failed++;

  if (
    test('denies git reset HEAD --hard (with intervening ref)', () => {
      expectDestructiveDeny('git reset HEAD --hard', 'git reset HEAD --hard');
    })
  )
    passed++;
  else failed++;

  if (
    test('denies git clean -fd (combined force+dirs flag)', () => {
      expectDestructiveDeny('git clean -fd', 'git clean -fd');
    })
  )
    passed++;
  else failed++;

  if (
    test('denies destructive command in second chained segment', () => {
      expectDestructiveDeny('echo y | rm -rf /tmp/junk', 'echo y | rm -rf');
    })
  )
    passed++;
  else failed++;

  if (
    test('denies destructive command inside command substitution', () => {
      expectDestructiveDeny('echo $(rm -rf /tmp/junk)', 'rm -rf inside $()');
    })
  )
    passed++;
  else failed++;

  if (
    test('denies destructive command inside backticks', () => {
      expectDestructiveDeny('echo `git push -f origin main`', 'git push -f inside backticks');
    })
  )
    passed++;
  else failed++;

  if (
    test('allows destructive phrase quoted inside a commit message', () => {
      expectAllow('git commit -m "fix: rm -rf race in worker"', 'rm -rf in -m');
    })
  )
    passed++;
  else failed++;

  if (
    test('allows SQL phrase quoted inside a commit message', () => {
      expectAllow('git commit -m "docs: explain when drop table is safe"', 'drop table in -m');
    })
  )
    passed++;
  else failed++;

  if (
    test('denies quoted destructive SQL passed to SQL clients (issue #3024)', () => {
      expectDestructiveDeny('psql -c "drop table users"', 'psql quoted drop table');
      expectDestructiveDeny("psql -c 'truncate audit_log'", 'psql quoted truncate');
      expectDestructiveDeny('mysql -e "delete from sessions"', 'mysql quoted delete');
      expectDestructiveDeny('sqlite3 app.db "DROP TABLE users"', 'sqlite3 quoted drop');
    })
  )
    passed++;
  else failed++;

  if (
    test('denies quoted destructive SQL through sudo/env wrappers', () => {
      expectDestructiveDeny('sudo -u postgres psql -c "drop table users"', 'sudo -u psql');
      expectDestructiveDeny('env PGUSER=postgres psql -c "drop table users"', 'env psql');
      expectDestructiveDeny('env PGPASSWORD=value psql -c "drop table users"', 'env PGPASSWORD psql');
      expectDestructiveDeny('env -C /tmp psql -c "drop table users"', 'env -C psql');
      expectDestructiveDeny('env --chdir /tmp psql -c "drop table users"', 'env --chdir psql');
    })
  )
    passed++;
  else failed++;

  if (
    test('denies destructive SQL through wrapper sh -c chains', () => {
      expectDestructiveDeny('sudo sh -c \'psql -c "drop table users"\'', 'sudo sh -c psql');
      expectDestructiveDeny('env sh -c \'psql -c "drop table users"\'', 'env sh -c psql');
    })
  )
    passed++;
  else failed++;

  if (
    test('allows SQL string literals and non-SQL clients mentioning SQL', () => {
      expectAllow('psql -c "SELECT \'drop table\' FROM audit_log"', 'SQL string literal');
      expectAllow('psql -c "SELECT $tag$drop table users$tag$ FROM t"', 'tagged dollar-quote literal');
      expectAllow('echo "drop table users"', 'echo SQL mention');
    })
  )
    passed++;
  else failed++;

  if (
    test('allows destructive SQL prose inside a quoted heredoc', () => {
      expectAllow(
        [
          "cat > migration-notes.md <<'EOF'",
          'This migration will DROP TABLE old_sessions after verification.',
          'EOF'
        ].join('\n'),
        'quoted heredoc SQL prose'
      );
    })
  )
    passed++;
  else failed++;

  if (
    test('allows destructive prose and separators inside an unquoted heredoc', () => {
      expectAllow(
        [
          'cat > migration-notes.md <<EOF',
          'Document only: DELETE FROM sessions; rm -rf old-cache',
          'EOF'
        ].join('\n'),
        'unquoted heredoc prose'
      );
    })
  )
    passed++;
  else failed++;

  if (
    test('allows destructive prose inside a tab-stripping heredoc', () => {
      expectAllow(
        [
          'cat > migration-notes.md <<-EOF',
          '\tTRUNCATE old_sessions; rm -rf old-cache',
          '\tEOF'
        ].join('\n'),
        'tab-stripping heredoc prose'
      );
    })
  )
    passed++;
  else failed++;

  if (
    test('handles multiple heredoc redirections in declaration order', () => {
      expectAllow(
        [
          "cat <<ONE <<'TWO'",
          'DELETE FROM sessions is documentation here.',
          'ONE',
          '$(rm -rf /tmp/example-only)',
          'TWO'
        ].join('\n'),
        'multiple heredoc redirections'
      );
    })
  )
    passed++;
  else failed++;

  if (
    test('fails closed when a shell consumes the heredoc payload', () => {
      for (const command of [
        ['bash <<EOF', 'rm -rf /tmp/shell-input-target', 'EOF'].join('\n'),
        ["sh <<'EOF'", 'git reset --hard', 'EOF'].join('\n'),
        ['cat <<EOF | sh', 'rm -rf /tmp/piped-shell-target', 'EOF'].join('\n'),
        ["cat > /tmp/review-script <<'EOF'", 'rm -rf /tmp/persisted-target', 'EOF', 'bash /tmp/review-script'].join('\n')
      ]) {
        expectDestructiveDeny(command, 'shell-executed heredoc payload');
      }
    })
  )
    passed++;
  else failed++;

  if (
    test('does not rescan a here-string as a heredoc', () => {
      expectDestructiveDeny(
        ['cat <<<EOF', 'rm -rf /tmp/here-string-followup'].join('\n'),
        'command after here-string'
      );
    })
  )
    passed++;
  else failed++;

  if (
    test('uses shell-correct single-quote escaping while finding heredocs', () => {
      expectDestructiveDeny(
        ["echo 'a\\'X'<<EOF 'Y'b\\'", 'rm -rf /tmp/quoted-followup'].join('\n'),
        'command after quoted non-heredoc text'
      );
    })
  )
    passed++;
  else failed++;

  if (
    test('fails closed on an unclosed heredoc body', () => {
      expectDestructiveDeny(
        ['cat <<EOF', 'rm -rf /tmp/unclosed-heredoc'].join('\n'),
        'unclosed heredoc body'
      );
    })
  )
    passed++;
  else failed++;

  if (
    test('still denies destructive commands after a heredoc terminator', () => {
      expectDestructiveDeny(
        [
          "cat > migration-notes.md <<'EOF'",
          'DROP TABLE is documentation here.',
          'EOF',
          'rm -rf /tmp/real-target'
        ].join('\n'),
        'command after heredoc terminator'
      );
    })
  )
    passed++;
  else failed++;

  if (
    test('still denies command substitutions inside an unquoted heredoc', () => {
      expectDestructiveDeny(
        [
          'cat > output.txt <<EOF',
          '$(rm -rf /tmp/expanded-target)',
          'EOF'
        ].join('\n'),
        'unquoted heredoc command substitution'
      );
    })
  )
    passed++;
  else failed++;

  if (
    test('allows literal command substitutions inside a quoted heredoc', () => {
      expectAllow(
        [
          "cat > example.md <<'EOF'",
          '$(rm -rf /tmp/example-only)',
          'EOF'
        ].join('\n'),
        'quoted heredoc command-substitution prose'
      );
    })
  )
    passed++;
  else failed++;

  if (
    test('does not mistake an arithmetic shift for a heredoc', () => {
      expectDestructiveDeny(
        ['echo $((1 << 2))', 'rm -rf /tmp/real-target'].join('\n'),
        'command after arithmetic shift'
      );
    })
  )
    passed++;
  else failed++;

  if (
    test('does not mistake a named arithmetic shift operand for a heredoc', () => {
      expectDestructiveDeny(
        ['echo $((flags << WIDTH))', 'rm -rf /tmp/real-target'].join('\n'),
        'command after named arithmetic shift'
      );
    })
  )
    passed++;
  else failed++;

  if (
    test('fails closed on multiline arithmetic shift contexts', () => {
      for (const arithmetic of [
        ['((', 'flags << WIDTH', '))'],
        ['$((', 'flags << WIDTH', '))'],
        ['$[', 'flags << WIDTH', ']']
      ]) {
        expectDestructiveDeny(
          [...arithmetic, 'rm -rf /tmp/real-target'].join('\n'),
          'command after multiline arithmetic shift'
        );
      }
    })
  )
    passed++;
  else failed++;

  if (
    test('does not mistake a conditional string operator for a heredoc', () => {
      expectDestructiveDeny(
        ['[[ alpha << omega ]]', 'rm -rf /tmp/real-target'].join('\n'),
        'command after conditional shift-like operator'
      );
    })
  )
    passed++;
  else failed++;

  if (
    test('does not parse heredocs inside operator-adjacent comments', () => {
      expectDestructiveDeny(
        ['true;# <<EOF', 'rm -rf /tmp/real-target'].join('\n'),
        'command after commented heredoc marker'
      );
    })
  )
    passed++;
  else failed++;

  if (
    test('fails closed on heredoc markers inside multiline quotes', () => {
      expectDestructiveDeny(
        ['printf \'%s\' "literal', '<<EOF', 'still literal"', 'rm -rf /tmp/real-target'].join('\n'),
        'command after multiline quoted heredoc marker'
      );
    })
  )
    passed++;
  else failed++;

  if (
    test('fails closed on ANSI-C quoted heredoc delimiters', () => {
      expectDestructiveDeny(
        ["cat <<$'EOF'", 'documentation', 'EOF', 'rm -rf /tmp/real-target'].join('\n'),
        'command after ANSI-C heredoc'
      );
    })
  )
    passed++;
  else failed++;

  if (
    test('fails closed on escaped heredoc delimiter words', () => {
      expectDestructiveDeny(
        ['cat <<E\\', 'OF', 'documentation', 'EOF', 'rm -rf /tmp/real-target'].join('\n'),
        'command after escaped heredoc delimiter'
      );
    })
  )
    passed++;
  else failed++;

  if (
    test('denies multiline command substitutions inside an unquoted heredoc', () => {
      expectDestructiveDeny(
        ['cat <<EOF', '$(', 'rm -rf /tmp/expanded-target', ')', 'EOF'].join('\n'),
        'multiline unquoted heredoc command substitution'
      );
    })
  )
    passed++;
  else failed++;

  if (
    test('denies multiline backtick substitutions inside an unquoted heredoc', () => {
      expectDestructiveDeny(
        ['cat <<EOF', '`', 'rm -rf /tmp/expanded-target', '`', 'EOF'].join('\n'),
        'multiline unquoted heredoc backtick substitution'
      );
    })
  )
    passed++;
  else failed++;

  if (
    test('denies line-continued command substitutions inside an unquoted heredoc', () => {
      expectDestructiveDeny(
        ['cat <<EOF', '$\\', '(', 'rm -rf /tmp/expanded-target', ')', 'EOF'].join('\n'),
        'line-continued unquoted heredoc command substitution'
      );
    })
  )
    passed++;
  else failed++;

  if (
    test('denies split command names after heredoc line continuation', () => {
      expectDestructiveDeny(
        ['cat <<EOF', '$(r\\', 'm -rf /tmp/expanded-target', ')', 'EOF'].join('\n'),
        'split command name in unquoted heredoc substitution'
      );
    })
  )
    passed++;
  else failed++;

  if (
    test('allows a joined command when tab stripping removes the option separator', () => {
      expectAllow(
        ['cat <<-EOF', '\t$(rm\\', '\t-rf /tmp/expanded-target)', 'EOF'].join('\n'),
        'tab stripping joins rm and -rf into a harmless command name'
      );
    })
  )
    passed++;
  else failed++;

  if (
    test('denies split command names after tab-stripped heredoc continuations', () => {
      expectDestructiveDeny(
        ['cat <<-EOF', '\t$(r\\', '\tm -rf /tmp/expanded-target)', 'EOF'].join('\n'),
        'split command name in tab-stripped unquoted heredoc substitution'
      );
    })
  )
    passed++;
  else failed++;

  if (
    test('fails closed on line-continued unquoted heredoc terminators', () => {
      expectDestructiveDeny(
        ['cat <<EOF', 'payload', 'EO\\', 'F', 'rm -rf /tmp/real-target'].join('\n'),
        'command after line-continued heredoc terminator'
      );
    })
  )
    passed++;
  else failed++;

  if (
    test('allows escaped command-substitution prose in an unquoted heredoc', () => {
      expectAllow(
        ['cat <<EOF', '\\$(echo example)', 'DROP TABLE is documentation here.', 'EOF'].join('\n'),
        'escaped unquoted heredoc command-substitution prose'
      );
    })
  )
    passed++;
  else failed++;

  if (
    test('allows #2886 migration-doc heredoc repro with DROP TABLE prose', () => {
      expectAllow(
        [
          "cat > migration-notes.md <<'EOF'",
          "This migration will DROP TABLE old_sessions once we've verified nothing reads from it anymore.",
          'EOF'
        ].join('\n'),
        'issue #2886 cat heredoc repro'
      );
    })
  )
    passed++;
  else failed++;

  if (
    test('allows destructive SQL prose inside a tee heredoc', () => {
      expectAllow(
        [
          "tee migration-notes.md <<'EOF'",
          'This migration will DROP TABLE old_sessions after verification.',
          'EOF'
        ].join('\n'),
        'tee heredoc SQL prose'
      );
    })
  )
    passed++;
  else failed++;

  if (
    test('allows destructive rm prose inside a path-qualified cat heredoc', () => {
      expectAllow(
        [
          "/bin/cat > notes.md <<'EOF'",
          'Cleanup steps mention rm -rf old-cache; do not run yet.',
          'EOF'
        ].join('\n'),
        'path-qualified cat heredoc prose'
      );
    })
  )
    passed++;
  else failed++;

  if (
    test('allows destructive prose inside a command-wrapped cat heredoc', () => {
      expectAllow(
        [
          "command cat > notes.md <<'EOF'",
          'Notes: DELETE FROM sessions; truncate staging.',
          'EOF'
        ].join('\n'),
        'command-wrapped cat heredoc prose'
      );
    })
  )
    passed++;
  else failed++;

  if (
    test('still denies real destructive commands (not heredoc prose)', () => {
      expectDestructiveDeny('rm -rf /tmp/real-destructive-target', 'real rm -rf');
      expectDestructiveDeny('git reset --hard', 'real git reset --hard');
      expectDestructiveDeny('drop table old_sessions', 'real drop table command text');
    })
  )
    passed++;
  else failed++;

  if (
    test('fails closed when tee pipes heredoc payload into a shell', () => {
      expectDestructiveDeny(
        ['tee notes.md <<EOF | bash', 'rm -rf /tmp/tee-piped-shell-target', 'EOF'].join('\n'),
        'tee piped to shell'
      );
    })
  )
    passed++;
  else failed++;

  if (
    test('denies substitutions inside literal quote characters in an unquoted heredoc', () => {
      for (const payload of [
        "'$(rm -rf /tmp/expanded-target)'",
        '"$(rm -rf /tmp/expanded-target)"',
        "'`rm -rf /tmp/expanded-target`'"
      ]) {
        expectDestructiveDeny(
          ['cat <<EOF', payload, 'EOF'].join('\n'),
          'quoted-looking unquoted heredoc substitution'
        );
      }
    })
  )
    passed++;
  else failed++;

  if (
    test('allows quoted destructive prose inside a harmless heredoc substitution', () => {
      expectAllow(
        ['cat <<EOF', "$(printf '%s' 'rm -rf /tmp/example-only')", 'EOF'].join('\n'),
        'quoted prose inside heredoc substitution'
      );
    })
  )
    passed++;
  else failed++;

  if (
    test('still denies destructive commands after arithmetic shifts', () => {
      expectDestructiveDeny(
        ['echo $((1 << 2))', 'rm -rf /tmp/shift-target'].join('\n'),
        'command after $((...)) arithmetic shift'
      );
      expectDestructiveDeny(
        ['echo $((x << 2))', 'rm -rf /tmp/shift-target'].join('\n'),
        'command after $((...)) identifier shift'
      );
      expectDestructiveDeny(
        ['(( 1 << 2 ))', 'rm -rf /tmp/shift-target'].join('\n'),
        'command after ((...)) arithmetic shift'
      );
      expectDestructiveDeny(
        ['echo $[x << 1]', 'rm -rf /tmp/shift-target'].join('\n'),
        'command after legacy $[...] arithmetic shift'
      );
    })
  )
    passed++;
  else failed++;

  if (
    test('allows git push --force-if-includes as a safety-checked variant on a non-shared branch', () => {
      expectAllow('git push --force-with-lease --force-if-includes origin feature-branch', 'git push --force-if-includes');
    })
  )
    passed++;
  else failed++;

  // --- Ref- and history-destroying git commands (issues #3154, #3151) ---

  const destructiveGitCases = [
    ['git branch -D feature', 'git branch -D'],
    ['git branch --delete --force feature', 'git branch --delete --force'],
    ['git branch -d -f feature', 'git branch -d -f'],
    ['git stash drop', 'git stash drop'],
    ['git stash drop stash@{0}', 'git stash drop stash@{0}'],
    ['git stash clear', 'git stash clear'],
    ['git reflog expire --expire=now --all', 'git reflog expire'],
    ['git reflog delete HEAD@{2}', 'git reflog delete'],
    ['git update-ref -d refs/heads/x', 'git update-ref -d'],
    ['git update-ref --delete refs/heads/x', 'git update-ref --delete'],
    ['git restore foo.ts', 'git restore <path>'],
    ['git restore .', 'git restore .'],
    ['git restore --worktree foo.ts', 'git restore --worktree'],
    ['git restore -W foo.ts', 'git restore -W'],
    ['git restore --staged --worktree foo.ts', 'git restore --staged --worktree'],
    ['git restore -s HEAD foo.ts', 'git restore --source without --staged'],
    ['git push --force-with-lease origin main', 'git push --force-with-lease to main'],
    ['git push --force-with-lease origin HEAD:main', 'git push --force-with-lease HEAD:main'],
    ['git push --force-with-lease origin +refs/heads/master:refs/heads/master', 'git push --force-with-lease +refs/heads/master'],
    ['git push --force-with-lease --force-if-includes origin main', 'git push --force-with-lease --force-if-includes to main'],
    ['git push --force-with-lease --repo origin main', 'git push --force-with-lease --repo to main']
  ];
  for (const [command, label] of destructiveGitCases) {
    if (
      test(`denies ${label} as destructive`, () => {
        expectDestructiveDeny(command, label);
      })
    )
      passed++;
    else failed++;
  }

  const safeGitCases = [
    ['git branch -d feature', 'git branch -d (refuses when unmerged)'],
    ['git branch -f feature', 'git branch -f (no delete)'],
    ['git stash list', 'git stash list'],
    ['git stash show', 'git stash show'],
    ['git reflog show', 'git reflog show'],
    ['git update-ref refs/heads/x abc1234', 'git update-ref without -d'],
    ['git restore --staged foo.ts', 'git restore --staged'],
    ['git restore -S foo.ts', 'git restore -S'],
    ['git restore --source=HEAD --staged foo.ts', 'git restore --source with --staged'],
    ['git push --force-with-lease origin feature-branch', 'git push --force-with-lease to feature branch'],
    ['git push --force-with-lease', 'git push --force-with-lease with no refspec'],
    ['git push --force-with-lease -o ci.skip origin feature-branch', 'git push --force-with-lease with push option']
  ];
  for (const [command, label] of safeGitCases) {
    if (
      test(`allows ${label}`, () => {
        expectAllow(command, label);
      })
    )
      passed++;
    else failed++;
  }

  // --- Review-round-2 findings ---

  if (
    test('denies git push --force even with --force-if-includes present', () => {
      expectDestructiveDeny('git push --force --force-if-includes origin main', 'git push --force --force-if-includes');
    })
  )
    passed++;
  else failed++;

  if (
    test('denies git push when bare --force is mixed with lease flags', () => {
      expectDestructiveDeny('git push --force-with-lease --force origin main', 'git push --force-with-lease --force');
    })
  )
    passed++;
  else failed++;

  if (
    test('denies git push with +refspec prefix (bare branch)', () => {
      expectDestructiveDeny('git push origin +main', 'git push origin +main');
    })
  )
    passed++;
  else failed++;

  if (
    test('denies git push with +refspec prefix (full ref)', () => {
      expectDestructiveDeny('git push origin +refs/heads/main:refs/heads/main', 'git push origin +refs/heads/main:refs/heads/main');
    })
  )
    passed++;
  else failed++;

  if (
    test('denies git switch --discard-changes', () => {
      expectDestructiveDeny('git switch --discard-changes feature', 'git switch --discard-changes');
    })
  )
    passed++;
  else failed++;

  if (
    test('denies git switch --force', () => {
      expectDestructiveDeny('git switch --force main', 'git switch --force');
    })
  )
    passed++;
  else failed++;

  if (
    test('denies git switch -f short form', () => {
      expectDestructiveDeny('git switch -f main', 'git switch -f');
    })
  )
    passed++;
  else failed++;

  if (
    test('denies git switch -C force-create', () => {
      expectDestructiveDeny('git switch -C feature', 'git switch -C');
    })
  )
    passed++;
  else failed++;

  if (
    test('still allows plain git switch', () => {
      expectAllow('git switch feature', 'git switch feature');
    })
  )
    passed++;
  else failed++;

  if (
    test('denies rm -rf nested inside a backtick subshell', () => {
      expectDestructiveDeny('echo y | `rm -rf /tmp/junk`', 'backtick subshell');
    })
  )
    passed++;
  else failed++;

  if (
    test('denies rm -rf nested inside a $(...) subshell', () => {
      expectDestructiveDeny('echo y | $(rm -rf /tmp/junk)', 'dollar-paren subshell');
    })
  )
    passed++;
  else failed++;

  if (
    test('denies rm -rf inside double-quoted command substitution', () => {
      expectDestructiveDeny('echo "$(rm -rf /tmp/junk)"', 'double-quoted dollar-paren subshell');
    })
  )
    passed++;
  else failed++;

  // --- Subshell + brace-group bypass coverage ---
  // Destructive commands inside `(...)` and `{ ...; }` execute the
  // same way they do at the top level, so the destructive classifier
  // must see inside those bodies too. Nested parens `((...))` are
  // arithmetic-evaluation syntax in bash (not a nested subshell), but
  // our parser depth-tracks them conservatively — i.e. the inner
  // tokens are still scanned for destructive intent. That's safety
  // over precision and the right default for this gate.

  if (
    test('denies rm -rf inside plain (...) subshell group', () => {
      expectDestructiveDeny('(rm -rf /tmp/junk)', 'plain subshell group');
    })
  )
    passed++;
  else failed++;

  if (
    test('denies rm -rf inside ((...)) — arithmetic eval, treated conservatively', () => {
      expectDestructiveDeny('((rm -rf /tmp/junk))', 'arithmetic-eval parens');
    })
  )
    passed++;
  else failed++;

  if (
    test('denies rm -rf inside { ...; } brace group', () => {
      expectDestructiveDeny('{ rm -rf /tmp/junk; }', 'brace group');
    })
  )
    passed++;
  else failed++;

  if (
    test('denies git push --force inside plain (...) subshell group', () => {
      expectDestructiveDeny('(git push --force origin main)', 'git-force in subshell');
    })
  )
    passed++;
  else failed++;

  if (
    test('denies git push --force inside { ...; } brace group', () => {
      expectDestructiveDeny('{ git push --force origin main; }', 'git-force in brace group');
    })
  )
    passed++;
  else failed++;

  if (
    test('denies rm -rf nested across () and {} (cross-syntax)', () => {
      expectDestructiveDeny('(echo y; { rm -rf /tmp/junk; })', '() containing {} cross-syntax');
    })
  )
    passed++;
  else failed++;

  if (
    test('denies rm -rf nested across $() and () (cross-syntax)', () => {
      expectDestructiveDeny('$(echo y; (rm -rf /tmp/junk))', '$() containing () cross-syntax');
    })
  )
    passed++;
  else failed++;

  // Negative cases — literals and non-destructive commands must NOT
  // be promoted to destructive by the new grouping-body walker.

  if (
    test('allows literal (rm -rf ...) inside single quotes', () => {
      expectAllow("git commit -m '(rm -rf /tmp/junk)'", 'single-quoted subshell literal');
    })
  )
    passed++;
  else failed++;

  if (
    test('allows literal (rm -rf ...) inside double quotes', () => {
      expectAllow('echo "(rm -rf /tmp/junk)"', 'double-quoted subshell literal');
    })
  )
    passed++;
  else failed++;

  if (
    test('allows literal { rm -rf ...; } inside double quotes', () => {
      expectAllow('echo "{ rm -rf /tmp/junk; }"', 'double-quoted brace-group literal');
    })
  )
    passed++;
  else failed++;

  if (
    test('allows non-destructive (echo hello)', () => {
      expectAllow('(echo hello)', 'non-destructive subshell');
    })
  )
    passed++;
  else failed++;

  if (
    test('allows non-destructive { echo hello; }', () => {
      expectAllow('{ echo hello; }', 'non-destructive brace group');
    })
  )
    passed++;
  else failed++;

  if (
    test('allows {rm -rf} — no space after { is not a brace group', () => {
      // bash treats `{rm` as a single token; no destructive intent
      // can be statically derived from this form, and the command
      // would not actually run rm at runtime either.
      expectAllow('echo {rm -rf /tmp/junk}', 'no-space brace literal');
    })
  )
    passed++;
  else failed++;

  // --- Round 1 review fixes: brace-group span-skip + boundary ---
  // Verifies the body-accumulation loop in `extractBraceGroups`
  // correctly walks past `$(...)`, `(...)`, and backtick spans so
  // a `}` inside one of those does not terminate the brace group
  // early, plus the nested `{` boundary rule.

  if (
    test('denies rm -rf in brace group with backtick containing }', () => {
      expectDestructiveDeny('{ echo `echo }`; rm -rf /tmp/junk; }', 'brace + backtick containing }');
    })
  )
    passed++;
  else failed++;

  if (
    test('denies rm -rf in brace group with $() containing }', () => {
      expectDestructiveDeny('{ echo $(echo "}"); rm -rf /tmp/junk; }', 'brace + $() containing }');
    })
  )
    passed++;
  else failed++;

  if (
    test('denies rm -rf in brace group with nested () containing }', () => {
      expectDestructiveDeny('{ (echo "}"); rm -rf /tmp/junk; }', 'brace + () containing }');
    })
  )
    passed++;
  else failed++;

  if (
    test('denies rm -rf in brace group with $() body containing }', () => {
      expectDestructiveDeny('{ x=$(echo a}b); rm -rf /tmp/junk; }', 'brace + $() body with }');
    })
  )
    passed++;
  else failed++;

  if (
    test('denies rm -rf when token like foo{ appears before brace group close', () => {
      // tokens like `foo{` are not reserved-word `{` (no boundary,
      // no whitespace after) — must not bump nested-depth and so
      // must not delay brace-group close
      expectDestructiveDeny('{ echo foo{bar; rm -rf /tmp/junk; }', 'foo{ token inside brace body');
    })
  )
    passed++;
  else failed++;

  // --- Issue #2078: GATEGUARD_BASH_ROUTINE_DISABLED env var ---
  // Operators on hosts that don't benefit from the once-per-session
  // routine bash gate (Cursor, OpenCode, etc.) get an env-var opt-out.
  // The destructive gate is unaffected.

  clearState();
  if (
    test('GATEGUARD_BASH_ROUTINE_DISABLED=1 skips routine bash gate', () => {
      const input = { tool_name: 'Bash', tool_input: { command: 'ls -la' } };
      const result = runBashHook(input, { GATEGUARD_BASH_ROUTINE_DISABLED: '1' });
      assert.strictEqual(result.code, 0, 'exit code should be 0');
      const output = parseOutput(result.stdout);
      assert.ok(output, 'should produce valid JSON output');
      if (output.hookSpecificOutput) {
        assert.notStrictEqual(output.hookSpecificOutput.permissionDecision, 'deny', 'routine bash should not be denied when env opts out');
      } else {
        assert.strictEqual(output.tool_name, 'Bash', 'pass-through should preserve input');
      }
    })
  )
    passed++;
  else failed++;

  clearState();
  if (
    test('GATEGUARD_BASH_ROUTINE_DISABLED accepts truthy aliases (true, on, yes, enabled)', () => {
      for (const value of ['true', 'on', 'yes', 'enabled', 'TRUE', 'On']) {
        clearState();
        const result = runBashHook({ tool_name: 'Bash', tool_input: { command: 'grep foo bar.txt' } }, { GATEGUARD_BASH_ROUTINE_DISABLED: value });
        const output = parseOutput(result.stdout);
        assert.ok(output, `value=${value}: should produce JSON`);
        if (output.hookSpecificOutput) {
          assert.notStrictEqual(output.hookSpecificOutput.permissionDecision, 'deny', `value=${value}: should not deny routine bash`);
        }
      }
    })
  )
    passed++;
  else failed++;

  clearState();
  if (
    test('GATEGUARD_BASH_ROUTINE_DISABLED unset preserves baseline (denies first routine bash)', () => {
      const input = { tool_name: 'Bash', tool_input: { command: 'npm test' } };
      const result = runBashHook(input);
      assert.strictEqual(result.code, 0, 'exit code should be 0');
      const output = parseOutput(result.stdout);
      assert.ok(output, 'should produce JSON');
      assert.strictEqual(output.hookSpecificOutput.permissionDecision, 'deny', 'baseline routine gate must still fire when env is unset');
    })
  )
    passed++;
  else failed++;

  clearState();
  if (
    test('GATEGUARD_BASH_ROUTINE_DISABLED=0 / off / false keeps current behavior', () => {
      for (const value of ['0', 'false', 'off', '', 'random-value']) {
        clearState();
        const result = runBashHook({ tool_name: 'Bash', tool_input: { command: 'npm test' } }, { GATEGUARD_BASH_ROUTINE_DISABLED: value });
        const output = parseOutput(result.stdout);
        assert.ok(output, `value="${value}": should produce JSON`);
        assert.strictEqual(output.hookSpecificOutput.permissionDecision, 'deny', `value="${value}": routine gate should still fire`);
      }
    })
  )
    passed++;
  else failed++;

  clearState();
  if (
    test('GATEGUARD_BASH_ROUTINE_DISABLED=1 does NOT disable destructive bash gate', () => {
      const input = { tool_name: 'Bash', tool_input: { command: 'rm -rf /important/data' } };
      const result = runBashHook(input, { GATEGUARD_BASH_ROUTINE_DISABLED: '1' });
      const output = parseOutput(result.stdout);
      assert.ok(output, 'should produce JSON');
      assert.strictEqual(output.hookSpecificOutput.permissionDecision, 'deny', 'destructive gate must still fire even when routine gate is opted out');
      assert.ok(output.hookSpecificOutput.permissionDecisionReason.includes('Destructive'), 'reason should mention Destructive');
    })
  )
    passed++;
  else failed++;

  // --- Issue #2078: GATEGUARD_BASH_EXTRA_DESTRUCTIVE env var ---
  // Operators can register additional destructive patterns without
  // patching the bundled JS. Same matching scope as the built-in
  // SQL/dd regex (matches against quote-stripped, subshell-flattened
  // command) so a custom phrase inside `$(...)` is also caught.

  clearState();
  if (
    test('GATEGUARD_BASH_EXTRA_DESTRUCTIVE custom phrase fires destructive gate', () => {
      const input = { tool_name: 'Bash', tool_input: { command: 'supabase db reset --linked' } };
      const result = runBashHook(input, {
        GATEGUARD_BASH_EXTRA_DESTRUCTIVE: 'supabase\\s+db\\s+reset|prisma\\s+migrate\\s+reset'
      });
      const output = parseOutput(result.stdout);
      assert.ok(output, 'should produce JSON');
      assert.strictEqual(output.hookSpecificOutput.permissionDecision, 'deny', 'custom destructive phrase should be gated');
      assert.ok(output.hookSpecificOutput.permissionDecisionReason.includes('Destructive'), 'reason should mention Destructive');
    })
  )
    passed++;
  else failed++;

  clearState();
  if (
    test('GATEGUARD_BASH_EXTRA_DESTRUCTIVE second member of alternation also fires', () => {
      const input = { tool_name: 'Bash', tool_input: { command: 'prisma migrate reset --force' } };
      const result = runBashHook(input, {
        GATEGUARD_BASH_EXTRA_DESTRUCTIVE: 'supabase\\s+db\\s+reset|prisma\\s+migrate\\s+reset'
      });
      const output = parseOutput(result.stdout);
      assert.ok(output, 'should produce JSON');
      assert.strictEqual(output.hookSpecificOutput.permissionDecision, 'deny', 'second alternation member should be gated');
    })
  )
    passed++;
  else failed++;

  clearState();
  if (
    test('GATEGUARD_BASH_EXTRA_DESTRUCTIVE invalid regex degrades to baseline (no crash)', () => {
      // Unbalanced paren is a regex parse error. Hook must NOT crash; it
      // should fall back to the built-in patterns. A plain `ls` should
      // therefore hit the routine gate (denied first time) and a
      // built-in destructive (`rm -rf`) should still fire the destructive gate.
      const lsResult = runBashHook({ tool_name: 'Bash', tool_input: { command: 'npm test' } }, { GATEGUARD_BASH_EXTRA_DESTRUCTIVE: '(unclosed' });
      assert.strictEqual(lsResult.code, 0, 'malformed regex must not crash hook');
      const lsOutput = parseOutput(lsResult.stdout);
      assert.ok(lsOutput, 'should produce JSON despite bad env regex');
      // Note: with invalid extra regex, the bash branch behaves as if the
      // env var was unset — routine gate fires on first `ls`, destructive
      // gate fires on `rm -rf`.
      assert.strictEqual(lsOutput.hookSpecificOutput.permissionDecision, 'deny', 'baseline routine gate should still fire when extra-regex is malformed');
    })
  )
    passed++;
  else failed++;

  clearState();
  if (
    test('GATEGUARD_BASH_EXTRA_DESTRUCTIVE unset does not affect baseline', () => {
      const input = { tool_name: 'Bash', tool_input: { command: 'supabase db reset --linked' } };
      const result = runBashHook(input);
      assert.strictEqual(result.code, 0, 'exit code should be 0');
      const output = parseOutput(result.stdout);
      assert.ok(output, 'should produce JSON');
      // Without the extra regex, `supabase db reset` is a routine bash
      // command and should hit the routine gate (deny first time) — the
      // destructive gate's "rollback" guidance must NOT appear, since this
      // is the routine, not destructive, deny path.
      assert.strictEqual(output.hookSpecificOutput.permissionDecision, 'deny', 'routine gate fires when extra-regex is unset');
      assert.ok(!output.hookSpecificOutput.permissionDecisionReason.includes('rollback'), 'should be routine deny (no "rollback" guidance), not destructive');
      assert.ok(!output.hookSpecificOutput.permissionDecisionReason.includes('Destructive'), 'should not be the destructive deny message');
    })
  )
    passed++;
  else failed++;

  clearState();
  if (
    test('GATEGUARD_BASH_EXTRA_DESTRUCTIVE custom phrase inside $(...) also caught', () => {
      const input = {
        tool_name: 'Bash',
        tool_input: { command: 'echo "running" && $(supabase db reset)' }
      };
      const result = runBashHook(input, {
        GATEGUARD_BASH_EXTRA_DESTRUCTIVE: 'supabase\\s+db\\s+reset'
      });
      const output = parseOutput(result.stdout);
      assert.ok(output, 'should produce JSON');
      assert.strictEqual(output.hookSpecificOutput.permissionDecision, 'deny', 'custom phrase inside command substitution should be gated');
    })
  )
    passed++;
  else failed++;

  // --- find -exec destructive detection ---

  if (
    test('denies find -exec rm {} \\; as destructive', () => {
      expectDestructiveDeny('find . -name "*.tmp" -exec rm {} \\;', 'find -exec rm');
    })
  )
    passed++;
  else failed++;

  if (
    test('denies find -exec rm -rf {} \\; as destructive', () => {
      expectDestructiveDeny('find . -name "*.tmp" -exec rm -rf {} \\;', 'find -exec rm -rf');
    })
  )
    passed++;
  else failed++;

  if (
    test('denies find -exec rmdir {} \\; as destructive', () => {
      expectDestructiveDeny('find . -name "*.tmp" -exec rmdir {} \\;', 'find -exec rmdir');
    })
  )
    passed++;
  else failed++;

  if (
    test('denies find -exec unlink {} \\; as destructive', () => {
      expectDestructiveDeny('find . -name "*.tmp" -exec unlink {} \\;', 'find -exec unlink');
    })
  )
    passed++;
  else failed++;

  if (
    test('denies find -exec git reset --hard {} \\; as destructive', () => {
      expectDestructiveDeny('find . -name "*.tmp" -exec git reset --hard {} \\;', 'find -exec git reset --hard');
    })
  )
    passed++;
  else failed++;

  if (
    test('denies find -exec rm {} \\; preceded by && (bypass via compound command)', () => {
      expectDestructiveDeny('echo x && find . -exec rm {} \\;', 'compound command bypass: find -exec rm');
    })
  )
    passed++;
  else failed++;

  if (
    test('denies find -exec rm -rf {} \\; preceded by ; (bypass via semicolon)', () => {
      expectDestructiveDeny('true; find . -name "*.log" -exec rm -rf {} \\;', 'semicolon bypass: find -exec rm -rf');
    })
  )
    passed++;
  else failed++;

  if (
    test('denies find -exec rm {} \\; in pipeline (bypass via pipe)', () => {
      expectDestructiveDeny('echo start | find . -exec rm {} \\;', 'pipe bypass: find -exec rm');
    })
  )
    passed++;
  else failed++;

  if (
    test('denies find -exec rm {} \\; after || (OR-chain bypass)', () => {
      expectDestructiveDeny('false || find . -exec rm {} \\;', 'OR-chain bypass: find -exec rm');
    })
  )
    passed++;
  else failed++;

  // GHSA-4v57-ph3x-gf55: quote/newline/wrapper bypasses of the classifier.
  if (
    test('denies rm -rf after a newline separator (GHSA-4v57)', () => {
      expectDestructiveDeny('echo safe\nrm -rf /tmp/victim', 'newline-separated rm -rf');
    })
  )
    passed++;
  else failed++;

  if (
    test('denies a single-quoted rm command word (GHSA-4v57)', () => {
      expectDestructiveDeny("'rm' -rf /tmp/victim", "quoted 'rm' command word");
    })
  )
    passed++;
  else failed++;

  if (
    test('denies a double-quoted rm command word (GHSA-4v57)', () => {
      expectDestructiveDeny('"rm" -rf /tmp/victim', 'quoted "rm" command word');
    })
  )
    passed++;
  else failed++;

  if (
    test('denies rm -rf wrapped in sh -c (GHSA-4v57)', () => {
      expectDestructiveDeny("sh -c 'rm -rf /tmp/victim'", 'sh -c wrapper');
    })
  )
    passed++;
  else failed++;

  if (
    test('denies rm -rf wrapped in bash -c (GHSA-4v57)', () => {
      expectDestructiveDeny("bash -c 'rm -rf /tmp/victim'", 'bash -c wrapper');
    })
  )
    passed++;
  else failed++;

  if (
    test('denies find -exec with a quoted rm binary (GHSA-4v57)', () => {
      expectDestructiveDeny("find . -name '*.tmp' -exec 'rm' {} \\;", 'quoted find -exec rm');
    })
  )
    passed++;
  else failed++;

  if (
    test('still allows rm -rf inside a quoted echo argument (no false positive)', () => {
      clearState();
      const input = { tool_name: 'Bash', tool_input: { command: 'echo "to clean run: rm -rf build"' } };
      const result = runBashHook(input);
      assert.strictEqual(result.code, 0, 'exit code should be 0');
      const output = parseOutput(result.stdout);
      assert.ok(!output || !/Destructive|rollback/.test(output.hookSpecificOutput?.permissionDecisionReason || ''), 'rm inside a quoted string arg must not be flagged destructive');
    })
  )
    passed++;
  else failed++;

  if (
    test('allows find -exec echo {} \\; (non-destructive, routine gate)', () => {
      clearState();
      const input = { tool_name: 'Bash', tool_input: { command: 'find . -name "*.tmp" -exec echo {} \\;' } };
      const result = runBashHook(input);
      assert.strictEqual(result.code, 0, 'exit code should be 0');
      const output = parseOutput(result.stdout);
      assert.ok(output, 'should produce JSON output');
      // Should be denied by routine gate (first bash), not destructive gate
      assert.strictEqual(output.hookSpecificOutput.permissionDecision, 'deny', 'should be denied by routine gate');
      assert.ok(!output.hookSpecificOutput.permissionDecisionReason.includes('Destructive'), 'should not be the destructive deny message');
      assert.ok(!output.hookSpecificOutput.permissionDecisionReason.includes('rollback'), 'should not mention rollback');
    })
  )
    passed++;
  else failed++;

  // --- Issue #2078 review fix: warning emitted once per *distinct*
  // invalid regex, not once per process. Verifies the same-process
  // path that the reviewers (CodeRabbit + cubic) flagged.
  clearState();
  if (
    test('GATEGUARD_BASH_EXTRA_DESTRUCTIVE warns once per distinct invalid regex (not once per process)', () => {
      // We can't easily intercept stderr from a spawnSync child without
      // re-running the hook in the same process, so we exercise
      // checkCommand-equivalent behavior via a same-process require.
      const originalEnv = process.env.GATEGUARD_BASH_EXTRA_DESTRUCTIVE;
      const originalStderrWrite = process.stderr.write.bind(process.stderr);
      const captured = [];
      process.stderr.write = chunk => {
        const s = typeof chunk === 'string' ? chunk : chunk.toString();
        if (s.includes('GATEGUARD_BASH_EXTRA_DESTRUCTIVE')) {
          captured.push(s.trim());
        }
        // Don't forward to real stderr — keeps test output clean.
        return true;
      };
      try {
        // First bad pattern — should warn once.
        process.env.GATEGUARD_BASH_EXTRA_DESTRUCTIVE = '(unclosed-a';
        const hook1 = loadDirectHook({ GATEGUARD_BASH_EXTRA_DESTRUCTIVE: '(unclosed-a' });
        hook1.run(JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'ls' } }));
        hook1.run(JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'ls' } }));
        assert.strictEqual(captured.length, 1, `same invalid pattern should warn exactly once, got ${captured.length}: ${JSON.stringify(captured)}`);

        // Switch to a *different* bad pattern — should warn again (this is
        // the bug both reviewers flagged: the sticky flag was never reset
        // when the cache key changed).
        process.env.GATEGUARD_BASH_EXTRA_DESTRUCTIVE = '(unclosed-b';
        hook1.run(JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'ls' } }));
        assert.strictEqual(captured.length, 2, `distinct invalid pattern should produce a second warning, got ${captured.length}: ${JSON.stringify(captured)}`);

        // Switch back to a valid regex — no extra warning.
        process.env.GATEGUARD_BASH_EXTRA_DESTRUCTIVE = 'valid\\s+pattern';
        hook1.run(JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'ls' } }));
        assert.strictEqual(captured.length, 2, `valid regex should not emit a warning, got ${captured.length}: ${JSON.stringify(captured)}`);
      } finally {
        process.stderr.write = originalStderrWrite;
        if (originalEnv === undefined) {
          delete process.env.GATEGUARD_BASH_EXTRA_DESTRUCTIVE;
        } else {
          process.env.GATEGUARD_BASH_EXTRA_DESTRUCTIVE = originalEnv;
        }
      }
    })
  )
    passed++;
  else failed++;

  // --- Fact-force denial dampening (#2142) ---

  console.log('\n  Fact-force denial dampening (#2142):');

  clearState();
  if (
    test('first denials use the full four-fact block and count toward the budget', () => {
      const result = runHook({ tool_name: 'Edit', tool_input: { file_path: '/src/damp-one.js' } });
      const output = parseOutput(result.stdout);
      assert.strictEqual(output.hookSpecificOutput.permissionDecision, 'deny');
      assert.ok(output.hookSpecificOutput.permissionDecisionReason.includes('present these facts'), 'first denial should use the full block');
      const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
      assert.strictEqual(state.fact_force_denials, 1, 'denial counter should persist in session state');
    })
  )
    passed++;
  else failed++;

  clearState();
  if (
    test('emits a condensed single-line denial once the full-block budget is spent', () => {
      writeState({ checked: [], last_active: Date.now(), fact_force_denials: 3 });
      const result = runHook({ tool_name: 'Edit', tool_input: { file_path: '/src/damp-two.js' } });
      const output = parseOutput(result.stdout);
      assert.strictEqual(result.code, 0);
      assert.strictEqual(output.hookSpecificOutput.permissionDecision, 'deny', 'still denies first touch');
      const reason = output.hookSpecificOutput.permissionDecisionReason;
      assert.ok(reason.includes('[Fact-Forcing Gate]'), 'condensed message keeps the gate marker');
      assert.ok(reason.includes('denial #4'), 'condensed message carries the denial ordinal');
      assert.ok(reason.includes('/src/damp-two.js'), 'condensed message names the target');
      assert.ok(!reason.includes('present these facts'), 'no repeated four-fact block');
      assert.ok(!reason.includes('\n'), 'condensed message is a single line');
      assert.ok(reason.includes('ECC_GATEGUARD=off'), 'condensed message keeps a recovery hint');
      assert.ok(reason.includes('GATEGUARD_EXEMPT_GLOBS'), 'condensed Edit denial keeps the path-scoped recovery hint');
    })
  )
    passed++;
  else failed++;

  clearState();
  if (
    test('consecutive condensed denials are textually different (ordinal advances)', () => {
      writeState({ checked: [], last_active: Date.now(), fact_force_denials: 5 });
      const first = parseOutput(runHook({ tool_name: 'Write', tool_input: { file_path: '/src/damp-a.js', content: 'x' } }).stdout);
      // Different directory: a same-dir new-file Write would be a sibling allow, not a denial.
      const second = parseOutput(runHook({ tool_name: 'Write', tool_input: { file_path: '/lib/damp-b.js', content: 'x' } }).stdout);
      const firstReason = first.hookSpecificOutput.permissionDecisionReason;
      const secondReason = second.hookSpecificOutput.permissionDecisionReason;
      assert.ok(firstReason.includes('denial #6'), `expected ordinal 6, got: ${firstReason}`);
      assert.ok(secondReason.includes('denial #7'), `expected ordinal 7, got: ${secondReason}`);
      assert.ok(firstReason.includes('GATEGUARD_EXEMPT_GLOBS'), 'condensed Write denial keeps the path-scoped recovery hint');
      assert.ok(!firstReason.includes('GATEGUARD_BASH_ROUTINE_DISABLED'), 'condensed Write denial should not suggest the routine Bash control');
      assert.notStrictEqual(firstReason, secondReason, 'successive denials must differ so they cannot compound verbatim');
    })
  )
    passed++;
  else failed++;

  clearState();
  if (
    test('retry of the same target is still allowed after a condensed denial', () => {
      writeState({ checked: [], last_active: Date.now(), fact_force_denials: 9 });
      const input = { tool_name: 'Edit', tool_input: { file_path: '/src/damp-retry.js' } };
      const denied = parseOutput(runHook(input).stdout);
      assert.strictEqual(denied.hookSpecificOutput.permissionDecision, 'deny');
      const retryOutput = parseOutput(runHook(input).stdout);
      assert.ok(!retryOutput || !retryOutput.hookSpecificOutput, 'retry passes through (no second deny, no re-prompt)');
    })
  )
    passed++;
  else failed++;

  clearState();
  if (
    test('GATEGUARD_FACT_FORCE_FULL_DENIALS tunes the full-block budget', () => {
      // Budget 0: condensed from the very first denial.
      const zero = parseOutput(runHook({ tool_name: 'Edit', tool_input: { file_path: '/src/damp-zero.js' } }, { GATEGUARD_FACT_FORCE_FULL_DENIALS: '0' }).stdout);
      assert.ok(zero.hookSpecificOutput.permissionDecisionReason.includes('denial #1'));
      assert.ok(!zero.hookSpecificOutput.permissionDecisionReason.includes('present these facts'));

      // Large budget: full block well past the default threshold.
      clearState();
      writeState({ checked: [], last_active: Date.now(), fact_force_denials: 7 });
      const big = parseOutput(runHook({ tool_name: 'Edit', tool_input: { file_path: '/src/damp-big.js' } }, { GATEGUARD_FACT_FORCE_FULL_DENIALS: '20' }).stdout);
      assert.ok(big.hookSpecificOutput.permissionDecisionReason.includes('present these facts'), 'budget of 20 keeps the full block at denial 8');
    })
  )
    passed++;
  else failed++;

  clearState();
  if (
    test('allows new paths after the session-wide denial budget', () => {
      writeState({ checked: [], last_active: Date.now(), fact_force_denials: 3 });
      const result = runHook(
        { tool_name: 'Edit', tool_input: { file_path: '/src/after-budget.js' } },
        { GATEGUARD_FACT_FORCE_MAX_DENIALS: '3' }
      );
      assert.strictEqual(result.code, 0);
      const output = parseOutput(result.stdout);
      assert.ok(output, 'should produce valid JSON output');
      assert.ok(!output.hookSpecificOutput, 'paths after the budget should pass through');
      assert.strictEqual(output.tool_name, 'Edit', 'pass-through should preserve input');
    })
  )
    passed++;
  else failed++;

  clearState();
  if (
    test('MultiEdit allows new paths after the session-wide denial budget', () => {
      writeState({ checked: [], last_active: Date.now(), fact_force_denials: 3 });
      const result = runHook(
        { tool_name: 'MultiEdit', tool_input: { edits: [{ file_path: '/src/after-multi-budget.js', old_string: 'a', new_string: 'b' }] } },
        { GATEGUARD_FACT_FORCE_MAX_DENIALS: '3' }
      );
      assert.strictEqual(result.code, 0);
      const output = parseOutput(result.stdout);
      assert.ok(output, 'should produce valid JSON output');
      assert.ok(!output.hookSpecificOutput, 'MultiEdit paths after the budget should pass through');
      assert.strictEqual(output.tool_name, 'MultiEdit', 'pass-through should preserve input');
    })
  )
    passed++;
  else failed++;

  clearState();
  if (
    test('Write allows new paths after the session-wide denial budget', () => {
      writeState({ checked: [], last_active: Date.now(), fact_force_denials: 3 });
      const result = runHook(
        { tool_name: 'Write', tool_input: { file_path: '/src/after-write-budget.js', content: 'x' } },
        { GATEGUARD_FACT_FORCE_MAX_DENIALS: '3' }
      );
      assert.strictEqual(result.code, 0);
      const output = parseOutput(result.stdout);
      assert.ok(output, 'should produce valid JSON output');
      assert.ok(!output.hookSpecificOutput, 'Write paths after the budget should pass through');
      assert.strictEqual(output.tool_name, 'Write', 'pass-through should preserve input');
    })
  )
    passed++;
  else failed++;

  clearState();
  if (
    test('denies at the exact budget and passes through on the next path', () => {
      writeState({ checked: [], last_active: Date.now(), fact_force_denials: 2 });
      const atLimit = runHook(
        { tool_name: 'Edit', tool_input: { file_path: '/src/at-budget.js' } },
        { GATEGUARD_FACT_FORCE_MAX_DENIALS: '3' }
      );
      const atLimitOutput = parseOutput(atLimit.stdout);
      assert.ok(atLimitOutput, 'should produce valid JSON output at the limit');
      assert.strictEqual(
        atLimitOutput.hookSpecificOutput.permissionDecision,
        'deny',
        'the denial that reaches the budget should still deny'
      );

      const pastLimit = runHook(
        { tool_name: 'Edit', tool_input: { file_path: '/src/past-budget.js' } },
        { GATEGUARD_FACT_FORCE_MAX_DENIALS: '3' }
      );
      const pastLimitOutput = parseOutput(pastLimit.stdout);
      assert.ok(pastLimitOutput, 'should produce valid JSON output past the limit');
      assert.ok(!pastLimitOutput.hookSpecificOutput, 'the next path should pass through');
    })
  )
    passed++;
  else failed++;

  for (const malformed of ['3.5', '3oops', '0x3', ' 3 oops', '-1', '']) {
    clearState();
    if (
      test(`leaves the gate uncapped for malformed budget ${JSON.stringify(malformed)}`, () => {
        writeState({ checked: [], last_active: Date.now(), fact_force_denials: 9 });
        const result = runHook(
          { tool_name: 'Edit', tool_input: { file_path: '/src/malformed-budget.js' } },
          { GATEGUARD_FACT_FORCE_MAX_DENIALS: malformed }
        );
        const output = parseOutput(result.stdout);
        assert.ok(output, 'should produce valid JSON output');
        assert.strictEqual(
          output.hookSpecificOutput.permissionDecision,
          'deny',
          'a malformed budget must not silently become a finite cap'
        );
      })
    )
      passed++;
    else failed++;
  }

  clearState();
  if (
    test('condensed denial names the session-wide denial cap', () => {
      writeState({ checked: [], last_active: Date.now(), fact_force_denials: 5 });
      const result = runHook(
        { tool_name: 'Edit', tool_input: { file_path: '/src/condensed-budget.js' } },
        { GATEGUARD_FACT_FORCE_MAX_DENIALS: '10' }
      );
      const output = parseOutput(result.stdout);
      assert.ok(output, 'should produce valid JSON output');
      const reason = output.hookSpecificOutput.permissionDecisionReason;
      assert.strictEqual(output.hookSpecificOutput.permissionDecision, 'deny');
      assert.ok(
        reason.includes('GATEGUARD_FACT_FORCE_MAX_DENIALS'),
        'condensed denial should name the session-wide denial cap'
      );
    })
  )
    passed++;
  else failed++;

  clearState();
  if (
    test('malformed denial counter in state is treated as zero (full block, no crash)', () => {
      writeState({ checked: [], last_active: Date.now(), fact_force_denials: 'garbage' });
      const result = runHook({ tool_name: 'Edit', tool_input: { file_path: '/src/damp-malformed.js' } });
      assert.strictEqual(result.code, 0);
      const output = parseOutput(result.stdout);
      assert.strictEqual(output.hookSpecificOutput.permissionDecision, 'deny');
      assert.ok(output.hookSpecificOutput.permissionDecisionReason.includes('present these facts'), 'malformed counter resets to the full block');
    })
  )
    passed++;
  else failed++;

  clearState();
  if (
    test('MultiEdit denials are dampened past the budget', () => {
      writeState({ checked: [], last_active: Date.now(), fact_force_denials: 4 });
      const result = runHook({
        tool_name: 'MultiEdit',
        tool_input: { edits: [{ file_path: '/src/damp-multi.js', old_string: 'a', new_string: 'b' }] }
      });
      const output = parseOutput(result.stdout);
      assert.strictEqual(output.hookSpecificOutput.permissionDecision, 'deny');
      assert.ok(output.hookSpecificOutput.permissionDecisionReason.includes('denial #5'));
      assert.ok(!output.hookSpecificOutput.permissionDecisionReason.includes('present these facts'));
      assert.ok(output.hookSpecificOutput.permissionDecisionReason.includes('GATEGUARD_EXEMPT_GLOBS'), 'condensed MultiEdit denial keeps the path-scoped recovery hint');
    })
  )
    passed++;
  else failed++;

  clearState();
  if (
    test('destructive Bash gate keeps the full message regardless of denial count', () => {
      writeState({ checked: ['__bash_session__'], last_active: Date.now(), fact_force_denials: 50 });
      const result = runBashHook({ tool_name: 'Bash', tool_input: { command: 'rm -rf /tmp/damp-target' } });
      const output = parseOutput(result.stdout);
      assert.strictEqual(output.hookSpecificOutput.permissionDecision, 'deny');
      assert.ok(output.hookSpecificOutput.permissionDecisionReason.includes('rollback'), 'destructive gate is exempt from dampening');
    })
  )
    passed++;
  else failed++;

  // --- Novos comandos Git read-only ---
  console.log('\n  Novos comandos Git read-only:');

  clearState();
  if (
    test('allows git diff --cached', () => {
      expectAllow('git diff --cached', 'git diff --cached');
    })
  )
    passed++;
  else failed++;

  clearState();
  if (
    test('allows git diff --staged', () => {
      expectAllow('git diff --staged', 'git diff --staged');
    })
  )
    passed++;
  else failed++;

  clearState();
  if (
    test('allows git diff --stat', () => {
      expectAllow('git diff --stat', 'git diff --stat');
    })
  )
    passed++;
  else failed++;

  clearState();
  if (
    test('allows git diff --name-only --cached', () => {
      expectAllow('git diff --name-only --cached', 'git diff --name-only --cached');
    })
  )
    passed++;
  else failed++;

  clearState();
  if (
    test('allows git show --stat', () => {
      expectAllow('git show --stat', 'git show --stat');
    })
  )
    passed++;
  else failed++;

  clearState();
  if (
    test('allows git show --name-only', () => {
      expectAllow('git show --name-only', 'git show --name-only');
    })
  )
    passed++;
  else failed++;

  clearState();
  if (
    test('allows git show HEAD --stat', () => {
      expectAllow('git show HEAD --stat', 'git show HEAD --stat');
    })
  )
    passed++;
  else failed++;

  clearState();
  if (
    test('allows git show HEAD --name-only', () => {
      expectAllow('git show HEAD --name-only', 'git show HEAD --name-only');
    })
  )
    passed++;
  else failed++;

  // Garantir que comandos destrutivos continuam negados
  clearState();
  if (
    test('still denies git reset --hard', () => {
      expectDestructiveDeny('git reset --hard', 'git reset --hard');
    })
  )
    passed++;
  else failed++;

  clearState();
  if (
    test('still denies git checkout -f', () => {
      expectDestructiveDeny('git checkout -f main', 'git checkout -f');
    })
  )
    passed++;
  else failed++;

  clearState();
  if (
    test('still denies git clean -fd', () => {
      expectDestructiveDeny('git clean -fd', 'git clean -fd');
    })
  )
    passed++;
  else failed++;

  clearState();
  if (
    test('still denies git push --force', () => {
      expectDestructiveDeny('git push --force origin main', 'git push --force');
    })
  )
    passed++;
  else failed++;

  // --- Exempt globs: GATEGUARD_EXEMPT_GLOBS skips first-touch fact-forcing ---
  clearState();
  if (
    test('exempts an Edit whose path matches GATEGUARD_EXEMPT_GLOBS', () => {
      const input = {
        tool_name: 'Edit',
        tool_input: { file_path: '/proj/tests/test_x.js', old_string: 'a', new_string: 'b' }
      };
      const result = runHook(input, { GATEGUARD_EXEMPT_GLOBS: '**/tests/**', CLAUDE_PROJECT_DIR: '/proj' });
      assert.strictEqual(result.code, 0, 'exit code should be 0');
      const output = parseOutput(result.stdout);
      assert.ok(output, 'should produce valid JSON output');
      if (output.hookSpecificOutput) {
        assert.notStrictEqual(output.hookSpecificOutput.permissionDecision, 'deny', 'exempt path must not be denied');
      } else {
        assert.strictEqual(output.tool_name, 'Edit', 'pass-through should preserve input');
      }
    })
  )
    passed++;
  else failed++;

  clearState();
  if (
    test('does NOT exempt a non-matching path under the same globs', () => {
      const input = {
        tool_name: 'Edit',
        tool_input: { file_path: '/proj/src/core/x.js', old_string: 'a', new_string: 'b' }
      };
      const result = runHook(input, { GATEGUARD_EXEMPT_GLOBS: '**/tests/**' });
      const output = parseOutput(result.stdout);
      assert.ok(output, 'should produce JSON output');
      assert.strictEqual(output.hookSpecificOutput.permissionDecision, 'deny', 'non-matching path still gated');
    })
  )
    passed++;
  else failed++;

  if (
    test('supports multiple comma-separated exempt globs (Write + non-match)', () => {
      const globs = '**/tests/**,**/scratchpad/**';
      clearState();
      const exempt = runHook(
        { tool_name: 'Write', tool_input: { file_path: '/tmp/x/scratchpad/s.js', content: 'x' } },
        { GATEGUARD_EXEMPT_GLOBS: globs, CLAUDE_PROJECT_DIR: '/tmp/x' }
      );
      const exemptOut = parseOutput(exempt.stdout);
      assert.ok(exemptOut, 'should produce JSON output');
      if (exemptOut.hookSpecificOutput) {
        assert.notStrictEqual(exemptOut.hookSpecificOutput.permissionDecision, 'deny', 'scratchpad path exempt');
      }
      clearState();
      const gated = runHook(
        { tool_name: 'Write', tool_input: { file_path: '/proj/src/s.js', content: 'x' } },
        { GATEGUARD_EXEMPT_GLOBS: globs }
      );
      const gatedOut = parseOutput(gated.stdout);
      assert.ok(gatedOut, 'should produce JSON output');
      assert.strictEqual(gatedOut.hookSpecificOutput.permissionDecision, 'deny', 'src path still gated');
    })
  )
    passed++;
  else failed++;

  clearState();
  if (
    test('is default-off: unset GATEGUARD_EXEMPT_GLOBS gates tests/ as before', () => {
      const input = {
        tool_name: 'Edit',
        tool_input: { file_path: '/proj/tests/test_x.js', old_string: 'a', new_string: 'b' }
      };
      const result = runHook(input, { GATEGUARD_EXEMPT_GLOBS: '' });
      const output = parseOutput(result.stdout);
      assert.ok(output, 'should produce JSON output');
      assert.strictEqual(output.hookSpecificOutput.permissionDecision, 'deny', 'no exemptions when unset');
    })
  )
    passed++;
  else failed++;

  for (const { glob, filePath, cwd = '/proj', exempt } of [
    { glob: 'services/**', filePath: '/proj/services/api.js', exempt: true },
    { glob: 'services/**', filePath: '/other/services/api.js', exempt: false },
    { glob: 'services/**', filePath: '/proj/vendor/services/api.js', exempt: false },
    { glob: 'services/**', filePath: '/proj/my-services/api.js', exempt: false },
    { glob: '*.md', filePath: '/proj/notes.md/outline.txt', exempt: false },
    { glob: '*.md', filePath: '/proj/docs/notes.md', exempt: false },
    { glob: '*.md', filePath: '/other/notes.md', exempt: false },
    { glob: 'README.md', filePath: '/proj/readme.md', exempt: true },
    { glob: '*.md', filePath: './notes.md', exempt: true },
    { glob: '**/*.md', filePath: '/proj/docs/notes.md', exempt: true },
    { glob: '**/*.md', filePath: '/proj/notes.md', exempt: true },
    { glob: '**/*.md', filePath: '../other/notes.md', exempt: false },
    { glob: 'docs/?otes.md', filePath: '/proj/docs/notes.md', exempt: true },
    { glob: 'docs?notes.md', filePath: '/proj/docs/notes.md', exempt: false },
    { glob: 'services/**', filePath: 'C:\\proj\\services\\api.js', cwd: 'C:\\proj', exempt: true },
    { glob: 'services/**', filePath: 'C:\\other\\services\\api.js', cwd: 'C:\\proj', exempt: false },
    { glob: '/approved/docs/**', filePath: '/approved/docs/notes.md', exempt: true },
  ]) {
    clearState();
    if (test(`scopes exempt glob ${glob} for ${filePath}`, () => {
      const result = runHook(
        { cwd, tool_name: 'Edit', tool_input: { file_path: filePath } },
        { GATEGUARD_EXEMPT_GLOBS: glob, CLAUDE_PROJECT_DIR: cwd }
      );
      const output = parseOutput(result.stdout);
      assert.strictEqual(output?.hookSpecificOutput?.permissionDecision === 'deny', !exempt);
    })) passed++;
    else failed++;
  }

  clearState();
  if (test('MultiEdit gates outside-project targets even when another target is exempt', () => {
    const result = runHook({
      cwd: '/proj', tool_name: 'MultiEdit',
      tool_input: { edits: [{ file_path: '/proj/docs/a.md' }, { file_path: '/other/docs/b.md' }] }
    }, { GATEGUARD_EXEMPT_GLOBS: 'docs/**', CLAUDE_PROJECT_DIR: '/proj' });
    const output = parseOutput(result.stdout);
    assert.strictEqual(output?.hookSpecificOutput?.permissionDecision, 'deny');
    assert.ok(output.hookSpecificOutput.permissionDecisionReason.includes('/other/docs/b.md'));
  })) passed++;
  else failed++;

  // --- PowerShell tool consumer contract ---
  if (
    test('normalizes PowerShell tool-name casing before destructive classification', () => {
      for (const toolName of ['PowerShell', 'powershell', 'POWERSHELL']) {
        clearState();
        const result = runPowerShellHook({
          tool_name: toolName,
          tool_input: { command: 'Remove-Item -Force C:/tmp/demo' }
        });
        assert.strictEqual(result.code, 0, `${toolName} hook should exit 0`);
        const output = parseOutput(result.stdout);
        assert.ok(output, `${toolName} should produce JSON output`);
        assert.strictEqual(
          output.hookSpecificOutput?.permissionDecision,
          'deny',
          `${toolName} should be denied`
        );
        assert.match(
          output.hookSpecificOutput.permissionDecisionReason,
          /Destructive command detected/
        );
      }
    })
  )
    passed++;
  else failed++;

  if (
    test('denies the first routine PowerShell command and allows its retry', () => {
      clearState();
      const input = {
        tool_name: 'PowerShell',
        tool_input: { command: 'Get-Date' }
      };

      const first = runPowerShellHook(input);
      assert.strictEqual(first.code, 0, 'first PowerShell hook should exit 0');
      const firstOutput = parseOutput(first.stdout);
      assert.ok(firstOutput, 'first PowerShell attempt should produce JSON output');
      assert.strictEqual(
        firstOutput.hookSpecificOutput?.permissionDecision,
        'deny',
        'first routine PowerShell command should be denied'
      );
      assert.match(
        firstOutput.hookSpecificOutput.permissionDecisionReason,
        /pre:powershell:gateguard-fact-force/,
        'recovery guidance should name the independently configurable PowerShell hook ID'
      );

      const retry = runPowerShellHook(input);
      assert.strictEqual(retry.code, 0, 'PowerShell retry should exit 0');
      const retryOutput = parseOutput(retry.stdout);
      assert.ok(retryOutput, 'PowerShell retry should produce JSON output');
      if (retryOutput.hookSpecificOutput) {
        assert.notStrictEqual(
          retryOutput.hookSpecificOutput.permissionDecision,
          'deny',
          'routine PowerShell retry should be allowed'
        );
      } else {
        assert.strictEqual(retryOutput.tool_name, 'PowerShell');
      }
    })
  )
    passed++;
  else failed++;

  if (
    test('denies direct and nested destructive PowerShell commands', () => {
      const encodedPayload = Buffer.from(
        'Remove-Item -Force C:/tmp/demo',
        'utf16le'
      ).toString('base64');
      const commands = [
        'Remove-Item -Recurse C:/tmp/demo',
        'rp -Force HKCU:/Software/Demo -Name setting',
        'Clear-Disk -Number 2 -RemoveData -Confirm:$false',
        'pwsh -Command "Remove-Item -Force C:/tmp/demo"',
        'pwsh -Command:"Remove-Item -Force C:/tmp/demo"',
        `pwsh -EncodedCommand:${encodedPayload}`,
        "$payload='Remove-Item -Force C:/tmp/demo'; pwsh -Command $payload",
        "$payload='Remove-Item -Force C:/tmp/demo'; pwsh -Command \"$payload\"",
        "$payload='Remove-Item -Force C:/tmp/demo'; pwsh -Command \"Write-Output ready; $payload\"",
        "$payload='Remove-Item'; pwsh -Command $payload -Force C:/tmp/demo",
        "$cmd='Remove-Item'; Set-Alias zap $cmd; zap -Force C:/tmp/demo",
        "$cmd='Remove-Item'; Set-Alias -Name zap $cmd; zap -Force C:/tmp/demo",
        "$cmd='Remove-Item'; Set-Alias -Scope Global -Name zap $cmd; zap -Force C:/tmp/demo",
        "$cmd='Remove-Item'; New-Alias -Description demo -Name zap $cmd; zap -Force C:/tmp/demo",
        "$cmd='Remove-Item'; sal -Option AllScope -Name zap $cmd; zap -Force C:/tmp/demo",
        'Set-Alias -Unknown demo -Name zap Write-Output; zap ok',

        'Set-Alias -Name zap Remove-Item; zap -Force C:/tmp/demo',
        'Set-Alias -Name zap $cmd; zap -Force C:/tmp/demo',
        "$cmd='Remove-Item'; Set-Alias -Value $cmd zap; zap -Force C:/tmp/demo",
        "$payload='Remove-Item -Force C:/tmp/demo'; $payload | pwsh -Command -",
        "$payload='Remove-Item -Force C:/tmp/demo'; Write-Output $payload | pwsh -Command -",
        "Set-Alias zap $cmd; zap -Force C:/tmp/demo; $cmd='Write-Output'",
        "$payload | pwsh -Command -; $payload='Write-Output ok'",
        'pwsh -Command "Write-Output ready; $runtimePayload"',
        'pwsh -Command $runtimePayload -Force C:/tmp/demo',
        'Write-Output "$(Remove-Item -Force C:/tmp/demo)"',
        '& { Remove-Item -Force C:/tmp/demo }',
        'if ($true) { Remove-Item -Force C:/tmp/demo }',
        '@(Remove-Item -Force C:/tmp/demo)',
        'cmd /c "rd /s /q C:/tmp/demo"',
        'Remove-Item `\n-Force C:/tmp/demo',
        '# (\nRemove-Item -Force C:/tmp/demo',
        '<# ignored <# #> Remove-Item -Force C:/tmp/demo',
        'function cleanup { Remove-Item -Force C:/tmp/demo }; if ($true) { cleanup }',
        'cmd /c pwsh -Command "Remove-Item -Force C:/tmp/demo"',
        '@"\n" # $(Remove-Item -Force C:/tmp/demo)\n"@',
        '& ‘Remove-Item’ -Force C:/tmp/demo',
        'Invoke-Expression $runtimeValue',
        'pwsh -Command "$payload"; $payload = "Write-Output ok"'
      ];

      for (const command of commands) {
        clearState();
        const result = runPowerShellHook({
          tool_name: 'PowerShell',
          tool_input: { command }
        });
        assert.strictEqual(result.code, 0, `${command} hook should exit 0`);
        const output = parseOutput(result.stdout);
        assert.ok(output, `${command} should produce JSON output`);
        assert.strictEqual(
          output.hookSpecificOutput?.permissionDecision,
          'deny',
          `${command} should be denied`
        );
        assert.match(
          output.hookSpecificOutput.permissionDecisionReason,
          /Destructive command detected/
        );
      }
    })
  )
    passed++;
  else failed++;

  if (
    test('allows benign PowerShell after the shared routine shell gate is satisfied', () => {
      clearState();
      writeState({ checked: ['__bash_session__'], last_active: Date.now() });

      for (const command of ['Get-ChildItem C:/tmp', 'Remove-Item C:/tmp/notes.txt']) {
        const result = runPowerShellHook({
          tool_name: 'PowerShell',
          tool_input: { command }
        });
        assert.strictEqual(result.code, 0, `${command} hook should exit 0`);
        const output = parseOutput(result.stdout);
        assert.ok(output, `${command} should produce JSON output`);
        if (output.hookSpecificOutput) {
          assert.notStrictEqual(
            output.hookSpecificOutput.permissionDecision,
            'deny',
            `${command} should not receive a destructive denial`
          );
        } else {
          assert.strictEqual(output.tool_name, 'PowerShell');
        }
      }
    })
  )
    passed++;
  else failed++;

  // --- Batch consistency (#3136): a parallel batch of edits to one ---
  // not-yet-touched file partially applies: the first denial marks the
  // file checked, so sibling edits in the same batch are allowed. Hooks
  // see calls one at a time and cannot lock a batch, so the contract is
  // that the denial itself names the file and warns that batch siblings
  // may already have been applied.
  clearState();
  if (
    test('first-touch Edit denial warns about applied batch siblings (#3136)', () => {
      // Two edits to the same unchecked file, sent as a parallel batch.
      // Each hook invocation is its own process, exactly as in a batch.
      const editA = {
        tool_name: 'Edit',
        tool_input: { file_path: '/src/batch-target.js', old_string: 'a', new_string: 'b' }
      };
      const editB = {
        tool_name: 'Edit',
        tool_input: { file_path: '/src/batch-target.js', old_string: 'c', new_string: 'd' }
      };

      const first = parseOutput(runHook(editA).stdout);
      assert.strictEqual(first.hookSpecificOutput.permissionDecision, 'deny', 'first edit of the batch is gated');
      const firstReason = first.hookSpecificOutput.permissionDecisionReason;
      assert.ok(firstReason.includes('/src/batch-target.js'), 'denial names the exact file');
      assert.ok(
        firstReason.includes('parallel batch'),
        'denial warns that batch siblings may already have been applied'
      );
      assert.ok(
        firstReason.includes('Re-read'),
        'denial tells the agent to re-read the file before building on siblings'
      );

      // Sibling edit in the same batch: judged against post-denial state,
      // so it applies. The warning above is what makes this visible.
      const second = parseOutput(runHook(editB).stdout);
      if (second && second.hookSpecificOutput) {
        assert.notStrictEqual(second.hookSpecificOutput.permissionDecision, 'deny', 'batch sibling is not re-gated');
      }
    })
  )
    passed++;
  else failed++;

  clearState();
  if (
    test('condensed Edit denial also warns about applied batch siblings (#3136)', () => {
      writeState({ checked: [], last_active: Date.now(), fact_force_denials: 3 });
      const result = runHook({ tool_name: 'Edit', tool_input: { file_path: '/src/batch-condensed.js' } });
      const output = parseOutput(result.stdout);
      assert.strictEqual(output.hookSpecificOutput.permissionDecision, 'deny');
      const reason = output.hookSpecificOutput.permissionDecisionReason;
      assert.ok(reason.includes('parallel batch'), 'condensed denial keeps the batch-sibling warning');
      assert.ok(!reason.includes('\n'), 'condensed denial stays a single line');
    })
  )
    passed++;
  else failed++;

  clearState();
  if (
    test('first-touch Write and MultiEdit denials warn about applied batch siblings (#3136)', () => {
      const writeOut = parseOutput(
        runHook({ tool_name: 'Write', tool_input: { file_path: '/src/batch-new.js', content: 'x' } }).stdout
      );
      assert.strictEqual(writeOut.hookSpecificOutput.permissionDecision, 'deny');
      assert.ok(
        writeOut.hookSpecificOutput.permissionDecisionReason.includes('parallel batch'),
        'Write denial carries the batch-sibling warning'
      );

      const multiOut = parseOutput(
        runHook({
          tool_name: 'MultiEdit',
          tool_input: { edits: [{ file_path: '/src/batch-multi.js', old_string: 'a', new_string: 'b' }] }
        }).stdout
      );
      assert.strictEqual(multiOut.hookSpecificOutput.permissionDecision, 'deny');
      assert.ok(
        multiOut.hookSpecificOutput.permissionDecisionReason.includes('parallel batch'),
        'MultiEdit denial carries the batch-sibling warning'
      );
    })
  )
    passed++;
  else failed++;

  // --- Canonical checked-path keys ---
  const decisionOf = result => {
    const output = parseOutput(result.stdout);
    return output && output.hookSpecificOutput ? output.hookSpecificOutput.permissionDecision : undefined;
  };
  const denialCount = () => JSON.parse(fs.readFileSync(stateFile, 'utf8')).fact_force_denials;

  clearState();
  if (
    test('a.py, ./a.py and <root>/a.py share one checked key (one denial)', () => {
      const env = { CLAUDE_PROJECT_DIR: '/proj-keys' };
      const edit = file_path => runHook({ tool_name: 'Edit', tool_input: { file_path, old_string: 'a', new_string: 'b' } }, env);
      assert.strictEqual(decisionOf(edit('a.py')), 'deny', 'first touch of a.py is denied');
      assert.notStrictEqual(decisionOf(edit('./a.py')), 'deny', './a.py is the same file');
      assert.notStrictEqual(decisionOf(edit('/proj-keys/a.py')), 'deny', 'absolute spelling is the same file');
      assert.strictEqual(denialCount(), 1, 'exactly one denial counted');
    })
  )
    passed++;
  else failed++;

  clearState();
  if (
    test('raw key from an older state file still counts as checked', () => {
      writeState({ checked: ['a.py'], last_active: Date.now(), fact_force_denials: 1 });
      const result = runHook(
        { tool_name: 'Edit', tool_input: { file_path: 'a.py', old_string: 'a', new_string: 'b' } },
        { CLAUDE_PROJECT_DIR: '/proj-keys' }
      );
      assert.notStrictEqual(decisionOf(result), 'deny', 'raw legacy key must not be re-denied');
      assert.strictEqual(denialCount(), 1, 'no new denial counted');
    })
  )
    passed++;
  else failed++;

  clearState();
  if (
    test('Windows root folds separators and case into one key', () => {
      const env = { CLAUDE_PROJECT_DIR: 'C:\\proj' };
      const write = file_path => runHook({ tool_name: 'Write', tool_input: { file_path, content: 'x' } }, env);
      assert.strictEqual(decisionOf(write('src\\a.py')), 'deny', 'first touch is denied');
      assert.notStrictEqual(decisionOf(write('c:/proj/src/a.py')), 'deny', 'forward-slash lowercase spelling is the same file');
      assert.notStrictEqual(decisionOf(write('C:\\PROJ\\src\\A.py')), 'deny', 'case differs only on win32');
      assert.strictEqual(denialCount(), 1, 'exactly one denial counted');
    })
  )
    passed++;
  else failed++;

  clearState();
  if (
    test('MultiEdit entries use the canonical key', () => {
      const env = { CLAUDE_PROJECT_DIR: '/proj-keys' };
      assert.strictEqual(
        decisionOf(runHook({ tool_name: 'Edit', tool_input: { file_path: 'b.py', old_string: 'a', new_string: 'b' } }, env)),
        'deny'
      );
      const multi = runHook(
        { tool_name: 'MultiEdit', tool_input: { edits: [{ file_path: './b.py', old_string: 'a', new_string: 'b' }] } },
        env
      );
      assert.notStrictEqual(decisionOf(multi), 'deny', 'MultiEdit on ./b.py matches the checked b.py');
      assert.strictEqual(denialCount(), 1, 'exactly one denial counted');
    })
  )
    passed++;
  else failed++;

  // --- Relative targets resolve against the tool cwd, not the project root ---
  clearState();
  if (
    test('relative target resolves against data.cwd before CLAUDE_PROJECT_DIR', () => {
      const env = { CLAUDE_PROJECT_DIR: '/proj-cwd' };
      const edit = file_path =>
        runHook({ tool_name: 'Edit', cwd: '/proj-cwd/sub', tool_input: { file_path, old_string: 'a', new_string: 'b' } }, env);
      assert.strictEqual(decisionOf(edit('src/a.py')), 'deny', 'first touch of src/a.py (cwd sub) is denied');
      assert.notStrictEqual(decisionOf(edit('/proj-cwd/sub/src/a.py')), 'deny', 'absolute spelling of the same file is checked');
      assert.strictEqual(decisionOf(edit('/proj-cwd/src/a.py')), 'deny', 'a different file under the project root is gated');
      assert.strictEqual(denialCount(), 2, 'two distinct files, two denials');
    })
  )
    passed++;
  else failed++;

  clearState();
  if (
    test('without data.cwd a relative target still resolves against CLAUDE_PROJECT_DIR', () => {
      const env = { CLAUDE_PROJECT_DIR: '/proj-cwd' };
      const edit = file_path => runHook({ tool_name: 'Edit', tool_input: { file_path, old_string: 'a', new_string: 'b' } }, env);
      assert.strictEqual(decisionOf(edit('src/a.py')), 'deny');
      assert.notStrictEqual(decisionOf(edit('/proj-cwd/src/a.py')), 'deny', 'project-root fallback unchanged');
    })
  )
    passed++;
  else failed++;

  // --- Questions by target class ---
  const CLASS_ENV = { CLAUDE_PROJECT_DIR: '/proj-classes' };
  const QUOTE_LINE = "Quote the user's current instruction verbatim";
  const RETRY_LINE = 'Present the facts, then retry the same operation.';
  const classDenialReason = (toolName, file_path, env = {}) => {
    const tool_input = toolName === 'MultiEdit'
      ? { edits: [{ file_path, old_string: 'a', new_string: 'b' }] }
      : { file_path, old_string: 'a', new_string: 'b', content: 'x' };
    const output = parseOutput(runHook({ tool_name: toolName, tool_input }, { ...CLASS_ENV, ...env }).stdout);
    assert.ok(output && output.hookSpecificOutput, `${toolName} ${file_path} should be denied`);
    assert.strictEqual(output.hookSpecificOutput.permissionDecision, 'deny');
    return output.hookSpecificOutput.permissionDecisionReason;
  };
  const assertNoCodeQuestions = reason => {
    assert.ok(!reason.includes('call this new file'), 'must not ask the code Write questions');
    assert.ok(!reason.includes('import/require'), 'must not ask the code Edit questions');
    assert.ok(!reason.includes('public functions/classes'), 'must not ask the code Edit questions');
  };
  const assertFrame = (reason, verb, file) => {
    assert.ok(reason.startsWith('[Fact-Forcing Gate]\n\n'), 'keeps the gate header');
    assert.ok(reason.includes(`Before ${verb} ${file}, present these facts:`), `header names ${verb} ${file}`);
    assert.ok(reason.includes(QUOTE_LINE), 'list ends with the verbatim-instruction line');
    assert.ok(reason.includes(`If this call was sent in a parallel batch, other edits to ${file}`), 'keeps batch-sibling warning');
    assert.ok(reason.includes(RETRY_LINE), 'keeps the closing retry line');
    assert.ok(reason.includes('GATEGUARD_EXEMPT_GLOBS'), 'keeps the path-scoped recovery hint');
  };

  clearState();
  if (
    test('first-touch Write of docs/guide.md asks prose questions, not code questions', () => {
      const reason = classDenialReason('Write', 'docs/guide.md');
      assertFrame(reason, 'creating', 'docs/guide.md');
      assert.ok(reason.includes('supersedes or duplicates'), 'asks what it supersedes');
      assert.ok(reason.includes('linked or referenced from'), 'asks where it is linked from');
      assert.ok(reason.includes('why a new file rather than editing an existing one'), 'asks why a new file');
      assert.ok(reason.includes(`4. ${QUOTE_LINE}`), 'quote is item 4');
      assertNoCodeQuestions(reason);
    })
  )
    passed++;
  else failed++;

  clearState();
  if (
    test('first-touch Edit of docs/guide.md asks prose Edit questions', () => {
      const reason = classDenialReason('Edit', 'docs/guide.md');
      assertFrame(reason, 'editing', 'docs/guide.md');
      assert.ok(reason.includes('reference the section being changed'), 'asks what references the section');
      assert.ok(reason.includes('corrects or adds'), 'asks what the change corrects or adds');
      assert.ok(reason.includes(`3. ${QUOTE_LINE}`), 'quote is item 3');
      assert.ok(!reason.includes('supersedes'), 'Write-only prose question absent');
      assertNoCodeQuestions(reason);
    })
  )
    passed++;
  else failed++;

  clearState();
  if (
    test('skills/x/SKILL.md and .claude/agents/a.md get instruction questions', () => {
      for (const file of ['skills/x/SKILL.md', '.claude/agents/a.md', 'CLAUDE.md']) {
        const reason = classDenialReason('Write', file);
        assertFrame(reason, 'creating', file);
        assert.ok(reason.includes('harness/loader'), `${file}: asks which harness reads it`);
        assert.ok(reason.includes('agent behaviour changes'), `${file}: asks what behaviour changes`);
        assert.ok(reason.includes('instruction, skill, or agent file already covers'), `${file}: asks for existing coverage`);
        assert.ok(reason.includes(`4. ${QUOTE_LINE}`), `${file}: quote is item 4`);
        assertNoCodeQuestions(reason);
      }
    })
  )
    passed++;
  else failed++;

  clearState();
  if (
    test('src/a.py Write and Edit keep the code text byte-identical', () => {
      const fullReason = tool_input => {
        const output = parseOutput(runHook({ tool_name: tool_input.content === undefined ? 'Edit' : 'Write', tool_input }, CLASS_ENV).stdout);
        assert.ok(output && output.hookSpecificOutput, `${tool_input.file_path} should be denied`);
        return output.hookSpecificOutput.permissionDecisionReason;
      };
      const writeReason = fullReason({ file_path: 'src/a.py', content: 'import json\n' });
      const expectedWrite = [
        '[Fact-Forcing Gate]',
        '',
        'Before creating src/a.py, present these facts:',
        '',
        '1. Name the file(s) and line(s) that will call this new file',
        '2. Confirm no existing file serves the same purpose (search the tree — Glob/Grep, or find/grep via Bash)',
        '3. If this file reads/writes data files, show field names, structure, and date format (use redacted or synthetic values, not raw production data)',
        "4. Quote the user's current instruction verbatim",
        '',
        'If this call was sent in a parallel batch, other edits to src/a.py from that batch may already have been applied. Re-read the file before building on them.',
        '',
        'Present the facts, then retry the same operation.',
        ''
      ].join('\n');
      assert.ok(writeReason.startsWith(expectedWrite), 'code Write block unchanged');
      const editReason = fullReason({ file_path: 'src/b.py', old_string: 'def load(path):', new_string: 'def load_json(path):' });
      const expectedEdit = [
        '[Fact-Forcing Gate]',
        '',
        'Before editing src/b.py, present these facts:',
        '',
        '1. List ALL files that import/require this file (search the tree — Glob/Grep, or find/grep via Bash)',
        '2. List the public functions/classes affected by this change',
        '3. If this file reads/writes data files, show field names, structure, and date format (use redacted or synthetic values, not raw production data)',
        "4. Quote the user's current instruction verbatim",
        '',
        'If this call was sent in a parallel batch, other edits to src/b.py from that batch may already have been applied. Re-read the file before building on them.',
        '',
        'Present the facts, then retry the same operation.',
        ''
      ].join('\n');
      assert.ok(editReason.startsWith(expectedEdit), 'code Edit block unchanged');
    })
  )
    passed++;
  else failed++;

  clearState();
  if (
    test('src/a.test.ts and tests/helpers.js get test questions', () => {
      for (const file of ['src/a.test.ts', 'tests/helpers.js']) {
        const reason = classDenialReason('Write', file);
        assertFrame(reason, 'creating', file);
        assert.ok(reason.includes('behaviour is under test'), `${file}: asks what is under test`);
        assert.ok(reason.includes('existing test file(s)'), `${file}: asks for existing test files`);
        assert.ok(reason.includes(`3. ${QUOTE_LINE}`), `${file}: quote is item 3`);
        assertNoCodeQuestions(reason);
      }
    })
  )
    passed++;
  else failed++;

  clearState();
  if (
    test('config/app.yaml and .env.local get config questions', () => {
      for (const file of ['config/app.yaml', '.env.local']) {
        const reason = classDenialReason('Write', file);
        assertFrame(reason, 'creating', file);
        assert.ok(reason.includes('process/tool reads this file'), `${file}: asks what reads it`);
        assert.ok(reason.includes('effect of the change'), `${file}: asks for the effect`);
        assert.ok(reason.includes('no secrets or credentials'), `${file}: asks about secrets`);
        assert.ok(reason.includes(`4. ${QUOTE_LINE}`), `${file}: quote is item 4`);
        assertNoCodeQuestions(reason);
      }
    })
  )
    passed++;
  else failed++;

  // --- Questions from the change profile ---
  const PROFILE_ENV = { CLAUDE_PROJECT_DIR: '/proj-profile' };
  const profileDenialReason = (toolName, tool_input, env = {}) => {
    const output = parseOutput(runHook({ tool_name: toolName, tool_input }, { ...PROFILE_ENV, ...env }).stdout);
    assert.ok(output && output.hookSpecificOutput, `${toolName} ${JSON.stringify(tool_input).slice(0, 80)} should be denied`);
    assert.strictEqual(output.hookSpecificOutput.permissionDecision, 'deny');
    return output.hookSpecificOutput.permissionDecisionReason;
  };
  const listedQuestions = reason => reason.split('\n').filter(line => /^\d+\. /.test(line)).map(line => line.replace(/^\d+\. /, ''));
  const QUESTION_LINES = {
    importers: 'List ALL files that import/require this file (search the tree — Glob/Grep, or find/grep via Bash)',
    publicApi: 'List the public functions/classes affected by this change',
    localCallers: 'List the call sites in this file or its module that rely on the changed behaviour (search the tree — Glob/Grep, or find/grep via Bash)',
    callers: 'Name the file(s) and line(s) that will call this new file',
    noDuplicate: 'Confirm no existing file serves the same purpose (search the tree — Glob/Grep, or find/grep via Bash)',
    dataSchema: 'If this file reads/writes data files, show field names, structure, and date format (use redacted or synthetic values, not raw production data)',
    quote: QUOTE_LINE
  };
  const B2_FULL_EDIT = [QUESTION_LINES.importers, QUESTION_LINES.publicApi, QUESTION_LINES.dataSchema, QUESTION_LINES.quote];
  const B2_FULL_WRITE = [QUESTION_LINES.callers, QUESTION_LINES.noDuplicate, QUESTION_LINES.dataSchema, QUESTION_LINES.quote];

  clearState();
  if (
    test('an Edit that changes an exported signature asks for importers and the affected public API', () => {
      const reason = profileDenialReason('Edit', { file_path: 'src/api.js', old_string: 'export function load(a) {', new_string: 'export function load(a, b) {' });
      assert.deepStrictEqual(listedQuestions(reason), [QUESTION_LINES.importers, QUESTION_LINES.publicApi, QUESTION_LINES.quote]);
      assertFrame(reason, 'editing', 'src/api.js');
    })
  )
    passed++;
  else failed++;

  clearState();
  if (
    test('an Edit of a function body asks for call sites in the file or module instead of importers', () => {
      const reason = profileDenialReason('Edit', { file_path: 'src/calc.js', old_string: '  return a + 1;', new_string: '  return a * 2;' });
      assert.deepStrictEqual(listedQuestions(reason), [QUESTION_LINES.localCallers, QUESTION_LINES.quote]);
      assertFrame(reason, 'editing', 'src/calc.js');
    })
  )
    passed++;
  else failed++;

  clearState();
  if (
    test('an Edit that handles data keeps the data-schema question', () => {
      const reason = profileDenialReason('Edit', { file_path: 'src/calc.py', old_string: '    x = 1', new_string: '    rows = json.load(fh)' });
      assert.deepStrictEqual(listedQuestions(reason), [QUESTION_LINES.localCallers, QUESTION_LINES.dataSchema, QUESTION_LINES.quote]);
    })
  )
    passed++;
  else failed++;

  clearState();
  if (
    test('a Write of a new code file without data handling drops the data-schema question', () => {
      const reason = profileDenialReason('Write', { file_path: 'src/new_mod.js', content: 'export const x = 1;\n' });
      assert.deepStrictEqual(listedQuestions(reason), [QUESTION_LINES.callers, QUESTION_LINES.noDuplicate, QUESTION_LINES.quote]);
      const withData = profileDenialReason('Write', { file_path: 'lib/new_io.js', content: "const fs = require('fs');\n" });
      assert.deepStrictEqual(listedQuestions(withData), B2_FULL_WRITE);
    })
  )
    passed++;
  else failed++;

  clearState();
  if (
    test('an unknown or over-bound change keeps the full code questions byte-identical', () => {
      const cases = [
        ['Edit', { file_path: 'src/a.rb', old_string: 'a', new_string: 'b' }, B2_FULL_EDIT],
        ['Edit', { file_path: 'src/big.js', old_string: 'x'.repeat(70 * 1024), new_string: 'y' }, B2_FULL_EDIT],
        ['Edit', { file_path: 'src/shape.js' }, B2_FULL_EDIT],
        ['Edit', { file_path: 'src/shape2.js', old_string: 5, new_string: 'b' }, B2_FULL_EDIT],
        ['Write', { file_path: 'src/d.rb', content: 'x' }, B2_FULL_WRITE],
        ['Write', { file_path: 'src/e.js' }, B2_FULL_WRITE]
      ];
      for (const [tool, input, expected] of cases) {
        clearState();
        const reason = profileDenialReason(tool, input);
        assert.deepStrictEqual(listedQuestions(reason), expected, `${input.file_path}`);
        const header = `Before ${tool === 'Write' ? 'creating' : 'editing'} ${input.file_path}, present these facts:`;
        const block = ['[Fact-Forcing Gate]', '', header, '', ...expected.map((q, i) => `${i + 1}. ${q}`), ''].join('\n');
        assert.ok(reason.startsWith(block), `${input.file_path}: block unchanged`);
      }
    })
  )
    passed++;
  else failed++;

  clearState();
  if (
    test('sensitive code targets always get the full code questions', () => {
      const reason = profileDenialReason('Edit', { file_path: 'src/auth/login.js', old_string: '  return a + 1;', new_string: '  return a * 2;' });
      assert.deepStrictEqual(listedQuestions(reason), B2_FULL_EDIT);
      assert.ok(reason.includes('Sensitive target'), 'sensitive note');
      const write = profileDenialReason('Write', { file_path: 'src/billing/new.js', content: 'export const x = 1;\n' });
      assert.deepStrictEqual(listedQuestions(write), B2_FULL_WRITE);
    })
  )
    passed++;
  else failed++;

  clearState();
  if (
    test('config, instruction and test targets keep their class questions whatever the change', () => {
      const config = listedQuestions(profileDenialReason('Write', { file_path: 'config/app.yaml', content: 'a: 1\n' }));
      assert.strictEqual(config.length, 4, 'config keeps three questions and the quote');
      assert.ok(config[2].includes('no secrets or credentials'));
      const instruction = listedQuestions(profileDenialReason('Edit', { file_path: 'CLAUDE.md', old_string: 'a', new_string: 'b' }));
      assert.strictEqual(instruction.length, 4, 'instruction keeps three questions and the quote');
      const testFile = listedQuestions(profileDenialReason('Edit', { file_path: 'src/a.test.js', old_string: '  return 1;', new_string: '  return 2;' }));
      assert.ok(testFile[0].includes('behaviour is under test'), 'test questions');
      assert.strictEqual(testFile.length, 3);
    })
  )
    passed++;
  else failed++;

  clearState();
  if (
    test('MultiEdit questions follow every entry for the denied file', () => {
      const surface = profileDenialReason('MultiEdit', {
        edits: [
          { file_path: 'src/m.js', old_string: '  return 1;', new_string: '  return 2;' },
          { file_path: 'src/m.js', old_string: 'function f() {', new_string: 'export function f() {' }
        ]
      });
      assert.deepStrictEqual(listedQuestions(surface), [QUESTION_LINES.importers, QUESTION_LINES.publicApi, QUESTION_LINES.quote]);
      clearState();
      const local = profileDenialReason('MultiEdit', {
        edits: [
          { file_path: 'src/n.js', old_string: '  return 1;', new_string: '  return 2;' },
          { file_path: 'src/other.js', old_string: 'export const y = 1;', new_string: 'export const y = 2;' }
        ]
      });
      assert.deepStrictEqual(listedQuestions(local), [QUESTION_LINES.localCallers, QUESTION_LINES.quote], 'entries for other files do not count');
    })
  )
    passed++;
  else failed++;

  clearState();
  if (
    test('shell scripts ask the questions their change warrants', () => {
      const local = profileDenialReason('Edit', { file_path: 'scripts/q1.sh', old_string: '  echo "a"', new_string: '  echo "b"' });
      assert.deepStrictEqual(listedQuestions(local), [QUESTION_LINES.localCallers, QUESTION_LINES.quote]);
      clearState();
      const fn = profileDenialReason('Edit', { file_path: 'scripts/q2.sh', old_string: 'deploy() {', new_string: 'deploy_all() {' });
      assert.deepStrictEqual(listedQuestions(fn), [QUESTION_LINES.importers, QUESTION_LINES.publicApi, QUESTION_LINES.quote]);
      clearState();
      const exported = profileDenialReason('Edit', { file_path: 'scripts/q3.sh', old_string: 'export MODE=a', new_string: 'export MODE=b' });
      assert.deepStrictEqual(listedQuestions(exported), [QUESTION_LINES.importers, QUESTION_LINES.publicApi, QUESTION_LINES.quote]);
      clearState();
      const fetch = profileDenialReason('Edit', { file_path: 'scripts/q4.sh', old_string: '  run', new_string: '  curl -s "$URL" > out.json' });
      assert.deepStrictEqual(listedQuestions(fetch), [QUESTION_LINES.localCallers, QUESTION_LINES.dataSchema, QUESTION_LINES.quote]);
      clearState();
      const ps = profileDenialReason('Edit', { file_path: 'scripts/q5.ps1', old_string: 'function Get-A {', new_string: 'function Get-B {' });
      assert.deepStrictEqual(listedQuestions(ps), [QUESTION_LINES.importers, QUESTION_LINES.publicApi, QUESTION_LINES.quote]);
      clearState();
      const bat = profileDenialReason('Edit', { file_path: 'scripts/q6.bat', old_string: 'echo a', new_string: 'echo b' });
      assert.deepStrictEqual(listedQuestions(bat), [QUESTION_LINES.importers, QUESTION_LINES.publicApi, QUESTION_LINES.quote], 'batch always counts as surface');
    })
  )
    passed++;
  else failed++;

  clearState();
  if (
    test('a one-line edit of a Python module constant asks for importers', () => {
      const reason = profileDenialReason('Edit', { file_path: 'tools/q7.py', old_string: 'BASE = "https://a.test/#home"', new_string: 'BASE = "https://a.test/#admin"' });
      assert.deepStrictEqual(listedQuestions(reason), [QUESTION_LINES.importers, QUESTION_LINES.publicApi, QUESTION_LINES.quote]);
      clearState();
      const local = profileDenialReason('Edit', { file_path: 'tools/q8.py', old_string: 'result = compute(a)', new_string: 'result = compute(b)' });
      assert.deepStrictEqual(listedQuestions(local), [QUESTION_LINES.localCallers, QUESTION_LINES.quote]);
    })
  )
    passed++;
  else failed++;

  clearState();
  if (
    test('condensed denials follow the change profile', () => {
      const env = { GATEGUARD_FACT_FORCE_FULL_DENIALS: '0' };
      const local = profileDenialReason('Edit', { file_path: 'src/c1.js', old_string: '  return 1;', new_string: '  return 2;' }, env);
      assert.ok(local.includes('the call sites in this file or its module that rely on the change'), local);
      assert.ok(!local.includes('importers/callers'), 'no importer hint for a local change');
      assert.ok(!local.includes('data schemas'), 'no data hint for a change without data');
      const created = profileDenialReason('Write', { file_path: 'src/c3.js', content: 'export const a = 1;\n' }, env);
      assert.ok(created.includes('that no existing file serves the same purpose'), created);
      assert.ok(created.includes('(denial #') && created.includes('parallel batch') && created.includes('ECC_GATEGUARD=off'), 'keeps ordinal and hints');
      const data = profileDenialReason('Edit', { file_path: 'src/c4.js', old_string: '  return 1;', new_string: '  return JSON.parse(raw);' }, env);
      assert.ok(data.includes('the data schemas it reads or writes'), data);
      const full = profileDenialReason('Edit', { file_path: 'src/c2.rb', old_string: 'a', new_string: 'b' }, env);
      assert.ok(full.includes('briefly state importers/callers, affected API, data schemas if any'), 'unknown profile keeps the hint');
    })
  )
    passed++;
  else failed++;

  // --- Comment and whitespace-only edits ---
  const trivialRoot = fs.mkdtempSync(path.join(tmpRoot, 'gateguard-trivial-'));
  const seedTrivialFiles = tool_input => {
    const entries = Array.isArray(tool_input.edits) ? tool_input.edits : [tool_input];
    const byFile = new Map();
    for (const entry of entries) {
      if (!entry || typeof entry !== 'object') continue;
      const rel = entry.file_path || tool_input.file_path;
      if (typeof rel !== 'string' || typeof entry.old_string !== 'string') continue;
      byFile.set(rel, [...(byFile.get(rel) || []), entry.old_string]);
    }
    for (const [rel, parts] of byFile) {
      const file = path.join(trivialRoot, rel);
      if (fs.existsSync(file)) continue;
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, `${parts.join('\n')}\n`);
    }
  };
  const trivialRun = (toolName, tool_input, env = {}) => {
    seedTrivialFiles(tool_input);
    const result = runHook({ tool_name: toolName, tool_input }, { CLAUDE_PROJECT_DIR: trivialRoot, ...env });
    const output = parseOutput(result.stdout);
    const hso = output && output.hookSpecificOutput ? output.hookSpecificOutput : {};
    const context = Array.isArray(hso.additionalContext) ? hso.additionalContext.join('\n') : String(hso.additionalContext || '');
    return { result, decision: hso.permissionDecision, context, reason: hso.permissionDecisionReason || '' };
  };
  const trivialState = () => (fs.existsSync(stateFile) ? JSON.parse(fs.readFileSync(stateFile, 'utf8')) : {});
  const trivialKey = rel => `${trivialRoot}/${rel}`;
  const TRIVIAL_NOTE = 'Comment or whitespace-only change to';

  clearState();
  if (
    test('a comment-only Edit of an unchecked code file passes with a note and is not marked checked', () => {
      const out = trivialRun('Edit', { file_path: 'src/t1.js', old_string: '// old note\nfoo();', new_string: '// new note\nfoo();' });
      assert.notStrictEqual(out.decision, 'deny', out.result.stdout);
      assert.ok(out.context.includes(`${TRIVIAL_NOTE} src/t1.js`), out.context);
      assert.strictEqual(out.result.code, 0);
      const state = trivialState();
      assert.ok(!(state.checked || []).includes(trivialKey('src/t1.js')), 'not marked checked');
      assert.strictEqual(state.trivial_allows, 1);
      assert.strictEqual(state.fact_force_denials || 0, 0, 'denial count untouched');
      assert.ok(!out.result.stdout.includes('"allow"'), 'never an allow decision');
    })
  )
    passed++;
  else failed++;

  if (
    test('a later code change to the same file is still gated', () => {
      const out = trivialRun('Edit', { file_path: 'src/t1.js', old_string: 'foo();', new_string: 'bar();' });
      assert.strictEqual(out.decision, 'deny', out.result.stdout);
      const state = trivialState();
      assert.strictEqual(state.fact_force_denials, 1);
      assert.strictEqual(state.trivial_allows, 1, 'trivial counter kept');
    })
  )
    passed++;
  else failed++;

  clearState();
  if (
    test('whitespace-only reindents and trivial test-file edits pass', () => {
      const js = trivialRun('Edit', { file_path: 'src/t2.js', old_string: 'if (x) {\n  foo();\n}', new_string: 'if (x) {\n    foo();\n}' });
      assert.ok(js.context.includes(TRIVIAL_NOTE), js.result.stdout);
      const spec = trivialRun('Edit', { file_path: 'src/t2.test.js', old_string: "it('a', () => {}); // old", new_string: "it('a', () => {}); // new" });
      assert.ok(spec.context.includes(TRIVIAL_NOTE), spec.result.stdout);
      assert.strictEqual(trivialState().trivial_allows, 2);
    })
  )
    passed++;
  else failed++;

  clearState();
  if (
    test('comment-only edits of shell, PowerShell and batch scripts pass without marking them checked', () => {
      const cases = [
        { file_path: 'scripts/s1.sh', old_string: '# build\n', new_string: '# Build all targets.\n' },
        { file_path: 'scripts/s2.ps1', old_string: '<# old #>\nGet-Item a', new_string: '<# new #>\nGet-Item a' },
        { file_path: 'scripts/s3.cmd', old_string: 'REM old\necho a', new_string: 'REM new\necho a' }
      ];
      for (const input of cases) {
        const out = trivialRun('Edit', input);
        assert.notStrictEqual(out.decision, 'deny', out.result.stdout);
        assert.ok(out.context.includes(`${TRIVIAL_NOTE} ${input.file_path}`), out.context);
        assert.ok(!(trivialState().checked || []).includes(trivialKey(input.file_path)), 'not marked checked');
      }
      assert.strictEqual(trivialState().trivial_allows, 3);
    })
  )
    passed++;
  else failed++;

  clearState();
  if (
    test('trivial-looking edits are still denied where the pass does not apply', () => {
      const cases = [
        ['sensitive target', { file_path: 'src/auth/session.js', old_string: '// old\nfoo();', new_string: '// new\nfoo();' }],
        ['comment plus code', { file_path: 'src/d1.js', old_string: '// old\nfoo(1);', new_string: '// new\nfoo(2);' }],
        ['python indentation', { file_path: 'src/d2.py', old_string: 'if x:\n    y()', new_string: 'if x:\n        y()' }],
        ['unknown extension', { file_path: 'src/d3.rb', old_string: '# old', new_string: '# new' }],
        ['config target', { file_path: 'config/d4.yaml', old_string: '# old', new_string: '# new' }],
        ['instruction target', { file_path: 'CLAUDE.md', old_string: '<!-- old -->', new_string: '<!-- new -->' }],
        ['instruction code file', { file_path: '.claude/hooks/d5.md', old_string: '// old', new_string: '// new' }],
        ['template literal', { file_path: 'src/d6.js', old_string: '// old\n`;', new_string: '// new\n`;' }],
        ['over the bound', { file_path: 'src/d7.js', old_string: `// ${'x'.repeat(70 * 1024)}`, new_string: '// y' }],
        ['missing new_string', { file_path: 'src/d8.js', old_string: '// old' }],
        ['sensitive shell script', { file_path: 'scripts/auth/rotate.sh', old_string: '# old\nrun', new_string: '# new\nrun' }],
        ['workflow shell script', { file_path: '.github/workflows/d9.sh', old_string: '# old', new_string: '# new' }],
        ['shell heredoc', { file_path: 'scripts/d10.sh', old_string: 'cat <<EOF\n# old\nEOF', new_string: 'cat <<EOF\n# new\nEOF' }],
        ['shell quoted hash', { file_path: 'scripts/d11.sh', old_string: 'echo "a # old"', new_string: 'echo "a # new"' }],
        ['shell shebang', { file_path: 'scripts/d12.sh', old_string: '#!/bin/bash', new_string: '#!/bin/sh' }],
        ['powershell requires', { file_path: 'scripts/d13.ps1', old_string: '#Requires -Version 5', new_string: '#Requires -Version 7' }],
        ['powershell here-string', { file_path: 'scripts/d14.ps1', old_string: '@"\n# old\n"@', new_string: '@"\n# new\n"@' }]
      ];
      for (const [label, input] of cases) {
        clearState();
        const out = trivialRun('Edit', input);
        assert.strictEqual(out.decision, 'deny', `${label}: ${out.result.stdout}`);
        assert.ok(!out.context.includes(TRIVIAL_NOTE), `${label}: no trivial note`);
        assert.strictEqual(trivialState().trivial_allows || 0, 0, `${label}: no trivial count`);
      }
    })
  )
    passed++;
  else failed++;

  clearState();
  if (
    test('comment-looking edits that change code in their file context are denied', () => {
      const cases = [
        ['macro continuation', 'src/ctx/a.c', '#define A 1 \\\n// c\nint x;\n', { old_string: '// c\n', new_string: '' }],
        ['joined next line', 'src/ctx/b.js', 'a();\n// c\nb();\n', { old_string: '// c\n', new_string: '// c ' }],
        ['template literal', 'src/ctx/c.js', 'const q = `\n  // hint\n  SELECT 1\n`;\n', { old_string: '  // hint', new_string: '  // other' }],
        ['docstring', 'src/ctx/d.py', 'Q = """\n# limit 10\nSELECT 1\n"""\n', { old_string: '# limit 10', new_string: '# limit 99' }],
        ['heredoc body', 'scripts/ctx/e.sh', 'cat > colors.txt <<EOF\n#ff0000\n#00ff00\nEOF\n', { old_string: '#00ff00', new_string: '#0000ff' }],
        ['inside a string', 'src/ctx/f.js', 'const s = "abc // q";\n', { old_string: '// q"', new_string: '// r"' }],
        ['replace_all into a string', 'src/ctx/g.js', 'x = "// a"; // a\n', { old_string: '// a', new_string: '// b', replace_all: true }],
        ['type directive', 'src/ctx/h.py', 'x = f()  # type: ignore\n', { old_string: '# type: ignore', new_string: '# ok' }],
        ['suppression marker', 'src/ctx/i.py', 'call(cmd, shell=True)  # nosec\n', { old_string: '# nosec', new_string: '# reviewed' }],
        ['build constraint', 'src/ctx/j.go', '//go:build linux\n\npackage j\n', { old_string: '//go:build linux', new_string: '//go:build ignore' }],
        ['cgo preamble', 'src/ctx/k.go', 'package k\n\n// int add(int a) { return a; }\nimport "C"\n', { old_string: 'return a;', new_string: 'return a + 1;' }]
      ];
      for (const [label, rel, content, input] of cases) {
        clearState();
        const file = path.join(trivialRoot, rel);
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, content);
        const out = trivialRun('Edit', { file_path: rel, ...input });
        assert.strictEqual(out.decision, 'deny', `${label}: ${out.result.stdout}`);
        assert.strictEqual(trivialState().trivial_allows || 0, 0, `${label}: no trivial count`);
      }
    })
  )
    passed++;
  else failed++;

  clearState();
  if (
    test('the trivial pass needs a readable regular file under the size bound', () => {
      const input = { old_string: '// old', new_string: '// new' };
      const cases = [['missing file', 'src/nf/missing.js']];
      const big = path.join(trivialRoot, 'src/nf/big.js');
      fs.mkdirSync(path.dirname(big), { recursive: true });
      fs.writeFileSync(big, `// old\n${'x();\n'.repeat(300 * 1024)}`);
      cases.push(['file over 1 MiB', 'src/nf/big.js']);
      fs.mkdirSync(path.join(trivialRoot, 'src/nf/dir.js'), { recursive: true });
      cases.push(['directory', 'src/nf/dir.js']);
      if (process.platform !== 'win32' && spawnSync('mkfifo', [path.join(trivialRoot, 'src/nf/pipe.js')]).status === 0) {
        cases.push(['named pipe', 'src/nf/pipe.js']);
      }
      for (const [label, rel] of cases) {
        clearState();
        const started = Date.now();
        const result = runHook({ tool_name: 'Edit', tool_input: { file_path: rel, ...input } }, { CLAUDE_PROJECT_DIR: trivialRoot });
        const hso = (parseOutput(result.stdout) || {}).hookSpecificOutput || {};
        assert.strictEqual(hso.permissionDecision, 'deny', `${label}: ${result.stdout}`);
        assert.ok(Date.now() - started < 10000, `${label}: returned promptly`);
      }
    })
  )
    passed++;
  else failed++;

  clearState();
  if (
    test('a comment edit next to closed multi-line constructs still passes', () => {
      const rel = 'src/ctx/ok.js';
      const file = path.join(trivialRoot, rel);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, 'const q = `a\n${b}\n`;\nconst r = /[/"]+/g;\n\n// old\nfoo();\n');
      const out = trivialRun('Edit', { file_path: rel, old_string: '// old', new_string: '// new' });
      assert.ok(out.context.includes(`${TRIVIAL_NOTE} ${rel}`), out.result.stdout);
    })
  )
    passed++;
  else failed++;

  clearState();
  if (
    test('a Write is never a trivial edit', () => {
      const out = trivialRun('Write', { file_path: 'src/w1.js', content: '// only a comment\n' });
      assert.strictEqual(out.decision, 'deny', out.result.stdout);
    })
  )
    passed++;
  else failed++;

  clearState();
  if (
    test('MultiEdit passes a file only when all of its entries are trivial', () => {
      const allTrivial = trivialRun('MultiEdit', {
        edits: [
          { file_path: 'src/m1.js', old_string: '// a', new_string: '// b' },
          { file_path: 'src/m1.js', old_string: 'foo(); // c', new_string: 'foo(); // d' }
        ]
      });
      assert.notStrictEqual(allTrivial.decision, 'deny', allTrivial.result.stdout);
      assert.ok(allTrivial.context.includes(`${TRIVIAL_NOTE} src/m1.js`), allTrivial.context);
      assert.strictEqual(trivialState().trivial_allows, 1, 'one pass per file');
      clearState();
      const mixed = trivialRun('MultiEdit', {
        edits: [
          { file_path: 'src/m2.js', old_string: '// a', new_string: '// b' },
          { file_path: 'src/m2.js', old_string: 'foo(1);', new_string: 'foo(2);' }
        ]
      });
      assert.strictEqual(mixed.decision, 'deny', 'a non-trivial entry for the file denies it');
      clearState();
      const twoFiles = trivialRun('MultiEdit', {
        edits: [
          { file_path: 'src/m3.js', old_string: '// a', new_string: '// b' },
          { file_path: 'src/m4.js', old_string: 'foo(1);', new_string: 'foo(2);' }
        ]
      });
      assert.strictEqual(twoFiles.decision, 'deny');
      assert.ok(twoFiles.reason.includes('src/m4.js'), 'the non-trivial file is the one denied');
      const state = trivialState();
      assert.ok(!(state.checked || []).includes(trivialKey('src/m3.js')), 'trivial file not marked checked');
    })
  )
    passed++;
  else failed++;

  clearState();
  if (
    test('MultiEdit entries without their own path are gated as the call file_path', () => {
      const sensitive = trivialRun('MultiEdit', { file_path: '.env', edits: [{ old_string: 'A=1', new_string: 'A=2' }] });
      assert.strictEqual(sensitive.decision, 'deny', sensitive.result.stdout);
      assert.ok(sensitive.reason.includes('.env'), sensitive.reason);
      clearState();
      const code = trivialRun('MultiEdit', { file_path: 'src/mt1.js', edits: [{ old_string: 'f(1);', new_string: 'f(2);' }] });
      assert.strictEqual(code.decision, 'deny', code.result.stdout);
      assert.ok(code.reason.includes('src/mt1.js'), code.reason);
      clearState();
      const trivial = trivialRun('MultiEdit', { file_path: 'src/mt2.js', edits: [{ old_string: 'f(); // a', new_string: 'f(); // b' }] });
      assert.ok(trivial.context.includes(`${TRIVIAL_NOTE} src/mt2.js`), trivial.result.stdout);
      clearState();
      const input = { file_path: 'config/.env.local', edits: [{ old_string: 'A=1', new_string: 'A=2' }] };
      seedTrivialFiles(input);
      const result = runHook({ tool_name: 'MultiEdit', tool_input: input, agent_id: 'sub-1' }, { CLAUDE_PROJECT_DIR: trivialRoot });
      const hso = (parseOutput(result.stdout) || {}).hookSpecificOutput || {};
      assert.strictEqual(hso.permissionDecision, 'deny', `subagent: ${result.stdout}`);
      clearState();
      const odd = trivialRun('MultiEdit', { file_path: 'src/mt3.js', edits: [null, 7, { old_string: 'g(1);', new_string: 'g(2);' }] });
      assert.strictEqual(odd.decision, 'deny', `malformed entries: ${odd.result.stdout}`);
    })
  )
    passed++;
  else failed++;

  clearState();
  if (
    test('the trivial pass comes before the denial cap and never consumes it', () => {
      const out = trivialRun('Edit', { file_path: 'src/cap1.js', old_string: '// a', new_string: '// b' }, { GATEGUARD_FACT_FORCE_MAX_DENIALS: '0' });
      assert.ok(out.context.includes(TRIVIAL_NOTE), out.result.stdout);
      const state = trivialState();
      assert.strictEqual(state.cap_allows || 0, 0);
      assert.strictEqual(state.trivial_allows, 1);
    })
  )
    passed++;
  else failed++;

  clearState();
  if (
    test('trivial_allows merges by maximum with a concurrent state file', () => {
      writeState({ checked: [], last_active: Date.now(), trivial_allows: 5 });
      trivialRun('Edit', { file_path: 'src/merge1.js', old_string: '// a', new_string: '// b' });
      assert.strictEqual(trivialState().trivial_allows, 6);
      writeState({ checked: [], last_active: Date.now(), trivial_allows: 'junk' });
      trivialRun('Edit', { file_path: 'src/merge2.js', old_string: '// a', new_string: '// b' });
      assert.strictEqual(trivialState().trivial_allows, 1, 'malformed counter reads as zero');
    })
  )
    passed++;
  else failed++;

  clearState();
  if (
    test('scripts/hooks/x.js is code, not instruction', () => {
      const reason = classDenialReason('Write', 'scripts/hooks/x.js');
      assert.ok(reason.includes('call this new file'), 'code Write questions');
      assert.ok(!reason.includes('harness/loader'), 'not instruction questions');
    })
  )
    passed++;
  else failed++;

  clearState();
  if (
    test('MultiEdit on a .md entry uses the prose Edit variant', () => {
      const reason = classDenialReason('MultiEdit', 'docs/multi.md');
      assertFrame(reason, 'editing', 'docs/multi.md');
      assert.ok(reason.includes('reference the section being changed'), 'prose Edit questions');
      assertNoCodeQuestions(reason);
    })
  )
    passed++;
  else failed++;

  clearState();
  if (
    test('condensed denial for .md after the budget carries the prose hint and ordinal', () => {
      const env = { GATEGUARD_FACT_FORCE_FULL_DENIALS: '0' };
      const writeReason = classDenialReason('Write', 'docs/late.md', env);
      assert.ok(!writeReason.includes('\n'), 'condensed denial is one line');
      assert.ok(writeReason.includes('(denial #1 this session) First creation of docs/late.md: '), 'keeps ordinal and target');
      assert.ok(writeReason.includes('briefly state what this supersedes, where it is linked from'), 'prose Write hint');
      assert.ok(!writeReason.includes('importers/callers'), 'no code hint');
      assert.ok(writeReason.includes('parallel batch'), 'keeps batch-sibling warning');
      assert.ok(writeReason.includes('GATEGUARD_EXEMPT_GLOBS') && writeReason.includes('ECC_GATEGUARD=off'), 'keeps exemption hint');
      const editReason = classDenialReason('Edit', 'docs/late-edit.md', env);
      assert.ok(editReason.includes('(denial #2 this session) First edit of docs/late-edit.md: '), 'ordinal advances');
      assert.ok(editReason.includes('what references the changed section'), 'prose Edit hint');
      const codeReason = classDenialReason('Edit', 'src/late.rb', env);
      assert.ok(codeReason.includes('briefly state importers/callers, affected API, data schemas if any'), 'code hint unchanged');
    })
  )
    passed++;
  else failed++;

  clearState();
  if (
    test('class denials still sanitize the path', () => {
      const reason = classDenialReason('Write', 'docs/hid\u200bden.md');
      assert.ok(!reason.includes('\u200b'), 'zero-width space stripped');
      assert.ok(reason.includes('supersedes or duplicates'), 'still prose questions');
    })
  )
    passed++;
  else failed++;

  // --- Prior-search credit in the current human turn ---
  const creditRoot = '/proj-credit';
  // An ambient CLAUDE_TRANSCRIPT_PATH must not leak into cases that pass no transcript.
  const creditEnv = { CLAUDE_PROJECT_DIR: creditRoot, CLAUDE_TRANSCRIPT_PATH: '' };
  const transcriptDir = fs.mkdtempSync(path.join(tmpRoot, 'gateguard-transcripts-'));
  const creditOutputs = [];
  let transcriptSeq = 0;
  let uuidSeq = 0;
  const nextUuid = () => `uuid-${++uuidSeq}`;
  const humanRecord = (text, extra = {}) =>
    ({ type: 'user', uuid: nextUuid(), message: { role: 'user', content: text }, ...extra });
  // Real assistant records carry message.id; a search without one is never credited.
  const toolUseRecord = (id, name, input, extra = {}) => ({
    type: 'assistant',
    uuid: nextUuid(),
    message: { id: `msg_${id}`, role: 'assistant', content: [{ type: 'tool_use', id, name, input }] },
    ...extra
  });
  const toolResultRecord = (id, isError = false, extra = {}) => ({
    type: 'user',
    uuid: nextUuid(),
    message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, is_error: isError, content: 'ok' }] },
    ...extra
  });
  const searchRecords = (id, name, input) => [toolUseRecord(id, name, input), toolResultRecord(id)];
  // Like Claude Code, a fixture ends with the pending call's own assistant record and runners pass its id.
  const pendingToolUseIds = new Map();
  const writeTranscript = (records, { pending = true } = {}) => {
    transcriptSeq += 1;
    const file = path.join(transcriptDir, `t-${transcriptSeq}.jsonl`);
    const all = records.slice();
    if (pending) {
      const id = `toolu_pending_${transcriptSeq}`;
      all.push({
        type: 'assistant',
        uuid: nextUuid(),
        message: { id: `msg_pending_${transcriptSeq}`, role: 'assistant', content: [{ type: 'tool_use', id, name: 'Edit', input: {} }] }
      });
      pendingToolUseIds.set(file, id);
    }
    const lines = all.map(r => (typeof r === 'string' ? r : JSON.stringify(r)));
    fs.writeFileSync(file, lines.join('\n') + '\n', 'utf8');
    return file;
  };
  const creditRun = (toolName, toolInput, transcriptPath, env = {}) => {
    const payload = { tool_name: toolName, tool_input: toolInput, cwd: creditRoot };
    if (transcriptPath !== undefined) payload.transcript_path = transcriptPath;
    if (pendingToolUseIds.has(transcriptPath)) payload.tool_use_id = pendingToolUseIds.get(transcriptPath);
    const result = runHook(payload, { ...creditEnv, ...env });
    creditOutputs.push(result.stdout);
    const output = parseOutput(result.stdout);
    const hso = output && output.hookSpecificOutput ? output.hookSpecificOutput : {};
    return { result, decision: hso.permissionDecision, context: hso.additionalContext || '', reason: hso.permissionDecisionReason || '' };
  };
  const creditEdit = (file_path, transcriptPath, env) =>
    creditRun('Edit', { file_path, old_string: 'a', new_string: 'b' }, transcriptPath, env);
  const creditWrite = (file_path, transcriptPath, env) => creditRun('Write', { file_path, content: 'x' }, transcriptPath, env);
  const readState = () => (fs.existsSync(stateFile) ? JSON.parse(fs.readFileSync(stateFile, 'utf8')) : {});
  const gateCase = (name, fn) => {
    clearState();
    if (test(name, fn)) passed++;
    else failed++;
  };
  const assertNotCredited = (out, label) => {
    assert.strictEqual(out.decision, 'deny', `${label}: expected deny`);
    assert.ok(!out.context.includes('Prior search seen'), `${label}: no credit note`);
  };
  const assertCredited = (out, label) => {
    assert.notStrictEqual(out.decision, 'deny', `${label}: must not deny`);
    assert.ok(out.context.includes('Prior search seen in this turn'), `${label}: credit note expected, got ${out.result.stdout}`);
  };

  gateCase('Grep stem in this turn credits the first Edit (note, no denial counted)', () => {
    const t = writeTranscript([
      humanRecord('please fix the widget factory'),
      ...searchRecords('toolu_g1', 'Grep', { pattern: 'widget_factory', path: creditRoot })
    ]);
    const out = creditEdit(`${creditRoot}/src/widget_factory.py`, t);
    assertCredited(out, 'Grep stem');
    assert.ok(out.context.includes('(Grep widget_factory, 1 tool call ago)'), out.context);
    assert.ok(out.context.includes(`first-touch check satisfied for ${creditRoot}/src/widget_factory.py`), out.context);
    const state = readState();
    assert.ok(!state.fact_force_denials, 'denial count unchanged');
    assert.strictEqual(state.fact_force_credited, 1, 'credit counted');
    assert.ok(state.checked.includes(stateKey(`${creditRoot}/src/widget_factory.py`)), 'canonical key marked checked');
    const again = creditEdit(`${creditRoot}/src/widget_factory.py`, t);
    assert.notStrictEqual(again.decision, 'deny');
    assert.strictEqual(again.context, '', 'already checked: plain allow, no second note');
    assert.strictEqual(readState().fact_force_credited, 1, 'no double credit');
  });

  gateCase('Glob directory credits a Write of a new file there', () => {
    const t = writeTranscript([
      humanRecord('add a component'),
      ...searchRecords('toolu_gl', 'Glob', { pattern: 'src/components/*.tsx', path: creditRoot })
    ]);
    assertCredited(creditWrite(`${creditRoot}/src/components/NewThing.tsx`, t), 'Glob dir');
    assert.ok(!readState().fact_force_denials);
  });

  gateCase('LS directory credits a Write there', () => {
    const t = writeTranscript([humanRecord('add a page'), ...searchRecords('toolu_ls', 'LS', { path: `${creditRoot}/docs` })]);
    assertCredited(creditWrite(`${creditRoot}/docs/brand-new-page.md`, t), 'LS dir');
  });

  gateCase('Bash rg stem credits an Edit', () => {
    const t = writeTranscript([humanRecord('fix it'), ...searchRecords('toolu_b1', 'Bash', { command: 'cd /proj-credit && rg foo_bar src' })]);
    const out = creditEdit(`${creditRoot}/src/foo_bar.js`, t);
    assertCredited(out, 'Bash rg');
    assert.ok(out.context.includes('(Bash rg foo_bar src,'), out.context);
  });

  gateCase('PowerShell Get-ChildItem stem credits an Edit', () => {
    const t = writeTranscript([
      humanRecord('fix it'),
      ...searchRecords('toolu_p1', 'PowerShell', { command: 'Get-ChildItem -Recurse -Filter *foo_bar*' })
    ]);
    assertCredited(creditEdit(`${creditRoot}/src/foo_bar.ps1`, t), 'PowerShell gci');
  });

  gateCase('git grep qualifies, git log does not', () => {
    const ok = writeTranscript([humanRecord('x'), ...searchRecords('toolu_gg', 'Bash', { command: 'git grep -n foo_bar' })]);
    assertCredited(creditEdit(`${creditRoot}/src/foo_bar.js`, ok), 'git grep');
    const no = writeTranscript([humanRecord('x'), ...searchRecords('toolu_gl2', 'Bash', { command: 'git log -- src/baz_qux.js' })]);
    assertNotCredited(creditEdit(`${creditRoot}/src/baz_qux.js`, no), 'git log');
  });

  gateCase('stem only in a non-search shell segment does not credit', () => {
    const t = writeTranscript([humanRecord('x'), ...searchRecords('toolu_b2', 'Bash', { command: 'echo foo_bar | grep something; ls' })]);
    assertNotCredited(creditEdit(`${creditRoot}/src/foo_bar.js`, t), 'stem in echo segment');
  });

  gateCase('command substitution in a search command is ambiguous (no credit)', () => {
    const t = writeTranscript([humanRecord('x'), ...searchRecords('toolu_b3', 'Bash', { command: 'rg $(echo foo_bar) src' })]);
    assertNotCredited(creditEdit(`${creditRoot}/src/foo_bar.js`, t), 'substitution');
  });

  gateCase('cd before a search disables directory credit (stem still counts)', () => {
    const t = writeTranscript([humanRecord('x'), ...searchRecords('toolu_cd', 'Bash', { command: 'cd /elsewhere && ls docs' })]);
    assertNotCredited(creditWrite(`${creditRoot}/docs/brand-new-page.md`, t), 'cd then ls dir');
  });

  gateCase('a search in the same assistant batch as the pending call never credits', () => {
    const batch = (id, name, input) => ({
      type: 'assistant',
      uuid: nextUuid(),
      message: { id: 'msg_batch', role: 'assistant', content: [{ type: 'tool_use', id, name, input }] }
    });
    const t = writeTranscript([
      humanRecord('x'),
      batch('toolu_bg', 'Grep', { pattern: 'widget_factory' }),
      batch('toolu_be', 'Edit', { file_path: `${creditRoot}/src/widget_factory.py` }),
      toolResultRecord('toolu_bg')
    ]);
    const input = { file_path: `${creditRoot}/src/widget_factory.py`, old_string: 'a', new_string: 'b' };
    const same = runHook({ tool_name: 'Edit', tool_use_id: 'toolu_be', cwd: creditRoot, transcript_path: t, tool_input: input }, creditEnv);
    creditOutputs.push(same.stdout);
    assert.strictEqual(parseOutput(same.stdout).hookSpecificOutput.permissionDecision, 'deny', 'same batch denied');
    clearState();
    const later = writeTranscript([
      humanRecord('x'),
      batch('toolu_bg2', 'Grep', { pattern: 'widget_factory' }),
      toolResultRecord('toolu_bg2'),
      { type: 'assistant', uuid: nextUuid(), message: { id: 'msg_next', role: 'assistant', content: [{ type: 'tool_use', id: 'toolu_be2', name: 'Edit', input }] } }
    ]);
    const next = runHook({ tool_name: 'Edit', tool_use_id: 'toolu_be2', cwd: creditRoot, transcript_path: later, tool_input: input }, creditEnv);
    creditOutputs.push(next.stdout);
    assert.ok(next.stdout.includes('Prior search seen'), 'search from an earlier message credits');
  });

  gateCase('no search in the turn -> deny', () => {
    const t = writeTranscript([humanRecord('edit it'), ...searchRecords('toolu_r0', 'Read', { file_path: `${creditRoot}/other.js` })]);
    const out = creditEdit(`${creditRoot}/src/widget_factory.py`, t);
    assertNotCredited(out, 'no search');
    assert.strictEqual(readState().fact_force_denials, 1);
    assert.ok(!readState().fact_force_credited, 'no credit counted on deny');
  });

  gateCase('search tool_use without a tool_result (same batch) -> deny', () => {
    const t = writeTranscript([humanRecord('x'), toolUseRecord('toolu_pending', 'Grep', { pattern: 'widget_factory' })]);
    assertNotCredited(creditEdit(`${creditRoot}/src/widget_factory.py`, t), 'pending search');
  });

  gateCase('search whose tool_result is_error -> deny', () => {
    const t = writeTranscript([
      humanRecord('x'),
      toolUseRecord('toolu_err', 'Grep', { pattern: 'widget_factory' }),
      toolResultRecord('toolu_err', true)
    ]);
    assertNotCredited(creditEdit(`${creditRoot}/src/widget_factory.py`, t), 'errored search');
  });

  gateCase('search before the latest human message -> deny', () => {
    const t = writeTranscript([
      humanRecord('first request'),
      ...searchRecords('toolu_old', 'Grep', { pattern: 'widget_factory' }),
      humanRecord('second request')
    ]);
    assertNotCredited(creditEdit(`${creditRoot}/src/widget_factory.py`, t), 'previous turn search');
  });

  gateCase('tool_result user records do not reset the turn', () => {
    const t = writeTranscript([
      humanRecord('x'),
      ...searchRecords('toolu_s1', 'Grep', { pattern: 'widget_factory' }),
      ...searchRecords('toolu_s2', 'Read', { file_path: `${creditRoot}/a.js` }),
      ...searchRecords('toolu_s3', 'Bash', { command: 'npm test' })
    ]);
    const out = creditEdit(`${creditRoot}/src/widget_factory.py`, t);
    assertCredited(out, 'tool_results between');
    assert.ok(out.context.includes('3 tool calls ago'), out.context);
  });

  gateCase('isMeta and sidechain user records are not turn boundaries', () => {
    const t = writeTranscript([
      humanRecord('x'),
      ...searchRecords('toolu_m1', 'Grep', { pattern: 'widget_factory' }),
      humanRecord('<system-reminder>meta</system-reminder>', { isMeta: true }),
      humanRecord('subagent prompt', { isSidechain: true })
    ]);
    assertCredited(creditEdit(`${creditRoot}/src/widget_factory.py`, t), 'meta/sidechain boundary');
  });

  gateCase('sidechain search records are ignored', () => {
    const t = writeTranscript([
      humanRecord('x'),
      toolUseRecord('toolu_sc', 'Grep', { pattern: 'widget_factory' }, { isSidechain: true }),
      toolResultRecord('toolu_sc', false, { isSidechain: true })
    ]);
    assertNotCredited(creditEdit(`${creditRoot}/src/widget_factory.py`, t), 'sidechain search');
  });

  gateCase('Read of the target never credits an Edit', () => {
    const t = writeTranscript([
      humanRecord('x'),
      ...searchRecords('toolu_rd', 'Read', { file_path: `${creditRoot}/src/widget_factory.py` })
    ]);
    assertNotCredited(creditEdit(`${creditRoot}/src/widget_factory.py`, t), 'Read target');
  });

  gateCase('directory match does not credit an Edit (stem only)', () => {
    const t = writeTranscript([humanRecord('x'), ...searchRecords('toolu_ls2', 'LS', { path: `${creditRoot}/src` })]);
    assertNotCredited(creditEdit(`${creditRoot}/src/widget_factory.py`, t), 'LS dir for Edit');
  });

  gateCase('generic stems (index.js) are not credited', () => {
    const t = writeTranscript([humanRecord('x'), ...searchRecords('toolu_ix', 'Grep', { pattern: 'index' })]);
    assertNotCredited(creditEdit(`${creditRoot}/src/index.js`, t), 'generic stem');
  });

  gateCase('stems shorter than 4 characters are not credited', () => {
    const t = writeTranscript([humanRecord('x'), ...searchRecords('toolu_ab', 'Grep', { pattern: 'abc' })]);
    assertNotCredited(creditEdit(`${creditRoot}/src/abc.js`, t), 'short stem');
  });

  gateCase('missing or non-file transcript -> deny', () => {
    assertNotCredited(creditEdit(`${creditRoot}/src/widget_factory.py`, path.join(transcriptDir, 'nope.jsonl')), 'missing file');
    assertNotCredited(creditEdit(`${creditRoot}/src/other_widget.py`, transcriptDir), 'directory path');
    assertNotCredited(creditEdit(`${creditRoot}/src/third_widget.py`), 'no transcript_path');
  });

  gateCase('garbage lines -> deny; garbage around a valid turn is skipped', () => {
    const junk = writeTranscript(['not json', '{"type":', '{"type":"assistant","message":null}', '[1,2]', 'null']);
    assertNotCredited(creditEdit(`${creditRoot}/src/widget_factory.py`, junk), 'garbage only');
    const mixed = writeTranscript([
      'garbage {',
      humanRecord('x'),
      '{"broken":',
      ...searchRecords('toolu_gm', 'Grep', { pattern: 'other_widget' }),
      '\u0000\u0001'
    ]);
    assertCredited(creditEdit(`${creditRoot}/src/other_widget.py`, mixed), 'garbage around valid turn');
  });

  const fillerRecords = prefix => {
    const filler = [];
    for (let i = 0; i < 40; i++) {
      const id = `toolu_${prefix}${i}`;
      filler.push(toolUseRecord(id, 'Bash', { command: 'npm test' }));
      filler.push({
        type: 'user',
        message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: 'y'.repeat(10 * 1024) }] }
      });
    }
    return filler;
  };

  gateCase('tail truncated, no boundary in window, search + result inside -> credited (turn id null)', () => {
    const t = writeTranscript([
      humanRecord('long ago'),
      ...fillerRecords('fill'),
      ...searchRecords('toolu_late', 'Grep', { pattern: 'widget_factory' })
    ]);
    assert.ok(fs.statSync(t).size > 300 * 1024, 'fixture exceeds the tail window');
    const { scanCurrentTurn } = loadDirectHook();
    const scan = scanCurrentTurn(t);
    assert.strictEqual(scan.turnId, null, 'no boundary: no turn id');
    assert.ok(scan.searches.some(s => s.name === 'Grep'), 'search inside the window is collected');
    assertCredited(creditEdit(`${creditRoot}/src/widget_factory.py`, t), 'clipped window is the current turn');
  });

  gateCase('tail truncated, search tool_use before the window, result inside -> not credited', () => {
    const t = writeTranscript([
      humanRecord('long ago'),
      toolUseRecord('toolu_early', 'Grep', { pattern: 'widget_factory' }),
      ...fillerRecords('fill2'),
      toolResultRecord('toolu_early')
    ]);
    assert.ok(fs.statSync(t).size > 300 * 1024, 'fixture exceeds the tail window');
    assertNotCredited(creditEdit(`${creditRoot}/src/widget_factory.py`, t), 'tool_use outside the window');
  });

  gateCase('whole file scanned with no boundary -> no credit', () => {
    const t = writeTranscript([...searchRecords('toolu_nob', 'Grep', { pattern: 'widget_factory' })]);
    assertNotCredited(creditEdit(`${creditRoot}/src/widget_factory.py`, t), 'no human record at all');
  });

  gateCase('MultiEdit credits per entry; first uncredited entry is denied', () => {
    const t = writeTranscript([humanRecord('x'), ...searchRecords('toolu_me', 'Grep', { pattern: 'alpha_mod' })]);
    const out = creditRun(
      'MultiEdit',
      {
        edits: [
          { file_path: `${creditRoot}/src/alpha_mod.js`, old_string: 'a', new_string: 'b' },
          { file_path: `${creditRoot}/src/beta_mod.js`, old_string: 'a', new_string: 'b' }
        ]
      },
      t
    );
    assert.strictEqual(out.decision, 'deny');
    assert.ok(out.reason.includes('beta_mod.js'), 'uncredited entry is the one denied');
    const state = readState();
    assert.ok(state.checked.includes(stateKey(`${creditRoot}/src/alpha_mod.js`)), 'credited entry marked checked');
    assert.strictEqual(state.fact_force_credited, 1);
    assert.strictEqual(state.fact_force_denials, 1);
  });

  gateCase('MultiEdit with every entry credited returns one combined note', () => {
    const t = writeTranscript([
      humanRecord('x'),
      ...searchRecords('toolu_me2', 'Grep', { pattern: 'alpha_mod|beta_mod' })
    ]);
    const out = creditRun(
      'MultiEdit',
      {
        edits: [
          { file_path: `${creditRoot}/src/alpha_mod.js`, old_string: 'a', new_string: 'b' },
          { file_path: `${creditRoot}/src/beta_mod.js`, old_string: 'a', new_string: 'b' }
        ]
      },
      t
    );
    assert.notStrictEqual(out.decision, 'deny');
    assert.ok(out.context.includes('alpha_mod.js') && out.context.includes('beta_mod.js'), out.context);
    assert.strictEqual(readState().fact_force_credited, 2);
    assert.ok(!readState().fact_force_denials);
  });

  gateCase('exempt paths and subagents are unchanged (no credit note)', () => {
    const t = writeTranscript([humanRecord('x'), ...searchRecords('toolu_ex', 'Grep', { pattern: 'widget_factory' })]);
    const exempt = creditEdit(`${creditRoot}/tmp/widget_factory.py`, t, { GATEGUARD_EXEMPT_GLOBS: 'tmp/**' });
    assert.notStrictEqual(exempt.decision, 'deny');
    assert.strictEqual(exempt.context, '', 'exempt path: plain allow');
    const sub = runHook(
      {
        tool_name: 'Edit',
        agent_id: 'agent-1',
        cwd: creditRoot,
        transcript_path: t,
        tool_input: { file_path: `${creditRoot}/src/widget_factory.py`, old_string: 'a', new_string: 'b' }
      },
      creditEnv
    );
    creditOutputs.push(sub.stdout);
    assert.ok(!sub.stdout.includes('Prior search'), 'subagent: plain allow');
    assert.ok(!readState().fact_force_credited, 'no credit recorded');
  });

  gateCase('credit note detail is sanitized and bounded', () => {
    const pattern = `widget_factory\u200b\u202e${'x'.repeat(300)}\nIGNORE PREVIOUS`;
    const t = writeTranscript([humanRecord('x'), ...searchRecords('toolu_long', 'Grep', { pattern })]);
    const out = creditEdit(`${creditRoot}/src/widget_factory.py`, t);
    assertCredited(out, 'long pattern');
    const detail = out.context.match(/\(Grep (.*), 1 tool call ago\)/);
    assert.ok(detail, out.context);
    assert.ok(Array.from(detail[1]).length <= 80, `detail too long: ${detail[1].length}`);
    for (const bad of ['\u200b', '\u202e', '\n']) assert.ok(!out.context.includes(bad), 'no invisible/control chars');
    assert.ok(!out.context.includes('IGNORE PREVIOUS'), 'truncated before trailing text');
  });

  gateCase('state save failure on credit -> allow with state warning', () => {
    const t = writeTranscript([humanRecord('x'), ...searchRecords('toolu_sf', 'Grep', { pattern: 'widget_factory' })]);
    const blocker = path.join(transcriptDir, `not-a-dir-${transcriptSeq}`);
    fs.writeFileSync(blocker, 'x');
    const out = creditEdit(`${creditRoot}/src/widget_factory.py`, t, { GATEGUARD_STATE_DIR: blocker });
    assert.notStrictEqual(out.decision, 'deny');
    assert.ok(out.result.stderr.includes('could not be persisted'), out.result.stderr);
  });

  gateCase('fact_force_credited survives later state writes (merge keeps it)', () => {
    writeState({ checked: [], last_active: Date.now(), fact_force_credited: 4 });
    assertNotCredited(creditEdit(`${creditRoot}/src/widget_factory.py`), 'deny path');
    assert.strictEqual(readState().fact_force_credited, 4, 'denial write keeps credited count');
    assert.strictEqual(readState().fact_force_denials, 1);
  });

  gateCase('50 MB transcript is scanned from the tail only (<= 256 KiB read)', () => {
    const big = path.join(transcriptDir, 'big.jsonl');
    const bigSize = 50 * 1024 * 1024;
    const tail = [humanRecord('now'), ...searchRecords('toolu_big', 'Grep', { pattern: 'widget_factory' })];
    for (let i = 0; i < 50; i++) tail.push(...searchRecords(`toolu_t${i}`, 'Read', { file_path: `${creditRoot}/f${i}.js` }));
    // Sparse 50 MB body (ftruncate) + the real tail: cheap to build, same shape for the hook.
    const fd = fs.openSync(big, 'w');
    try {
      fs.writeSync(fd, JSON.stringify(humanRecord('ancient')) + '\n');
      fs.ftruncateSync(fd, bigSize);
      fs.writeSync(fd, '\n' + tail.map(r => JSON.stringify(r)).join('\n') + '\n', bigSize);
    } finally {
      fs.closeSync(fd);
    }
    const savedRoot = process.env.CLAUDE_PROJECT_DIR;
    const savedTranscript = process.env.CLAUDE_TRANSCRIPT_PATH;
    const originalOpenSync = fs.openSync;
    const originalReadSync = fs.readSync;
    const bigFds = new Set();
    let bytesRead = 0;
    let result;
    let ms;
    try {
      assert.ok(fs.statSync(big).size > bigSize, 'fixture is > 50 MB');
      const hook = loadDirectHook({ CLAUDE_PROJECT_DIR: creditRoot, CLAUDE_TRANSCRIPT_PATH: '' });
      const payload = {
        tool_name: 'Edit',
        cwd: creditRoot,
        transcript_path: big,
        tool_input: { file_path: `${creditRoot}/src/widget_factory.py`, old_string: 'a', new_string: 'b' }
      };
      fs.openSync = function countingOpenSync(target) {
        const opened = originalOpenSync.apply(fs, arguments);
        if (String(target) === big) bigFds.add(opened);
        return opened;
      };
      fs.readSync = function countingReadSync(readFd) {
        const n = originalReadSync.apply(fs, arguments);
        if (bigFds.has(readFd)) bytesRead += n;
        return n;
      };
      const start = process.hrtime.bigint();
      result = hook.run(payload);
      ms = Number(process.hrtime.bigint() - start) / 1e6;
    } finally {
      fs.openSync = originalOpenSync;
      fs.readSync = originalReadSync;
      if (savedRoot === undefined) delete process.env.CLAUDE_PROJECT_DIR;
      else process.env.CLAUDE_PROJECT_DIR = savedRoot;
      if (savedTranscript === undefined) delete process.env.CLAUDE_TRANSCRIPT_PATH;
      else process.env.CLAUDE_TRANSCRIPT_PATH = savedTranscript;
      fs.rmSync(big, { force: true });
    }
    console.log(`    (run() on 50 MB transcript: ${bytesRead} bytes read, ${ms.toFixed(1)} ms)`);
    assert.ok(result && String(result.additionalContext || '').includes('Prior search seen'), 'credited from the tail');
    assert.ok(bigFds.size >= 1 && bytesRead > 0, 'transcript was read through fs.readSync');
    assert.ok(bytesRead <= 256 * 1024, `read ${bytesRead} bytes; must stay within the 256 KiB tail`);
    assert.ok(ms < 1000, `wall-clock backstop: run() took ${ms.toFixed(1)} ms`);
  });

  gateCase('no prior-search credit output carries permissionDecision "allow"', () => {
    assert.ok(creditOutputs.length > 20, 'collected outputs');
    for (const stdout of creditOutputs) {
      const output = parseOutput(stdout);
      const decision = output && output.hookSpecificOutput ? output.hookSpecificOutput.permissionDecision : undefined;
      assert.notStrictEqual(decision, 'allow', stdout);
    }
  });

  // --- Denials name the closest search that did not count ---
  const MISS_PREFIX = 'Closest search this turn did not count';
  const missLine = reason => reason.split('\n').find(line => line.startsWith(MISS_PREFIX)) || '';

  gateCase('a denial names a search that looked outside the file directory', () => {
    const t = writeTranscript([humanRecord('x'), ...searchRecords('toolu_o1', 'Grep', { pattern: 'widget_factory', path: `${creditRoot}/docs` })]);
    const out = creditEdit(`${creditRoot}/src/widget_factory.py`, t);
    assertNotCredited(out, 'out of scope');
    const line = missLine(out.reason);
    assert.ok(line.includes('(Grep widget_factory)'), line || out.reason);
    assert.ok(line.includes("its search path does not contain this file"), line);
  });

  gateCase('a denial names a search whose filters excluded the file', () => {
    const t = writeTranscript([humanRecord('x'), ...searchRecords('toolu_x1', 'Bash', { command: "rg -g '!*.py' widget_factory ." })]);
    const out = creditEdit(`${creditRoot}/src/widget_factory.py`, t);
    assertNotCredited(out, 'excluded');
    assert.ok(missLine(out.reason).includes('its filters exclude this file'), out.reason);
  });

  gateCase('a denial names a search sent in the same batch', () => {
    const batch = (id, name, input) => ({
      type: 'assistant',
      uuid: nextUuid(),
      message: { id: 'msg_b4batch', role: 'assistant', content: [{ type: 'tool_use', id, name, input }] }
    });
    const t = writeTranscript([
      humanRecord('x'),
      ...searchRecords('toolu_far', 'Grep', { pattern: 'widget_factory', path: `${creditRoot}/docs` }),
      batch('toolu_sb', 'Grep', { pattern: 'widget_factory' }),
      batch('toolu_se', 'Edit', { file_path: `${creditRoot}/src/widget_factory.py` }),
      toolResultRecord('toolu_sb')
    ], { pending: false });
    const input = { file_path: `${creditRoot}/src/widget_factory.py`, old_string: 'a', new_string: 'b' };
    const result = runHook({ tool_name: 'Edit', tool_use_id: 'toolu_se', cwd: creditRoot, transcript_path: t, tool_input: input }, creditEnv);
    const reason = parseOutput(result.stdout).hookSpecificOutput.permissionDecisionReason;
    const line = missLine(reason);
    assert.ok(line.includes('same batch as this call'), `same batch outranks out of scope: ${line}`);
  });

  gateCase('a denial names a search that only read piped input', () => {
    const t = writeTranscript([humanRecord('x'), ...searchRecords('toolu_p1', 'Bash', { command: 'git diff | grep widget_factory' })]);
    const out = creditEdit(`${creditRoot}/src/widget_factory.py`, t);
    assertNotCredited(out, 'stdin');
    assert.ok(missLine(out.reason).includes('it searched piped input, not the tree'), out.reason);
  });

  gateCase('a denial names a Read or a non-search command of the file', () => {
    const read = writeTranscript([
      humanRecord('x'),
      toolUseRecord('toolu_r1', 'Read', { file_path: `${creditRoot}/src/widget_factory.py` }),
      toolResultRecord('toolu_r1')
    ]);
    const out = creditEdit(`${creditRoot}/src/widget_factory.py`, read);
    assertNotCredited(out, 'read');
    const line = missLine(out.reason);
    assert.ok(line.includes(`(Read ${creditRoot}/src/widget_factory.py)`), line || out.reason);
    assert.ok(line.includes('only Glob, Grep, LS and shell search commands count'), line);
    clearState();
    const cat = writeTranscript([humanRecord('x'), ...searchRecords('toolu_c1', 'Bash', { command: 'cat src/widget_factory.py' })]);
    assert.ok(missLine(creditEdit(`${creditRoot}/src/widget_factory.py`, cat).reason).includes('(Bash cat src/widget_factory.py)'));
  });

  gateCase('a denial explains that a generic file name never matches', () => {
    const t = writeTranscript([humanRecord('x'), ...searchRecords('toolu_g1', 'Grep', { pattern: 'index' })]);
    const out = creditEdit(`${creditRoot}/src/index.py`, t);
    assertNotCredited(out, 'generic');
    assert.ok(missLine(out.reason).includes('this file name is too generic to match a search'), out.reason);
  });

  gateCase('no closest-search line when nothing in the turn mentions the file', () => {
    const t = writeTranscript([humanRecord('x'), ...searchRecords('toolu_n1', 'Grep', { pattern: 'unrelated_thing' })]);
    const out = creditEdit(`${creditRoot}/src/widget_factory.py`, t);
    assertNotCredited(out, 'unrelated');
    assert.strictEqual(missLine(out.reason), '');
    assert.ok(!out.reason.includes(MISS_PREFIX));
    const none = creditEdit(`${creditRoot}/src/other_file.py`, undefined);
    assert.ok(!none.reason.includes(MISS_PREFIX), 'no transcript, no line');
  });

  gateCase('the closest-search detail is sanitized and bounded', () => {
    const noisy = `widget_factory \u202e\u200b${'z'.repeat(200)}\u0007`;
    const t = writeTranscript([humanRecord('x'), ...searchRecords('toolu_s1', 'Grep', { pattern: noisy, path: `${creditRoot}/docs` })]);
    const out = creditEdit(`${creditRoot}/src/widget_factory.py`, t);
    const line = missLine(out.reason);
    assert.ok(line, out.reason);
    for (const bad of ['\u202e', '\u200b', '\u0007']) assert.ok(!line.includes(bad), `no U+${bad.codePointAt(0).toString(16)}`);
    const detail = line.slice(line.indexOf('(Grep ') + 6, line.indexOf('):'));
    assert.ok(Array.from(detail).length <= 60, `detail bounded: ${detail.length}`);
    assert.ok(detail.endsWith('...'), 'truncation marked');
  });

  gateCase('sensitive targets never get a closest-search line', () => {
    const t = writeTranscript([humanRecord('x'), ...searchRecords('toolu_k1', 'Grep', { pattern: 'login_view', path: `${creditRoot}/docs` })]);
    const out = creditEdit(`${creditRoot}/src/auth/login_view.py`, t);
    assertNotCredited(out, 'sensitive');
    assert.ok(!out.reason.includes(MISS_PREFIX), out.reason);
  });

  gateCase('condensed denials and MultiEdit denials carry the closest-search line', () => {
    const t = writeTranscript([humanRecord('x'), ...searchRecords('toolu_m1', 'Grep', { pattern: 'widget_factory', path: `${creditRoot}/docs` })]);
    const condensed = creditEdit(`${creditRoot}/src/widget_factory.py`, t, { GATEGUARD_FACT_FORCE_FULL_DENIALS: '0' });
    assert.ok(!condensed.reason.includes('\n'), 'still one line');
    assert.ok(condensed.reason.includes(`${MISS_PREFIX} (Grep widget_factory)`), condensed.reason);
    clearState();
    const multi = creditRun('MultiEdit', { edits: [{ file_path: `${creditRoot}/src/widget_factory.py`, old_string: 'a', new_string: 'b' }] }, t);
    assert.ok(missLine(multi.reason).includes('(Grep widget_factory)'), multi.reason);
  });

  // --- Exclusion globs never earn search credit ---
  const exclusionTarget = `${creditRoot}/src/widget.py`;
  let exclusionSeq = 0;
  const exclusionTurn = (name, input) => {
    exclusionSeq += 1;
    return writeTranscript([humanRecord('fix the widget'), ...searchRecords(`toolu_r2_${exclusionSeq}`, name, input)]);
  };
  const exclusionDenied = [
    ['Grep glob !widget.py', 'Grep', { pattern: 'TODO', glob: '!widget.py', path: creditRoot }],
    ['Grep glob list with an exclusion', 'Grep', { pattern: 'widget', glob: '*.js,!widget.py', path: creditRoot }],
    ['Grep path-style exclusion covering the target', 'Grep', { pattern: 'widget', glob: '!src/**', path: creditRoot }],
    ['Grep positive basename glob that misses the target', 'Grep', { pattern: 'widget', glob: '*.md', path: creditRoot }],
    ["rg -g '!widget.py'", 'Bash', { command: "rg -g '!widget.py' TODO ." }],
    ['rg --glob=!widget.py', 'Bash', { command: 'rg --glob=!widget.py TODO .' }],
    ['rg --iglob exclusion, other case', 'Bash', { command: "rg --iglob '!WIDGET.py' TODO ." }],
    ['rg -g exclusion of the directory', 'Bash', { command: "rg -g '!src/' widget ." }],
    ['rg -g positive glob that misses the target', 'Bash', { command: "rg -g '*.md' widget ." }],
    ['grep --exclude=widget.py', 'Bash', { command: 'grep -r --exclude=widget.py TODO .' }],
    ['grep --exclude-dir of the target dir', 'Bash', { command: 'grep -rn --exclude-dir=src widget .' }],
    ['grep --exclude-from (unknown exclusions)', 'Bash', { command: 'grep -r --exclude-from=skip.txt widget .' }],
    ['grep --include that misses the target', 'Bash', { command: 'grep -r --include=*.md widget .' }],
    ['find -not -name', 'Bash', { command: 'find . -not -name widget.py' }],
    ['find ! -name', 'Bash', { command: 'find . ! -name widget.py -type f' }],
    ['find -path ... -prune', 'Bash', { command: 'find . -path ./src/widget.py -prune -o -print' }],
    ['find -name that misses the target', 'Bash', { command: 'find . -name widget.md' }],
    ['fd -E widget.py', 'Bash', { command: 'fd -E widget.py py src' }],
    ['fd --exclude widget.py', 'Bash', { command: 'fd --exclude widget.py py .' }],
    ['ls -I widget.py', 'Bash', { command: 'ls -I widget.py src' }],
    ["tree -I 'widget*'", 'Bash', { command: "tree -I 'widget*' src" }],
    ['Get-ChildItem -Exclude', 'PowerShell', { command: 'Get-ChildItem -Recurse -Exclude widget.py' }],
    ['rg brace exclusion', 'Bash', { command: "rg -g '!*.{py,js}' widget ." }],
    ['rg deep directory exclusion', 'Bash', { command: "rg -g '!**/src/**' widget ." }],
    ['rg character-class exclusion', 'Bash', { command: "rg -g '!w[i]dget.py' TODO ." }],
    ['rg exclusion in a short-flag cluster', 'Bash', { command: "rg -ig'!widget.py' TODO ." }],
    ['find negated group', 'Bash', { command: 'find . ! ( -name widget.py -o -name x.py ) -print' }],
    ['git ls-files -x', 'Bash', { command: 'git ls-files -x widget.py src' }]
  ];
  for (const [label, name, input] of exclusionDenied) {
    gateCase(`an exclusion never credits the excluded target (${label})`, () => {
      assertNotCredited(creditEdit(exclusionTarget, exclusionTurn(name, input)), label);
      assert.ok(!readState().fact_force_credited, `${label}: nothing credited`);
    });
  }
  const exclusionCredited = [
    ["rg -g '*.py' widget", 'Bash', { command: "rg -g '*.py' widget ." }],
    ['Grep widget glob *.py', 'Grep', { pattern: 'widget', glob: '*.py', path: creditRoot }],
    ["rg -g '!*.md' widget (exclusion does not cover the target)", 'Bash', { command: "rg -g '!*.md' widget ." }],
    ['Grep widget glob *.{py,js} (braces are one glob)', 'Grep', { pattern: 'widget', glob: '*.{py,js}', path: creditRoot }],
    ['Grep widget glob !node_modules/**', 'Grep', { pattern: 'widget', glob: '!node_modules/**', path: creditRoot }],
    ['grep --exclude-dir=node_modules widget', 'Bash', { command: 'grep -r --exclude-dir=node_modules widget .' }],
    ['find -name widget.py', 'Bash', { command: 'find . -name widget.py' }],
    ['Grep TODO glob widget.py (positive glob names the stem)', 'Grep', { pattern: 'TODO', glob: 'widget.py', path: creditRoot }]
  ];
  for (const [label, name, input] of exclusionCredited) {
    gateCase(`control still credits (${label})`, () => {
      assertCredited(creditEdit(exclusionTarget, exclusionTurn(name, input)), label);
    });
  }

  // --- Bracket classes in filter globs match exactly ---
  const bracketCases = [
    ['include class of a dot does not admit another character', 'src/fooXjs', "rg -g 'foo[.]js' fooXjs .", false],
    ['include class of a dot admits the dot', 'src/widget.py', "rg -g 'widget[.]py' widget .", true],
    ['include negated class admits another character', 'src/widget.py', "rg -g 'widge[!x].py' widget .", true],
    ['include negated class rejects its member', 'src/widget.py', "rg -g 'widge[!t].py' widget .", false],
    ['include caret-negated class rejects its member', 'src/widget.py', "rg -g 'widge[^t].py' widget .", false],
    ['include range admits a member', 'src/widget.py', "rg -g 'widge[r-u].py' widget .", true],
    ['include range rejects a non-member', 'src/widget.py', "rg -g 'widge[a-f].py' widget .", false],
    ['include range is case-insensitive', 'src/widget.py', "rg -g 'widge[R-U].py' widget .", true],
    ['include class with a literal ] first', 'src/widget.py', "rg -g 'widge[]t].py' widget .", true],
    ['Grep include class of a dot does not admit another character', 'src/fooXjs', { pattern: 'fooXjs', glob: 'foo[.]js' }, false],
    ['include with an unclosed class admits nothing', 'src/widget.py', "rg -g 'widget[.py' widget .", false],
    ['include with an empty class admits nothing', 'src/widget.py', "rg -g 'widget[].py' widget .", false],
    ['exclusion class covering the target blocks it', 'src/widget.py', "rg -g '!widge[t].py' widget .", false],
    ['exclusion range covering the target blocks it', 'src/widget.py', "rg -g '!widge[s-u].py' widget .", false],
    ['exclusion class of a dot does not cover another character', 'src/widgetXjs', "rg -g '!widget[.]js' widgetXjs .", true],
    ['exclusion negated class does not cover its member', 'src/widget.py', "rg -g '!widge[!t].py' widget .", true],
    ['exclusion with an unclosed class covers the target', 'src/widget.py', "rg -g '!zzz[' widget .", false],
    ['exclusion with an empty negated class covers the target', 'src/widget.py', "rg -g '!zzz[!]' widget .", false]
  ];
  for (const [label, rel, search, credited] of bracketCases) {
    gateCase(`bracket class: ${label}`, () => {
      const input = typeof search === 'string' ? { command: search } : { ...search, path: creditRoot };
      const out = creditEdit(`${creditRoot}/${rel}`, exclusionTurn(typeof search === 'string' ? 'Bash' : 'Grep', input));
      if (credited) assertCredited(out, label);
      else assertNotCredited(out, label);
    });
  }

  // --- Directory-qualified include globs restrict the search ---
  const longInclude = `${'a'.repeat(300)}*.py`;
  const pathIncludeCases = [
    ['rg include in another directory', 'lib/fooXjs.js', "rg -g 'src/*.js' fooXjs .", false],
    ['rg --glob include in another directory', 'src/widget.py', 'rg --glob=docs/*.py widget .', false],
    ['rg recursive include of another directory', 'src/widget.py', "rg -g 'lib/**' widget .", false],
    ['rg include anchored at the search root', 'vendor/src/widget.py', "rg -g 'src/*.py' widget .", false],
    ['rg include that does not cross a directory', 'src/deep/widget.py', "rg -g 'src/*.py' widget .", false],
    ['rg include relative to a narrower search path', 'src/widget.py', "rg -g 'src/*.py' widget src", false],
    ['Grep include in another directory', 'src/widget.py', { pattern: 'widget', glob: 'lib/*.py' }, false],
    ['grep --include matches base names only', 'src/widget.py', 'grep -r --include=src/*.py widget .', false],
    ['find -name with a slash matches nothing', 'src/widget.py', "find . -name 'src/widget.py'", false],
    ['PowerShell -Include with a path matches nothing', 'src/widget.py', 'Get-ChildItem -Recurse -Include src/widget.py', false],
    ['rg include past the length bound admits nothing', 'src/widget.py', `rg -g '${longInclude}' widget .`, false],
    ['rg include of the target directory', 'src/widget.py', "rg -g 'src/*.py' widget .", true],
    ['rg include with a leading slash', 'src/widget.py', "rg -g '/src/*.py' widget .", true],
    ['rg include with a leading **/', 'vendor/src/widget.py', "rg -g '**/src/*.py' widget .", true],
    ['rg recursive include of the target directory', 'src/deep/widget.py', "rg -g 'src/**' widget .", true],
    ['rg include relative to the search path', 'src/deep/widget.py', "rg -g 'deep/*.py' widget src", true],
    ['Grep include of the target directory', 'src/widget.py', { pattern: 'widget', glob: 'src/**/*.py' }, true]
  ];
  for (const [label, rel, search, credited] of pathIncludeCases) {
    gateCase(`path include: ${label}`, () => {
      const input = typeof search === 'string' ? { command: search } : { ...search, path: creditRoot };
      const tool = typeof search !== 'string' ? 'Grep' : /^Get-ChildItem/.test(search) ? 'PowerShell' : 'Bash';
      const out = creditEdit(`${creditRoot}/${rel}`, exclusionTurn(tool, input));
      if (credited) assertCredited(out, label);
      else assertNotCredited(out, label);
    });
  }

  // --- The search prefilter never hides a search that names the target ---
  const prefilterCases = [
    ["rg wid''get .", true],
    ['rg "wid"get .', true],
    ['rg WIDGET .', true],
    ['rg gadget .', false]
  ];
  for (const [command, credited] of prefilterCases) {
    gateCase(`search prefilter: ${command}`, () => {
      const out = creditEdit(exclusionTarget, exclusionTurn('Bash', { command }));
      if (credited) assertCredited(out, command);
      else assertNotCredited(out, command);
    });
  }

  // --- Every PowerShell spelling of -Exclude is an exclusion ---
  const psExcludeDenied = [
    'Get-ChildItem -Recurse -ex widget.py',
    'Get-ChildItem -Recurse -EXC widget.py',
    'gci -Recurse -Excl widget.py',
    'Get-ChildItem -Recurse -Exclude:widget.py',
    'Get-ChildItem -Recurse -exclu:widget.py',
    'Get-ChildItem -Recurse -Exclude: widget.py',
    'Get-ChildItem -Recurse -Exclude a.py, widget.py',
    'Get-ChildItem -Recurse -Exclude a.py ,widget.py',
    'Get-ChildItem -Recurse -Exclude a.py , widget.py',
    'Get-ChildItem -Recurse -Exclude a.py,widget.py',
    'Get-ChildItem -Recurse -Exclude:a.py, widget.py',
    'Select-String -Pattern TODO -Path src/* -ex widget.py',
    'sls TODO src/* -Exclude a.py, widget.py',
    'Get-ChildItem -Recurse -e:widget.py',
    'Get-ChildItem -Recurse -Nonesuch:widget.py',
    'Get-ChildItem -Recurse -in widget.py'
  ];
  for (const command of psExcludeDenied) {
    gateCase(`PowerShell exclusion never credits the excluded target (${command})`, () => {
      assertNotCredited(creditEdit(exclusionTarget, exclusionTurn('PowerShell', { command })), command);
      assert.ok(!readState().fact_force_credited, `${command}: nothing credited`);
    });
  }
  const psCredited = [
    'Get-ChildItem -Path src -Recurse -Filter widget.py',
    'Get-ChildItem -Recurse -Filt:widget.py',
    'Get-ChildItem -Recurse -Include a.md, widget.py',
    'Get-ChildItem -Recurse -Exclude a.md, b.md -Filter widget.py',
    'Select-String -Pattern widget -Path src/* -Exclude a.md'
  ];
  for (const command of psCredited) {
    gateCase(`PowerShell control still credits (${command})`, () => {
      assertCredited(creditEdit(exclusionTarget, exclusionTurn('PowerShell', { command })), command);
    });
  }
  gateCase('PowerShell include lists spread across tokens still filter the target', () => {
    const command = 'Get-ChildItem -Recurse -Include a.md, widget.md';
    assertNotCredited(creditEdit(exclusionTarget, exclusionTurn('PowerShell', { command })), command);
  });

  // --- Same-turn sibling creations and counters ---
  const projectRoot = fs.realpathSync(fs.mkdtempSync(path.join(tmpRoot, 'gateguard-proj-')));
  const projectEnv = { CLAUDE_PROJECT_DIR: projectRoot, CLAUDE_TRANSCRIPT_PATH: '' };
  const siblingOutputs = [];
  const projectRun = (toolName, toolInput, transcriptPath, env = {}) => {
    const payload = { tool_name: toolName, tool_input: toolInput, cwd: projectRoot };
    if (transcriptPath !== undefined) payload.transcript_path = transcriptPath;
    if (pendingToolUseIds.has(transcriptPath)) payload.tool_use_id = pendingToolUseIds.get(transcriptPath);
    const result = runHook(payload, { ...projectEnv, ...env });
    siblingOutputs.push(result.stdout);
    const output = parseOutput(result.stdout);
    const hso = output && output.hookSpecificOutput ? output.hookSpecificOutput : {};
    return { result, decision: hso.permissionDecision, context: hso.additionalContext || '', reason: hso.permissionDecisionReason || '' };
  };
  const projectWrite = (file_path, transcriptPath, env) => projectRun('Write', { file_path, content: 'x' }, transcriptPath, env);
  const projectEdit = (file_path, transcriptPath, env) =>
    projectRun('Edit', { file_path, old_string: 'a', new_string: 'b' }, transcriptPath, env);
  const assertSibling = (out, label) => {
    assert.notStrictEqual(out.decision, 'deny', `${label}: must not deny (${out.result.stdout})`);
    assert.notStrictEqual(out.decision, 'allow', `${label}: never permissionDecision allow`);
    assert.ok(out.context.includes('[Fact-Forcing Gate] Sibling of '), `${label}: sibling note expected, got ${out.result.stdout}`);
  };
  const assertDeniedNoSibling = (out, label) => {
    assert.strictEqual(out.decision, 'deny', `${label}: expected deny, got ${out.result.stdout}`);
    assert.ok(!out.context.includes('Sibling of'), `${label}: no sibling note`);
  };
  // dir_gates keys are `<class>\u0000<canonicalDir>`.
  const dirGateKey = (dir, cls = 'code') => `${cls}\u0000${stateKey(dir)}`;
  const newTurn = text => {
    const human = humanRecord(text);
    return { human, transcript: writeTranscript([human]) };
  };

  gateCase('checked lookups under a simulated Windows root (both spellings share one key)', () => {
    const winRoot = 'C:\\Users\\RUNNER~1\\AppData\\Local\\Temp\\gateguard-proj-abc';
    const savedRoot = process.env.CLAUDE_PROJECT_DIR;
    const savedTranscript = process.env.CLAUDE_TRANSCRIPT_PATH;
    let first;
    let second;
    try {
      // Fixed synthetic paths: keys need no real disk, and the target is absent on any host.
      const hook = loadDirectHook({ CLAUDE_PROJECT_DIR: winRoot, CLAUDE_TRANSCRIPT_PATH: '' });
      const write = file_path => hook.run({ tool_name: 'Write', cwd: winRoot, tool_input: { file_path, content: 'x' } });
      first = write(`${winRoot}/src/widgets/w0.js`);
      second = write(`${winRoot}\\src\\widgets\\w1.js`);
    } finally {
      if (savedRoot === undefined) delete process.env.CLAUDE_PROJECT_DIR;
      else process.env.CLAUDE_PROJECT_DIR = savedRoot;
      if (savedTranscript === undefined) delete process.env.CLAUDE_TRANSCRIPT_PATH;
      else process.env.CLAUDE_TRANSCRIPT_PATH = savedTranscript;
    }
    assert.strictEqual(parseOutput(first.stdout).hookSpecificOutput.permissionDecision, 'deny');
    const state = readState();
    if (process.platform === 'win32') {
      assert.ok(second && /Sibling of/.test(String(second.additionalContext || '')), JSON.stringify(second));
      assert.strictEqual(Object.keys(state.dir_gates || {}).length, 1, 'one dir gate for both spellings');
    } else {
      assert.strictEqual(parseOutput(second.stdout).hookSpecificOutput.permissionDecision, 'deny', JSON.stringify(second));
      assert.deepStrictEqual(Object.keys(state.dir_gates || {}), [], 'no dir gate for an unresolvable directory');
    }
    assert.ok(state.checked.includes(stateKey(`${winRoot}/src/widgets/w0.js`)), `w0 checked: ${JSON.stringify(state.checked)}`);
    assert.ok(state.checked.includes(stateKey(`${winRoot}\\src\\widgets\\w1.js`)), 'w1 checked (backslash spelling)');
  });

  gateCase('8 new files in one dir in the same turn -> 1 deny + 7 sibling notes', () => {
    const { human, transcript } = newTurn('scaffold the widgets');
    const first = projectWrite(`${projectRoot}/src/widgets/w0.js`, transcript);
    assertDeniedNoSibling(first, 'first file');
    for (let i = 1; i < 8; i++) {
      const out = projectWrite(`${projectRoot}/src/widgets/w${i}.js`, transcript);
      assertSibling(out, `file ${i}`);
      assert.strictEqual(
        out.context,
        `[Fact-Forcing Gate] Sibling of ${projectRoot}/src/widgets/w0.js (gated earlier at denial #1 this session); proceeding without a repeat denial.`
      );
    }
    const state = readState();
    assert.strictEqual(state.fact_force_denials, 1, 'one denial');
    assert.strictEqual(state.sibling_allows, 7, 'seven sibling allows');
    assert.ok(state.checked.includes(stateKey(`${projectRoot}/src/widgets/w7.js`)), 'sibling marked checked (canonical key)');
    const gate = state.dir_gates[dirGateKey(`${projectRoot}/src/widgets`)];
    assert.ok(gate, 'dir gate keyed by canonical dir');
    assert.strictEqual(gate.turn, human.uuid);
    assert.strictEqual(gate.first, `${projectRoot}/src/widgets/w0.js`);
    assert.strictEqual(gate.ordinal, 1);
    assert.ok(typeof gate.at === 'number' && gate.at > 0);
    const retry = projectWrite(`${projectRoot}/src/widgets/w3.js`, transcript);
    assert.strictEqual(retry.decision, undefined);
    assert.strictEqual(retry.context, '', 'already checked: plain allow');
  });

  gateCase('a different directory gets its own denial', () => {
    const { transcript } = newTurn('x');
    assertDeniedNoSibling(projectWrite(`${projectRoot}/src/a/one.js`, transcript), 'dir a');
    assertDeniedNoSibling(projectWrite(`${projectRoot}/src/b/two.js`, transcript), 'dir b');
    assertDeniedNoSibling(projectWrite(`${projectRoot}/src/a/nested/three.js`, transcript), 'subdirectory is not a sibling');
    assertSibling(projectWrite(`${projectRoot}/src/b/four.js`, transcript), 'dir b sibling');
  });

  gateCase('the next human turn in the same dir is denied again', () => {
    const turn1 = humanRecord('first');
    const t1 = writeTranscript([turn1]);
    assertDeniedNoSibling(projectWrite(`${projectRoot}/src/w/one.js`, t1), 'turn 1');
    const t2 = writeTranscript([turn1, humanRecord('second')]);
    assertDeniedNoSibling(projectWrite(`${projectRoot}/src/w/two.js`, t2), 'turn 2');
    assertSibling(projectWrite(`${projectRoot}/src/w/three.js`, t2), 'turn 2 sibling');
    assert.ok(projectWrite(`${projectRoot}/src/w/three.js`, t2).context === '', 'checked');
    assert.strictEqual(readState().dir_gates[dirGateKey(`${projectRoot}/src/w`)].ordinal, 2, 'latest denial ordinal recorded');
  });

  gateCase('a Write over an existing file in the gated dir is still denied (per-file)', () => {
    fs.mkdirSync(path.join(projectRoot, 'src', 'e'), { recursive: true });
    fs.writeFileSync(path.join(projectRoot, 'src', 'e', 'existing.js'), 'old');
    const { transcript } = newTurn('x');
    assertDeniedNoSibling(projectWrite(`${projectRoot}/src/e/new.js`, transcript), 'new file');
    assertDeniedNoSibling(projectWrite(`${projectRoot}/src/e/existing.js`, transcript), 'existing file');
    assert.ok(!readState().sibling_allows, 'no sibling allow');
  });

  gateCase('an existing-file Write denial does not open a dir gate', () => {
    fs.mkdirSync(path.join(projectRoot, 'src', 'f'), { recursive: true });
    fs.writeFileSync(path.join(projectRoot, 'src', 'f', 'present.js'), 'old');
    const { transcript } = newTurn('x');
    assertDeniedNoSibling(projectWrite(`${projectRoot}/src/f/present.js`, transcript), 'existing file');
    assertDeniedNoSibling(projectWrite(`${projectRoot}/src/f/brand_new.js`, transcript), 'new file after existing');
  });

  gateCase('fs error resolving the target -> treated as existing (no collapse)', () => {
    fs.mkdirSync(path.join(projectRoot, 'src'), { recursive: true });
    fs.writeFileSync(path.join(projectRoot, 'src', 'blocker'), 'not a dir');
    const { transcript } = newTurn('x');
    assertDeniedNoSibling(projectWrite(`${projectRoot}/src/blocker/one.js`, transcript), 'ENOTDIR first');
    if (process.platform === 'win32') return;
    assertDeniedNoSibling(projectWrite(`${projectRoot}/src/blocker/two.js`, transcript), 'ENOTDIR second');
    assert.ok(!Object.keys(readState().dir_gates || {}).some(k => k.endsWith(`${projectRoot}/src/blocker`)), 'no dir gate recorded');
  });

  gateCase('Edit and MultiEdit in a gated dir are never collapsed', () => {
    const { transcript } = newTurn('x');
    assertDeniedNoSibling(projectWrite(`${projectRoot}/src/m/one.js`, transcript), 'write');
    assertDeniedNoSibling(projectEdit(`${projectRoot}/src/m/two.js`, transcript), 'edit sibling');
    const multi = projectRun(
      'MultiEdit',
      { edits: [{ file_path: `${projectRoot}/src/m/three.js`, old_string: 'a', new_string: 'b' }] },
      transcript
    );
    assertDeniedNoSibling(multi, 'multiedit sibling');
    assertSibling(projectWrite(`${projectRoot}/src/m/four.js`, transcript), 'write sibling still works');
  });

  gateCase('an Edit denial does not open a dir gate', () => {
    const { transcript } = newTurn('x');
    assertDeniedNoSibling(projectEdit(`${projectRoot}/src/n/one.js`, transcript), 'edit');
    assertDeniedNoSibling(projectWrite(`${projectRoot}/src/n/two.js`, transcript), 'write after edit');
  });

  gateCase('instruction-class siblings are each denied', () => {
    const { transcript } = newTurn('x');
    assertDeniedNoSibling(projectWrite(`${projectRoot}/skills/foo/one.md`, transcript), 'instruction 1');
    assertDeniedNoSibling(projectWrite(`${projectRoot}/skills/foo/two.md`, transcript), 'instruction 2');
    assert.ok(!Object.keys(readState().dir_gates || {}).some(k => k.endsWith(`${projectRoot}/skills/foo`)), 'instruction denial opens no dir gate');
    assertDeniedNoSibling(projectWrite(`${projectRoot}/skills/foo/helper.js`, transcript), 'code file after instruction denials');
    assertDeniedNoSibling(projectWrite(`${projectRoot}/skills/foo/three.md`, transcript), 'instruction after a code dir gate');
  });

  gateCase('no transcript -> sibling within 120 s, denied after', () => {
    assertDeniedNoSibling(projectWrite(`${projectRoot}/src/nt/one.js`), 'first');
    assertSibling(projectWrite(`${projectRoot}/src/nt/two.js`), 'within window');
    const state = readState();
    assert.strictEqual(state.dir_gates[dirGateKey(`${projectRoot}/src/nt`)].turn, null, 'turn null without transcript');
    state.dir_gates[dirGateKey(`${projectRoot}/src/nt`)].at = Date.now() - 121000;
    writeState(state);
    assertDeniedNoSibling(projectWrite(`${projectRoot}/src/nt/three.js`), 'after window');
  });

  gateCase('a turn-scoped gate is not matched without a turn id, and vice versa', () => {
    const { transcript } = newTurn('x');
    assertDeniedNoSibling(projectWrite(`${projectRoot}/src/tt/one.js`, transcript), 'turn gate');
    assertDeniedNoSibling(projectWrite(`${projectRoot}/src/tt/two.js`), 'no-turn call vs turn gate');
    assertDeniedNoSibling(projectWrite(`${projectRoot}/src/tt/three.js`, transcript), 'turn call vs null-turn gate');
  });

  gateCase('a prior search credits before the sibling rule', () => {
    const human = humanRecord('x');
    const t = writeTranscript([human]);
    assertDeniedNoSibling(projectWrite(`${projectRoot}/src/cr/one.js`, t), 'first');
    const t2 = writeTranscript([human, ...searchRecords('toolu_c4g', 'Grep', { pattern: 'widget_factory' })]);
    const out = projectWrite(`${projectRoot}/src/cr/widget_factory.js`, t2);
    assert.ok(out.context.includes('Prior search seen in this turn'), out.result.stdout);
    assert.ok(!out.context.includes('Sibling of'));
    assert.ok(!readState().sibling_allows, 'credit is not a sibling allow');
  });

  gateCase('counters record class names for denial, credit and sibling events', () => {
    const human = humanRecord('x');
    const t = writeTranscript([human, ...searchRecords('toolu_c4c', 'Grep', { pattern: 'widget_factory' })]);
    assertDeniedNoSibling(projectWrite(`${projectRoot}/src/cc/one.js`, t), 'code deny');
    assertSibling(projectWrite(`${projectRoot}/src/cc/two.js`, t), 'code sibling');
    assertDeniedNoSibling(projectWrite(`${projectRoot}/docs/guide_page.md`, t), 'prose deny');
    assertDeniedNoSibling(projectEdit(`${projectRoot}/tests/a.test.js`, t), 'test deny');
    assertDeniedNoSibling(projectWrite(`${projectRoot}/skills/x/SKILL.md`, t), 'instruction deny');
    assertCredited(projectEdit(`${projectRoot}/lib/widget_factory.js`, t), 'code credit');
    const state = readState();
    assert.deepStrictEqual(state.denials_by_class, { code: 1, prose: 1, test: 1, instruction: 1 });
    assert.deepStrictEqual(state.credited_by_class, { code: 1 });
    assert.strictEqual(state.sibling_allows, 1);
    assert.strictEqual(state.fact_force_denials, 4);
    assert.strictEqual(state.fact_force_credited, 1);
    const json = JSON.stringify({ d: state.denials_by_class, c: state.credited_by_class });
    assert.ok(!json.includes('/'), 'counters hold class names only, never paths');
  });

  gateCase('a state file without the counter fields loads and gains them', () => {
    writeState({ checked: ['/elsewhere/x.js'], last_active: Date.now(), fact_force_denials: 2 });
    const { transcript } = newTurn('x');
    assertDeniedNoSibling(projectWrite(`${projectRoot}/src/old/one.js`, transcript), 'deny');
    assertSibling(projectWrite(`${projectRoot}/src/old/two.js`, transcript), 'sibling');
    const state = readState();
    assert.ok(state.checked.includes('/elsewhere/x.js'));
    assert.strictEqual(state.fact_force_denials, 3);
    assert.strictEqual(state.dir_gates[dirGateKey(`${projectRoot}/src/old`)].ordinal, 3);
    assert.deepStrictEqual(state.denials_by_class, { code: 1 });
    assert.deepStrictEqual(state.credited_by_class, {});
    assert.strictEqual(state.sibling_allows, 1);
    assert.strictEqual(state.fact_force_credited, 0);
  });

  gateCase('malformed counter fields are tolerated (treated as empty/zero)', () => {
    writeState({
      checked: [],
      last_active: Date.now(),
      dir_gates: { [dirGateKey(`${projectRoot}/src/bad`)]: 'nope', [dirGateKey(`${projectRoot}/src/bad2`)]: { at: 'x' }, other: [1, 2] },
      denials_by_class: [5],
      credited_by_class: { code: -3, prose: 'x', test: 2 },
      sibling_allows: 'many'
    });
    assertDeniedNoSibling(projectWrite(`${projectRoot}/src/bad/one.js`), 'malformed gate ignored');
    assertSibling(projectWrite(`${projectRoot}/src/bad/two.js`), 'fresh gate works');
    const state = readState();
    assert.deepStrictEqual(Object.keys(state.dir_gates), [dirGateKey(`${projectRoot}/src/bad`)]);
    assert.deepStrictEqual(state.denials_by_class, { code: 1 });
    assert.deepStrictEqual(state.credited_by_class, { test: 2 });
    assert.strictEqual(state.sibling_allows, 1);
    writeState({ checked: [], last_active: Date.now(), dir_gates: 'garbage', denials_by_class: null, sibling_allows: -1 });
    assertDeniedNoSibling(projectWrite(`${projectRoot}/src/bad3/one.js`), 'garbage dir_gates');
    assert.strictEqual(readState().sibling_allows, 0);
  });

  gateCase('dir_gates is capped at 50 (oldest evicted)', () => {
    const now = Date.now();
    const gates = {};
    for (let i = 0; i < 50; i++) gates[dirGateKey(`/cap/d${i}`)] = { turn: null, at: now - 100000 + i, first: `/cap/d${i}/f.js`, ordinal: i + 1 };
    writeState({ checked: [], last_active: now, dir_gates: gates });
    assertDeniedNoSibling(projectWrite(`${projectRoot}/src/cap/one.js`), 'new gate');
    const state = readState();
    assert.strictEqual(Object.keys(state.dir_gates).length, 50, 'capped at 50');
    assert.ok(state.dir_gates[dirGateKey(`${projectRoot}/src/cap`)], 'newest kept');
    assert.ok(!state.dir_gates[dirGateKey('/cap/d0')], 'oldest evicted');
    assert.ok(state.dir_gates[dirGateKey('/cap/d1')], 'second-oldest kept');
  });

  gateCase('dir_gate first path is stored sanitized', () => {
    const file_path = `${projectRoot}/src/san/evil\u202ename\u200b.js`;
    assertDeniedNoSibling(projectWrite(file_path), 'deny');
    const gate = readState().dir_gates[dirGateKey(`${projectRoot}/src/san`)];
    assert.ok(gate && !gate.first.includes('\u202e') && !gate.first.includes('\u200b'), JSON.stringify(gate));
    const out = projectWrite(`${projectRoot}/src/san/ok.js`);
    assertSibling(out, 'sibling');
    assert.ok(!out.context.includes('\u202e'));
  });

  gateCase('merges dir_gates and counters written by another process during save', () => {
    const hook = loadDirectHook({ CLAUDE_PROJECT_DIR: projectRoot, CLAUDE_TRANSCRIPT_PATH: '' });
    const originalMkdirSync = fs.mkdirSync;
    const now = Date.now();
    let injected = false;
    fs.mkdirSync = function patchedMkdirSync(target) {
      const result = originalMkdirSync.apply(fs, arguments);
      if (!injected && path.resolve(String(target)) === path.resolve(stateDir)) {
        injected = true;
        fs.writeFileSync(
          stateFile,
          JSON.stringify({
            checked: ['/src/concurrent.js'],
            last_active: now,
            fact_force_denials: 7,
            dir_gates: {
              [dirGateKey('/other/dir')]: { turn: 'u-other', at: now, first: '/other/dir/a.js', ordinal: 7 },
              [dirGateKey(`${projectRoot}/src/conc`)]: { turn: 'u-old', at: 1, first: 'stale', ordinal: 1 }
            },
            denials_by_class: { code: 5, prose: 2 },
            credited_by_class: { test: 3 },
            sibling_allows: 9
          }),
          'utf8'
        );
      }
      return result;
    };
    const savedRoot = process.env.CLAUDE_PROJECT_DIR;
    const savedTranscript = process.env.CLAUDE_TRANSCRIPT_PATH;
    try {
      const result = hook.run({ tool_name: 'Write', cwd: projectRoot, tool_input: { file_path: `${projectRoot}/src/conc/new.js`, content: 'x' } });
      assert.strictEqual(parseOutput(result.stdout).hookSpecificOutput.permissionDecision, 'deny');
    } finally {
      fs.mkdirSync = originalMkdirSync;
      if (savedRoot === undefined) delete process.env.CLAUDE_PROJECT_DIR;
      else process.env.CLAUDE_PROJECT_DIR = savedRoot;
      if (savedTranscript === undefined) delete process.env.CLAUDE_TRANSCRIPT_PATH;
      else process.env.CLAUDE_TRANSCRIPT_PATH = savedTranscript;
    }
    const persisted = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
    assert.ok(persisted.dir_gates[dirGateKey('/other/dir')], 'concurrent dir gate preserved');
    const mine = persisted.dir_gates[dirGateKey(`${projectRoot}/src/conc`)];
    assert.ok(mine && mine.first === `${projectRoot}/src/conc/new.js` && mine.turn === null, 'newer in-memory gate wins');
    assert.deepStrictEqual(persisted.denials_by_class, { code: 5, prose: 2 }, 'per-key max(disk, mem)');
    assert.deepStrictEqual(persisted.credited_by_class, { test: 3 });
    assert.strictEqual(persisted.sibling_allows, 9);
    assert.ok(persisted.checked.includes('/src/concurrent.js'));
  });

  gateCase('sibling state save failure -> allow with state warning', () => {
    assertDeniedNoSibling(projectWrite(`${projectRoot}/src/sf/one.js`), 'deny');
    const hook = loadDirectHook({ CLAUDE_PROJECT_DIR: projectRoot, CLAUDE_TRANSCRIPT_PATH: '' });
    const originalWriteFileSync = fs.writeFileSync;
    fs.writeFileSync = function patchedWriteFileSync(target) {
      if (String(target).includes('.json.tmp.')) throw Object.assign(new Error('EIO'), { code: 'EIO' });
      return originalWriteFileSync.apply(fs, arguments);
    };
    const savedRoot = process.env.CLAUDE_PROJECT_DIR;
    const savedTranscript = process.env.CLAUDE_TRANSCRIPT_PATH;
    let result;
    try {
      result = hook.run({ tool_name: 'Write', cwd: projectRoot, tool_input: { file_path: `${projectRoot}/src/sf/two.js`, content: 'x' } });
    } finally {
      fs.writeFileSync = originalWriteFileSync;
      if (savedRoot === undefined) delete process.env.CLAUDE_PROJECT_DIR;
      else process.env.CLAUDE_PROJECT_DIR = savedRoot;
      if (savedTranscript === undefined) delete process.env.CLAUDE_TRANSCRIPT_PATH;
      else process.env.CLAUDE_TRANSCRIPT_PATH = savedTranscript;
    }
    assert.ok(!result.stdout, 'no deny and no sibling note');
    assert.ok(String(result.stderr).includes('could not be persisted'), JSON.stringify(result));
  });

  gateCase('clipped window keeps the promptId turn id; a sibling gate from earlier in the turn still matches', () => {
    const { scanCurrentTurn } = loadDirectHook();
    const pid = 'prompt-heavy';
    const human = humanRecord('scaffold', { promptId: pid });
    const early = writeTranscript([human]);
    assert.strictEqual(scanCurrentTurn(early).turnId, pid);
    const gateDir = `${projectRoot}/src/heavy`;
    assertDeniedNoSibling(projectWrite(`${gateDir}/one.js`, early), 'first file, boundary in window');
    assert.strictEqual(readState().dir_gates[dirGateKey(gateDir)].turn, pid, 'gate recorded under the promptId');
    const filler = fillerRecords('pid').map(r => (r.type === 'user' ? { ...r, promptId: pid } : r));
    const late = writeTranscript([human, ...filler]);
    assert.ok(fs.statSync(late).size > 300 * 1024, 'boundary scrolled out of the tail');
    assert.strictEqual(scanCurrentTurn(late).turnId, pid, 'turn id stable after the turn outgrows the tail');
    assertSibling(projectWrite(`${gateDir}/two.js`, late), 'sibling after the boundary left the window');
    const next = writeTranscript([humanRecord('next', { promptId: 'prompt-next' })]);
    assertDeniedNoSibling(projectWrite(`${gateDir}/three.js`, next), 'next prompt is a new turn');
  });

  gateCase('a new human turn uses its own promptId even when a late tool_result carries the previous one', () => {
    const turnOneHuman = humanRecord('turn one', { promptId: 'P1' });
    const t1 = writeTranscript([turnOneHuman]);
    assertDeniedNoSibling(projectWrite(`${projectRoot}/src/late-result/aaa1.py`, t1), 'turn P1');
    const late = { ...toolResultRecord('toolu_n3late'), promptId: 'P1' };
    const t2 = writeTranscript([turnOneHuman, humanRecord('turn two', { promptId: 'P2' }), toolUseRecord('toolu_n3late', 'Bash', { command: 'true' }), late]);
    assertDeniedNoSibling(projectWrite(`${projectRoot}/src/late-result/aaa2.py`, t2), 'turn P2 with a late P1 tool_result');
    assertSibling(projectWrite(`${projectRoot}/src/late-result/aaa3.py`, t2), 'sibling within turn P2');
    assert.strictEqual(readState().dir_gates[dirGateKey(`${projectRoot}/src/late-result`)].turn, 'P2', 'gate recorded under the boundary promptId');
  });

  gateCase('a transcript that yields no turn id never falls back to the no-turn 120 s rule', () => {
    const asDir = fs.mkdtempSync(path.join(tmpRoot, 'gateguard-transcript-dir-'));
    assertDeniedNoSibling(projectWrite(`${projectRoot}/src/null-scan/one.js`, asDir), 'transcript path is a directory (scan null)');
    assertDeniedNoSibling(projectWrite(`${projectRoot}/src/null-scan/two.js`, asDir), 'no collapse with a null scan');
    const noBoundary = writeTranscript([toolUseRecord('toolu_n4x', 'Bash', { command: 'true' }), toolResultRecord('toolu_n4x')]);
    assertDeniedNoSibling(projectWrite(`${projectRoot}/src/no-boundary/one.js`, noBoundary), 'whole file without a boundary (turn id null)');
    assertDeniedNoSibling(projectWrite(`${projectRoot}/src/no-boundary/two.js`, noBoundary), 'no collapse without a turn id');
    const missing = path.join(tmpRoot, 'gateguard-missing-transcript.jsonl');
    assertDeniedNoSibling(projectWrite(`${projectRoot}/src/missing-transcript/one.js`, missing), 'missing transcript file');
    assertDeniedNoSibling(projectWrite(`${projectRoot}/src/missing-transcript/two.js`, missing), 'no collapse with a missing transcript');
    const malformed = path.join(tmpRoot, `gateguard-malformed-transcript-${process.pid}.jsonl`);
    fs.writeFileSync(malformed, [humanRecord('t1', { promptId: 'M1' }), humanRecord('t2', { promptId: 'M2' })].map(r => JSON.stringify(r)).join('\n') + '\n{"type":"assistant"}\n');
    assertDeniedNoSibling(projectWrite(`${projectRoot}/src/malformed-record/one.js`, malformed), 'malformed assistant record');
    assertSibling(projectWrite(`${projectRoot}/src/malformed-record/two.js`, malformed), 'malformed record skipped: same turn M2 still collapses');
    assert.strictEqual(readState().dir_gates[dirGateKey(`${projectRoot}/src/malformed-record`)].turn, 'M2');
    fs.rmSync(asDir, { recursive: true, force: true });
    fs.rmSync(malformed, { force: true });
  });

  gateCase('no sibling-collapse output carries permissionDecision "allow"', () => {
    assert.ok(siblingOutputs.length > 20, 'collected outputs');
    for (const stdout of siblingOutputs) {
      const output = parseOutput(stdout);
      const decision = output && output.hookSpecificOutput ? output.hookSpecificOutput.permissionDecision : undefined;
      assert.notStrictEqual(decision, 'allow', stdout);
    }
  });

  // --- Prior-search credit: scope and matching rules ---
  const scopeRoot = fs.realpathSync(fs.mkdtempSync(path.join(tmpRoot, 'gateguard-scope-proj-')));
  // Shell fixtures use forward slashes: bash treats unquoted backslashes as escapes.
  const scopeRootSh = scopeRoot.replace(/\\/g, '/');
  for (const dir of ['src/handlers', 'handlers', 'f']) fs.mkdirSync(path.join(scopeRoot, dir), { recursive: true });
  for (const file of ['src/payment.py', 'src/auth.py', 'src/payment_service.py', 'top.py']) {
    fs.writeFileSync(path.join(scopeRoot, file), 'x');
  }
  const scopeEnv = { CLAUDE_PROJECT_DIR: scopeRoot, CLAUDE_TRANSCRIPT_PATH: '' };
  const scopeOutputs = [];
  let scopeSession = 0;
  // Each call gets a fresh session unless the case passes session_id explicitly.
  const scopeRun = (toolName, toolInput, transcriptPath, extra = {}) => {
    scopeSession += 1;
    const payload = { tool_name: toolName, tool_input: toolInput, cwd: scopeRoot, transcript_path: transcriptPath, session_id: `scope-${scopeSession}` };
    if (pendingToolUseIds.has(transcriptPath)) payload.tool_use_id = pendingToolUseIds.get(transcriptPath);
    Object.assign(payload, extra);
    if (payload.tool_use_id === null) delete payload.tool_use_id;
    const result = runHook(payload, scopeEnv);
    scopeOutputs.push(result.stdout);
    const output = parseOutput(result.stdout);
    const hso = output && output.hookSpecificOutput ? output.hookSpecificOutput : {};
    return { result, decision: hso.permissionDecision, context: hso.additionalContext || '', reason: hso.permissionDecisionReason || '' };
  };
  const scopePath = rel => `${scopeRoot}/${rel}`;
  const scopeEdit = (rel, t, extra) => scopeRun('Edit', { file_path: scopePath(rel), old_string: 'a', new_string: 'b' }, t, extra);
  const scopeWrite = (rel, t, extra) => scopeRun('Write', { file_path: scopePath(rel), content: 'x' }, t, extra);
  const scopeTurn = (...records) => writeTranscript([humanRecord('fix'), ...records]);
  const bashSearch = (id, command) => searchRecords(id, 'Bash', { command });
  const assertScopeDenied = (out, label) => {
    assert.strictEqual(out.decision, 'deny', `${label}: expected deny, got ${out.result.stdout}`);
    assert.ok(!out.context.includes('Prior search seen'), `${label}: no credit note`);
  };
  const assertScopeCredited = (out, label) => {
    assert.notStrictEqual(out.decision, 'deny', `${label}: must not deny (${out.result.stdout})`);
    assert.ok(out.context.includes('Prior search seen in this turn'), `${label}: credit note expected, got ${out.result.stdout}`);
  };
  const assistantMessage = (id, messageId, name, input) => ({
    type: 'assistant',
    uuid: nextUuid(),
    message: { id: messageId, role: 'assistant', content: [{ type: 'tool_use', id, name, input }] }
  });
  const toolResult = (id, extra) => ({
    type: 'user',
    uuid: nextUuid(),
    message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: 'ok', ...extra }] }
  });

  gateCase('a directory listing does not credit a Write that overwrites an existing file', () => {
    assertScopeDenied(scopeWrite('src/payment.py', scopeTurn(...searchRecords('toolu_h1a', 'LS', { path: 'src' }))), 'LS src -> overwrite payment.py');
    assertScopeDenied(scopeWrite('top.py', scopeTurn(...bashSearch('toolu_h1b', 'grep -rn TODO .'))), 'grep -rn TODO . -> overwrite top.py');
    assertScopeDenied(scopeWrite('src/handlers/../payment.py', scopeTurn(...searchRecords('toolu_h1c', 'Glob', { pattern: 'src/*.py' }))), 'Glob src/*.py -> overwrite');
  });

  gateCase('shell patterns and flag values are not directories', () => {
    assertScopeDenied(scopeWrite('handlers/zzzz_new.py', scopeTurn(...bashSearch('toolu_h2a', 'grep -r handlers src'))), 'grep pattern as dir');
    assertScopeDenied(scopeWrite('f/qqqq_new.py', scopeTurn(...bashSearch('toolu_h2b', 'find . -type f -name x'))), 'find -type value as dir');
    assertScopeDenied(scopeWrite('handlers/rg_new.py', scopeTurn(...bashSearch('toolu_h2c', 'rg -g handlers TODO src'))), 'rg -g value as dir');
    assertScopeDenied(scopeWrite('handlers/sls_new.py', scopeTurn(...searchRecords('toolu_h2d', 'PowerShell', { command: 'Select-String handlers src/*.py' }))), 'sls pattern');
  });

  gateCase('bare cwd operands and missing directories give no directory credit', () => {
    assertScopeDenied(scopeWrite('zzz_new.py', scopeTurn(...bashSearch('toolu_h2e', 'grep -rn TODO .'))), 'grep -rn TODO .');
    assertScopeDenied(scopeWrite('nothere/new_mod.py', scopeTurn(...bashSearch('toolu_h2f', 'ls nothere'))), 'ls of a missing dir');
    assertScopeDenied(scopeWrite('top.py/new_mod.py', scopeTurn(...bashSearch('toolu_h2g', 'ls top.py'))), 'ls of a file, not a dir');
  });

  gateCase('Glob with no literal prefix, or no glob characters, names no directory', () => {
    assertScopeDenied(scopeWrite('brandnew.py', scopeTurn(...searchRecords('toolu_h2h', 'Glob', { pattern: '**/*' }))), 'Glob **/*');
    assertScopeDenied(scopeWrite('otherzz.py', scopeTurn(...searchRecords('toolu_h2i', 'Glob', { pattern: 'qqq.txt' }))), 'Glob qqq.txt');
    assertScopeDenied(scopeWrite('src/handlers/brand_new.py', scopeTurn(...searchRecords('toolu_h2j', 'Glob', { pattern: 'src/handlers/x.py' }))), 'Glob file lookup');
  });

  gateCase('stems match on word boundaries only', () => {
    assertScopeDenied(scopeEdit('src/auth.py', scopeTurn(...searchRecords('toolu_m1a', 'Grep', { pattern: 'author' }))), 'author vs auth');
    assertScopeDenied(scopeEdit('src/payment.py', scopeTurn(...searchRecords('toolu_m1b', 'Grep', { pattern: 'TODO', glob: '**/payments/**' }))), 'payments glob');
    assertScopeCredited(scopeEdit('src/auth.py', scopeTurn(...searchRecords('toolu_m1c', 'Grep', { pattern: 'def auth(' }))), 'auth( boundary');
  });

  gateCase('shell segments that only read stdin never credit', () => {
    assertScopeDenied(scopeEdit('src/payment.py', scopeTurn(...bashSearch('toolu_m1d', 'echo payment | grep payment'))), 'echo | grep');
    assertScopeDenied(scopeEdit('src/payment.py', scopeTurn(...bashSearch('toolu_m1e', 'cat README | grep -c payment'))), 'cat | grep -c');
    assertScopeDenied(scopeEdit('src/payment.py', scopeTurn(...bashSearch('toolu_m1f', 'echo payment | rg payment'))), 'piped rg with no path');
  });

  gateCase('a shell segment that only reads the target is not a search', () => {
    assertScopeDenied(scopeEdit('src/payment.py', scopeTurn(...bashSearch('toolu_m1g', 'ls src/payment.py'))), 'ls target');
    assertScopeDenied(scopeEdit('src/payment.py', scopeTurn(...bashSearch('toolu_m1h', 'grep -n . src/payment.py'))), 'grep . target');
    assertScopeDenied(scopeEdit('src/payment.py', scopeTurn(...bashSearch('toolu_m1i', 'grep -n payment ./src/payment.py'))), 'grep stem in target only');
    assertScopeDenied(scopeEdit('src/payment.py', scopeTurn(...searchRecords('toolu_m1j', 'Grep', { pattern: 'payment', path: 'src/payment.py' }))), 'Grep path = target');
  });

  gateCase('Grep/Glob/LS with an explicit path only credit targets inside it', () => {
    assertScopeDenied(scopeEdit('src/payment.py', scopeTurn(...searchRecords('toolu_m1k', 'Grep', { pattern: 'payment', path: '/nonexistent/elsewhere' }))), 'Grep elsewhere');
    assertScopeDenied(scopeEdit('src/payment.py', scopeTurn(...searchRecords('toolu_m1l', 'Glob', { pattern: 'payment.md', path: '/nonexistent-dir' }))), 'Glob elsewhere');
    assertScopeDenied(scopeEdit('src/payment.py', scopeTurn(...searchRecords('toolu_m1m', 'Grep', { pattern: 'TODO', path: 'x', glob: 'src/payments/**' }))), 'glob in another directory');
    assertScopeDenied(scopeEdit('src/payment.py', scopeTurn(...searchRecords('toolu_m1n', 'Glob', { pattern: 'lib/**/payment*' }))), 'Glob prefix elsewhere');
    assertScopeDenied(scopeEdit('src/payment.py', scopeTurn(...searchRecords('toolu_m1o', 'Glob', { pattern: 'payment.md', path: scopeRoot }))), 'file lookup in an ancestor dir');
    assertScopeDenied(scopeEdit('src/payment.py', scopeTurn(...searchRecords('toolu_m1p', 'Glob', { pattern: 'src/payment.py' }))), 'lookup of the target itself');
    assertScopeCredited(scopeEdit('src/payment.py', scopeTurn(...searchRecords('toolu_m1q', 'Glob', { pattern: 'src/payment.md' }))), 'file lookup beside the target');
  });

  gateCase('same-batch searches are excluded when the pending call cannot be located', () => {
    const edit = scopePath(`src/payment.py`);
    const sameBatch = writeTranscript(
      [humanRecord('fix'), assistantMessage('g1', 'msg_B', 'Grep', { pattern: 'payment' }), assistantMessage('e1', 'msg_B', 'Edit', { file_path: edit }), toolResult('g1')],
      { pending: false }
    );
    assertScopeDenied(scopeEdit('src/payment.py', sameBatch), 'no tool_use_id: newest message excluded');
    assertScopeDenied(scopeEdit('src/payment.py', sameBatch, { tool_use_id: 'e1' }), 'tool_use_id located');
    const notYet = writeTranscript([humanRecord('fix'), assistantMessage('g2', 'msg_C', 'Grep', { pattern: 'payment' }), toolResult('g2')], { pending: false });
    assertScopeDenied(scopeEdit('src/payment.py', notYet, { tool_use_id: 'e2' }), 'tool_use_id not in transcript yet');
    const noMsgId = writeTranscript([
      humanRecord('fix'),
      { type: 'assistant', uuid: nextUuid(), message: { role: 'assistant', content: [{ type: 'tool_use', id: 'g3', name: 'Grep', input: { pattern: 'payment' } }] } },
      toolResult('g3')
    ]);
    assertScopeDenied(scopeEdit('src/payment.py', noMsgId), 'search without message.id');
    const earlier = writeTranscript(
      [humanRecord('fix'), assistantMessage('g4', 'msg_D', 'Grep', { pattern: 'payment' }), toolResult('g4'), assistantMessage('e4', 'msg_E', 'Edit', { file_path: edit })],
      { pending: false }
    );
    assertScopeCredited(scopeEdit('src/payment.py', earlier), 'no tool_use_id: search in an older message still credits');
  });

  gateCase('a boundary without uuid yields a hashed turn id; siblings do not cross turns', () => {
    const { scanCurrentTurn } = loadDirectHook();
    const noUuid = text => ({ type: 'user', message: { role: 'user', content: text } });
    const t1 = writeTranscript([noUuid('turn one')], { pending: false });
    const t2 = writeTranscript([noUuid('turn one'), noUuid('turn TWO new request')], { pending: false });
    const id1 = scanCurrentTurn(t1).turnId;
    const id2 = scanCurrentTurn(t2).turnId;
    assert.ok(/^h:[0-9a-f]{16}$/.test(id1), `hashed turn id, got ${id1}`);
    assert.notStrictEqual(id1, id2, 'different boundary lines, different turn ids');
    const w1 = scopeWrite('src/hashed-turn/hhh1.py', t1, { tool_use_id: null, session_id: 'hashed-turn-session' });
    assert.strictEqual(w1.decision, 'deny', w1.result.stdout);
    const w2 = scopeWrite('src/hashed-turn/hhh2.py', t2, { tool_use_id: null, session_id: 'hashed-turn-session' });
    assert.strictEqual(w2.decision, 'deny', `turn 2 sibling must be denied: ${w2.result.stdout}`);
  });

  gateCase('compaction is a turn boundary', () => {
    const pre = [humanRecord('orig task'), ...searchRecords('toolu_l2a', 'Grep', { pattern: 'payment' })];
    const summary = { type: 'user', uuid: nextUuid(), isCompactSummary: true, message: { role: 'user', content: 'Summary: ...' } };
    assertScopeDenied(scopeEdit('src/payment.py', writeTranscript([...pre, { type: 'system', subtype: 'compact_boundary' }, summary])), 'summary');
    assertScopeDenied(scopeEdit('src/payment.py', writeTranscript([...pre, { type: 'system', uuid: 'cb-1', subtype: 'compact_boundary' }])), 'boundary only');
    const { scanCurrentTurn } = loadDirectHook();
    assert.strictEqual(scanCurrentTurn(writeTranscript([...pre, summary], { pending: false })).turnId, summary.uuid, 'summary uuid is the turn id');
  });

  gateCase('error results are recognised without a boolean is_error', () => {
    const errored = extra => scopeTurn(toolUseRecord('toolu_l3', 'Grep', { pattern: 'payment' }), toolResult('toolu_l3', extra));
    assertScopeDenied(scopeEdit('src/payment.py', errored({ is_error: 'true', content: 'Error: denied' })), 'is_error "true"');
    assertScopeDenied(scopeEdit('src/payment.py', errored({ content: '<tool_use_error>Permission denied</tool_use_error>' })), 'string content');
    assertScopeDenied(scopeEdit('src/payment.py', errored({ content: [{ type: 'text', text: '  <tool_use_error>x</tool_use_error>' }] })), 'text block');
  });

  gateCase('a tool_use id seen more than once in the turn never qualifies', () => {
    const t = writeTranscript([
      humanRecord('x'),
      assistantMessage('g', 'msg_1', 'Grep', { pattern: 'unrelated' }),
      toolResult('g'),
      assistantMessage('g', 'msg_2', 'Grep', { pattern: 'payment' })
    ]);
    assertScopeDenied(scopeEdit('src/payment.py', t), 'duplicate id');
  });

  gateCase('a cd anywhere in the turn disables shell directory credit (stem counts with a known base)', () => {
    const t = scopeTurn(...bashSearch('toolu_l7a', 'cd src'), ...bashSearch('toolu_l7b', 'ls handlers'));
    assertScopeDenied(scopeWrite('handlers/new_mod.py', t), 'cd then ls handlers');
    const control = scopeTurn(...bashSearch('toolu_l7c', 'ls handlers'));
    assertScopeCredited(scopeWrite('handlers/new_mod2.py', control), 'control without cd');
    const stem = scopeTurn(...bashSearch('toolu_l7d', 'cd src'), ...bashSearch('toolu_l7e', 'rg -n payment ..'));
    assertScopeDenied(scopeEdit('src/payment.py', stem), 'relative operand after a cd in another call');
    const absolute = scopeTurn(...bashSearch('toolu_l7f', 'cd src'), ...bashSearch('toolu_l7g', `rg -n payment ${scopeRootSh}/src`));
    assertScopeCredited(scopeEdit('src/payment.py', absolute), 'stem after cd with an absolute operand');
  });

  gateCase('documented search forms still credit', () => {
    assertScopeCredited(scopeEdit('src/payment.py', scopeTurn(...bashSearch('toolu_p1', 'rg -n payment src'))), 'rg -n payment src');
    assertScopeCredited(scopeEdit('src/payment_service.py', scopeTurn(...searchRecords('toolu_p2', 'Grep', { pattern: 'payment_service', path: 'src' }))), 'Grep path src');
    assertScopeCredited(scopeWrite('src/handlers/new_handler.py', scopeTurn(...searchRecords('toolu_p3', 'Glob', { pattern: 'src/handlers/*.py' }))), 'Glob dir');
    assertScopeCredited(scopeWrite('src/handlers/ls_new.py', scopeTurn(...searchRecords('toolu_p4', 'LS', { path: 'src/handlers' }))), 'LS dir');
    assertScopeCredited(scopeWrite('src/handlers/x_new.py', scopeTurn(...bashSearch('toolu_p5', 'find src/handlers -name "*.py"'))), 'find dir');
    assertScopeCredited(scopeEdit('src/auth.py', scopeTurn(...bashSearch('toolu_p6', 'grep -r . -e auth'))), '-e supplies the pattern');
    assertScopeCredited(scopeWrite('src/handlers/grep_new.py', scopeTurn(...bashSearch('toolu_p7', 'grep -rn --include "*.py" TODO src/handlers/'))), 'grep dir');
  });

  gateCase('a shell search only credits targets inside what it searched', () => {
    const edit = (id, command) => scopeEdit('src/payment.py', scopeTurn(...bashSearch(id, command)));
    assertScopeDenied(edit('toolu_n1a', 'grep -rn payment /usr/share/doc'), 'grep -rn outside the project');
    assertScopeDenied(edit('toolu_n1b', 'rg payment docs'), 'rg in another directory');
    assertScopeDenied(edit('toolu_n1c', 'find /etc -name payment'), 'find outside the project');
    assertScopeDenied(edit('toolu_n1d', 'rg payment < /etc/hostname'), 'rg reading stdin via <');
    assertScopeDenied(edit('toolu_n1e', 'rg payment </etc/hostname'), 'rg reading stdin via <file');
    assertScopeDenied(edit('toolu_n1f', 'grep -rn payment 0< /etc/hostname'), 'grep with only an input redirection');
    assertScopeDenied(edit('toolu_n1g', 'rg payment</etc/hostname'), 'redirection glued to the pattern');
    assertScopeDenied(edit('toolu_n1h', 'fd payment /etc'), 'fd outside the project');
    assertScopeDenied(edit('toolu_n1i', 'cd /elsewhere && rg payment src'), 'relative operand after an absolute cd');
    assertScopeDenied(edit('toolu_n1j', 'git grep -n payment -- docs'), 'git grep limited to another directory');
    assertScopeDenied(
      scopeEdit('src/payment.py', scopeTurn(...searchRecords('toolu_n1k', 'PowerShell', { command: 'Select-String -Path docs/*.md -Pattern payment' }))),
      'Select-String -Path in another directory'
    );
  });

  gateCase('scoped shell searches still credit (positive controls)', () => {
    const edit = (id, command) => scopeEdit('src/payment.py', scopeTurn(...bashSearch(id, command)));
    assertScopeCredited(edit('toolu_n1p1', 'rg -n payment src'), 'rg -n payment src');
    assertScopeCredited(edit('toolu_n1p2', 'grep -rn payment .'), 'grep -rn payment . (cwd scope)');
    assertScopeCredited(edit('toolu_n1p3', 'find src -name "payment*"'), 'find src');
    assertScopeCredited(edit('toolu_n1p4', 'rg payment'), 'rg with no operand searches the cwd');
    assertScopeCredited(edit('toolu_n1p5', 'find . -name "payment*"'), 'find .');
    assertScopeCredited(edit('toolu_n1p6', 'rg payment docs src'), 'one of several operands contains the target');
    assertScopeCredited(edit('toolu_n1p7', 'rg -n payment src/payment.py src/auth.py'), 'the target itself among other operands');
    assertScopeCredited(edit('toolu_n1p8', 'rg payment src < /dev/null'), 'operand before an input redirection');
    assertScopeCredited(edit('toolu_n1p9', `cd ${scopeRootSh} && rg payment src`), 'relative operand after an absolute cd into the project');
    assertScopeCredited(edit('toolu_n1p10', `grep -rn payment ${scopeRootSh}/src`), 'absolute operand');
    assertScopeCredited(edit('toolu_n1p11', 'rg payment src/*.py'), 'glob operand scopes to its literal directory');
  });

  gateCase('no credit-scoping output carries permissionDecision "allow"', () => {
    assert.ok(scopeOutputs.length > 30, 'collected outputs');
    for (const stdout of scopeOutputs) {
      const output = parseOutput(stdout);
      const decision = output && output.hookSpecificOutput ? output.hookSpecificOutput.permissionDecision : undefined;
      assert.notStrictEqual(decision, 'allow', stdout);
    }
  });

  // --- Sibling collapse keyed by target class ---
  // The project root sits under an ancestor `tests/` on purpose: `src/a.py` must still be code.
  const classBase = fs.realpathSync(fs.mkdtempSync(path.join(tmpRoot, 'gateguard-class-')));
  const classRoot = path.join(classBase, 'tests', 'proj');
  fs.mkdirSync(classRoot, { recursive: true });
  const classEnv = { CLAUDE_PROJECT_DIR: classRoot, CLAUDE_TRANSCRIPT_PATH: '' };
  const classOutputs = [];
  const classPath = rel => `${classRoot}/${rel}`;
  const classRun = (toolName, toolInput, transcriptPath) => {
    const payload = { tool_name: toolName, tool_input: toolInput, cwd: classRoot };
    if (transcriptPath !== undefined) payload.transcript_path = transcriptPath;
    if (pendingToolUseIds.has(transcriptPath)) payload.tool_use_id = pendingToolUseIds.get(transcriptPath);
    const result = runHook(payload, classEnv);
    classOutputs.push(result.stdout);
    const output = parseOutput(result.stdout);
    const hso = output && output.hookSpecificOutput ? output.hookSpecificOutput : {};
    return { result, decision: hso.permissionDecision, context: hso.additionalContext || '', reason: hso.permissionDecisionReason || '' };
  };
  const classWrite = (rel, t) => classRun('Write', { file_path: classPath(rel), content: 'x' }, t);
  const classEdit = (rel, t) => classRun('Edit', { file_path: classPath(rel), old_string: 'a', new_string: 'b' }, t);
  const scaffoldTurn = () => writeTranscript([humanRecord('scaffold it')]);
  const classGateKey = (cls, relDir) => `${cls}\u0000${stateKey(`${classRoot}/${relDir}`)}`;
  const assertClassDenied = (out, label) => {
    assert.strictEqual(out.decision, 'deny', `${label}: expected deny, got ${out.result.stdout}`);
    assert.ok(!out.context.includes('Sibling of'), `${label}: no sibling note`);
  };
  const assertClassSibling = (out, label) => {
    assert.notStrictEqual(out.decision, 'deny', `${label}: must not deny (${out.result.stdout})`);
    assert.ok(out.context.includes('[Fact-Forcing Gate] Sibling of '), `${label}: sibling note expected, got ${out.result.stdout}`);
  };

  gateCase('a code denial does not collapse other classes in the same dir', () => {
    const t = scaffoldTurn();
    assertClassDenied(classWrite('src/newmod.py', t), 'code first');
    assertClassDenied(classWrite('src/.env.production', t), 'config sibling of code');
    assertClassDenied(classWrite('src/newmod.test.py', t), 'test sibling of code');
    assertClassDenied(classWrite('src/README.md', t), 'prose sibling of code');
    assertClassDenied(classWrite('src/settings.yaml', t), 'config sibling of code');
    assertClassDenied(classWrite('src/.env.local', t), '.env sibling of code');
    assertClassSibling(classWrite('src/other.py', t), 'code sibling of code still collapses');
    assertClassSibling(classWrite('src/other.test.py', t), 'test sibling of test collapses');
    assertClassSibling(classWrite('src/CHANGES.md', t), 'prose sibling of prose collapses');
  });

  gateCase('harness, instruction and config paths never collapse', () => {
    const t = scaffoldTurn();
    assertClassDenied(classWrite('.github/notes.md', t), '.github prose');
    assertClassDenied(classWrite('.github/more.md', t), '.github prose never collapses');
    const instructionOut = classWrite('.github/copilot-instructions.md', t);
    assertClassDenied(instructionOut, 'copilot-instructions');
    assert.ok(instructionOut.reason.includes('harness/loader'), 'copilot-instructions.md is instruction class');
    assertClassDenied(classWrite('READMEX.md', t), 'root prose');
    assertClassDenied(classWrite('AGENT.md', t), 'AGENT.md');
    assertClassDenied(classWrite('.cursorrules', t), '.cursorrules');
    assertClassDenied(classWrite('.windsurfrules', t), '.windsurfrules');
    assertClassDenied(classWrite('.mcp.json', t), '.mcp.json');
    assertClassSibling(classWrite('NOTES.md', t), 'ordinary prose sibling at root still collapses');
    assertClassDenied(classWrite('.claude/hooks/a.sh', t), '.claude/hooks');
    assertClassDenied(classWrite('.claude/hooks/evil.sh', t), '.claude/hooks sibling');
    assertClassDenied(classWrite('.husky/pre-commit', t), '.husky');
    assertClassDenied(classWrite('.husky/pre-push', t), '.husky sibling');
    assertClassDenied(classWrite('config/app.yaml', t), 'config');
    assertClassDenied(classWrite('config/db.yaml', t), 'config sibling');
    assertClassDenied(classWrite('lib/.hidden.js', t), 'dotfile');
    assertClassDenied(classWrite('lib/.other.js', t), 'dotfile sibling');
    const gates = readState().dir_gates || {};
    for (const key of Object.keys(gates)) {
      assert.ok(!/\.github|\.claude|\.husky|^config|^instruction/.test(key), `no gate recorded for ${JSON.stringify(key)}`);
    }
  });

  gateCase('classification uses the project-relative path (ancestor tests/ dir, worktrees)', () => {
    const t = scaffoldTurn();
    const code = classWrite('src/a.py', t);
    assertClassDenied(code, 'code');
    assert.ok(code.reason.includes('Name the file(s) and line(s) that will call this new file'), 'code questions');
    const state = readState();
    assert.deepStrictEqual(state.denials_by_class, { code: 1 }, 'counter uses the same class as the questions');
    assert.ok(state.dir_gates[classGateKey('code', 'src')], `gate key uses the same class: ${JSON.stringify(Object.keys(state.dir_gates))}`);
    assert.ok(classEdit('lib/b.py', t).reason.includes('List the call sites in this file or its module'), 'Edit code questions');
    fs.mkdirSync(classPath('.claude/worktrees/feat-x'), { recursive: true });
    fs.writeFileSync(classPath('.claude/worktrees/feat-x/.git'), 'gitdir: ../../../.git/worktrees/feat-x\n');
    const wt = classWrite('.claude/worktrees/feat-x/docs/guide.md', t);
    assertClassDenied(wt, 'worktree prose');
    assert.ok(wt.reason.includes('supersedes or duplicates'), `worktree .md is prose: ${wt.reason}`);
    assertClassSibling(classWrite('.claude/worktrees/feat-x/docs/guide2.md', t), 'worktree prose sibling');
    const wtHook = classWrite('.claude/worktrees/feat-x/.claude/hooks/x.md', t);
    assertClassDenied(wtHook, 'worktree harness');
    assert.ok(wtHook.reason.includes('which harness loads this file'), `worktree .claude/hooks/*.md is instruction: ${wtHook.reason}`);
    assertClassDenied(classWrite('.claude/worktrees/feat-x/.claude/hooks/y.md', t), 'worktree harness sibling');
  });

  gateCase('sibling note wording and class-prefixed gate key', () => {
    const t = scaffoldTurn();
    assertClassDenied(classWrite('src/w/one.js', t), 'first');
    const out = classWrite('src/w/two.js', t);
    assertClassSibling(out, 'sibling');
    assert.strictEqual(
      out.context,
      `[Fact-Forcing Gate] Sibling of ${classRoot}/src/w/one.js (gated earlier at denial #1 this session); proceeding without a repeat denial.`
    );
    const gates = readState().dir_gates;
    assert.deepStrictEqual(Object.keys(gates), [classGateKey('code', 'src/w')]);
  });

  gateCase('a future `at` or a zero ordinal is never honored', () => {
    const now = Date.now();
    const gate = (at, ordinal, turn = null) => ({ turn, at, first: '/forged.js', ordinal });
    writeState({
      checked: [],
      last_active: now,
      dir_gates: {
        [classGateKey('code', 'src/fut')]: gate(now + 3600 * 1000, 1),
        [classGateKey('code', 'src/zero')]: gate(now - 1000, 0),
        [classGateKey('code', 'src/ok')]: gate(now - 1000, 1)
      }
    });
    assertClassDenied(classWrite('src/fut/a.js'), 'future at (no turn)');
    assertClassDenied(classWrite('src/zero/a.js'), 'ordinal 0');
    assertClassSibling(classWrite('src/ok/a.js'), 'control: valid gate still matches');
    const human = humanRecord('x');
    const t = writeTranscript([human]);
    writeState({ checked: [], last_active: now, dir_gates: { [classGateKey('code', 'src/futt')]: gate(now + 3600 * 1000, 1, human.uuid) } });
    assertClassDenied(classWrite('src/futt/a.js', t), 'future at (same turn)');
  });

  gateCase('old-shape dir_gates keys (no class prefix) are ignored and dropped', () => {
    const now = Date.now();
    writeState({ checked: [], last_active: now, dir_gates: { [`${classRoot}/src/legacy`]: { turn: null, at: now - 1000, first: 'forged', ordinal: 1 } } });
    assertClassDenied(classWrite('src/legacy/a.js'), 'old-shape gate ignored');
    const keys = Object.keys(readState().dir_gates);
    assert.deepStrictEqual(keys, [classGateKey('code', 'src/legacy')], 'old-shape key dropped, new key recorded');
    writeState({ checked: [], last_active: now, dir_gates: { [`bogus\u0000${classRoot}/src/b`]: { turn: null, at: now - 1000, first: 'x', ordinal: 1 } } });
    assertClassDenied(classWrite('src/b/a.js'), 'unknown class prefix ignored');
  });

  gateCase('prototype keys in state are rejected and never pollute', () => {
    const now = Date.now();
    const legacy = classGateKey('code', 'src/pp');
    fs.mkdirSync(stateDir, { recursive: true });
    fs.writeFileSync(
      stateFile,
      '{"checked":[],"last_active":' + now + ',"dir_gates":{"__proto__":{"turn":null,"at":1,"first":"x","ordinal":1},' +
        '"constructor":{"turn":null,"at":' + (now - 1000) + ',"first":"x","ordinal":1},' +
        '"prototype":{"turn":null,"at":' + (now - 1000) + ',"first":"x","ordinal":1},' +
        JSON.stringify(legacy) + ':{"turn":null,"at":' + (now - 1000) + ',"first":"forged","ordinal":"NaN"}},' +
        '"denials_by_class":{"__proto__":{"polluted":1},"constructor":5,"prototype":4,"code":7},' +
        '"credited_by_class":{"constructor":2},"sibling_allows":0}',
      'utf8'
    );
    assertClassDenied(classWrite('src/pp/a.js'), 'NaN ordinal gate not honored');
    assert.strictEqual({}.polluted, undefined, 'Object.prototype not polluted');
    const raw = fs.readFileSync(stateFile, 'utf8');
    const state = JSON.parse(raw);
    for (const field of ['dir_gates', 'denials_by_class', 'credited_by_class']) {
      for (const bad of ['__proto__', 'constructor', 'prototype']) {
        assert.ok(!Object.prototype.hasOwnProperty.call(state[field], bad), `${field} drops ${bad}`);
      }
    }
    assert.strictEqual(state.denials_by_class.code, 8, 'code counter incremented from 7');
    assert.deepStrictEqual(state.credited_by_class, {});
  });

  gateCase('second writes into dot-directories are denied', () => {
    const t = scaffoldTurn();
    for (const [a, b] of [
      ['.devcontainer/a.sh', '.devcontainer/post-create.sh'],
      ['.githooks/a', '.githooks/pre-commit'],
      ['.kiro/steering/a.md', '.kiro/steering/b.md'],
      ['.clinerules/a.md', '.clinerules/b.md'],
      ['.idea/a.xml', '.idea/run.xml'],
      ['.continue/prompts/a.prompt', '.continue/prompts/b.prompt']
    ]) {
      assertClassDenied(classWrite(a, t), `${a} first`);
      assertClassDenied(classWrite(b, t), `${b} second`);
    }
    assert.deepStrictEqual(Object.keys(readState().dir_gates || {}), [], 'no dir gate recorded for any dot-directory');
  });

  gateCase('a symlinked directory is screened (and keyed) by its real location', () => {
    const t = scaffoldTurn();
    fs.mkdirSync(classPath('.claude/hooks'), { recursive: true });
    fs.mkdirSync(classPath('src/realdir'), { recursive: true });
    try {
      fs.symlinkSync(classPath('.claude/hooks'), classPath('src/tools'), 'dir');
      fs.symlinkSync(classPath('src/realdir'), classPath('src/aliasdir'), 'dir');
    } catch (e) {
      if (process.platform === 'win32' && e.code === 'EPERM') return; // no symlink privilege
      throw e;
    }
    assertClassDenied(classWrite('src/tools/a.sh', t), 'first write through the symlink');
    assertClassDenied(classWrite('src/tools/evil.sh', t), 'second write lands in .claude/hooks');
    assertClassDenied(classWrite('src/realdir/one.js', t), 'real dir first');
    assertClassSibling(classWrite('src/aliasdir/two.js', t), 'alias of the same real dir shares its gate');
    assert.deepStrictEqual(Object.keys(readState().dir_gates), [classGateKey('code', 'src/realdir')], 'gate keyed by the real directory');
  });

  gateCase('a .claude/worktrees/<name>/ prefix without a .git is not stripped', () => {
    const t = scaffoldTurn();
    fs.mkdirSync(classPath('.claude/worktrees/fake/src'), { recursive: true });
    assertClassDenied(classWrite('.claude/worktrees/fake/src/a.py', t), 'fake worktree first');
    assertClassDenied(classWrite('.claude/worktrees/fake/src/b.py', t), 'fake worktree sibling');
    assertClassDenied(classWrite('.claude/worktrees/fake/a.sh', t), 'fake worktree root first');
    assertClassDenied(classWrite('.claude/worktrees/fake/statusline.sh', t), 'fake worktree root sibling');
    const md = classWrite('.claude/worktrees/fake/docs/g.md', t);
    assertClassDenied(md, 'fake worktree .md');
    assert.ok(md.reason.includes('which harness loads this file') || md.reason.includes('harness/loader'), `stays instruction: ${md.reason}`);
  });

  gateCase('no class-keyed collapse output carries permissionDecision "allow"', () => {
    assert.ok(classOutputs.length > 30, 'collected outputs');
    for (const stdout of classOutputs) {
      const output = parseOutput(stdout);
      const decision = output && output.hookSpecificOutput ? output.hookSpecificOutput.permissionDecision : undefined;
      assert.notStrictEqual(decision, 'allow', stdout);
    }
  });

  // --- Opt-in session cap on first-touch denials ---
  const capEnvName = 'GATEGUARD_FACT_FORCE_MAX_DENIALS';
  const capOutputs = [];
  const capRun = (toolName, toolInput, transcriptPath, cap) => {
    const out = projectRun(toolName, toolInput, transcriptPath, cap === undefined ? {} : { [capEnvName]: cap });
    capOutputs.push(out.result.stdout);
    return out;
  };
  const capAssertPassThrough = (out, toolName, label) => {
    const output = parseOutput(out.result.stdout);
    assert.ok(output, `${label}: valid JSON`);
    assert.ok(!output.hookSpecificOutput, `${label}: pass-through expected, got ${out.result.stdout}`);
    assert.strictEqual(output.tool_name, toolName, `${label}: pass-through preserves input`);
  };
  const capWarning = value =>
    `[Fact-Forcing Gate] ignoring malformed ${capEnvName}=${value}; the denial cap is not active.`;
  // Same-process run with stderr captured; restores the env var that loadDirectHook sets.
  const capInProcess = (fn) => {
    const saved = process.env[capEnvName];
    const originalStderrWrite = process.stderr.write.bind(process.stderr);
    const captured = [];
    process.stderr.write = chunk => {
      const s = typeof chunk === 'string' ? chunk : chunk.toString();
      if (s.includes(capEnvName)) captured.push(s.replace(/\n$/, ''));
      return true;
    };
    try {
      return fn(captured);
    } finally {
      process.stderr.write = originalStderrWrite;
      if (saved === undefined) delete process.env[capEnvName];
      else process.env[capEnvName] = saved;
    }
  };
  const capDirectEdit = (hook, file) =>
    parseOutput(hook.run(JSON.stringify({ tool_name: 'Edit', cwd: projectRoot, tool_input: { file_path: `${projectRoot}/${file}` } })).stdout);

  for (const malformed of ['3.9', '+3', 'abc', '-1', '3oops', '0x3', ' 3 oops', '99999999999999999999']) {
    gateCase(`malformed cap ${JSON.stringify(malformed)} warns once and leaves the gate uncapped`, () => {
      writeState({ checked: [], last_active: Date.now(), fact_force_denials: 9 });
      capInProcess(captured => {
        const hook = loadDirectHook({ ...projectEnv, [capEnvName]: malformed });
        const first = capDirectEdit(hook, 'src/cap-malformed-a.py');
        const second = capDirectEdit(hook, 'src/cap-malformed-b.py');
        assert.strictEqual(first.hookSpecificOutput.permissionDecision, 'deny', 'uncapped: first denied');
        assert.strictEqual(second.hookSpecificOutput.permissionDecision, 'deny', 'uncapped: second denied');
        assert.deepStrictEqual(captured, [capWarning(malformed.trim())], 'exactly one warning with the sanitized value');
      });
      assert.ok(!readState().cap_allows, 'no cap allow recorded');
    });
  }

  gateCase('a different malformed cap warns again; valid, empty and unset values never warn', () => {
    capInProcess(captured => {
      const hook = loadDirectHook({ ...projectEnv, [capEnvName]: 'abc' });
      capDirectEdit(hook, 'src/cap-warn-1.py');
      process.env[capEnvName] = 'xyz';
      capDirectEdit(hook, 'src/cap-warn-2.py');
      capDirectEdit(hook, 'src/cap-warn-3.py');
      assert.deepStrictEqual(captured, [capWarning('abc'), capWarning('xyz')]);
      process.env[capEnvName] = '50';
      capDirectEdit(hook, 'src/cap-warn-4.py');
      process.env[capEnvName] = '';
      capDirectEdit(hook, 'src/cap-warn-5.py');
      delete process.env[capEnvName];
      capDirectEdit(hook, 'src/cap-warn-6.py');
      assert.strictEqual(captured.length, 2, `no further warnings: ${JSON.stringify(captured)}`);
    });
  });

  gateCase('the warning value is sanitized and bounded', () => {
    capInProcess(captured => {
      const hook = loadDirectHook({ ...projectEnv, [capEnvName]: `3\u202e\u200b${'9'.repeat(200)}x` });
      capDirectEdit(hook, 'src/cap-warn-sanitize.py');
      assert.strictEqual(captured.length, 1, JSON.stringify(captured));
      assert.ok(!/[\u202e\u200b]/.test(captured[0]), 'no invisible characters');
      assert.ok(captured[0].length < 200, `bounded: ${captured[0].length}`);
    });
  });

  gateCase('a malformed cap also warns from the spawned hook (stderr), stdout still denies', () => {
    const out = capRun('Edit', { file_path: `${projectRoot}/src/cap-spawn.py` }, undefined, 'abc');
    assert.strictEqual(out.decision, 'deny');
    assert.ok(out.result.stderr.includes(capWarning('abc')), out.result.stderr);
  });

  gateCase('surrounding whitespace is trimmed (" 2 " caps at 2, no warning)', () => {
    writeState({ checked: [], last_active: Date.now(), fact_force_denials: 2 });
    const out = capRun('Edit', { file_path: `${projectRoot}/src/cap-trim.py` }, undefined, ' 2 ');
    capAssertPassThrough(out, 'Edit', 'trimmed cap');
    assert.ok(!out.result.stderr.includes(capEnvName), out.result.stderr);
  });

  gateCase('a cap pass marks the target checked, counts cap_allows, never counts a denial', () => {
    writeState({ checked: [], last_active: Date.now(), fact_force_denials: 2 });
    const a = `${projectRoot}/src/cap-counted-a.py`;
    capAssertPassThrough(capRun('Edit', { file_path: a }, undefined, '2'), 'Edit', 'first past cap');
    let state = readState();
    assert.strictEqual(state.cap_allows, 1, 'cap_allows counted');
    assert.strictEqual(state.fact_force_denials, 2, 'denials unchanged');
    assert.ok(state.checked.includes(stateKey(a)), 'cap-passed target marked checked');
    capAssertPassThrough(capRun('Edit', { file_path: a }, undefined, '2'), 'Edit', 'retry');
    assert.strictEqual(readState().cap_allows, 1, 'a retry of a checked target is not recounted');
    capAssertPassThrough(capRun('Write', { file_path: `${projectRoot}/src/cap-counted-b.py`, content: 'x' }, undefined, '2'), 'Write', 'second');
    state = readState();
    assert.strictEqual(state.cap_allows, 2);
    assert.strictEqual(state.fact_force_denials, 2);
  });

  gateCase('cap_allows loads from old or malformed state and survives later writes', () => {
    writeState({ checked: [], last_active: Date.now(), fact_force_denials: 1, cap_allows: 'garbage' });
    capRun('Edit', { file_path: `${projectRoot}/src/cap-old-a.py` }, undefined, '1');
    assert.strictEqual(readState().cap_allows, 1, 'malformed counter treated as zero');
    writeState({ ...readState(), cap_allows: 7 });
    capRun('Edit', { file_path: `${projectRoot}/src/cap-old-b.py` }, undefined, '1');
    assert.strictEqual(readState().cap_allows, 8, 'increments the persisted count');
    capRun('Edit', { file_path: `${projectRoot}/src/cap-old-c.py` });
    assert.strictEqual(readState().cap_allows, 8, 'kept across an unrelated state write');
  });

  gateCase('cap 0 passes the first new path without a denial', () => {
    capAssertPassThrough(capRun('Edit', { file_path: `${projectRoot}/src/cap-zero.py` }, undefined, '0'), 'Edit', 'cap 0');
    const state = readState();
    assert.ok(!state.fact_force_denials, 'no denial counted');
    assert.strictEqual(state.cap_allows, 1);
  });

  gateCase('credit and sibling allows run before the cap and do not consume it', () => {
    const t = writeTranscript([
      humanRecord('build the gadget and fix the widget factory'),
      ...searchRecords('toolu_cap_g1', 'Grep', { pattern: 'widget_factory', path: projectRoot }),
      ...searchRecords('toolu_cap_g2', 'Grep', { pattern: 'gadget_maker', path: projectRoot })
    ]);
    const credited = capRun('Edit', { file_path: `${projectRoot}/src/widget_factory.py`, old_string: 'a', new_string: 'b' }, t, '1');
    assert.ok(credited.context.includes('Prior search seen in this turn'), credited.result.stdout);
    assert.ok(!readState().fact_force_denials, 'credit consumes no denial');
    const first = capRun('Write', { file_path: `${projectRoot}/src/capgen/g0.js`, content: 'x' }, t, '1');
    assert.strictEqual(first.decision, 'deny', 'the one denial the cap allows');
    const sibling = capRun('Write', { file_path: `${projectRoot}/src/capgen/g1.js`, content: 'x' }, t, '1');
    assert.ok(sibling.context.includes('[Fact-Forcing Gate] Sibling of '), `sibling note, not a cap pass: ${sibling.result.stdout}`);
    const creditedAfterCap = capRun('Edit', { file_path: `${projectRoot}/src/gadget_maker.py`, old_string: 'a', new_string: 'b' }, t, '1');
    assert.ok(creditedAfterCap.context.includes('Prior search seen in this turn'), 'credit still wins once the cap is reached');
    let state = readState();
    assert.strictEqual(state.fact_force_denials, 1);
    assert.strictEqual(state.sibling_allows, 1);
    assert.strictEqual(state.fact_force_credited, 2);
    assert.ok(!state.cap_allows, 'no cap pass yet');
    const capped = capRun('Edit', { file_path: `${projectRoot}/src/unrelated_module.py`, old_string: 'a', new_string: 'b' }, t, '1');
    capAssertPassThrough(capped, 'Edit', 'uncredited target past the cap');
    state = readState();
    assert.strictEqual(state.cap_allows, 1);
    assert.strictEqual(state.fact_force_denials, 1);
  });

  gateCase('MultiEdit past the cap passes every entry and counts each', () => {
    writeState({ checked: [], last_active: Date.now(), fact_force_denials: 1 });
    const files = ['src/cap-multi-a.py', 'src/cap-multi-b.py', 'src/cap-multi-c.py'].map(f => `${projectRoot}/${f}`);
    const out = capRun('MultiEdit', { edits: files.map(file_path => ({ file_path, old_string: 'a', new_string: 'b' })) }, undefined, '1');
    capAssertPassThrough(out, 'MultiEdit', 'MultiEdit past cap');
    const state = readState();
    assert.strictEqual(state.cap_allows, 3);
    assert.strictEqual(state.fact_force_denials, 1);
    for (const f of files) assert.ok(state.checked.includes(stateKey(f)), `${f} checked`);
  });

  gateCase('destructive and routine Bash stay gated once the cap is reached', () => {
    writeState({ checked: [], last_active: Date.now(), fact_force_denials: 5 });
    const env = { ...projectEnv, [capEnvName]: '0' };
    const destructive = parseOutput(runBashHook({ tool_name: 'Bash', tool_input: { command: 'rm -rf build' } }, env).stdout);
    assert.strictEqual(destructive.hookSpecificOutput.permissionDecision, 'deny', 'destructive gate unchanged');
    const routine = parseOutput(runBashHook({ tool_name: 'Bash', tool_input: { command: 'npm test' } }, env).stdout);
    assert.strictEqual(routine.hookSpecificOutput.permissionDecision, 'deny', 'routine gate unchanged');
    assert.ok(!readState().cap_allows, 'Bash never counts a cap pass');
  });

  gateCase('no cap output carries permissionDecision "allow"', () => {
    assert.ok(capOutputs.length > 10, `collected outputs: ${capOutputs.length}`);
    for (const stdout of capOutputs) {
      const output = parseOutput(stdout);
      const decision = output && output.hookSpecificOutput ? output.hookSpecificOutput.permissionDecision : undefined;
      assert.notStrictEqual(decision, 'allow', stdout);
    }
  });

  // --- Sensitive targets are never auto-passed ---
  const sensLine = 'Sensitive target: prior-search credit, sibling collapse, and the denial cap do not apply.';
  const sensTargets = [
    '.env', '.env.local', 'config/.env.production', 'certs/server.pem', 'certs/server.key', 'certs/client.p12',
    'certs/client.pfx', 'keys/id_rsa', 'keys/id_rsa.pub', 'keys/id_ed25519', 'keys/id_ecdsa', 'keys/id_dsa',
    '.netrc', 'home/.pgpass', 'config/credentials.json',
    'config/secrets.yaml', 'src/auth/login_flow.py', 'src/authn/token_check.py', 'src/authz/policy_rules.py',
    'src/security/hardening.py', 'src/secrets/vault_client.py', 'src/payment/charge_card.py',
    'src/payments/refund_flow.py', 'src/billing/invoice_maker.py', 'db/migrations/0001_initial.py',
    '.github/workflows/release.yml', 'SRC/Auth/Upper_Case.py'
  ];
  const sensOutputs = [];
  const sensRun = (toolName, toolInput, transcriptPath, env = {}) => {
    const out = projectRun(toolName, toolInput, transcriptPath, env);
    sensOutputs.push(out.result.stdout);
    return out;
  };
  const sensAbs = rel => `${projectRoot}/${rel}`;
  const sensDir = rel => path.posix.dirname(sensAbs(rel));
  const sensStem = rel => path.posix.basename(rel).replace(/\.[^.]*$/, '') || path.posix.basename(rel);
  const sensAssertDenied = (out, label) => {
    assert.strictEqual(out.decision, 'deny', `${label}: expected deny, got ${out.result.stdout}`);
    assert.ok(!out.context, `${label}: no credit/sibling note`);
    assert.ok(out.reason.includes(sensLine), `${label}: sensitive line expected: ${out.reason}`);
  };
  // Search evidence that credits a Write of a new file in `rel`'s directory, and an Edit of its stem.
  const sensCreditTranscript = (rel, n) => writeTranscript([
    humanRecord('update it'),
    ...searchRecords(`toolu_sens_ls_${n}`, 'LS', { path: sensDir(rel) }),
    ...searchRecords(`toolu_sens_gr_${n}`, 'Grep', { pattern: sensStem(rel), path: projectRoot }),
    ...searchRecords(`toolu_sens_ctl_${n}`, 'LS', { path: sensAbs('src/plain') })
  ]);

  gateCase('each sensitive target is denied on first Write despite a qualifying search (control credited)', () => {
    sensTargets.forEach((rel, n) => {
      clearState();
      const t = sensCreditTranscript(rel, n);
      sensAssertDenied(sensRun('Write', { file_path: sensAbs(rel), content: 'x' }, t), `Write ${rel}`);
      const control = sensRun('Write', { file_path: sensAbs(`src/plain/ctl_${n}.py`), content: 'x' }, t);
      assert.ok(control.context.includes('Prior search seen in this turn'), `control credited for ${rel}: ${control.result.stdout}`);
      const state = readState();
      assert.strictEqual(state.fact_force_denials, 1, `${rel}: the denial counts`);
      assert.strictEqual(state.fact_force_credited, 1, `${rel}: only the control was credited`);
    });
  });

  gateCase('sensitive Edit and MultiEdit targets are denied despite a stem search', () => {
    const t = writeTranscript([
      humanRecord('fix the billing'),
      ...searchRecords('toolu_sens_e1', 'Grep', { pattern: 'invoice_maker|login_flow|plain_helper', path: projectRoot })
    ]);
    sensAssertDenied(sensRun('Edit', { file_path: sensAbs('src/billing/invoice_maker.py'), old_string: 'a', new_string: 'b' }, t), 'Edit');
    const multi = sensRun('MultiEdit', {
      edits: [
        { file_path: sensAbs('src/plain/plain_helper.py'), old_string: 'a', new_string: 'b' },
        { file_path: sensAbs('src/auth/login_flow.py'), old_string: 'a', new_string: 'b' }
      ]
    }, t);
    sensAssertDenied(multi, 'MultiEdit sensitive entry');
    const state = readState();
    assert.strictEqual(state.fact_force_credited, 1, 'the ordinary entry was credited');
    assert.strictEqual(state.fact_force_denials, 2);
  });

  gateCase('a sensitive new file never joins a same-dir sibling gate', () => {
    const t = writeTranscript([humanRecord('scaffold keys')]);
    assertDeniedNoSibling(sensRun('Write', { file_path: sensAbs('src/keys/loader.py'), content: 'x' }, t), 'ordinary first');
    for (const rel of ['src/keys/server.key', 'src/keys/server.pem', 'src/keys/credentials.py', 'src/keys/secrets.py', 'src/keys/id_rsa_test_fixture.py']) {
      sensAssertDenied(sensRun('Write', { file_path: sensAbs(rel), content: 'x' }, t), rel);
    }
    assertSibling(sensRun('Write', { file_path: sensAbs('src/keys/other.py'), content: 'x' }, t), 'ordinary sibling still collapses');
    assert.strictEqual(readState().sibling_allows, 1);
  });

  gateCase('a sensitive denial opens no sibling gate; sensitive dirs never collapse', () => {
    const t = writeTranscript([humanRecord('scaffold auth')]);
    sensAssertDenied(sensRun('Write', { file_path: sensAbs('src/vault/api.key'), content: 'x' }, t), 'sensitive first');
    assertDeniedNoSibling(sensRun('Write', { file_path: sensAbs('src/vault/client.py'), content: 'x' }, t), 'ordinary after sensitive');
    sensAssertDenied(sensRun('Write', { file_path: sensAbs('src/auth/a.py'), content: 'x' }, t), 'auth first');
    sensAssertDenied(sensRun('Write', { file_path: sensAbs('src/auth/b.py'), content: 'x' }, t), 'auth second');
    const gates = Object.keys(readState().dir_gates || {});
    assert.ok(!gates.some(k => k.endsWith(stateKey(sensAbs('src/auth')))), `no auth gate: ${JSON.stringify(gates)}`);
    assert.deepStrictEqual(gates, [dirGateKey(sensAbs('src/vault'))], 'only the ordinary denial opened a gate');
  });

  gateCase('sensitive targets are denied after the denial cap is reached (and still count)', () => {
    writeState({ checked: [], last_active: Date.now(), fact_force_denials: 5 });
    const env = { GATEGUARD_FACT_FORCE_MAX_DENIALS: '1' };
    sensTargets.forEach((rel, n) => {
      const tool = n % 2 ? 'Edit' : 'Write';
      const input = tool === 'Edit' ? { file_path: sensAbs(rel), old_string: 'a', new_string: 'b' } : { file_path: sensAbs(rel), content: 'x' };
      sensAssertDenied(sensRun(tool, input, undefined, env), `${tool} ${rel} past cap`);
    });
    const multi = sensRun('MultiEdit', { edits: [
      { file_path: sensAbs('src/plain/capped.py'), old_string: 'a', new_string: 'b' },
      { file_path: sensAbs('src/payments/capped.py'), old_string: 'a', new_string: 'b' }
    ] }, undefined, env);
    sensAssertDenied(multi, 'MultiEdit sensitive entry past cap');
    const control = sensRun('Edit', { file_path: sensAbs('src/plain/also_capped.py'), old_string: 'a', new_string: 'b' }, undefined, env);
    assert.ok(!parseOutput(control.result.stdout).hookSpecificOutput, 'ordinary target passes the cap');
    const state = readState();
    assert.strictEqual(state.fact_force_denials, 5 + sensTargets.length + 1, 'every sensitive denial counts');
    assert.strictEqual(state.cap_allows, 2);
  });

  gateCase('the sensitive line also appears in condensed denials; ordinary denials are unchanged', () => {
    writeState({ checked: [], last_active: Date.now(), fact_force_denials: 9 });
    const condensed = sensRun('Edit', { file_path: sensAbs('src/auth/condensed.py'), old_string: 'a', new_string: 'b' });
    sensAssertDenied(condensed, 'condensed');
    assert.ok(condensed.reason.includes('(denial #10 this session)'), condensed.reason);
    clearState();
    const full = sensRun('Edit', { file_path: sensAbs('src/auth/full.py'), old_string: 'a', new_string: 'b' });
    sensAssertDenied(full, 'full');
    assert.ok(full.reason.includes(`${sensLine}\n\nPresent the facts, then retry the same operation.`), full.reason);
    clearState();
    const ordinary = sensRun('Edit', { file_path: sensAbs('src/author.py'), old_string: 'a', new_string: 'b' });
    assert.strictEqual(ordinary.decision, 'deny');
    assert.ok(!ordinary.reason.includes('Sensitive target'), 'segment-exact: author.py is ordinary');
    for (const rel of ['docs/authoring.md', 'lib/paymentutils.py']) {
      clearState();
      const t = writeTranscript([humanRecord('go'), ...searchRecords(`toolu_ord_${rel.length}`, 'LS', { path: sensDir(rel) })]);
      const out = sensRun('Write', { file_path: sensAbs(rel), content: 'x' }, t);
      assert.ok(out.context.includes('Prior search seen in this turn'), `${rel} is ordinary and credited: ${out.result.stdout}`);
    }
  });

  // --- A symlinked directory cannot launder a sensitive real location ---
  // symlinked/src/tools -> symlinked/src/auth (a real directory inside the project).
  const aliasReady = (() => {
    fs.mkdirSync(sensAbs('symlinked/src/auth'), { recursive: true });
    fs.writeFileSync(sensAbs('symlinked/src/auth/login_flow.py'), 'x');
    fs.mkdirSync(sensAbs('symlinked/src/plain'), { recursive: true });
    fs.writeFileSync(sensAbs('symlinked/src/plain/plain_login.py'), 'x');
    try {
      fs.symlinkSync(sensAbs('symlinked/src/auth'), sensAbs('symlinked/src/tools'), 'dir');
      return true;
    } catch (e) {
      if (process.platform === 'win32' && e.code === 'EPERM') return false; // no symlink privilege
      throw e;
    }
  })();
  const aliasEdit = (rel, t, env) => sensRun('Edit', { file_path: sensAbs(rel), old_string: 'a', new_string: 'b' }, t, env);
  const assertAliasCredited = (out, label) =>
    assert.ok(out.context.includes('Prior search seen in this turn'), `${label}: credit expected, got ${out.result.stdout}`);

  gateCase('an Edit through a symlink into auth/ is denied despite a crediting search (direct control credited)', () => {
    if (!aliasReady) return;
    const t = writeTranscript([
      humanRecord('fix login'),
      ...searchRecords('toolu_r1_g1', 'Grep', { pattern: 'login_flow|plain_login|new_login', path: projectRoot })
    ]);
    sensAssertDenied(aliasEdit('symlinked/src/tools/login_flow.py', t), 'Edit via the alias');
    sensAssertDenied(sensRun('Write', { file_path: sensAbs('symlinked/src/tools/new_login.py'), content: 'x' }, t), 'Write via the alias');
    assertAliasCredited(aliasEdit('symlinked/src/plain/plain_login.py', t), 'direct non-sensitive path');
    const state = readState();
    assert.strictEqual(state.fact_force_credited, 1);
    assert.strictEqual(state.fact_force_denials, 2);
  });

  gateCase('a new file through a symlink into auth/ never joins a same-turn sibling gate', () => {
    if (!aliasReady) return;
    const { human, transcript } = newTurn('scaffold handlers');
    const gate = { turn: human.uuid, at: Date.now() - 1000, first: 'seeded.py', ordinal: 1 };
    writeState({
      checked: [],
      last_active: Date.now(),
      fact_force_denials: 1,
      dir_gates: {
        [dirGateKey(sensAbs('symlinked/src/auth'))]: gate,
        [dirGateKey(sensAbs('symlinked/src/tools'))]: gate,
        [dirGateKey(sensAbs('symlinked/src/plain'))]: gate
      }
    });
    sensAssertDenied(sensRun('Write', { file_path: sensAbs('symlinked/src/tools/new_handler.py'), content: 'x' }, transcript), 'sibling via alias');
    assertSibling(sensRun('Write', { file_path: sensAbs('symlinked/src/plain/new_handler.py'), content: 'x' }, transcript), 'control sibling');
  });

  gateCase('an Edit through a symlink into auth/ is denied past the denial cap (control passes)', () => {
    if (!aliasReady) return;
    const env = { GATEGUARD_FACT_FORCE_MAX_DENIALS: '0' };
    sensAssertDenied(aliasEdit('symlinked/src/tools/login_flow.py', undefined, env), 'alias past cap 0');
    const control = aliasEdit('symlinked/src/plain/plain_login.py', undefined, env);
    assert.ok(!parseOutput(control.result.stdout).hookSpecificOutput, `control passes the cap: ${control.result.stdout}`);
  });

  gateCase('no sensitive output carries permissionDecision "allow"', () => {
    assert.ok(sensOutputs.length > 60, `collected outputs: ${sensOutputs.length}`);
    for (const stdout of sensOutputs) {
      const output = parseOutput(stdout);
      const decision = output && output.hookSpecificOutput ? output.hookSpecificOutput.permissionDecision : undefined;
      assert.notStrictEqual(decision, 'allow', stdout);
    }
  });

  // --- Read-only first shell command ---
  const roDecision = result => {
    const output = parseOutput(result.stdout);
    return output && output.hookSpecificOutput ? output.hookSpecificOutput.permissionDecision : undefined;
  };
  const roReason = result => {
    const output = parseOutput(result.stdout);
    return output && output.hookSpecificOutput ? String(output.hookSpecificOutput.permissionDecisionReason) : '';
  };
  const roBash = (command, extra = {}, env = {}) => runBashHook({ tool_name: 'Bash', tool_input: { command }, ...extra }, env);
  const roPs = command => runPowerShellHook({ tool_name: 'PowerShell', tool_input: { command } });

  gateCase('a read-only first Bash command passes without using the routine gate', () => {
    const first = roBash('ls -la src');
    assert.strictEqual(roDecision(first), undefined, first.stdout);
    assert.ok(!first.stdout.includes('permissionDecision'), first.stdout);
    const state = readState();
    assert.strictEqual(state.routine_readonly_passes, 1);
    assert.ok(!(state.checked || []).includes('__bash_session__'), 'routine gate must stay unchecked');
    const second = roBash('git status --short | head');
    assert.strictEqual(roDecision(second), undefined, second.stdout);
    assert.strictEqual(readState().routine_readonly_passes, 2);
    const routine = roBash('npm test');
    assert.strictEqual(roDecision(routine), 'deny');
    assert.ok(roReason(routine).includes('current user request'));
    assert.strictEqual(roDecision(roBash('npm test')), undefined, 'retry after the routine gate passes');
  });

  gateCase('read-only commands after the routine gate is checked are not counted', () => {
    writeState({ checked: ['__bash_session__'], last_active: Date.now() });
    assert.strictEqual(roDecision(roBash('ls')), undefined);
    assert.ok(!readState().routine_readonly_passes, 'no read-only pass counted once the gate is checked');
  });

  gateCase('a read-only first PowerShell command passes and the next cmdlet is still gated', () => {
    assert.strictEqual(roDecision(roPs('Get-ChildItem -Recurse -Filter *.js')), undefined);
    const routine = roPs('Get-Date');
    assert.strictEqual(roDecision(routine), 'deny');
    assert.ok(roReason(routine).includes('Before the first PowerShell command'));
  });

  gateCase('commands that write, substitute or run unknown programs still draw the routine gate', () => {
    for (const command of ['ls > out.txt', 'ls | tee out.txt', 'cat $(pwd)/a', 'find . -exec ls {} +', 'find . -name x -delete', 'git log | xargs echo', 'FOO=1 ls', 'sed -i s/a/b/ f', 'git commit -m x']) {
      clearState();
      const result = roBash(command);
      assert.strictEqual(roDecision(result), 'deny', `${command}: ${result.stdout}`);
      assert.ok(roReason(result).includes('current user request'), `${command}: routine gate expected`);
      assert.ok(!readState().routine_readonly_passes, `${command}: no read-only pass`);
    }
    for (const command of ['Get-ChildItem | Out-File a.txt', 'Get-Content a | Set-Content b', 'pwsh -Command Get-ChildItem', 'Get-Content $env:X']) {
      clearState();
      assert.strictEqual(roDecision(roPs(command)), 'deny', command);
    }
  });

  gateCase('destructive commands are gated before the read-only check', () => {
    for (const command of ['find . -name x -exec rm {} +', 'rm -rf build', 'git branch -D old']) {
      clearState();
      const result = roBash(command);
      assert.strictEqual(roDecision(result), 'deny', command);
      assert.ok(roReason(result).includes('Destructive command detected'), `${command}: destructive gate expected`);
    }
    clearState();
    const ps = roPs('Remove-Item -Recurse -Force C:/tmp/demo');
    assert.strictEqual(roDecision(ps), 'deny');
    assert.ok(roReason(ps).includes('Destructive command detected'));
  });

  gateCase('a read-only first command in a subagent passes and other commands stay gated', () => {
    assert.strictEqual(roDecision(roBash('pwd', { agent_id: 'agent-ro' })), undefined);
    const routine = roBash('npm test', { agent_id: 'agent-ro' });
    assert.strictEqual(roDecision(routine), 'deny');
    assert.ok(roReason(routine).includes('current user request'));
  });

  // --- Idle window follows the session key ---
  const idleEnvNoIds = { CLAUDE_SESSION_ID: '', ECC_SESSION_ID: '', CLAUDE_TRANSCRIPT_PATH: '' };
  const idleStateFiles = () => fs.readdirSync(stateDir).filter(f => f.startsWith('state-') && f.endsWith('.json'));
  const idleSeed = (fileName, ageMs) => {
    fs.mkdirSync(stateDir, { recursive: true });
    const file = path.join(stateDir, fileName);
    fs.writeFileSync(file, JSON.stringify({ checked: ['__bash_session__'], last_active: Date.now() - ageMs }), 'utf8');
    return file;
  };
  const HOUR = 60 * 60 * 1000;

  gateCase('state keyed by a session id survives two idle hours', () => {
    writeState({ checked: ['__bash_session__'], last_active: Date.now() - 2 * HOUR });
    assert.strictEqual(roDecision(roBash('npm test')), undefined);
  });

  gateCase('state keyed by a session id expires after eight idle hours', () => {
    writeState({ checked: ['__bash_session__'], last_active: Date.now() - 8 * HOUR - 60 * 1000 });
    assert.strictEqual(roDecision(roBash('npm test')), 'deny');
  });

  gateCase('state keyed by a transcript path survives two idle hours', () => {
    const transcript = path.join(stateDir, 'idle-session.jsonl');
    roBash('npm test', { transcript_path: transcript }, idleEnvNoIds);
    const [file] = idleStateFiles();
    assert.ok(/^state-tx-/.test(file), file);
    const state = JSON.parse(fs.readFileSync(path.join(stateDir, file), 'utf8'));
    fs.writeFileSync(path.join(stateDir, file), JSON.stringify({ ...state, last_active: Date.now() - 2 * HOUR }), 'utf8');
    assert.strictEqual(roDecision(roBash('npm test', { transcript_path: transcript }, idleEnvNoIds)), undefined);
  });

  gateCase('state keyed by the project fallback still expires after 30 idle minutes', () => {
    const env = { ...idleEnvNoIds, CLAUDE_PROJECT_DIR: path.join(stateDir, 'idle-project') };
    roBash('npm test', {}, env);
    const [file] = idleStateFiles();
    assert.ok(/^state-proj-/.test(file), file);
    idleSeed(file, 31 * 60 * 1000);
    assert.strictEqual(roDecision(roBash('npm test', {}, env)), 'deny');
  });

  gateCase('module-load pruning keeps session files for the long window and project files for the short one', () => {
    const age = (file, ms) => fs.utimesSync(file, new Date(Date.now() - ms), new Date(Date.now() - ms));
    const recentSession = idleSeed('state-recent-session.json', 0);
    const oldSession = idleSeed('state-old-session.json', 0);
    const recentTx = idleSeed(`state-tx-${'a'.repeat(24)}.json`, 0);
    const oldProj = idleSeed(`state-proj-${'b'.repeat(24)}.json`, 0);
    const oldTmp = path.join(stateDir, 'state-recent-session.json.tmp.1.abcd');
    fs.writeFileSync(oldTmp, '{}', 'utf8');
    age(recentSession, 2 * HOUR);
    age(recentTx, 2 * HOUR);
    age(oldSession, 17 * HOUR);
    age(oldProj, 61 * 60 * 1000);
    age(oldTmp, 61 * 60 * 1000);
    loadDirectHook();
    assert.ok(fs.existsSync(recentSession), 'session file inside the long window is kept');
    assert.ok(fs.existsSync(recentTx), 'transcript file inside the long window is kept');
    assert.ok(!fs.existsSync(oldSession), 'session file past the long window is pruned');
    assert.ok(!fs.existsSync(oldProj), 'project fallback file past the short window is pruned');
    assert.ok(!fs.existsSync(oldTmp), 'stale temp file is pruned on the short window');
  });

  // --- Sensitive targets in subagents ---
  const subRun = (tool, toolInput, extra = {}) =>
    runHook({ tool_name: tool, tool_input: toolInput, session_id: 'subagent-sensitive-session', ...extra }, { CLAUDE_SESSION_ID: '', ECC_SESSION_ID: '' });
  const subEdit = (file_path, extra) => subRun('Edit', { file_path, old_string: 'a', new_string: 'b' }, extra);
  const subAgent = { agent_id: 'agent-sens' };

  gateCase('a subagent Edit of a sensitive file is denied once, then its retry passes', () => {
    const first = subEdit('/src/.env', subAgent);
    assert.strictEqual(roDecision(first), 'deny', first.stdout);
    assert.ok(roReason(first).includes(sensLine));
    assert.strictEqual(roDecision(subEdit('/src/.env', subAgent)), undefined, 'subagent retry passes');
  });

  gateCase('a subagent pass on a sensitive file does not unlock it for the parent', () => {
    subEdit('/src/auth/login.js', subAgent);
    assert.strictEqual(roDecision(subEdit('/src/auth/login.js', subAgent)), undefined);
    const parent = subEdit('/src/auth/login.js');
    assert.strictEqual(roDecision(parent), 'deny', 'parent first touch is still gated');
  });

  gateCase('a sensitive file the parent already gated passes in a subagent', () => {
    assert.strictEqual(roDecision(subEdit('/src/secrets.json')), 'deny');
    assert.strictEqual(roDecision(subEdit('/src/secrets.json', { parent_tool_use_id: 'toolu_parent' })), undefined);
  });

  gateCase('subagent Write and MultiEdit of sensitive targets are denied; ordinary targets still pass', () => {
    const write = subRun('Write', { file_path: '/repo/.github/workflows/ci.yml', content: 'x' }, subAgent);
    assert.strictEqual(roDecision(write), 'deny');
    const multi = subRun('MultiEdit', {
      edits: [
        { file_path: '/src/plain.js', old_string: 'a', new_string: 'b' },
        { file_path: '/src/payments/charge.js', old_string: 'a', new_string: 'b' }
      ]
    }, subAgent);
    assert.strictEqual(roDecision(multi), 'deny');
    assert.ok(roReason(multi).includes('charge.js'));
    assert.strictEqual(roDecision(subEdit('/src/ordinary.js', subAgent)), undefined);
    assert.strictEqual(roDecision(subRun('Write', { file_path: '/src/new-file.js', content: 'x' }, subAgent)), undefined);
  });

  gateCase('subagent sensitive denials ignore prior-search credit and the denial cap', () => {
    const transcript = writeTranscript([humanRecord('fix it'), ...searchRecords('toolu_sub1', 'Grep', { pattern: 'login', path: '/src' })]);
    const result = subRun('Edit', { file_path: '/src/auth/login.js', old_string: 'a', new_string: 'b' }, { ...subAgent, transcript_path: transcript });
    assert.strictEqual(roDecision(result), 'deny');
    clearState();
    const capped = runHook(
      { tool_name: 'Edit', tool_input: { file_path: '/src/.env.local', old_string: 'a', new_string: 'b' }, session_id: 'subagent-sensitive-session', ...subAgent },
      { CLAUDE_SESSION_ID: '', ECC_SESSION_ID: '', GATEGUARD_FACT_FORCE_MAX_DENIALS: '0' }
    );
    assert.strictEqual(roDecision(capped), 'deny');
  });

  // --- NotebookEdit ---
  const notebookInput = (rel, extra = {}) => ({ notebook_path: sensAbs(rel), new_source: 'x = 1', cell_id: 'c1', ...extra });
  const notebookRun = (rel, transcriptPath, env, extra) => projectRun('NotebookEdit', notebookInput(rel, extra), transcriptPath, env);
  const FULL_CODE_QUESTIONS = [
    'List ALL files that import/require this file',
    'List the public functions/classes affected by this change',
    'If this file reads/writes data files',
    "Quote the user's current instruction verbatim"
  ];

  gateCase('a first NotebookEdit is denied with the full code questions, then its retry passes', () => {
    const first = notebookRun('nb/analysis.ipynb');
    assert.strictEqual(first.decision, 'deny', first.result.stdout);
    assert.ok(first.reason.includes(`Before editing ${sensAbs('nb/analysis.ipynb')}`), first.reason);
    for (const line of FULL_CODE_QUESTIONS) assert.ok(first.reason.includes(line), `${line}: ${first.reason}`);
    assert.ok(!first.reason.includes(sensLine), 'ordinary notebook has no sensitive line');
    const retry = notebookRun('nb/analysis.ipynb');
    assert.strictEqual(retry.decision, undefined, retry.result.stdout);
    assert.strictEqual(readState().fact_force_denials, 1);
  });

  gateCase('NotebookEdit and Edit share one checked key for a notebook', () => {
    assert.strictEqual(notebookRun('nb/shared.ipynb').decision, 'deny');
    assert.strictEqual(projectEdit(sensAbs('nb/shared.ipynb')).decision, undefined, 'Edit after a NotebookEdit denial passes');
    assert.strictEqual(projectEdit(sensAbs('nb/other.ipynb')).decision, 'deny');
    assert.strictEqual(notebookRun('nb/other.ipynb').decision, undefined, 'NotebookEdit after an Edit denial passes');
  });

  gateCase('NotebookEdit is gated by notebook_path, not by a file_path field', () => {
    projectEdit(sensAbs('src/checked.py'));
    const out = notebookRun('nb/target.ipynb', undefined, {}, { file_path: sensAbs('src/checked.py') });
    assert.strictEqual(out.decision, 'deny', out.result.stdout);
    assert.ok(out.reason.includes('target.ipynb'), out.reason);
    const exempt = notebookRun('nb/exempt-by-file-path.ipynb', undefined, { GATEGUARD_EXEMPT_GLOBS: '**/other.py' }, { file_path: sensAbs('src/other.py') });
    assert.strictEqual(exempt.decision, 'deny', 'an exempt file_path does not exempt the notebook');
  });

  gateCase('a NotebookEdit is never a trivial pass', () => {
    const out = notebookRun('nb/comment.ipynb', undefined, {}, { new_source: '# just a comment', edit_mode: 'replace' });
    assert.strictEqual(out.decision, 'deny', out.result.stdout);
    assert.ok(!out.context.includes('Comment or whitespace-only'), out.context);
    assert.ok(!readState().trivial_allows, 'no trivial pass counted');
  });

  gateCase('a notebook under tests/ gets the test questions', () => {
    const out = notebookRun('tests/notebooks/check.ipynb');
    assert.strictEqual(out.decision, 'deny');
    assert.ok(out.reason.includes('Name what behaviour is under test'), out.reason);
  });

  gateCase('a search naming the notebook credits its first NotebookEdit', () => {
    const t = writeTranscript([humanRecord('update the notebook'), ...searchRecords('toolu_nb1', 'Grep', { pattern: 'forecast', path: projectRoot })]);
    const out = notebookRun('nb/forecast.ipynb', t);
    assert.notStrictEqual(out.decision, 'deny', out.result.stdout);
    assert.ok(out.context.includes('Prior search seen in this turn'), out.result.stdout);
  });

  gateCase('a sensitive notebook is denied despite a crediting search and past the denial cap', () => {
    const t = writeTranscript([humanRecord('update it'), ...searchRecords('toolu_nb2', 'Grep', { pattern: 'tokens', path: projectRoot })]);
    sensAssertDenied(notebookRun('src/auth/tokens.ipynb', t), 'credited sensitive notebook');
    clearState();
    sensAssertDenied(notebookRun('src/auth/tokens.ipynb', undefined, { GATEGUARD_FACT_FORCE_MAX_DENIALS: '0' }), 'sensitive notebook past cap 0');
    const control = notebookRun('nb/capped.ipynb', undefined, { GATEGUARD_FACT_FORCE_MAX_DENIALS: '0' });
    assert.strictEqual(control.decision, undefined, 'ordinary notebook passes the cap like Edit');
  });

  gateCase('NotebookEdit honours exempt globs', () => {
    const out = notebookRun('scratch/play.ipynb', undefined, { GATEGUARD_EXEMPT_GLOBS: '**/scratch/**' });
    assert.strictEqual(out.decision, undefined, out.result.stdout);
    assert.strictEqual(out.context, '');
  });

  gateCase('a subagent NotebookEdit passes for an ordinary notebook and is denied for a sensitive one', () => {
    const agent = { agent_id: 'agent-notebook' };
    assert.strictEqual(roDecision(subRun('NotebookEdit', { notebook_path: '/src/nb/plain.ipynb', new_source: 'x' }, agent)), undefined);
    const sensitive = subRun('NotebookEdit', { notebook_path: '/src/payments/ledger.ipynb', new_source: 'x' }, agent);
    assert.strictEqual(roDecision(sensitive), 'deny');
    assert.ok(roReason(sensitive).includes(sensLine));
  });

  gateCase('a lower-case notebookedit tool name is gated the same way', () => {
    assert.strictEqual(projectRun('notebookedit', notebookInput('nb/lower.ipynb')).decision, 'deny');
  });

  // --- Hard-linked targets ---
  const linkedLine = 'Hard-linked target: prior-search credit, sibling collapse, and the denial cap do not apply.';
  const linkPair = (rel, alias, content = '// old\nfoo();\n') => {
    fs.mkdirSync(path.dirname(sensAbs(rel)), { recursive: true });
    fs.mkdirSync(path.dirname(sensAbs(alias)), { recursive: true });
    fs.writeFileSync(sensAbs(rel), content);
    try {
      fs.linkSync(sensAbs(rel), sensAbs(alias));
      return true;
    } catch (e) {
      if (['EPERM', 'ENOTSUP', 'EXDEV', 'ENOSYS', 'EOPNOTSUPP'].includes(e.code)) return false;
      throw e;
    }
  };
  const linksReady = linkPair('linked/src/report.js', 'linked/vendor/report.js')
    && linkPair('linked/src/auth/token.js', 'linked/vendor/token.js')
    && linkPair('linked/src/sub.js', 'linked/vendor/sub.js')
    && linkPair('linked/scratch/tmp.js', 'linked/vendor/tmp.js');
  for (const rel of ['linked/src/plain.js', 'linked/src/plain_two.js']) fs.writeFileSync(sensAbs(rel), '// old\nfoo();\n');
  const assertLinkedDenied = (out, label) => {
    assert.strictEqual(out.decision, 'deny', `${label}: expected deny, got ${out.result.stdout}`);
    assert.ok(!out.context, `${label}: no credit, trivial or sibling note`);
    assert.ok(out.reason.includes(linkedLine), `${label}: hard-link line expected: ${out.reason}`);
    assert.ok(!out.reason.includes(sensLine), `${label}: no sensitive wording`);
  };
  const linkedSearch = n => writeTranscript([
    humanRecord('update the report'),
    ...searchRecords(`toolu_linked_${n}`, 'Grep', { pattern: 'report|plain|tmp', path: projectRoot })
  ]);

  gateCase('an Edit of a hard-linked file is denied despite a crediting search (control credited)', () => {
    if (!linksReady) return;
    const t = linkedSearch(1);
    assertLinkedDenied(projectEdit(sensAbs('linked/src/report.js'), t), 'original name');
    assertLinkedDenied(projectEdit(sensAbs('linked/vendor/report.js'), t), 'second name');
    assertCredited(projectEdit(sensAbs('linked/src/plain.js'), t), 'single-link control');
    const state = readState();
    assert.strictEqual(state.fact_force_denials, 2);
    assert.strictEqual(state.fact_force_credited, 1);
  });

  gateCase('the full code questions are asked for a hard-linked file', () => {
    if (!linksReady) return;
    const out = projectRun('Edit', { file_path: sensAbs('linked/src/report.js'), old_string: 'foo();', new_string: 'bar();' });
    assertLinkedDenied(out, 'body-only change');
    for (const line of FULL_CODE_QUESTIONS) assert.ok(out.reason.includes(line), `${line}: ${out.reason}`);
  });

  gateCase('a comment-only Edit of a hard-linked file is denied (control passes as trivial)', () => {
    if (!linksReady) return;
    const input = rel => ({ file_path: sensAbs(rel), old_string: '// old', new_string: '// new' });
    assertLinkedDenied(projectRun('Edit', input('linked/src/report.js')), 'Edit');
    const multi = projectRun('MultiEdit', { file_path: sensAbs('linked/vendor/tmp.js'), edits: [{ old_string: '// old', new_string: '// new' }] });
    assertLinkedDenied(multi, 'MultiEdit');
    const control = projectRun('Edit', input('linked/src/plain_two.js'));
    assert.notStrictEqual(control.decision, 'deny', control.result.stdout);
    assert.ok(control.context.includes('Comment or whitespace-only change'), control.context);
  });

  gateCase('a hard-linked file is denied past the denial cap (control passes)', () => {
    if (!linksReady) return;
    const env = { GATEGUARD_FACT_FORCE_MAX_DENIALS: '0' };
    assertLinkedDenied(projectEdit(sensAbs('linked/src/report.js'), undefined, env), 'Edit past cap 0');
    const multi = projectRun('MultiEdit', { edits: [
      { file_path: sensAbs('linked/src/plain.js'), old_string: 'foo();', new_string: 'bar();' },
      { file_path: sensAbs('linked/vendor/tmp.js'), old_string: 'foo();', new_string: 'bar();' }
    ] }, undefined, env);
    assertLinkedDenied(multi, 'MultiEdit entry past cap 0');
    assert.ok(multi.reason.includes('tmp.js'), multi.reason);
    const control = projectEdit(sensAbs('linked/src/plain_two.js'), undefined, env);
    assert.strictEqual(control.decision, undefined, control.result.stdout);
  });

  gateCase('a MultiEdit with a hard-linked entry is denied despite a crediting search', () => {
    if (!linksReady) return;
    const t = linkedSearch(2);
    const multi = projectRun('MultiEdit', { edits: [
      { file_path: sensAbs('linked/src/plain.js'), old_string: 'foo();', new_string: 'bar();' },
      { file_path: sensAbs('linked/src/report.js'), old_string: 'foo();', new_string: 'bar();' }
    ] }, t);
    assertLinkedDenied(multi, 'MultiEdit');
    assert.ok(multi.reason.includes('report.js'), multi.reason);
  });

  gateCase('a subagent Edit of a hard-linked file is denied once; single-link targets still pass', () => {
    if (!linksReady) return;
    const agent = { agent_id: 'agent-linked', cwd: projectRoot };
    const first = subEdit(sensAbs('linked/vendor/sub.js'), agent);
    assert.strictEqual(roDecision(first), 'deny', first.stdout);
    assert.ok(roReason(first).includes(linkedLine), roReason(first));
    assert.strictEqual(roDecision(subEdit(sensAbs('linked/vendor/sub.js'), agent)), undefined, 'subagent retry passes');
    assert.strictEqual(roDecision(subEdit(sensAbs('linked/src/plain.js'), agent)), undefined);
  });

  gateCase('a hard-linked sensitive file carries the sensitive wording', () => {
    if (!linksReady) return;
    const out = projectEdit(sensAbs('linked/src/auth/token.js'));
    sensAssertDenied(out, 'sensitive and hard-linked');
    assert.ok(!out.reason.includes(linkedLine), out.reason);
    const alias = projectEdit(sensAbs('linked/vendor/token.js'));
    assertLinkedDenied(alias, 'ordinary name of a hard link into auth/');
  });

  gateCase('a new file next to a hard-linked file keeps its allowances', () => {
    if (!linksReady) return;
    const t = writeTranscript([humanRecord('add a module'), ...searchRecords('toolu_linked_ls', 'LS', { path: sensAbs('linked/src') })]);
    const out = projectWrite(sensAbs('linked/src/new_module.js'), t);
    assertCredited(out, 'missing new file');
  });

  gateCase('an exempt glob still exempts a hard-linked file', () => {
    if (!linksReady) return;
    const out = projectEdit(sensAbs('linked/scratch/tmp.js'), undefined, { GATEGUARD_EXEMPT_GLOBS: 'linked/scratch/**' });
    assert.strictEqual(out.decision, undefined, out.result.stdout);
  });

  gateCase('no hard-link output carries permissionDecision "allow"', () => {
    for (const stdout of siblingOutputs) {
      const output = parseOutput(stdout);
      assert.notStrictEqual(output && output.hookSpecificOutput ? output.hookSpecificOutput.permissionDecision : undefined, 'allow', stdout);
    }
  });

  fs.rmSync(classBase, { recursive: true, force: true });
  fs.rmSync(scopeRoot, { recursive: true, force: true });

  fs.rmSync(projectRoot, { recursive: true, force: true });

  fs.rmSync(transcriptDir, { recursive: true, force: true });

  // Cleanup only the temp directory created by this test file.
  try {
    if (fs.existsSync(stateDir)) {
      fs.rmSync(stateDir, { recursive: true, force: true });
    }
  } catch (err) {
    console.error(`  [cleanup] failed to remove ${stateDir}: ${err.message}`);
  }

  // --- sanitizePath dangerous invisible unicode regression ---
  clearState();
  if (
    test('sanitizePath strips CI-defined dangerous invisible unicode from denial paths', () => {
      const file_path =
        '/src/eu2028\u2028eu2029\u2029app.js\u200bhidden\u2060name\ufefftail\u3164x\u0091c1.js';
      const input = {
        tool_name: 'Edit',
        tool_input: { file_path, old_string: 'foo', new_string: 'bar' }
      };
      const result = runHook(input);
      const output = parseOutput(result.stdout);
      const reason = String(
        output && output.hookSpecificOutput
          ? output.hookSpecificOutput.permissionDecisionReason
          : ''
      );
      for (const bad of ['\u2028', '\u2029', '\u200b', '\u2060', '\ufeff', '\u3164', '\u0091']) {
        assert.ok(!reason.includes(bad), `denial reason must not carry U+${bad.codePointAt(0).toString(16)} (${bad})`);
      }
      assert.ok(reason.includes('app.js'), 'visible path text must remain');
    })
  ) {
    passed++;
  } else {
    failed++;
  }

  // --- Modules load only on the paths that need them ---
  const loadedLibs = (payload, setup = []) => {
    const dir = fs.mkdtempSync(path.join(tmpRoot, 'gateguard-lazy-'));
    const env = { PATH: process.env.PATH, HOME: dir, GATEGUARD_STATE_DIR: path.join(dir, 'state'), CLAUDE_PROJECT_DIR: dir };
    const probe = [
      'const hook = require(process.argv[1]);',
      'hook.run(process.argv[2]);',
      "const names = Object.keys(require.cache).map(f => require('path').basename(f, '.js'));",
      "const libs = names.filter(n => /^(gateguard-|transcript-context$)/.test(n) && !/^gateguard-(fact-force|heredoc)$/.test(n));",
      'process.stdout.write(JSON.stringify(libs.sort()));'
    ].join('\n');
    try {
      for (const step of setup) spawnSync(process.execPath, ['-e', probe, hookScript, JSON.stringify(step)], { env });
      const out = spawnSync(process.execPath, ['-e', probe, hookScript, JSON.stringify(payload)], { encoding: 'utf8', env });
      return JSON.parse(out.stdout);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  };
  const lazyEdit = { session_id: 'lazy', tool_name: 'Edit', tool_input: { file_path: '/tmp/gateguard-lazy/src/widget.js', old_string: 'a', new_string: 'b' } };
  const lazyBash = command => ({ session_id: 'lazy', tool_name: 'Bash', tool_input: { command } });
  const lazyCases = [
    ['a first shell command loads only the read-only check', lazyBash('npm test'), [], ['gateguard-readonly-shell', 'gateguard-state']],
    ['a shell command after the routine gate loads only the state helpers', lazyBash('npm run build'), [lazyBash('npm test')], ['gateguard-state']],
    ['an edit of a checked file loads only the target classification', lazyEdit, [lazyEdit], ['gateguard-state', 'gateguard-target-class']],
    ['a first touch without a transcript loads no search matching', lazyEdit, [], ['gateguard-change-profile', 'gateguard-code-lexer', 'gateguard-file-context', 'gateguard-state', 'gateguard-target-class', 'gateguard-turn-scan', 'transcript-context']]
  ];
  for (const [label, payload, setup, expected] of lazyCases) {
    if (test(`lazy loading: ${label}`, () => assert.deepStrictEqual(loadedLibs(payload, setup), expected))) passed++;
    else failed++;
  }

  const ddResults = runDdRegressionTests();
  passed += ddResults.passed;
  failed += ddResults.failed;
  console.log(`\n  ${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
}

if (process.argv.includes('--dd-only')) {
  const { passed, failed } = runDdRegressionTests();
  console.log(`\n  ${passed} passed, ${failed} failed\n`);
  process.exitCode = failed > 0 ? 1 : 0;
} else {
  runTests();
}
