import { createModuleLogger } from '@earendil-works/pi-agent-core';
import type { CodeAgentEvents, ExtensionFactory } from '@earendil-works/pi-coding-agent';
import { exec } from 'child_process';
import path from 'path';

const log = createModuleLogger('ecc-pi-extension');

export const eccExtension: ExtensionFactory = app => {
  log.info('ECC Pi Extension initializing...');

  const events = app.get(Symbol.for('AgentEvents')) as CodeAgentEvents;

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
  events.on('session_start', ctx => {
    log.info('Handling session_start for ECC');
    runEccHook('session-start', {
      // Mapping context to ECC's expected ENV shapes
      CLAUDE_PROJECT_DIR: process.cwd()
    });
  });

  events.on('session_shutdown', ctx => {
    log.info('Handling session_shutdown for ECC');
    runEccHook('session-end', {});
  });

  return {
    id: 'ecc-integration',
    name: 'Everything Claude Code (ECC)',
    activate: () => {
      log.info('ECC Integration Activated');
    }
  };
};

export default eccExtension;
