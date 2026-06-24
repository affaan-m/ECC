import { exec } from 'child_process';
import path from 'path';
import type { EventBus, ExtensionFactory } from '@earendil-works/pi-coding-agent';

// Simple logger to avoid dependency on @earendil-works/pi-agent-core
const log = {
  info: (...args: unknown[]) => console.log('[ecc-pi-extension]', ...args),
  error: (...args: unknown[]) => console.error('[ecc-pi-extension]', ...args),
  warn: (...args: unknown[]) => console.warn('[ecc-pi-extension]', ...args),
};

export const eccExtension: ExtensionFactory = app => {
  log.info('ECC Pi Extension initializing...');

  const events: EventBus = app.events; // Use the event bus from the API

  const runEccHook = (hookName: string, envParams: Record<string, string>) => {
    const rootDir = process.env.PI_WORKSPACE_DIR || process.cwd();
    const scriptPath = path.join(rootDir, 'scripts', 'hooks', `${hookName}.js`);

    // We set Pi-specific environment vars to trick ECC's bash runner or payload handlers into working.
    const env = {
      ...process.env,
      ...envParams,
      ECC_HARNESS: 'pi',
      PI_INTEGRATION_ACTIVE: '1'
    };

    exec(`node ${scriptPath}`, { env }, (error, stdout, stderr) => {
      if (error) {
        log.error(`ECC Hook ${hookName} failed:`, error.message);
        if (stderr) log.error(`stderr: ${stderr}`);
        return;
      }
      if (stdout) log.info(`ECC Hook ${hookName} output: ${stdout.trim()}`);
    });
  };

  // Map Pi Events to ECC Hook names
  events.on('session_start', () => {
    log.info('Handling session_start for ECC');
    runEccHook('session-start', {
      CLAUDE_PROJECT_DIR: process.cwd()
    });
  });

  events.on('session_shutdown', () => {
    log.info('Handling session_shutdown for ECC');
    runEccHook('session-end', {});
  });

  log.info('ECC Integration Activated');
};

export default eccExtension;
