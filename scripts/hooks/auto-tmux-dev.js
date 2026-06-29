#!/usr/bin/env node
/**
 * Auto-Tmux Dev Hook - Start dev servers in tmux/cmd automatically
 *
 * macOS/Linux: Runs dev server in a named tmux session (non-blocking).
 *              Falls back to original command if tmux is not installed.
 * Windows: Opens dev server in a new cmd window (non-blocking).
 *
 * Runs before Bash tool use. If command is a dev server (npm run dev, pnpm dev, yarn dev, bun run dev),
 * transforms it to run in a detached session.
 *
 * Benefits:
 * - Dev server runs detached (doesn't block Claude Code)
 * - Session persists (can run `tmux capture-pane -t <session> -p` to see logs on Unix)
 * - Session name matches project directory (allows multiple projects simultaneously)
 *
 * Session management (Unix):
 * - Checks tmux availability before transforming
 * - Kills any existing session with the same name (clean restart)
 * - Creates new detached session
 * - Reports session name and how to view logs
 *
 * Session management (Windows):
 * - Opens new cmd window with descriptive title
 * - Allows multiple dev servers to run simultaneously
 */

const path = require('path');
const { spawnSync } = require('child_process');

const MAX_STDIN = 1024 * 1024; // 1MB limit
let data = '';

function run(rawInput) {
  try {
    const input = typeof rawInput === 'string' ? JSON.parse(rawInput) : rawInput;
    const cmd = input.tool_input?.command || '';

    // Detect dev server commands: npm run dev, pnpm dev, yarn dev, bun run dev
    // Trailing (?![\w-]) rather than \b: \b treats a hyphen as a word boundary,
    // so `dev\b` matches the `dev` prefix of distinct scripts like `dev-build` /
    // `dev-docs` and would wrongly detach those one-shot scripts into tmux. The
    // lookahead still matches the dev server (`dev`, `dev:ssr`, ...) but not a
    // `dev-<suffix>` script. Mirrors pre-bash-dev-server-block.js DEV_PATTERN.
    const devServerRegex = /(npm run dev|pnpm( run)? dev|yarn dev|bun run dev)(?![\w-])/;

    if (devServerRegex.test(cmd)) {
      // Get session name from current directory basename, sanitize for shell safety
      // e.g., /home/user/Portfolio → "Portfolio", /home/user/my-app-v2 → "my-app-v2"
      const rawName = path.basename(process.cwd());
      // Replace non-alphanumeric characters (except - and _) with underscore to prevent shell injection
      const sessionName = rawName.replace(/[^a-zA-Z0-9_-]/g, '_') || 'dev';

      if (process.platform === 'win32') {
        // Windows: open in a new cmd window (non-blocking)
        // Escape double quotes in cmd for cmd /k syntax
        const escapedCmd = cmd.replace(/"/g, '""');
        return JSON.stringify({
          ...input,
          tool_input: {
            ...input.tool_input,
            command: `start "DevServer-${sessionName}" cmd /k "${escapedCmd}"`,
          },
        });
      } else {
        // Unix (macOS/Linux): Check tmux is available before transforming
        const tmuxCheck = spawnSync('which', ['tmux'], { encoding: 'utf8' });
        if (tmuxCheck.status === 0) {
          // Escape single quotes for shell safety: 'text' -> 'text'\''text'
          const escapedCmd = cmd.replace(/'/g, "'\\''");

          // Build the transformed command:
          // 1. Kill existing session (silent if doesn't exist)
          // 2. Create new detached session with the dev command
          // 3. Echo confirmation message with instructions for viewing logs
          const transformedCmd = `SESSION="${sessionName}"; tmux kill-session -t "$SESSION" 2>/dev/null || true; tmux new-session -d -s "$SESSION" '${escapedCmd}' && echo "[Hook] Dev server started in tmux session '${sessionName}'. View logs: tmux capture-pane -t ${sessionName} -p -S -100"`;
          return JSON.stringify({
            ...input,
            tool_input: {
              ...input.tool_input,
              command: transformedCmd,
            },
          });
        }
        // else: tmux not found, pass through original command unchanged
      }
    }

    return JSON.stringify(input);
  } catch {
    // Invalid input — pass through original data unchanged
    return typeof rawInput === 'string' ? rawInput : JSON.stringify(rawInput);
  }
}

if (require.main === module) {
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', chunk => {
    if (data.length < MAX_STDIN) {
      const remaining = MAX_STDIN - data.length;
      data += chunk.substring(0, remaining);
    }
  });

  process.stdin.on('end', () => {
    process.stdout.write(run(data));
    process.exit(0);
  });
}

module.exports = { run };
