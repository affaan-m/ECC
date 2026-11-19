'use strict';

// This builtin-only bootstrap is embedded in trusted plugin manifests. It must
// validate input and workspace boundaries before importing any package code.
function bootstrap() {
  const fs = require('fs');
  const path = require('path');
  const os = require('os');
  const disabled = String(process.env.ECC_HOOKS_ENABLED || '').trim().toLowerCase();
  if (['0', 'false', 'no', 'off'].includes(disabled) || process.env.ECC_DRY_RUN === '1') {
    process.stdout.write(JSON.stringify({ decision: 'allow' }));
    return;
  }
  const chunks = [];
  let bytes = 0;
  let settled = false;
  const deny = () => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    process.stdin.destroy();
    process.stdout.write(JSON.stringify({ decision: 'deny', reason: 'ECC could not bind a trusted external hook runtime' }));
  };
  const within = (file, root) => {
    const relative = path.relative(root, file);
    return relative === '' || (!path.isAbsolute(relative) && relative.split(path.sep)[0] !== '..');
  };
  const metadata = file => {
    const handle = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0) | (fs.constants.O_NONBLOCK || 0));
    try {
      const state = fs.fstatSync(handle);
      if (!state.isFile() || state.size > 4096) throw new Error();
      const buffer = Buffer.alloc(4097);
      let length = 0;
      while (length < buffer.length) {
        const count = fs.readSync(handle, buffer, length, buffer.length - length, null);
        if (!count) break;
        length += count;
      }
      if (length > 4096) throw new Error();
      return buffer.subarray(0, length).toString('utf8').trim();
    } finally { fs.closeSync(handle); }
  };
  const gitCommon = directory => {
    let ancestor = directory;
    while (true) {
      const marker = path.join(ancestor, '.git');
      if (fs.existsSync(marker)) {
        const state = fs.statSync(marker);
        let git = marker;
        if (!state.isDirectory()) {
          const pointer = metadata(marker);
          if (!pointer.startsWith('gitdir:')) throw new Error();
          git = path.resolve(ancestor, pointer.slice(7).trim());
        }
        const common = path.join(git, 'commondir');
        const real = fs.realpathSync(fs.existsSync(common) ? path.resolve(git, metadata(common)) : git);
        if (!fs.statSync(real).isDirectory()) throw new Error();
        return real;
      }
      const parent = path.dirname(ancestor);
      if (parent === ancestor) return null;
      ancestor = parent;
    }
  };
  const timer = setTimeout(deny, 3000);
  process.stdin.on('data', chunk => {
    bytes += chunk.length;
    if (bytes > 1048576) deny();
    else if (!settled) chunks.push(chunk);
  });
  process.stdin.once('error', deny);
  process.stdin.once('end', () => {
    if (settled) return;
    try {
      const raw = Buffer.concat(chunks).toString('utf8');
      const payload = JSON.parse(raw);
      if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error();
      if (!Array.isArray(payload.workspacePaths) || !payload.workspacePaths.length || payload.workspacePaths.length > 32) throw new Error();
      const cwd = fs.realpathSync(process.cwd());
      const roots = payload.workspacePaths.map(root => {
        if (typeof root !== 'string' || root.length > 32768 || !path.isAbsolute(root)) throw new Error();
        const real = fs.realpathSync(root);
        if (!fs.statSync(real).isDirectory()) throw new Error();
        return real;
      });
      if (!roots.some(root => within(cwd, root))) throw new Error();
      const workspaceGit = [cwd, ...roots].map(gitCommon).filter(Boolean);
      let ancestor = cwd;
      while (true) {
        if (fs.existsSync(path.join(ancestor, '.git'))) { roots.push(ancestor); break; }
        const parent = path.dirname(ancestor);
        if (parent === ancestor) break;
        ancestor = parent;
      }
      const home = os.homedir();
      const candidates = [
        process.env.ANTIGRAVITY_PLUGIN_ROOT, process.env.ECC_PLUGIN_ROOT, process.env.CLAUDE_PLUGIN_ROOT,
        path.join(home, '.gemini', 'config', 'plugins', 'ecc'),
        path.join(home, '.gemini', 'config', 'plugins', 'antigravity-suite'),
        path.join(home, '.claude', 'plugins', 'marketplaces', 'ecc'),
        path.join(home, '.claude', 'plugins', 'cache', 'ecc'),
        path.join(home, '.agents', 'plugins', 'ecc'),
      ];
      for (const candidate of candidates) {
        if (typeof candidate !== 'string' || !path.isAbsolute(candidate)) continue;
        let bridge;
        try {
          const candidatePath = path.resolve(candidate);
          let prefix = path.parse(candidatePath).root;
          const components = path.relative(prefix, candidatePath).split(path.sep).filter(Boolean);
          const crossesWorkspace = components.some(component => {
            prefix = path.join(prefix, component);
            const real = fs.realpathSync(prefix);
            return roots.some(workspace => within(real, workspace));
          });
          if (crossesWorkspace) continue;
          const root = fs.realpathSync(candidatePath);
          bridge = fs.realpathSync(path.join(root, 'scripts', 'antigravity', 'hook-bridge.js'));
          if (!fs.statSync(bridge).isFile() || !within(bridge, root) || roots.some(workspace => within(bridge, workspace))) continue;
          const candidateGit = gitCommon(path.dirname(bridge));
          if (candidateGit && workspaceGit.some(common => path.relative(common, candidateGit) === '')) continue;
        } catch { continue; }
        settled = true;
        clearTimeout(timer);
        const runtime = require(bridge);
        if (!runtime || runtime.protocol !== 'ecc.antigravity-cli.v1' || typeof runtime.main !== 'function') throw new Error();
        Promise.resolve(runtime.main(raw)).catch(() => {
          process.stdout.write(JSON.stringify({ decision: 'deny', reason: 'ECC safety runtime failed' }));
        });
        return;
      }
      deny();
    } catch {
      /* Re-enable the single denial if a bound runtime failed during import. */
      settled = false;
      deny();
    }
  });
}

function buildAntigravityCliHookCommand() {
  const source = `(${bootstrap.toString()})()`.replace(/\s+/g, ' ');
  // The shell wrapper contains only first-party constant code, with no shell
  // substitutions or embedded caller data. Native payloads remain on stdin.
  if (/["$`\\]/.test(source)) throw new Error('Bootstrap contains shell-sensitive source');
  return `node -e "${source}" -- --hook config-protection`;
}

module.exports = { bootstrap, buildAntigravityCliHookCommand };
