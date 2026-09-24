'use strict';

const { spawn } = require('child_process');

const CLEAR_LINE = '\r\x1b[2K';
const FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
const FRAME_INTERVAL_MS = 80;

function runAnimator(label, options = {}) {
  const output = options.output || process.stdout;
  const schedule = options.schedule || setInterval;
  const clearSchedule = options.clearSchedule || clearInterval;
  const onDisconnect = options.onDisconnect
    || (handler => process.on('disconnect', handler));
  const exit = options.exit || (code => process.exit(code));
  let frameIndex = 1;
  const timer = schedule(() => {
    output.write(`\r${FRAMES[frameIndex]} ${label}`);
    frameIndex = (frameIndex + 1) % FRAMES.length;
  }, FRAME_INTERVAL_MS);

  onDisconnect(() => {
    clearSchedule(timer);
    exit(0);
  });
}

function startTerminalSpinner(label, options = {}) {
  const output = options.output || process.stdout;
  const spawnProcess = options.spawnProcess || spawn;
  const onAnimatorError = options.onAnimatorError;
  output.write(`${FRAMES[0]} ${label}`);

  let animator;
  try {
    animator = spawnProcess(
      process.execPath,
      [__filename, '--animate', label],
      {
        stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
      }
    );
    animator.on?.('error', error => {
      // Preserve a stable visible fallback if the child cannot animate.
      output.write(`\r${FRAMES[0]} ${label}`);
      onAnimatorError?.(error);
    });
  } catch {
    // The first frame still provides visible progress if animation cannot start.
  }

  let stopped = false;
  return {
    stop() {
      if (stopped) return;
      stopped = true;
      animator?.once?.('close', () => {
        // A child can render between kill() and close; clear that final frame.
        output.write(CLEAR_LINE);
      });
      animator?.kill();
      output.write(CLEAR_LINE);
    },
  };
}

// c8 ignore next 3 -- exercised as the independently instrumented child process.
if (require.main === module && process.argv[2] === '--animate') {
  runAnimator(process.argv[3] || 'Working...');
}

module.exports = {
  CLEAR_LINE,
  FRAMES,
  runAnimator,
  startTerminalSpinner,
};
