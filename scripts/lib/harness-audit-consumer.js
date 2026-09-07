'use strict';

const fs = require('fs');
const path = require('path');
const TOML = require('@iarna/toml');

const IGNORED_SCAN_DIRS = new Set([
  '.git',
  '.nox',
  '.pytest_cache',
  '.tox',
  '.venv',
  '__pycache__',
  'build',
  'dist',
  'env',
  'node_modules',
  'venv',
  'vendor',
]);

function safeRead(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch (_error) {
    return '';
  }
}

function walkFiles(rootDir, relativeRoots, predicate) {
  const projectRoot = fs.realpathSync(path.resolve(rootDir));
  const files = new Set();

  for (const relativeRoot of relativeRoots) {
    const scanRoot = path.resolve(projectRoot, relativeRoot);
    const relative = path.relative(projectRoot, scanRoot);
    const segments = relative.split(path.sep).filter(Boolean);
    if (
      relative === '..' ||
      relative.startsWith(`..${path.sep}`) ||
      path.isAbsolute(relative) ||
      segments.some(segment => IGNORED_SCAN_DIRS.has(segment)) ||
      !fs.existsSync(scanRoot)
    ) {
      continue;
    }
    try {
      const realRoot = fs.realpathSync(scanRoot);
      const realRelative = path.relative(projectRoot, realRoot);
      if (
        realRelative === '..' ||
        realRelative.startsWith(`..${path.sep}`) ||
        path.isAbsolute(realRelative)
      ) {
        continue;
      }
    } catch (_error) {
      continue;
    }

    const stack = [scanRoot];
    while (stack.length > 0) {
      const current = stack.pop();
      let entries;
      try {
        entries = fs.readdirSync(current, { withFileTypes: true });
      } catch (_error) {
        continue;
      }

      for (const entry of entries) {
        const nextPath = path.join(current, entry.name);
        if (entry.isDirectory()) {
          if (!IGNORED_SCAN_DIRS.has(entry.name)) {
            stack.push(nextPath);
          }
        } else if (entry.isFile() && predicate(entry.name, nextPath)) {
          files.add(nextPath);
        }
      }
    }
  }

  return files;
}

function parseIniTestPaths(text, sectionName) {
  if (!text) return [];
  const sectionPattern = new RegExp(
    `^\\s*\\[${sectionName.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&')}\\]\\s*$`,
    'i'
  );
  const lines = text.split(/\r?\n/);
  let inSection = false;
  let collecting = false;
  const values = [];

  for (const line of lines) {
    if (/^\s*\[.*]\s*$/.test(line)) {
      inSection = sectionPattern.test(line);
      collecting = false;
      continue;
    }
    if (!inSection || /^\s*[#;]/.test(line)) continue;

    const match = line.match(/^\s*testpaths\s*=\s*(.*)$/i);
    if (match) {
      collecting = true;
      values.push(match[1]);
      continue;
    }
    if (collecting && /^\s+\S/.test(line)) {
      values.push(line.trim());
    } else if (line.trim()) {
      collecting = false;
    }
  }

  return values
    .flatMap(value => value.split(/\s+/))
    .map(value => value.replace(/^['"]|['"]$/g, '').trim())
    .filter(Boolean);
}

function getPytestTestPaths(rootDir) {
  const paths = [];
  const pyproject = safeRead(path.join(rootDir, 'pyproject.toml'));
  if (pyproject) {
    try {
      const configured = TOML.parse(pyproject)?.tool?.pytest?.ini_options?.testpaths;
      if (Array.isArray(configured)) paths.push(...configured);
      else if (typeof configured === 'string') paths.push(...configured.split(/\s+/));
    } catch (_error) {
      // Malformed project metadata is not evidence of a configured test path.
    }
  }

  paths.push(...parseIniTestPaths(safeRead(path.join(rootDir, 'pytest.ini')), 'pytest'));
  paths.push(...parseIniTestPaths(safeRead(path.join(rootDir, 'tox.ini')), 'pytest'));
  paths.push(...parseIniTestPaths(safeRead(path.join(rootDir, 'setup.cfg')), 'tool:pytest'));

  return [...new Set(paths.filter(value => typeof value === 'string' && value.trim()))];
}

function isPythonTestFile(fileName) {
  return /^(test_.*|.*_test)\.py$/i.test(fileName);
}

function countPythonTestFiles(rootDir) {
  const roots = ['tests', ...getPytestTestPaths(rootDir)];
  return walkFiles(rootDir, roots, isPythonTestFile).size;
}

function hasPythonTestSuite(rootDir, pythonTestCount = countPythonTestFiles(rootDir)) {
  const pyproject = safeRead(path.join(rootDir, 'pyproject.toml'));
  const setupCfg = safeRead(path.join(rootDir, 'setup.cfg'));
  const hasConfig = (
    /^\s*\[tool\.pytest\.ini_options]\s*$/m.test(pyproject)
    || /^\s*\[tool:pytest]\s*$/m.test(setupCfg)
    || fs.existsSync(path.join(rootDir, 'pytest.ini'))
    || fs.existsSync(path.join(rootDir, 'tox.ini'))
  );
  return hasConfig ||
    pythonTestCount > 0 ||
    walkFiles(rootDir, ['.'], fileName => fileName === 'conftest.py').size > 0;
}

function globToRegex(pattern) {
  let output = '';
  for (let index = 0; index < pattern.length; index += 1) {
    const char = pattern[index];
    if (char === '*' && pattern[index + 1] === '*') {
      output += '.*';
      index += 1;
    } else if (char === '*') {
      output += '[^/]*';
    } else if (char === '?') {
      output += '[^/]';
    } else {
      output += char.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }
  }
  return output;
}

function matchesGitignorePattern(candidate, rawPattern) {
  const directoryOnly = rawPattern.endsWith('/');
  const anchored = rawPattern.startsWith('/');
  const pattern = rawPattern.replace(/^\//, '').replace(/\/$/, '');
  if (!pattern) return false;

  const body = globToRegex(pattern);
  const prefix = anchored || pattern.includes('/') ? '^' : '(^|.*/)';
  const suffix = directoryOnly ? '(/.*)?$' : '$';
  return new RegExp(`${prefix}${body}${suffix}`).test(candidate);
}

function gitignoreIgnoresEnvFiles(text) {
  if (typeof text !== 'string' || !text.trim()) return false;
  const candidates = [
    '.env',
    '.env.local',
    '.env.production',
    '.env/example',
    'config/.env',
    'secrets.env',
  ];
  const states = new Map(candidates.map(candidate => [candidate, false]));

  for (const rawLine of text.split(/\r?\n/)) {
    let line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    let negated = false;
    if (line.startsWith('!')) {
      negated = true;
      line = line.slice(1);
    } else if (line.startsWith('\\#') || line.startsWith('\\!')) {
      line = line.slice(1);
    }
    if (!line) continue;

    for (const candidate of candidates) {
      if (matchesGitignorePattern(candidate, line)) {
        states.set(candidate, !negated);
      }
    }
  }

  return [...states.values()].some(Boolean);
}

module.exports = {
  countPythonTestFiles,
  gitignoreIgnoresEnvFiles,
  hasPythonTestSuite,
};
