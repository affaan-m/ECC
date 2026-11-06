#!/usr/bin/env node
/**
 * Package Manager Setup Script
 *
 * Interactive script to configure preferred package manager.
 * Can be run directly or via the /setup-pm command.
 *
 * Usage:
 *   node scripts/setup-package-manager.js [pm-name]
 *   node scripts/setup-package-manager.js --detect
 *   node scripts/setup-package-manager.js --global pnpm
 *   node scripts/setup-package-manager.js --project bun
 */

const {
  PACKAGE_MANAGERS,
  isSupportedPackageManager,
  getPackageManager,
  setPreferredPackageManager,
  setProjectPackageManager,
  getAvailablePackageManagers,
  detectFromLockFile,
  detectFromPackageJson
} = require('./lib/package-manager');

function showHelp() {
  console.log(`
Package Manager Setup for Claude Code

Usage:
  node scripts/setup-package-manager.js [options] [package-manager]

Options:
  --detect        Detect and show current package manager
  --global <pm>   Set global preference (saves to ~/.claude/package-manager.json)
  --project <pm>  Set project preference (saves to .claude/package-manager.json)
  --list          List available package managers
  --help          Show this help message

Package Managers:
  npm             Node Package Manager (default with Node.js)
  pnpm            Fast, disk space efficient package manager
  yarn            Classic Yarn package manager
  bun             All-in-one JavaScript runtime & toolkit

Examples:
  # Detect current package manager
  node scripts/setup-package-manager.js --detect

  # Set pnpm as global preference
  node scripts/setup-package-manager.js --global pnpm

  # Set bun for current project
  node scripts/setup-package-manager.js --project bun

  # List available package managers
  node scripts/setup-package-manager.js --list
`);
}

function detectAndShow() {
  const pm = getPackageManager();
  const available = getAvailablePackageManagers();
  const fromLock = detectFromLockFile();
  const fromPkg = detectFromPackageJson();

  console.log('\n=== Package Manager Detection ===\n');

  console.log('Current selection:');
  console.log(`  Package Manager: ${pm.name}`);
  console.log(`  Source: ${pm.source}`);
  console.log('');

  console.log('Detection results:');
  console.log(`  From package.json: ${fromPkg || 'not specified'}`);
  console.log(`  From lock file: ${fromLock || 'not found'}`);
  console.log(`  Environment var: ${process.env.CLAUDE_PACKAGE_MANAGER || 'not set'}`);
  console.log('');

  console.log('Available package managers:');
  for (const pmName of Object.keys(PACKAGE_MANAGERS)) {
    const installed = available.includes(pmName);
    const indicator = installed ? '✓' : '✗';
    const current = pmName === pm.name ? ' (current)' : '';
    console.log(`  ${indicator} ${pmName}${current}`);
  }

  console.log('');
  console.log('Commands:');
  console.log(`  Install: ${pm.config.installCmd}`);
  console.log(`  Run script: ${pm.config.runCmd} [script-name]`);
  console.log(`  Execute binary: ${pm.config.execCmd} [binary-name]`);
  console.log('');
}

function listAvailable() {
  const available = getAvailablePackageManagers();
  const pm = getPackageManager();

  console.log('\nAvailable Package Managers:\n');

  for (const pmName of Object.keys(PACKAGE_MANAGERS)) {
    const config = PACKAGE_MANAGERS[pmName];
    const installed = available.includes(pmName);
    const current = pmName === pm.name ? ' (current)' : '';

    console.log(`${pmName}${current}`);
    console.log(`  Installed: ${installed ? 'Yes' : 'No'}`);
    console.log(`  Lock file: ${config.lockFile}`);
    console.log(`  Install: ${config.installCmd}`);
    console.log(`  Run: ${config.runCmd}`);
    console.log('');
  }
}

function setGlobal(pmName) {
  if (!isSupportedPackageManager(pmName)) {
    console.error(`Error: Unknown package manager "${pmName}"`);
    console.error(`Available: ${Object.keys(PACKAGE_MANAGERS).join(', ')}`);
    process.exit(1);
  }

  const available = getAvailablePackageManagers();
  if (!available.includes(pmName)) {
    console.warn(`Warning: ${pmName} is not installed on your system`);
  }

  try {
    setPreferredPackageManager(pmName);
    console.log(`\n✓ Global preference set to: ${pmName}`);
    console.log('  Saved to: ~/.claude/package-manager.json');
    console.log('');
  } catch (err) {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  }
}

function setProject(pmName) {
  if (!isSupportedPackageManager(pmName)) {
    console.error(`Error: Unknown package manager "${pmName}"`);
    console.error(`Available: ${Object.keys(PACKAGE_MANAGERS).join(', ')}`);
    process.exit(1);
  }

  try {
    setProjectPackageManager(pmName);
    console.log(`\n✓ Project preference set to: ${pmName}`);
    console.log('  Saved to: .claude/package-manager.json');
    console.log('');
  } catch (err) {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  }
}

// Main
const args = process.argv.slice(2);

if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
  showHelp();
  process.exit(0);
}

if (args.includes('--detect')) {
  detectAndShow();
  process.exit(0);
}

if (args.includes('--list')) {
  listAvailable();
  process.exit(0);
}

const globalIdx = args.indexOf('--global');
if (globalIdx !== -1) {
  const pmName = args[globalIdx + 1];
  if (!pmName || pmName.startsWith('-')) {
    console.error('Error: --global requires a package manager name');
    process.exit(1);
  }
  setGlobal(pmName);
  process.exit(0);
}

const projectIdx = args.indexOf('--project');
if (projectIdx !== -1) {
  const pmName = args[projectIdx + 1];
  if (!pmName || pmName.startsWith('-')) {
    console.error('Error: --project requires a package manager name');
    process.exit(1);
  }
  setProject(pmName);
  process.exit(0);
}

// If just a package manager name is provided, set it globally
const pmName = args[0];
if (isSupportedPackageManager(pmName)) {
  setGlobal(pmName);
} else {
  console.error(`Error: Unknown option or package manager "${pmName}"`);
  showHelp();
  process.exit(1);
}
