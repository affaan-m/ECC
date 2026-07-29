#!/usr/bin/env node
const { hookEnabled, readStdin, resolveScriptPath } = require('./adapter');
const { splitShellSegments } = require(resolveScriptPath('scripts', 'lib', 'shell-split'));

readStdin()
  .then(raw => {
    try {
      const input = JSON.parse(raw || '{}');
      const cmd = String(input.command || input.args?.command || '');

      if (hookEnabled('pre:bash:dev-server-block', ['standard', 'strict']) && process.platform !== 'win32') {
        const segments = splitShellSegments(cmd);
        const tmuxLauncher = /^\s*tmux\s+(new|new-session|new-window|split-window)\b/;
        const devPattern = /\b(npm\s+run\s+dev|pnpm(?:\s+run)?\s+dev|yarn\s+dev|bun\s+run\s+dev)\b/;
        const hasBlockedDev = segments.some(segment => devPattern.test(segment) && !tmuxLauncher.test(segment));
        if (hasBlockedDev) {
          console.error('[ECC] BLOCKED: Dev server must run in tmux for log access');
          console.error('[ECC] Use: tmux new-session -d -s dev "npm run dev"');
          process.exit(2);
        }
      }

      if (
        hookEnabled('pre:bash:tmux-reminder', ['strict']) &&
        process.platform !== 'win32' &&
        !process.env.TMUX &&
        /(npm (install|test)|pnpm (install|test)|yarn (install|test)?|bun (install|test)|cargo build|make\b|docker\b|pytest|vitest|playwright)/.test(cmd)
      ) {
        console.error('[ECC] Consider running in tmux for session persistence');
      }

      if (hookEnabled('pre:bash:git-push-reminder', ['strict']) && /\bgit\s+push\b/.test(cmd)) {
        console.error('[ECC] Review changes before push: git diff origin/main...HEAD');
      }
    } catch {
      // noop
    }

    process.stdout.write(raw);
  })
  .catch(() => process.exit(0));
