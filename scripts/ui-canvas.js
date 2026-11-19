#!/usr/bin/env node
'use strict';

/**
 * UI Canvas CLI: preview and hand-edit UI component mockups in the browser.
 *
 *   node scripts/ui-canvas.js open components/card.html --viewport mobile
 *   node scripts/ui-canvas.js await components/card.html
 *   node scripts/ui-canvas.js await <file> --reply "Background is now brand gray."
 *   node scripts/ui-canvas.js end <file>
 *
 * The agent writes a self-contained HTML mockup, `open` shows it in the UI
 * Canvas where the human selects, drags, resizes, edits text, deletes, and
 * switches viewports, and `await` blocks until they chat, apply edits, or
 * click Save and Finish. Finish delivers the edit log plus the path of the
 * exported final markup; the agent turns that into the production component.
 *
 * Shares the Plan Canvas loopback server, state dir, and Stop/SessionStart
 * hooks; only the session mode and the agent-facing guidance differ.
 */

const { PLAN_PROFILE, main, valueAfter } = require('./plan-canvas');

function usage() {
  return [
    'UI Canvas - preview, hand-edit, and approve UI component mockups in the browser',
    '',
    'Usage:',
    '  node scripts/ui-canvas.js                      Show server status and sessions',
    '  node scripts/ui-canvas.js open <file.html>     Open (or resume) a preview session',
    '  node scripts/ui-canvas.js await <file.html>    Block until the human chats, applies edits, or finishes',
    '  node scripts/ui-canvas.js pending              Show feedback queued for no listener',
    '  node scripts/ui-canvas.js typing <file.html>   Show a thinking/typing indicator in chat',
    '  node scripts/ui-canvas.js end <file.html>      End a session as the agent',
    '  node scripts/ui-canvas.js stop                 Shut down the shared canvas server',
    '  node scripts/ui-canvas.js server               Run the server in the foreground',
    '',
    'Options:',
    '  open:  --viewport <mobile|desktop|custom|WxH>  Initial viewport (default desktop)',
    '         --title <text>  Tab title shown in the browser',
    '         --no-open       Do not launch a browser window',
    '         --reopen        Reopen a session the user ended from the browser',
    '  await: --session-key <key>  Resume by an opaque session key instead of a file path',
    '         --reply <msg>  Show an agent reply in the canvas chat before waiting',
    '         --timeout-ms <n>  Return {status:"waiting"} after n ms (tests/debug only)',
    '  typing: --state <thinking|typing|idle>  Defaults to typing',
    '  server: --port <n> --host <h>',
    '',
    'Finish payloads name <file>.edited.html (final markup) and <file>.edits.json (edit log) next to the artifact;',
    'each Apply batch writes its own <file>.apply-<batch>.edited.html and .edits.json pair.',
    'Environment: ECC_PLAN_CANVAS_PORT, ECC_PLAN_CANVAS_STATE_DIR, ECC_PLAN_CANVAS_IDLE_MS, ECC_CANVAS_AGENT'
  ].join('\n');
}

const UI_PROFILE = {
  ...PLAN_PROFILE,
  mode: 'ui',
  bin: 'ecc-ui-canvas',
  tag: 'ui-canvas',
  usage,
  validateFile(file) {
    if (!/\.html?$/i.test(file)) {
      throw new Error('ui-canvas opens self-contained .html mockups; write the component to an .html file first');
    }
  },
  openBody(args) {
    const ui = {};
    const viewport = valueAfter(args, '--viewport');
    if (viewport) ui.viewport = viewport;
    const title = valueAfter(args, '--title');
    if (title) ui.title = title;
    return { mode: 'ui', ui };
  },
  nextSteps: {
    open: 'Run `ecc-ui-canvas await <file>` in the background and leave it running; it returns when the human chats, applies edits, or clicks Save and Finish.',
    feedback(result) {
      const items = Array.isArray(result.items) ? result.items : [];
      const finish = items.find(item => item.kind === 'finish');
      const applied = items.find(item => item.kind === 'edits');
      if (finish) {
        return `The human clicked Save and Finish. Read the final markup at ${finish.exportPath} (edit log: ${finish.editsPath}), reproduce that exact look in the real component with full functionality, and report in chat. Do not reopen the canvas.`;
      }
      if (applied) {
        return `The human applied ${applied.editCount} edit(s) to the preview. Rewrite the mockup file from ${applied.exportPath} (keep it self-contained), then run \`ecc-ui-canvas await <file> --reply "<what you changed>"\` to keep listening.`;
      }
      if (result.sessionEnded) {
        return 'The human sent this and ended the preview. Address it and report in chat; do not reopen the canvas uninvited.';
      }
      return 'Make the requested change in the mockup file; the preview live-reloads within a second and re-applies the human\'s pending edits. Then run `ecc-ui-canvas await <file> --reply "<what you changed>"` to answer and keep listening.';
    },
    ended(result) {
      return result.endedBy === 'user'
        ? 'The human ended the preview without saving. Stop polling and report in chat; do not reopen uninvited.'
        : 'Session ended. Stop polling.';
    }
  }
};

if (require.main === module) {
  main(process.argv.slice(2), UI_PROFILE).then(code => {
    process.exitCode = code;
  });
}

module.exports = { UI_PROFILE, main: argv => main(argv, UI_PROFILE), usage };
