'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { readBoundedRegularFile, validateCapabilities } = require('./contracts');
const { normalizeArch, normalizeOs } = require('./router');
const { resolveWindowsSrtShim } = require('./backends/srt');

const PROBE_TIMEOUT_MS = 5_000;
const MAX_PROBE_BUFFER = 1024 * 1024;
const MICROSANDBOX_VERSION = '0.6.8';

function runCommand(executable, argv = []) {
  return spawnSync(executable, argv, {
    encoding: 'utf8',
    shell: false,
    timeout: PROBE_TIMEOUT_MS,
    maxBuffer: MAX_PROBE_BUFFER,
    windowsHide: true,
  });
}

function succeeded(result) {
  return !result.error && result.status === 0;
}

function firstLine(value) {
  return String(value || '').trim().split(/\r?\n/, 1)[0] || null;
}

function commandVersion(run, executable, argv = ['--version']) {
  const result = run(executable, argv);
  return succeeded(result) ? firstLine(result.stdout || result.stderr) : null;
}

function backend(available, values = {}) {
  return Object.fromEntries(Object.entries({
    available: Boolean(available),
    ...values,
  }).filter(([, value]) => value !== undefined));
}

function installFix(tool, platform) {
  const fixes = {
    podman: {
      linux: 'Install Podman with your system package manager (for Ubuntu: sudo apt-get install podman)',
      macos: 'Install Podman: brew install podman && podman machine init && podman machine start',
      windows: 'Install Podman: winget install --exact --id RedHat.Podman && podman machine init && podman machine start',
    },
    microsandbox: {
      linux: `Install pinned Microsandbox: cargo install microsandbox-cli --version ${MICROSANDBOX_VERSION} --locked`,
      macos: `Install pinned Microsandbox: cargo install microsandbox-cli --version ${MICROSANDBOX_VERSION} --locked`,
      windows: `Install pinned Microsandbox: cargo install microsandbox-cli --version ${MICROSANDBOX_VERSION} --locked`,
    },
    lima: {
      linux: 'Install Lima from https://lima-vm.io/docs/installation/',
      macos: 'Install Lima: brew install lima',
    },
    gh: {
      linux: 'Install GitHub CLI from https://cli.github.com/ and authenticate: gh auth login',
      macos: 'Install GitHub CLI and authenticate: brew install gh && gh auth login',
      windows: 'Install GitHub CLI and authenticate: winget install --exact --id GitHub.cli && gh auth login',
    },
  };
  return fixes[tool]?.[platform];
}

function detectInsideContainer(platform, fileExists, readFile, env) {
  if (env.container) return true;
  if (platform !== 'linux') return false;
  if (fileExists('/.dockerenv') || fileExists('/run/.containerenv')) return true;
  try {
    return /docker|containerd|kubepods|podman/i.test(readFile('/proc/1/cgroup'));
  } catch {
    return false;
  }
}

function detectVirtualization(platform, architecture, run, canAccess) {
  if (platform === 'macos') {
    const result = run('sysctl', ['-n', 'kern.hv_support']);
    return succeeded(result) && String(result.stdout).trim() === '1';
  }
  if (platform === 'linux') {
    return canAccess('/dev/kvm');
  }
  if (platform === 'windows') {
    const result = run('powershell.exe', [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      '(Get-CimInstance Win32_Processor | Select-Object -First 1).VirtualizationFirmwareEnabled',
    ]);
    return succeeded(result) && /true/i.test(result.stdout);
  }
  return architecture === 'arm64' ? false : null;
}

function detectPodman(run, platform, architecture) {
  const version = commandVersion(run, 'podman');
  if (!version) {
    const fix = installFix('podman', platform);
    return backend(false, { version: null, state: 'unavailable', reason: 'podman not found', fix });
  }

  if (platform === 'linux') {
    const info = run('podman', ['info', '--format', 'json']);
    let rootless = false;
    if (succeeded(info)) {
      try {
        const parsed = JSON.parse(info.stdout);
        rootless = parsed?.host?.security?.rootless === true;
      } catch {
        rootless = false;
      }
    }
    const ready = succeeded(info) && rootless;
    return backend(ready, {
      version,
      state: ready ? 'ready' : (succeeded(info) ? 'unavailable' : 'not-configured'),
      targets: ready ? [{ os: 'linux', arch: architecture }] : [],
      reason: ready
        ? 'rootless Podman is ready'
        : (succeeded(info)
          ? 'Podman is running as root; ECC requires rootless isolation'
          : 'podman is installed but not usable by this user'),
      fix: ready
        ? undefined
        : (succeeded(info)
          ? "Run Podman as an unprivileged user; verify: podman info --format '{{.Host.Security.Rootless}}'"
          : 'Configure rootless Podman: podman system migrate'),
    });
  }

  const machines = run('podman', ['machine', 'list', '--format', 'json']);
  let running = false;
  let configured = false;
  if (succeeded(machines)) {
    try {
      const parsedMachines = JSON.parse(machines.stdout);
      configured = parsedMachines.length > 0;
      running = parsedMachines.some(machine => (
        machine.Running === true || String(machine.State || '').toLowerCase() === 'running'
      ));
    } catch {
      running = false;
    }
  }
  if (running) {
    const info = run('podman', ['info', '--format', 'json']);
    let rootless = false;
    if (succeeded(info)) {
      try {
        rootless = JSON.parse(info.stdout)?.host?.security?.rootless === true;
      } catch {
        rootless = false;
      }
    }
    if (!rootless) {
      return backend(false, {
        version,
        state: 'unavailable',
        targets: [],
        reason: 'Podman machine is rootful or its rootless state cannot be verified',
        fix: 'Use a rootless Podman machine: podman machine set --rootful=false && podman machine stop && podman machine start',
      });
    }
  }
  return backend(running, {
    version,
    state: running ? 'ready' : 'stopped',
    targets: running ? [{ os: 'linux', arch: architecture }] : [],
    reason: running ? 'Podman machine is running' : 'Podman machine is not running',
    fix: running
      ? undefined
      : (configured
        ? 'Start Podman: podman machine start'
        : 'Start Podman: podman machine init && podman machine start'),
  });
}

function detectCi(run, platform) {
  const version = commandVersion(run, 'gh');
  if (!version) {
    return backend(false, {
      version: null,
      state: 'unavailable',
      reason: 'GitHub CLI not found',
      fix: installFix('gh', platform),
    });
  }
  const auth = run('gh', ['auth', 'status']);
  const available = succeeded(auth);
  return backend(available, {
    version,
    state: available ? 'ready' : 'not-configured',
    targets: available ? [
      { os: 'linux', arch: 'x86_64' },
      { os: 'linux', arch: 'arm64' },
      { os: 'macos', arch: 'x86_64' },
      { os: 'macos', arch: 'arm64' },
      { os: 'windows', arch: 'x86_64' },
    ] : [],
    capabilities: available ? ['ios-simulator'] : [],
    reason: available ? 'GitHub CLI authentication is ready' : 'GitHub CLI is not authenticated',
    fix: available ? undefined : 'Authenticate GitHub CLI: gh auth login',
  });
}

function detectMicrosandbox(run, platform, architecture, virtualization) {
  const version = commandVersion(run, 'msb');
  if (!version) {
    return backend(false, {
      version: null,
      state: 'unavailable',
      targets: [],
      reason: 'microsandbox not found',
      fix: installFix('microsandbox', platform),
    });
  }
  if (!new RegExp(`(?:^|\\s)${MICROSANDBOX_VERSION.replace(/\./g, '\\.')}\\b`).test(version)) {
    return backend(false, {
      version,
      state: 'unavailable',
      targets: [],
      reason: `microsandbox ${version} is outside ECC's pinned ${MICROSANDBOX_VERSION} adapter contract`,
      fix: installFix('microsandbox', platform),
    });
  }
  if (!virtualization) {
    return backend(false, {
      version,
      state: 'unavailable',
      targets: [],
      reason: 'microsandbox needs hardware virtualization',
      fix: 'Enable KVM, Apple Virtualization.framework, or Windows Hypervisor Platform, then run: msb doctor',
    });
  }
  const doctor = run('msb', ['doctor']);
  const ready = succeeded(doctor);
  return backend(ready, {
    version,
    state: ready ? 'ready' : 'not-configured',
    targets: ready ? [{ os: 'linux', arch: architecture }] : [],
    capabilities: ready ? ['domain-network-policy'] : [],
    reason: ready ? 'microsandbox doctor passed' : 'microsandbox doctor reported an unavailable runtime dependency',
    fix: ready ? undefined : 'Repair the checks reported by: msb doctor',
  });
}

function detectSrt(
  run,
  platform,
  architecture,
  insideContainer,
  allowNestedSrt,
  options = {}
) {
  // npm exposes SRT as srt.cmd on Windows; fixed probe commands can safely use
  // cmd.exe while adapter execution keeps manifest text out of the outer shell.
  const windowsShim = platform === 'windows'
    ? resolveWindowsSrtShim(options.env || {}, options.cwd, options.fileExists)
    : null;
  const invoke = argv => (platform === 'windows'
    ? (windowsShim
      ? run('cmd.exe', ['/d', '/s', '/c', windowsShim, ...argv])
      : { status: null, stdout: '', stderr: '', error: new Error('trusted srt.cmd not found') })
    : run('srt', argv));
  const versionResult = invoke(['--version']);
  const version = succeeded(versionResult)
    ? firstLine(versionResult.stdout || versionResult.stderr)
    : null;
  if (!version) {
    return backend(false, {
      version: null,
      state: 'unavailable',
      targets: [],
      reason: 'srt not found',
      fix: 'Install SRT (current releases require Node 20.11+): npm install -g @anthropic-ai/sandbox-runtime',
    });
  }
  if (insideContainer && !allowNestedSrt) {
    return backend(false, {
      version,
      state: 'unavailable',
      targets: [],
      reason: 'srt nested mode is weaker and disabled by ECC',
      fix: 'Use Tier 1, or explicitly accept weaker nesting: ECC_SANDBOX_ALLOW_NESTED_SRT=1 ecc-sandbox probe --refresh',
    });
  }
  if (platform === 'windows') {
    const readiness = invoke(['-c', 'echo ecc-srt-probe']);
    if (!succeeded(readiness)) {
      return backend(false, {
        version,
        state: 'not-configured',
        targets: [],
        reason: 'srt is installed but its Windows sandbox account/WFP fence is not ready',
        fix: 'Provision SRT once from an elevated terminal: npx @anthropic-ai/sandbox-runtime windows-install',
      });
    }
  }
  return backend(true, {
    version,
    state: 'ready',
    targets: [{ os: platform, arch: architecture }],
    reason: insideContainer
      ? 'srt weaker nested mode was explicitly enabled'
      : 'srt is ready',
  });
}

function detectWindowsFeatures(run, architecture) {
  const wsbVersion = commandVersion(run, 'wsb', ['--help']);
  const hyperv = run('powershell.exe', [
    '-NoProfile',
    '-NonInteractive',
    '-Command',
    '(Get-WindowsOptionalFeature -Online -FeatureName Microsoft-Hyper-V-All).State',
  ]);
  const hypervReady = succeeded(hyperv) && /enabled/i.test(hyperv.stdout);
  return {
    'windows-sandbox': backend(Boolean(wsbVersion), {
      version: wsbVersion,
      state: wsbVersion ? 'ready' : 'unavailable',
      targets: wsbVersion ? [{ os: 'windows', arch: architecture }] : [],
      reason: wsbVersion ? 'Windows Sandbox CLI is ready' : 'Windows Sandbox CLI is unavailable',
      fix: wsbVersion ? undefined : 'Enable Windows Sandbox: Enable-WindowsOptionalFeature -Online -FeatureName Containers-DisposableClientVM -All',
    }),
    'hyper-v': backend(hypervReady, {
      version: null,
      state: hypervReady ? 'ready' : 'unavailable',
      targets: hypervReady ? [{ os: 'windows', arch: architecture }] : [],
      reason: hypervReady ? 'Hyper-V is enabled' : 'Hyper-V is not enabled',
      fix: hypervReady ? undefined : 'Enable Hyper-V: Enable-WindowsOptionalFeature -Online -FeatureName Microsoft-Hyper-V-All -All',
    }),
  };
}

function probeCapabilities(options = {}) {
  const platform = normalizeOs(options.platform || process.platform);
  const architecture = normalizeArch(options.architecture || process.arch);
  const run = options.run || runCommand;
  const fileExists = options.fileExists || fs.existsSync;
  const readFile = options.readFile || (filePath => fs.readFileSync(filePath, 'utf8'));
  const probeEnv = options.env || process.env;
  const canAccess = options.canAccess || (filePath => {
    try {
      fs.accessSync(filePath, fs.constants.R_OK | fs.constants.W_OK);
      return true;
    } catch {
      return false;
    }
  });
  const insideContainer = detectInsideContainer(
    platform,
    fileExists,
    readFile,
    probeEnv
  );
  const allowNestedSrt = options.allowNestedSrt === true
    || probeEnv.ECC_SANDBOX_ALLOW_NESTED_SRT === '1';
  const virtualization = detectVirtualization(platform, architecture, run, canAccess);
  const target = [{ os: 'linux', arch: architecture }];
  const lumeVersion = commandVersion(run, 'lume');
  const limaVersion = commandVersion(run, 'limactl');
  const tartVersion = commandVersion(run, 'tart');
  const dockerVersion = commandVersion(run, 'docker');
  const dockerInfo = dockerVersion ? run('docker', ['info', '--format', '{{json .ServerVersion}}']) : null;
  const windows = platform === 'windows'
    ? detectWindowsFeatures(run, architecture)
    : {
      'windows-sandbox': backend(false, { state: 'unavailable', reason: 'requires a Windows host' }),
      'hyper-v': backend(false, { state: 'unavailable', reason: 'requires a Windows host' }),
    };
  const lumeReady = Boolean(
    lumeVersion && platform === 'macos' && architecture === 'arm64' && virtualization
  );
  const tartReady = Boolean(
    tartVersion && platform === 'macos' && architecture === 'arm64' && virtualization
  );
  const limaReady = Boolean(
    limaVersion && ['macos', 'linux'].includes(platform) && virtualization
  );

  const capabilities = {
    schema_version: 1,
    generated_at: (options.now || new Date()).toISOString(),
    host: {
      os: platform,
      arch: architecture,
      cpus: options.cpus || os.cpus().length,
      inside_container: insideContainer,
      virtualization: virtualization ? 'available' : 'unavailable',
    },
    backends: {
      srt: detectSrt(run, platform, architecture, insideContainer, allowNestedSrt, {
        cwd: options.cwd || process.cwd(),
        env: probeEnv,
        fileExists,
      }),
      podman: detectPodman(run, platform, architecture),
      docker: backend(Boolean(dockerVersion) && succeeded(dockerInfo), {
        version: dockerVersion,
        state: dockerVersion && succeeded(dockerInfo) ? 'ready' : 'unavailable',
        targets: dockerVersion && succeeded(dockerInfo) ? target : [],
        reason: dockerVersion ? 'Docker fallback detected' : 'Docker fallback not detected',
      }),
      microsandbox: detectMicrosandbox(run, platform, architecture, virtualization),
      lume: backend(lumeReady, {
        version: lumeVersion,
        state: lumeReady ? 'ready' : 'unavailable',
        targets: lumeReady ? [{ os: 'macos', arch: 'arm64' }] : [],
        reason: platform === 'macos' && architecture === 'arm64'
          ? (lumeVersion ? 'Lume requires hardware virtualization' : 'Lume not found')
          : 'Lume requires an Apple Silicon macOS host',
        fix: !lumeVersion && platform === 'macos' && architecture === 'arm64'
          ? '/bin/bash -c "$(curl -fsSL https://cua.ai/lume/install.sh)"'
          : undefined,
      }),
      lima: backend(limaReady, {
        version: limaVersion,
        state: limaReady ? 'ready' : 'unavailable',
        targets: limaReady ? target : [],
        reason: ['macos', 'linux'].includes(platform)
          ? (limaVersion
            ? (virtualization ? 'Lima is ready for Linux guests' : 'Lima needs hardware virtualization')
            : 'Lima not found')
          : 'Lima requires a macOS or Linux host',
        fix: limaVersion ? undefined : installFix('lima', platform),
      }),
      tart: backend(tartReady, {
        version: tartVersion,
        state: tartReady ? 'ready' : 'unavailable',
        targets: tartReady ? [{ os: 'macos', arch: 'arm64' }] : [],
        reason: tartVersion ? 'Optional Fair Source Tart backend detected' : 'Optional Tart backend not installed',
      }),
      ...windows,
      'dockur-windows': backend(false, {
        version: null,
        state: 'not-configured',
        reason: 'dockur/windows is detection-only in v1; use Windows Sandbox or CI',
      }),
      ci: detectCi(run, platform),
    },
  };
  return validateCapabilities(capabilities);
}

function writeCapabilityCache(filePath, capabilities) {
  const resolved = path.resolve(filePath);
  fs.mkdirSync(path.dirname(resolved), { recursive: true, mode: 0o700 });
  const tempPath = `${resolved}.${process.pid}.tmp`;
  fs.writeFileSync(tempPath, `${JSON.stringify(capabilities, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
    flag: 'wx',
  });
  fs.renameSync(tempPath, resolved);
  return resolved;
}

function readCapabilityCache(filePath) {
  return validateCapabilities(JSON.parse(
    readBoundedRegularFile(filePath, 'Capability cache')
  ));
}

module.exports = {
  MAX_PROBE_BUFFER,
  PROBE_TIMEOUT_MS,
  commandVersion,
  detectInsideContainer,
  detectPodman,
  detectSrt,
  detectVirtualization,
  probeCapabilities,
  readCapabilityCache,
  runCommand,
  writeCapabilityCache,
};
