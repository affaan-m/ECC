'use strict';

/**
 * Local PDF export for Plan Canvas.
 *
 * Chromium's print-to-PDF implementation renders the same loopback artifact
 * the reviewer sees, so Markdown, HTML, images, tables, and Mermaid diagrams
 * keep their browser layout. No artifact content is sent to a converter or
 * added as an npm runtime dependency.
 */

const { spawn } = require('child_process');
const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');

const DEFAULT_EXPORT_TIMEOUT_MS = 45 * 1000;
const PDF_POLL_MS = 100;

function errorWithCode(message, code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function isExecutable(file, { platform = process.platform, fsImpl = fs } = {}) {
  if (!file) return false;
  try {
    fsImpl.accessSync(file, platform === 'win32' ? fs.constants.F_OK : fs.constants.X_OK);
    return fsImpl.statSync(file).isFile();
  } catch {
    return false;
  }
}

function pathExecutableNames(platform) {
  if (platform === 'win32') {
    return ['chrome.exe', 'msedge.exe', 'chromium.exe'];
  }
  return ['google-chrome-stable', 'google-chrome', 'chromium', 'chromium-browser', 'microsoft-edge-stable', 'microsoft-edge'];
}

function executableCandidates({ env, platform }) {
  const candidates = [];
  if (platform === 'darwin') {
    candidates.push(
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Chromium.app/Contents/MacOS/Chromium',
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'
    );
    if (env.HOME) {
      candidates.push(
        path.join(env.HOME, 'Applications/Google Chrome.app/Contents/MacOS/Google Chrome'),
        path.join(env.HOME, 'Applications/Chromium.app/Contents/MacOS/Chromium'),
        path.join(env.HOME, 'Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge')
      );
    }
  }
  if (platform === 'win32') {
    for (const root of [env.PROGRAMFILES, env['PROGRAMFILES(X86)'], env.LOCALAPPDATA].filter(Boolean)) {
      candidates.push(
        path.join(root, 'Google/Chrome/Application/chrome.exe'),
        path.join(root, 'Microsoft/Edge/Application/msedge.exe'),
        path.join(root, 'Chromium/Application/chrome.exe')
      );
    }
  }

  const pathEntries = String(env.PATH || '')
    .split(path.delimiter)
    .map(entry => entry.replace(/^"|"$/g, ''))
    .filter(Boolean);
  for (const directory of pathEntries) {
    for (const name of pathExecutableNames(platform)) candidates.push(path.join(directory, name));
  }
  return candidates;
}

function resolveChromiumExecutable({
  env = process.env,
  platform = process.platform,
  fsImpl = fs
} = {}) {
  const override = String(env.ECC_PLAN_CANVAS_CHROME_PATH || '').trim();
  if (override) return isExecutable(override, { platform, fsImpl }) ? override : null;
  return executableCandidates({ env, platform }).find(candidate => isExecutable(candidate, { platform, fsImpl })) || null;
}

function pdfFileName(artifactFile) {
  const original = path.basename(String(artifactFile || 'plan'));
  const stem = original
    .replace(/\.(?:plan\.)?(?:md|markdown|html?|htm)$/i, '')
    .split('')
    .map(character => character.charCodeAt(0) < 32 ? '-' : character)
    .join('')
    .replace(/[<>:"/\\|?*]/g, '-')
    .replace(/[.\s]+$/g, '')
    .trim() || 'plan';
  return `${stem}.pdf`;
}

function assertLoopbackUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw errorWithCode('PDF export URL is invalid', 'PDF_EXPORT_INVALID_URL');
  }
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) {
    throw errorWithCode('PDF export is restricted to the Plan Canvas loopback server', 'PDF_EXPORT_INVALID_URL');
  }
  return url.toString();
}

function isCompletePdf(file, fsImpl = fs) {
  let fd;
  try {
    fd = fsImpl.openSync(file, 'r');
    const stat = fsImpl.fstatSync(fd);
    if (!stat.isFile() || stat.size < 12) return false;
    const head = Buffer.alloc(5);
    fsImpl.readSync(fd, head, 0, head.length, 0);
    const tailLength = Math.min(2048, stat.size);
    const tail = Buffer.alloc(tailLength);
    fsImpl.readSync(fd, tail, 0, tailLength, stat.size - tailLength);
    return head.toString('ascii') === '%PDF-' && tail.toString('latin1').includes('%%EOF');
  } catch {
    return false;
  } finally {
    if (fd !== undefined) {
      try { fsImpl.closeSync(fd); } catch { /* best-effort probe */ }
    }
  }
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function startDenyProxy(netImpl = net) {
  return new Promise((resolve, reject) => {
    const server = netImpl.createServer(socket => {
      socket.on('error', () => {});
      socket.destroy();
    });
    const onError = error => reject(errorWithCode(
      `Could not isolate PDF renderer network access (${error.message})`,
      'PDF_EXPORT_FAILED'
    ));
    server.once('error', onError);
    server.listen(0, '127.0.0.1', () => {
      server.removeListener('error', onError);
      server.on('error', () => {});
      server.unref();
      resolve({ server, url: `http://127.0.0.1:${server.address().port}` });
    });
  });
}

function stopDenyProxy(server) {
  if (!server) return Promise.resolve();
  return new Promise(resolve => {
    try { server.close(resolve); } catch { resolve(); }
  });
}

async function stopChild(child) {
  if (!child || child.exitCode !== null || child.signalCode) return;
  const closed = new Promise(resolve => child.once('close', resolve));
  try { child.kill('SIGTERM'); } catch { return; }
  await Promise.race([closed, delay(1000)]);
  if (child.exitCode === null && !child.signalCode) {
    try { child.kill('SIGKILL'); } catch { /* already gone */ }
    await Promise.race([closed, delay(500)]);
  }
}

function waitForPdf(child, outputFile, { timeoutMs, fsImpl }) {
  return new Promise((resolve, reject) => {
    let stderr = '';
    let settled = false;
    const finish = error => {
      if (settled) return;
      settled = true;
      clearInterval(poll);
      clearTimeout(timeout);
      child.removeListener('error', onError);
      child.removeListener('close', onClose);
      if (error) reject(error);
      else resolve();
    };
    const failure = message => {
      const detail = stderr.trim().slice(-1200);
      return errorWithCode(`${message}${detail ? `: ${detail}` : ''}`, 'PDF_EXPORT_FAILED');
    };
    const onError = error => finish(failure(`Could not start the PDF renderer (${error.message})`));
    const onClose = code => {
      if (isCompletePdf(outputFile, fsImpl)) finish();
      else finish(failure(`PDF renderer exited with status ${code}`));
    };
    if (child.stderr) {
      child.stderr.on('data', chunk => {
        stderr += chunk.toString();
        if (stderr.length > 8000) stderr = stderr.slice(-4000);
      });
    }
    child.once('error', onError);
    child.once('close', onClose);
    const poll = setInterval(() => {
      if (isCompletePdf(outputFile, fsImpl)) finish();
    }, PDF_POLL_MS);
    const timeout = setTimeout(() => finish(failure(`PDF export timed out after ${timeoutMs}ms`)), timeoutMs);
  });
}

async function exportPdf({
  url,
  artifactFile,
  env = process.env,
  platform = process.platform,
  executable = null,
  timeoutMs = DEFAULT_EXPORT_TIMEOUT_MS,
  spawnImpl = spawn,
  fsImpl = fs,
  osImpl = os,
  netImpl = net
} = {}) {
  const safeUrl = assertLoopbackUrl(url);
  const exportUrl = new URL(safeUrl);
  const browser = executable || resolveChromiumExecutable({ env, platform, fsImpl });
  if (!browser) {
    const override = String(env.ECC_PLAN_CANVAS_CHROME_PATH || '').trim();
    throw errorWithCode(
      override
        ? `PDF renderer not found at ECC_PLAN_CANVAS_CHROME_PATH=${override}`
        : 'PDF export requires Google Chrome, Chromium, or Microsoft Edge; set ECC_PLAN_CANVAS_CHROME_PATH to its executable',
      'PDF_BROWSER_NOT_FOUND'
    );
  }

  const tempDir = fsImpl.mkdtempSync(path.join(osImpl.tmpdir(), 'ecc-plan-canvas-pdf-'));
  const outputFile = path.join(tempDir, 'artifact.pdf');
  const profileDir = path.join(tempDir, 'profile');
  fsImpl.mkdirSync(profileDir, { recursive: true });
  let child = null;
  let denyProxy = null;
  try {
    denyProxy = await startDenyProxy(netImpl);
    const args = [
      '--headless=new',
      '--disable-background-networking',
      '--disable-gpu',
      '--disable-component-update',
      '--disable-default-apps',
      '--disable-extensions',
      '--disable-sync',
      '--disable-quic',
      '--metrics-recording-only',
      '--mute-audio',
      '--no-first-run',
      '--no-default-browser-check',
      '--no-pdf-header-footer',
      '--print-to-pdf-no-header',
      '--hide-scrollbars',
      `--proxy-server=${denyProxy.url}`,
      `--proxy-bypass-list=<-loopback>;${exportUrl.origin}`,
      `--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE ${exportUrl.hostname}`,
      `--user-data-dir=${profileDir}`,
      `--print-to-pdf=${outputFile}`,
      '--virtual-time-budget=5000',
      safeUrl
    ];
    child = spawnImpl(browser, args, {
      stdio: ['ignore', 'ignore', 'pipe'],
      shell: false,
      env: { ...env, LANG: 'en_US.UTF-8' }
    });
    await waitForPdf(child, outputFile, { timeoutMs, fsImpl });
    const buffer = fsImpl.readFileSync(outputFile);
    if (!isCompletePdf(outputFile, fsImpl)) {
      throw errorWithCode('PDF renderer produced an incomplete document', 'PDF_EXPORT_FAILED');
    }
    return { buffer, filename: pdfFileName(artifactFile) };
  } finally {
    await stopChild(child);
    await stopDenyProxy(denyProxy && denyProxy.server);
    fsImpl.rmSync(tempDir, { recursive: true, force: true });
  }
}

module.exports = {
  DEFAULT_EXPORT_TIMEOUT_MS,
  assertLoopbackUrl,
  exportPdf,
  isCompletePdf,
  pdfFileName,
  resolveChromiumExecutable
};
