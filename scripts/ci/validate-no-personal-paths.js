#!/usr/bin/env node
/**
 * Prevent shipping user-specific absolute paths in public docs/skills/commands.
 *
 * Catches generic `/Users/<name>` (macOS) and `C:\Users\<name>` (Windows) paths,
 * while allowing obvious placeholder usernames used in templates/examples.
 * Forensic incident reports under `docs/fixes/` are exempt because they may
 * legitimately document a reporter's local machine path.
 *
 * Usage:
 *   node scripts/ci/validate-no-personal-paths.js
 *   node scripts/ci/validate-no-personal-paths.js --root <dir>
 *
 * `--root` scans another tree with the same rules. It exists so a generated
 * profile carrier can be validated the same way this repository is, which is
 * the only way that check can assert unconditionally instead of guessing
 * from stderr whether the flag was understood.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const HELP = `Usage: node scripts/ci/validate-no-personal-paths.js [--root <dir>]

Fails when a shipped file contains a user-specific absolute path
(/Users/<name> or C:\\Users\\<name>), ignoring placeholder usernames.

  --root <dir>  Scan <dir> instead of the repository root. Used to validate
                a generated carrier tree.
`;

function parseArgs(argv) {
  const options = { root: path.join(__dirname, '../..'), help: false };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--help' || argv[i] === '-h') {
      options.help = true;
    } else if (argv[i] === '--root') {
      const value = argv[i + 1];
      if (!value || value.startsWith('--')) {
        console.error('ERROR: --root requires a directory');
        process.exit(2);
      }
      options.root = path.resolve(value);
      i += 1;
    } else {
      console.error(`ERROR: unknown argument ${argv[i]}`);
      process.exit(2);
    }
  }
  return options;
}

const options = parseArgs(process.argv.slice(2));
if (options.help) {
  process.stdout.write(HELP);
  process.exit(0);
}

const ROOT = options.root;
if (!fs.existsSync(ROOT) || !fs.statSync(ROOT).isDirectory()) {
  console.error(`ERROR: --root is not a directory: ${ROOT}`);
  process.exit(2);
}

const TARGETS = [
  'README.md',
  'skills',
  'commands',
  'agents',
  'docs',
  '.opencode/commands',
  // Carrier-only surfaces. Absent in the repository, scanned when --root
  // points at a generated carrier.
  'on-demand',
  'ecc-profile.json',
];

const EXEMPT_PREFIXES = [
  'docs/fixes/',
];

const PLACEHOLDER_USERNAMES = new Set([
  'example',
  'me',
  'user',
  'username',
  'you',
  'yourname',
  'yourusername',
  'your-username',
]);

const POSIX_USER_RE = /\/Users\/([a-zA-Z][a-zA-Z0-9._-]*)/g;
const WIN_USER_RE = /C:\\Users\\([a-zA-Z][a-zA-Z0-9._-]*)/gi;

function repoRelative(file) {
  return path.relative(ROOT, file).split(path.sep).join('/');
}

function isExempt(file) {
  const rel = repoRelative(file);
  return EXEMPT_PREFIXES.some(prefix => rel.startsWith(prefix));
}

function findLeaks(content) {
  const leaks = [];

  for (const pattern of [POSIX_USER_RE, WIN_USER_RE]) {
    pattern.lastIndex = 0;
    let match;

    while ((match = pattern.exec(content)) !== null) {
      if (!PLACEHOLDER_USERNAMES.has(match[1].toLowerCase())) {
        leaks.push(match[0]);
      }
    }
  }

  return leaks;
}

function collectFiles(targetPath, out) {
  if (!fs.existsSync(targetPath)) return;
  const stat = fs.statSync(targetPath);
  if (stat.isFile()) {
    out.push(targetPath);
    return;
  }

  for (const entry of fs.readdirSync(targetPath)) {
    if (entry === 'node_modules' || entry === '.git') continue;
    collectFiles(path.join(targetPath, entry), out);
  }
}

const files = [];
for (const target of TARGETS) {
  collectFiles(path.join(ROOT, target), files);
}

let failures = 0;
for (const file of files) {
  if (!/\.(md|json|js|ts|sh|toml|yml|yaml)$/i.test(file)) continue;
  if (isExempt(file)) continue;

  const content = fs.readFileSync(file, 'utf8');
  const leaks = findLeaks(content);

  for (const leak of leaks) {
    console.error(`ERROR: personal path "${leak}" detected in ${repoRelative(file)}`);
    failures += 1;
  }
}

if (failures > 0) {
  process.exit(1);
}

console.log(`Validated: no personal absolute paths under ${ROOT}`);
