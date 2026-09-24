#!/usr/bin/env node
/**
 * Scan dependency manifests, lockfiles, AI-tool configs, and installed package
 * payload paths for active supply-chain incident indicators.
 */

const fs = require('fs');
const crypto = require('crypto');
const os = require('os');
const path = require('path');

const DEFAULT_ROOT = path.resolve(__dirname, '../..');

const MALICIOUS_PACKAGE_VERSIONS = {
  '@beproduct/nestjs-auth': [
    '0.1.2',
    '0.1.3',
    '0.1.4',
    '0.1.5',
    '0.1.6',
    '0.1.7',
    '0.1.8',
    '0.1.9',
    '0.1.10',
    '0.1.11',
    '0.1.12',
    '0.1.13',
    '0.1.14',
    '0.1.15',
    '0.1.16',
    '0.1.17',
    '0.1.18',
    '0.1.19',
  ],
  '@cap-js/db-service': ['2.10.1'],
  '@cap-js/postgres': ['2.2.2'],
  '@cap-js/sqlite': ['2.2.2'],
  '@dirigible-ai/sdk': ['0.6.2', '0.6.3'],
  '@draftauth/client': ['0.2.1', '0.2.2'],
  '@draftauth/core': ['0.13.1', '0.13.2'],
  '@draftlab/auth': ['0.24.1', '0.24.2'],
  '@draftlab/auth-router': ['0.5.1', '0.5.2'],
  '@draftlab/db': ['0.16.1', '0.16.2'],
  '@mesadev/rest': ['0.28.3'],
  '@mesadev/saguaro': ['0.4.22'],
  '@mesadev/sdk': ['0.28.3'],
  '@ml-toolkit-ts/preprocessing': ['1.0.2', '1.0.3'],
  '@ml-toolkit-ts/xgboost': ['1.0.3', '1.0.4'],
  '@mistralai/mistralai': ['2.2.2', '2.2.3', '2.2.4'],
  '@mistralai/mistralai-azure': ['1.7.1', '1.7.2', '1.7.3'],
  '@mistralai/mistralai-gcp': ['1.7.1', '1.7.2', '1.7.3'],
  '@opensearch-project/opensearch': ['3.5.3', '3.6.2', '3.7.0', '3.8.0'],
  '@squawk/airport-data': ['0.7.4', '0.7.5', '0.7.6', '0.7.7', '0.7.8'],
  '@squawk/airports': ['0.6.2', '0.6.3', '0.6.4', '0.6.5', '0.6.6'],
  '@squawk/airspace': ['0.8.1', '0.8.2', '0.8.3', '0.8.4', '0.8.5'],
  '@squawk/airspace-data': ['0.5.3', '0.5.4', '0.5.5', '0.5.6', '0.5.7'],
  '@squawk/airway-data': ['0.5.4', '0.5.5', '0.5.6', '0.5.7', '0.5.8'],
  '@squawk/airways': ['0.4.2', '0.4.3', '0.4.4', '0.4.5', '0.4.6'],
  '@squawk/fix-data': ['0.6.4', '0.6.5', '0.6.6', '0.6.7', '0.6.8'],
  '@squawk/fixes': ['0.3.2', '0.3.3', '0.3.4', '0.3.5', '0.3.6'],
  '@squawk/flight-math': ['0.5.4', '0.5.5', '0.5.6', '0.5.7', '0.5.8'],
  '@squawk/flightplan': ['0.5.2', '0.5.3', '0.5.4', '0.5.5', '0.5.6'],
  '@squawk/geo': ['0.4.4', '0.4.5', '0.4.6', '0.4.7', '0.4.8'],
  '@squawk/icao-registry': ['0.5.2', '0.5.3', '0.5.4', '0.5.5', '0.5.6'],
  '@squawk/icao-registry-data': ['0.8.4', '0.8.5', '0.8.6', '0.8.7', '0.8.8'],
  '@squawk/mcp': ['0.9.1', '0.9.2', '0.9.3', '0.9.4', '0.9.5'],
  '@squawk/navaid-data': ['0.6.4', '0.6.5', '0.6.6', '0.6.7', '0.6.8'],
  '@squawk/navaids': ['0.4.2', '0.4.3', '0.4.4', '0.4.5', '0.4.6'],
  '@squawk/notams': ['0.3.6', '0.3.7', '0.3.8', '0.3.9', '0.3.10'],
  '@squawk/procedure-data': ['0.7.3', '0.7.4', '0.7.5', '0.7.6', '0.7.7'],
  '@squawk/procedures': ['0.5.2', '0.5.3', '0.5.4', '0.5.5', '0.5.6'],
  '@squawk/types': ['0.8.1', '0.8.2', '0.8.3', '0.8.4', '0.8.5'],
  '@squawk/units': ['0.4.3', '0.4.4', '0.4.5', '0.4.6', '0.4.7'],
  '@squawk/weather': ['0.5.6', '0.5.7', '0.5.8', '0.5.9', '0.5.10'],
  '@supersurkhet/cli': ['0.0.2', '0.0.3', '0.0.4', '0.0.5', '0.0.6', '0.0.7'],
  '@supersurkhet/sdk': ['0.0.2', '0.0.3', '0.0.4', '0.0.5', '0.0.6', '0.0.7'],
  '@tallyui/components': ['1.0.1', '1.0.2', '1.0.3'],
  '@tallyui/connector-medusa': ['1.0.1', '1.0.2', '1.0.3'],
  '@tallyui/connector-shopify': ['1.0.1', '1.0.2', '1.0.3'],
  '@tallyui/connector-vendure': ['1.0.1', '1.0.2', '1.0.3'],
  '@tallyui/connector-woocommerce': ['1.0.1', '1.0.2', '1.0.3'],
  '@tallyui/core': ['0.2.1', '0.2.2', '0.2.3'],
  '@tallyui/database': ['1.0.1', '1.0.2', '1.0.3'],
  '@tallyui/pos': ['0.1.1', '0.1.2', '0.1.3'],
  '@tallyui/storage-sqlite': ['0.2.1', '0.2.2', '0.2.3'],
  '@tallyui/theme': ['0.2.1', '0.2.2', '0.2.3'],
  '@tanstack/arktype-adapter': ['1.166.12', '1.166.15'],
  '@tanstack/eslint-plugin-router': ['1.161.9', '1.161.12'],
  '@tanstack/eslint-plugin-start': ['0.0.4', '0.0.7'],
  '@tanstack/history': ['1.161.9', '1.161.12'],
  '@tanstack/nitro-v2-vite-plugin': ['1.154.12', '1.154.15'],
  '@tanstack/react-router': ['1.169.5', '1.169.8'],
  '@tanstack/react-router-devtools': ['1.166.16', '1.166.19'],
  '@tanstack/react-router-ssr-query': ['1.166.15', '1.166.18'],
  '@tanstack/react-start': ['1.167.68', '1.167.71'],
  '@tanstack/react-start-client': ['1.166.51', '1.166.54'],
  '@tanstack/react-start-rsc': ['0.0.47', '0.0.50'],
  '@tanstack/react-start-server': ['1.166.55', '1.166.58'],
  '@tanstack/router-cli': ['1.166.46', '1.166.49'],
  '@tanstack/router-core': ['1.169.5', '1.169.8'],
  '@tanstack/router-devtools': ['1.166.16', '1.166.19'],
  '@tanstack/router-devtools-core': ['1.167.6', '1.167.9'],
  '@tanstack/router-generator': ['1.166.45', '1.166.48'],
  '@tanstack/router-plugin': ['1.167.38', '1.167.41'],
  '@tanstack/router-ssr-query-core': ['1.168.3', '1.168.6'],
  '@tanstack/router-utils': ['1.161.11', '1.161.14'],
  '@tanstack/router-vite-plugin': ['1.166.53', '1.166.56'],
  '@tanstack/solid-router': ['1.169.5', '1.169.8'],
  '@tanstack/solid-router-devtools': ['1.166.16', '1.166.19'],
  '@tanstack/solid-router-ssr-query': ['1.166.15', '1.166.18'],
  '@tanstack/solid-start': ['1.167.65', '1.167.68'],
  '@tanstack/solid-start-client': ['1.166.50', '1.166.53'],
  '@tanstack/solid-start-server': ['1.166.54', '1.166.57'],
  '@tanstack/start-client-core': ['1.168.5', '1.168.8'],
  '@tanstack/start-fn-stubs': ['1.161.9', '1.161.12'],
  '@tanstack/start-plugin-core': ['1.169.23', '1.169.26'],
  '@tanstack/start-server-core': ['1.167.33', '1.167.36'],
  '@tanstack/start-static-server-functions': ['1.166.44', '1.166.47'],
  '@tanstack/start-storage-context': ['1.166.38', '1.166.41'],
  '@tanstack/valibot-adapter': ['1.166.12', '1.166.15'],
  '@tanstack/virtual-file-routes': ['1.161.10', '1.161.13'],
  '@tanstack/vue-router': ['1.169.5', '1.169.8'],
  '@tanstack/vue-router-devtools': ['1.166.16', '1.166.19'],
  '@tanstack/vue-router-ssr-query': ['1.166.15', '1.166.18'],
  '@tanstack/vue-start': ['1.167.61', '1.167.64'],
  '@tanstack/vue-start-client': ['1.166.46', '1.166.49'],
  '@tanstack/vue-start-server': ['1.166.50', '1.166.53'],
  '@tanstack/zod-adapter': ['1.166.12', '1.166.15'],
  '@taskflow-corp/cli': ['0.1.24', '0.1.25', '0.1.26', '0.1.27', '0.1.28', '0.1.29'],
  '@tolka/cli': ['1.0.2', '1.0.3', '1.0.4', '1.0.5', '1.0.6'],
  '@uipath/access-policy-sdk': ['0.3.1'],
  '@uipath/access-policy-tool': ['0.3.1'],
  '@uipath/agent.sdk': ['0.0.18'],
  '@uipath/agent-sdk': ['1.0.2'],
  '@uipath/agent-tool': ['1.0.1'],
  '@uipath/admin-tool': ['0.1.1'],
  '@uipath/aops-policy-tool': ['0.3.1'],
  '@uipath/ap-chat': ['1.5.7'],
  '@uipath/api-workflow-tool': ['1.0.1'],
  '@uipath/apollo-core': ['5.9.2'],
  '@uipath/apollo-react': ['4.24.5'],
  '@uipath/apollo-wind': ['2.16.2'],
  '@uipath/auth': ['1.0.1'],
  '@uipath/case-tool': ['1.0.1'],
  '@uipath/cli': ['1.0.1'],
  '@uipath/codedagent-tool': ['1.0.1'],
  '@uipath/codedagents-tool': ['0.1.12'],
  '@uipath/codedapp-tool': ['1.0.1'],
  '@uipath/common': ['1.0.1'],
  '@uipath/context-grounding-tool': ['0.1.1'],
  '@uipath/data-fabric-tool': ['1.0.2'],
  '@uipath/docsai-tool': ['1.0.1'],
  '@uipath/filesystem': ['1.0.1'],
  '@uipath/flow-tool': ['1.0.2'],
  '@uipath/functions-tool': ['1.0.1'],
  '@uipath/gov-tool': ['0.3.1'],
  '@uipath/identity-tool': ['0.1.1'],
  '@uipath/insights-sdk': ['1.0.1'],
  '@uipath/insights-tool': ['1.0.1'],
  '@uipath/integrationservice-sdk': ['1.0.2'],
  '@uipath/integrationservice-tool': ['1.0.2'],
  '@uipath/llmgw-tool': ['1.0.1'],
  '@uipath/maestro-sdk': ['1.0.1'],
  '@uipath/maestro-tool': ['1.0.1'],
  '@uipath/orchestrator-tool': ['1.0.1'],
  '@uipath/packager-tool-apiworkflow': ['0.0.19'],
  '@uipath/packager-tool-bpmn': ['0.0.9'],
  '@uipath/packager-tool-case': ['0.0.9'],
  '@uipath/packager-tool-connector': ['0.0.19'],
  '@uipath/packager-tool-flow': ['0.0.19'],
  '@uipath/packager-tool-functions': ['0.1.1'],
  '@uipath/packager-tool-webapp': ['1.0.6'],
  '@uipath/packager-tool-workflowcompiler': ['0.0.16'],
  '@uipath/packager-tool-workflowcompiler-browser': ['0.0.34'],
  '@uipath/platform-tool': ['1.0.1'],
  '@uipath/project-packager': ['1.1.16'],
  '@uipath/resource-tool': ['1.0.1'],
  '@uipath/resourcecatalog-tool': ['0.1.1'],
  '@uipath/resources-tool': ['0.1.11'],
  '@uipath/robot': ['1.3.4'],
  '@uipath/rpa-legacy-tool': ['1.0.1'],
  '@uipath/rpa-tool': ['0.9.5'],
  '@uipath/solution-packager': ['0.0.35'],
  '@uipath/solution-tool': ['1.0.1'],
  '@uipath/solutionpackager-sdk': ['1.0.11'],
  '@uipath/solutionpackager-tool-core': ['0.0.34'],
  '@uipath/tasks-tool': ['1.0.1'],
  '@uipath/telemetry': ['0.0.7'],
  '@uipath/test-manager-tool': ['1.0.2'],
  '@uipath/tool-workflowcompiler': ['0.0.12'],
  '@uipath/traces-tool': ['1.0.1'],
  '@uipath/ui-widgets-multi-file-upload': ['1.0.1'],
  '@uipath/uipath-python-bridge': ['1.0.1'],
  '@uipath/vertical-solutions-tool': ['1.0.1'],
  '@uipath/vss': ['0.1.6'],
  '@uipath/widget.sdk': ['1.2.3'],
  'agentwork-cli': ['0.1.4', '0.1.5'],
  'cmux-agent-mcp': ['0.1.3', '0.1.4', '0.1.5', '0.1.6', '0.1.7', '0.1.8'],
  'cross-stitch': ['1.1.3', '1.1.4', '1.1.5', '1.1.6', '1.1.7'],
  'git-branch-selector': ['1.3.3', '1.3.4', '1.3.5', '1.3.6', '1.3.7'],
  'git-git-git': ['1.0.8', '1.0.9', '1.0.10', '1.0.11', '1.0.12'],
  'guardrails-ai': ['0.10.1'],
  'intercom-client': ['7.0.4'],
  'lightning': ['2.6.2', '2.6.3'],
  'mbt': ['1.2.48'],
  'mistralai': ['2.4.6'],
  'ml-toolkit-ts': ['1.0.4', '1.0.5'],
  'node-ipc': ['9.1.6', '9.2.3', '10.1.1', '10.1.2', '11.0.0', '11.1.0', '12.0.1'],
  'nextmove-mcp': ['0.1.3', '0.1.4', '0.1.5', '0.1.7'],
  'safe-action': ['0.8.3', '0.8.4'],
  'ts-dna': ['3.0.1', '3.0.2', '3.0.3', '3.0.4', '3.0.5'],
  'wot-api': ['0.8.1', '0.8.2', '0.8.3', '0.8.4'],
};

const CRITICAL_TEXT_INDICATORS = [
  '@tanstack/setup',
  [
    'github:tanstack/router#79ac49eedf774dd4b0cf',
    'a308722bc463cfe5885c',
  ].join(''),
  [
    '79ac49eedf774dd4b0cf',
    'a308722bc463cfe5885c',
  ].join(''),
  'router_init.js',
  'router_runtime.js',
  'tanstack_runner.js',
  'opensearch_init.js',
  'vite_setup.mjs',
  'bun run tanstack_runner.js',
  'execution.js',
  'transformers.pyz',
  'pgmonitor.py',
  'pgsql-monitor.service',
  'gh-token-monitor',
  'com.user.gh-token-monitor',
  'IfYouRevokeThisTokenItWillWipeTheComputerOfTheOwner',
  [
    'ab4fcadaec49c032',
    '78063dd269ea5ee',
    'f82d24f2124a8e15',
    'd7b90f2fa8601266c',
  ].join(''),
  [
    '2ec78d556d696e20',
    '8927cc503d48e4b5e',
    'b56b31abc2870c2e',
    'd2e98d6be27fc96',
  ].join(''),
  [
    '7c12d8619f2db233',
    'e3d965a930709335',
    '5f149d5babc45891',
    '2757a5e88fec0f54',
  ].join(''),
  [
    '0c0e8730695e997b',
    '3a53d77483f28573',
    '392319ec023f8fd6',
    'd7282121cf7cf192',
  ].join(''),
  'svksjrhjkcejg',
  'filev2.getsession.org',
  'seed1.getsession.org',
  'seed2.getsession.org',
  'seed3.getsession.org',
  'signalservice',
  'git-tanstack.com',
  '169.254.169.254',
  '169.254.170.2',
  '127.0.0.1:8200',
  'litter.catbox.moe/h8nc9u.js',
  'litter.catbox.moe/7rrc6l.mjs',
  '83.142.209.194',
  'api.masscan.cloud',
  'claude@users.noreply.github.com',
  'dependabot/github_actions/format/',
  'OhNoWhatsGoingOnWithGitHub',
  'voicproducoes',
  'A Mini Shai-Hulud has Appeared',
  'Shai-Hulud: Here We Go Again',
  'PUSH UR T3MPRR',
  'codeql_analysis.yml',
  'shai-hulud-workflow.yml',
  [
    '96097e0612d9575c',
    'b133021017fb1a5c',
    '68a03b60f9f3d24e',
    'bdc0e628d9034144',
  ].join(''),
  [
    '449e4265979b5fdb',
    '2d3446c021af437e',
    '815debd66de7da2f',
    'e54f1ad93cbcc75e',
  ].join(''),
  [
    'c2f4dc64aec46315',
    '40a568e88932b61d',
    'aebbfb7e8281b812',
    'fa01b7215f9be9ea',
  ].join(''),
  [
    '78a82d93b4f58083',
    '5f5823b85a3d9ee1',
    'f03a15ee6f0e01b',
    '4eac86252a7002981',
  ].join(''),
  'sh.azurestaticprovider.net',
  '37.16.75.69',
  'bt.node.js',
  '__ntw',
  '__ntRun',
  '/nt-',
  'uname.txt',
  'envs.txt',
  'fixtures/_paths.txt',
];

const MALICIOUS_FILE_HASHES = {
  '96097e0612d9575cb133021017fb1a5c68a03b60f9f3d24ebdc0e628d9034144': {
    indicator: 'node-ipc.cjs sha256',
    message: 'Known malicious node-ipc CommonJS payload hash is present',
  },
  '449e4265979b5fdb2d3446c021af437e815debd66de7da2fe54f1ad93cbcc75e': {
    indicator: 'node-ipc-9.1.6.tgz sha256',
    message: 'Known malicious node-ipc tarball hash is present',
  },
  'c2f4dc64aec4631540a568e88932b61daebbfb7e8281b812fa01b7215f9be9ea': {
    indicator: 'node-ipc-9.2.3.tgz sha256',
    message: 'Known malicious node-ipc tarball hash is present',
  },
  '78a82d93b4f580835f5823b85a3d9ee1f03a15ee6f0e01b4eac86252a7002981': {
    indicator: 'node-ipc-12.0.1.tar.gz sha256',
    message: 'Known malicious node-ipc tarball hash is present',
  },
};

const DEPENDENCY_FILENAMES = new Set([
  'package.json',
  'package-lock.json',
  'pnpm-lock.yaml',
  'yarn.lock',
  'bun.lock',
  'pyproject.toml',
  'poetry.lock',
  'requirements.txt',
]);

const INSPECT_ONLY_FILENAMES = new Set([
  'node-ipc.cjs',
  'node-ipc-9.1.6.tgz',
  'node-ipc-9.2.3.tgz',
  'node-ipc-12.0.1.tar.gz',
]);

const PERSISTENCE_FILENAMES = new Set([
  'settings.json',
  'settings.local.json',
  'hooks.json',
  'tasks.json',
  'router_runtime.js',
  'setup.mjs',
  'pgmonitor.py',
  'gh-token-monitor.sh',
  'com.user.gh-token-monitor.plist',
  'gh-token-monitor.service',
  'pgsql-monitor.service',
  'codeql_analysis.yml',
  'shai-hulud-workflow.yml',
]);

const PAYLOAD_FILENAMES = new Set([
  'router_init.js',
  'router_runtime.js',
  'tanstack_runner.js',
  'opensearch_init.js',
  'vite_setup.mjs',
  'execution.js',
  'transformers.pyz',
  'pgmonitor.py',
  'gh-token-monitor.sh',
  'com.user.gh-token-monitor.plist',
  'gh-token-monitor.service',
  'pgsql-monitor.service',
  'codeql_analysis.yml',
  'shai-hulud-workflow.yml',
]);

function normalizedPath(filePath) {
  return filePath.split(path.sep).join('/');
}

function isGhTokenMonitorTokenPath(filePath) {
  return /\/\.config\/gh-token-monitor\/token$/.test(normalizedPath(filePath));
}

const IGNORED_DIRS = new Set([
  '.git',
  '.next',
  '.pytest_cache',
  '__pycache__',
  'coverage',
  'dist',
  'docs',
  'target',
  'tests',
]);

function normalizeForMatch(value) {
  return value.toLowerCase();
}

function isInSpecialConfigPath(filePath) {
  const normalized = normalizedPath(filePath);
  return /\/\.claude\//.test(normalized)
    || /\/\.vscode\//.test(normalized)
    || /\/\.kiro\/settings\//.test(normalized)
    || /\/Library\/LaunchAgents\//.test(normalized)
    || /\/\.config\/systemd\/user\//.test(normalized)
    || /\/\.local\/bin\//.test(normalized)
    || /\/\.github\/workflows\//.test(normalized);
}

function shouldInspectFile(filePath) {
  const base = path.basename(filePath);
  if (isGhTokenMonitorTokenPath(filePath)) return true;
  if (DEPENDENCY_FILENAMES.has(base)) return true;
  if (PERSISTENCE_FILENAMES.has(base) && isInSpecialConfigPath(filePath)) return true;
  if (PAYLOAD_FILENAMES.has(base) && filePath.includes(`${path.sep}node_modules${path.sep}`)) return true;
  if (INSPECT_ONLY_FILENAMES.has(base)) return true;
  return false;
}

function walkFiles(rootDir, files = []) {
  if (!fs.existsSync(rootDir)) return files;

  const stat = fs.statSync(rootDir);
  if (stat.isFile()) {
    if (shouldInspectFile(rootDir)) files.push(rootDir);
    return files;
  }

  for (const entry of fs.readdirSync(rootDir, { withFileTypes: true })) {
    const fullPath = path.join(rootDir, entry.name);
    if (entry.isDirectory()) {
      if (IGNORED_DIRS.has(entry.name) && entry.name !== 'node_modules') continue;
      if (entry.name === 'node_modules') {
        walkNodeModules(fullPath, files);
      } else {
        walkFiles(fullPath, files);
      }
    } else if (entry.isFile() && shouldInspectFile(fullPath)) {
      files.push(fullPath);
    }
  }

  return files;
}

function walkNodeModules(nodeModulesDir, files) {
  if (!fs.existsSync(nodeModulesDir)) return;

  for (const entry of fs.readdirSync(nodeModulesDir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    const fullPath = path.join(nodeModulesDir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name.startsWith('@')) {
        for (const scopedEntry of fs.readdirSync(fullPath, { withFileTypes: true })) {
          if (scopedEntry.isDirectory()) {
            inspectPackageDir(path.join(fullPath, scopedEntry.name), files);
          }
        }
      } else {
        inspectPackageDir(fullPath, files);
      }
    }
  }
}

function inspectPackageDir(packageDir, files) {
  for (const filename of [
    ...DEPENDENCY_FILENAMES,
    ...PAYLOAD_FILENAMES,
    ...INSPECT_ONLY_FILENAMES,
    'setup.mjs',
    'execution.js',
  ]) {
    const candidate = path.join(packageDir, filename);
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
      files.push(candidate);
    }
  }
}

function readText(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch {
    return '';
  }
}

function sha256File(filePath) {
  try {
    return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
  } catch {
    return '';
  }
}

function lineForIndex(text, index) {
  return text.slice(0, index).split(/\r?\n/).length;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function versionSpecifierMatches(value, version) {
  if (value === undefined || value === null) return false;
  const specifier = String(value);
  const versionPattern = new RegExp(`(^|[^0-9A-Za-z.])${escapeRegExp(version)}([^0-9A-Za-z.]|$)`, 'i');
  return specifier === version || versionPattern.test(specifier);
}

function packageKeyMatches(key, packageName) {
  return key === packageName
    || key === `node_modules/${packageName}`
    || key.endsWith(`/node_modules/${packageName}`);
}

function jsonReferencesPackageVersion(value, packageName, version) {
  if (!value || typeof value !== 'object') return false;

  if (value.name === packageName && versionSpecifierMatches(value.version, version)) {
    return true;
  }

  for (const [key, child] of Object.entries(value)) {
    if (packageKeyMatches(key, packageName)) {
      if (typeof child === 'string' && versionSpecifierMatches(child, version)) {
        return true;
      }
      if (child && typeof child === 'object' && versionSpecifierMatches(child.version, version)) {
        return true;
      }
    }

    if (child && typeof child === 'object' && jsonReferencesPackageVersion(child, packageName, version)) {
      return true;
    }
  }

  return false;
}

function textReferencesPackageVersion(text, packageName, version) {
  const escapedPackage = escapeRegExp(packageName);
  const escapedVersion = escapeRegExp(version);
  const packageToken = `${escapedPackage}(?![A-Za-z0-9._/-])`;
  const sameLinePattern = new RegExp(`${packageToken}[^\\n]{0,200}${escapedVersion}(?![0-9A-Za-z.])`, 'i');
  const requirementsPattern = new RegExp(`^\\s*${packageToken}\\s*(?:==|===|~=|>=|<=|>|<)\\s*${escapedVersion}(?![0-9A-Za-z.])`, 'im');
  const poetryNamePattern = new RegExp(`name\\s*=\\s*["']${escapedPackage}["'][\\s\\S]{0,300}?version\\s*=\\s*["']${escapedVersion}["']`, 'i');

  return sameLinePattern.test(text)
    || requirementsPattern.test(text)
    || poetryNamePattern.test(text);
}

function dependencyFileReferencesPackageVersion(text, packageName, version) {
  try {
    return jsonReferencesPackageVersion(JSON.parse(text), packageName, version);
  } catch {
    return textReferencesPackageVersion(text, packageName, version);
  }
}

function addFinding(findings, severity, filePath, line, indicator, message) {
  findings.push({ severity, filePath, line, indicator, message });
}

function isClaudeSettingsFile(filePath) {
  const normalized = normalizedPath(filePath);
  return /\/\.claude\/settings(?:\.local)?\.json$/.test(normalized);
}

function claudePermissionDenyRanges(filePath, text) {
  if (!isClaudeSettingsFile(filePath)) return [];

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return [];
  }

  const denyEntries = parsed?.permissions?.deny;
  if (!Array.isArray(denyEntries)) return [];

  const ranges = [];
  for (const entry of denyEntries) {
    if (typeof entry !== 'string' || entry.length === 0) continue;

    for (const needle of [...new Set([JSON.stringify(entry), entry])]) {
      let index = text.indexOf(needle);
      while (index !== -1) {
        ranges.push([index, index + needle.length]);
        index = text.indexOf(needle, index + needle.length);
      }
    }
  }

  return ranges;
}

function indexInRanges(index, ranges) {
  return ranges.some(([start, end]) => index >= start && index < end);
}

function scanFile(filePath, rootDir, findings) {
  const base = path.basename(filePath);
  const relativePath = path.relative(rootDir, filePath) || filePath;
  const text = readText(filePath);
  const lowerText = normalizeForMatch(text);
  const hashFinding = MALICIOUS_FILE_HASHES[sha256File(filePath)];
  const defensiveClaudeDenyRanges = claudePermissionDenyRanges(filePath, text);

  if (hashFinding) {
    addFinding(
      findings,
      'critical',
      relativePath,
      1,
      hashFinding.indicator,
      hashFinding.message,
    );
  }

  if (PAYLOAD_FILENAMES.has(base)) {
    addFinding(
      findings,
      'critical',
      relativePath,
      1,
      base,
      'Known Mini Shai-Hulud/TanStack payload or persistence filename is present',
    );
  }

  if (isGhTokenMonitorTokenPath(filePath)) {
    addFinding(
      findings,
      'critical',
      relativePath,
      1,
      '~/.config/gh-token-monitor/token',
      'Known Mini Shai-Hulud dead-man switch token store is present',
    );
  }

  for (const indicator of CRITICAL_TEXT_INDICATORS) {
    const normalizedIndicator = normalizeForMatch(indicator);
    let index = lowerText.indexOf(normalizedIndicator);
    while (index !== -1) {
      if (!indexInRanges(index, defensiveClaudeDenyRanges)) {
        addFinding(
          findings,
          'critical',
          relativePath,
          lineForIndex(text, index),
          indicator,
          'Known active supply-chain IOC is present',
        );
        break;
      }

      index = lowerText.indexOf(normalizedIndicator, index + normalizedIndicator.length);
    }
  }

  if (!DEPENDENCY_FILENAMES.has(base)) return;

  for (const [packageName, versions] of Object.entries(MALICIOUS_PACKAGE_VERSIONS)) {
    for (const version of versions) {
      if (dependencyFileReferencesPackageVersion(text, packageName, version)) {
        const packageIndex = lowerText.indexOf(normalizeForMatch(packageName));
        addFinding(
          findings,
          'critical',
          relativePath,
          lineForIndex(text, packageIndex === -1 ? 0 : packageIndex),
          `${packageName}@${version}`,
          'Dependency manifest or lockfile references a known compromised package version',
        );
      }
    }
  }
}

function homeTargets(homeDir) {
  return [
    '.claude/settings.json',
    '.claude/settings.local.json',
    '.claude/hooks/hooks.json',
    '.claude/router_runtime.js',
    '.claude/setup.mjs',
    '.vscode/tasks.json',
    '.vscode/setup.mjs',
    'Library/Application Support/Code/User/tasks.json',
    'Library/Application Support/Code - Insiders/User/tasks.json',
    '.config/Code/User/tasks.json',
    '.config/Code - Insiders/User/tasks.json',
    'AppData/Roaming/Code/User/tasks.json',
    'AppData/Roaming/Code - Insiders/User/tasks.json',
    'Library/LaunchAgents/com.user.gh-token-monitor.plist',
    '.config/systemd/user/gh-token-monitor.service',
    '.config/systemd/user/pgsql-monitor.service',
    '.config/gh-token-monitor/token',
    '.local/bin/gh-token-monitor.sh',
    '.local/bin/pgmonitor.py',
  ].map(relativePath => path.join(homeDir, relativePath));
}

function runtimeTargets() {
  return [
    '/tmp/transformers.pyz',
    '/tmp/pgmonitor.py',
    '/tmp/node-ipc-9.1.6.tgz',
    '/tmp/node-ipc-9.2.3.tgz',
    '/tmp/node-ipc-12.0.1.tar.gz',
    '/private/tmp/transformers.pyz',
    '/private/tmp/pgmonitor.py',
    '/private/tmp/node-ipc-9.1.6.tgz',
    '/private/tmp/node-ipc-9.2.3.tgz',
    '/private/tmp/node-ipc-12.0.1.tar.gz',
  ];
}

function scanSupplyChainIocs(options = {}) {
  const rootDir = path.resolve(options.rootDir || DEFAULT_ROOT);
  const files = walkFiles(rootDir);
  const findings = [];

  if (options.home) {
    for (const target of homeTargets(options.homeDir || os.homedir())) {
      if (fs.existsSync(target)) files.push(target);
    }
    for (const target of runtimeTargets()) {
      if (fs.existsSync(target)) files.push(target);
    }
  }

  for (const filePath of [...new Set(files)].sort()) {
    scanFile(filePath, rootDir, findings);
  }

  return {
    rootDir,
    scannedFiles: files.length,
    findings,
  };
}

function parseArgs(argv) {
  const options = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      options.help = true;
    } else if (arg === '--root') {
      options.rootDir = argv[++i];
    } else if (arg === '--home') {
      options.home = true;
    } else if (arg === '--home-dir') {
      options.home = true;
      options.homeDir = argv[++i];
    } else if (arg === '--json') {
      options.json = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return options;
}

function printHelp() {
  console.log(`Usage: node scripts/ci/scan-supply-chain-iocs.js [options]

Scan dependency manifests, lockfiles, installed package payloads, and AI-tool
persistence paths for active supply-chain IOC markers.

Options:
  --root <dir>       Directory to scan (default: repo root)
  --home             Also scan user-level Claude, VS Code, LaunchAgent, systemd,
                     local bin, and /tmp persistence targets
  --home-dir <dir>   Home directory to use with --home
  --json             Emit JSON instead of text
  --help, -h         Show this help

Examples:
  node scripts/ci/scan-supply-chain-iocs.js --home
  node scripts/ci/scan-supply-chain-iocs.js --root /path/to/project --json
`);
}

function printReport(result, json = false) {
  if (json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (result.findings.length === 0) {
    console.log(`Supply-chain IOC scan passed for ${result.rootDir} (${result.scannedFiles} files inspected)`);
    return;
  }

  for (const finding of result.findings) {
    console.error(
      `${finding.severity.toUpperCase()}: ${finding.filePath}:${finding.line} ${finding.indicator}`,
    );
    console.error(`  ${finding.message}`);
  }
}

if (require.main === module) {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (options.help) {
      printHelp();
      process.exit(0);
    }
    const result = scanSupplyChainIocs(options);
    printReport(result, options.json);
    process.exit(result.findings.length > 0 ? 1 : 0);
  } catch (error) {
    console.error(error.message);
    process.exit(2);
  }
}

module.exports = {
  CRITICAL_TEXT_INDICATORS,
  MALICIOUS_FILE_HASHES,
  MALICIOUS_PACKAGE_VERSIONS,
  scanSupplyChainIocs,
};
