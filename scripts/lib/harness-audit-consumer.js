'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const TOML = require('@iarna/toml');

const IGNORED_SCAN_DIRS = new Set([
  '.git',
  '.eggs',
  '.mypy_cache',
  '.nox',
  '.pytest_cache',
  '.ruff_cache',
  '.tox',
  '.venv',
  '__pycache__',
  '__pypackages__',
  'build',
  'dist',
  'env',
  'node_modules',
  'site-packages',
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

  function visit(current) {
    let entries;
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch (_error) {
      return [];
    }

    return entries.flatMap(entry => {
      const nextPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        return IGNORED_SCAN_DIRS.has(entry.name) ? [] : visit(nextPath);
      }
      return entry.isFile() && predicate(entry.name, nextPath) ? [nextPath] : [];
    });
  }

  const files = relativeRoots.flatMap(relativeRoot => {
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
      return [];
    }
    try {
      const realRoot = fs.realpathSync(scanRoot);
      const realRelative = path.relative(projectRoot, realRoot);
      if (
        realRelative === '..' ||
        realRelative.startsWith(`..${path.sep}`) ||
        path.isAbsolute(realRelative)
      ) {
        return [];
      }
    } catch (_error) {
      return [];
    }
    if (fs.statSync(scanRoot).isFile()) {
      return predicate(path.basename(scanRoot), scanRoot) ? [scanRoot] : [];
    }
    return visit(scanRoot);
  });

  return new Set(files);
}

function parseIniOption(text, sectionName, optionName) {
  if (!text) return [];
  const sectionPattern = new RegExp(
    `^\\s*\\[${sectionName.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&')}\\]\\s*$`,
    'i'
  );
  const lines = text.split(/\r?\n/);
  let inSection = false;
  let collecting = false;
  let values = [];

  for (const line of lines) {
    if (/^\s*\[.*]\s*$/.test(line)) {
      inSection = sectionPattern.test(line);
      collecting = false;
      continue;
    }
    if (!inSection || /^\s*[#;]/.test(line)) continue;

    const match = line.match(new RegExp(`^\\s*${optionName}\\s*=\\s*(.*)$`, 'i'));
    if (match) {
      collecting = true;
      values = [...values, match[1]];
      continue;
    }
    if (collecting && /^\s+\S/.test(line)) {
      values = [...values, line.trim()];
    } else if (line.trim()) {
      collecting = false;
    }
  }

  return values
    .flatMap(value => value.match(/"[^"]*"|'[^']*'|\S+/g) || [])
    .map(value => value.replace(/^['"]|['"]$/g, '').trim())
    .filter(Boolean);
}

function normalizeTomlList(value) {
  if (Array.isArray(value)) {
    return value.filter(item => typeof item === 'string' && item.trim());
  }
  return typeof value === 'string' ? value.split(/\s+/) : [];
}

function getActivePytestConfig(rootDir) {
  for (const fileName of ['pytest.toml', '.pytest.toml']) {
    const configPath = path.join(rootDir, fileName);
    if (!fs.existsSync(configPath)) continue;
    const text = safeRead(configPath);
    try {
      const config = TOML.parse(text)?.pytest || {};
      return {
        paths: normalizeTomlList(config.testpaths),
        pythonFiles: normalizeTomlList(config.python_files),
      };
    } catch (_error) {
      return null;
    }
  }

  for (const fileName of ['pytest.ini', '.pytest.ini']) {
    const configPath = path.join(rootDir, fileName);
    if (!fs.existsSync(configPath)) continue;
    const text = safeRead(configPath);
    if (!text.trim() || /^\s*\[pytest]\s*$/m.test(text)) {
      return {
        paths: parseIniOption(text, 'pytest', 'testpaths'),
        pythonFiles: parseIniOption(text, 'pytest', 'python_files'),
      };
    }
  }

  const pyproject = safeRead(path.join(rootDir, 'pyproject.toml'));
  if (/^\s*\[tool\.pytest(?:\.ini_options)?]\s*$/m.test(pyproject)) {
    try {
      const pytest = TOML.parse(pyproject)?.tool?.pytest || {};
      const config = pytest.ini_options || pytest;
      return {
        paths: normalizeTomlList(config.testpaths),
        pythonFiles: normalizeTomlList(config.python_files),
      };
    } catch (_error) {
      return null;
    }
  }

  const tox = safeRead(path.join(rootDir, 'tox.ini'));
  if (/^\s*\[pytest]\s*$/m.test(tox)) {
    return {
      paths: parseIniOption(tox, 'pytest', 'testpaths'),
      pythonFiles: parseIniOption(tox, 'pytest', 'python_files'),
    };
  }

  const setupCfg = safeRead(path.join(rootDir, 'setup.cfg'));
  if (/^\s*\[tool:pytest]\s*$/m.test(setupCfg)) {
    return {
      paths: parseIniOption(setupCfg, 'tool:pytest', 'testpaths'),
      pythonFiles: parseIniOption(setupCfg, 'tool:pytest', 'python_files'),
    };
  }

  return null;
}

function hasGlobSyntax(value) {
  return /[*?[]/.test(value);
}

function getGlobScanRoot(pattern) {
  const segments = pattern.replace(/\\/g, '/').split('/');
  const staticSegments = segments.slice(0, segments.findIndex(hasGlobSyntax));
  return staticSegments.join('/') || '.';
}

function matchesGlobPath(relativePath, pattern) {
  const candidate = relativePath.split(path.sep).join('/');
  const normalized = pattern.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/$/, '');
  let matcher;
  try {
    matcher = new RegExp(`^${globToRegex(normalized)}$`);
  } catch (_error) {
    return false;
  }
  const segments = candidate.split('/');
  return segments.some((_, index) => matcher.test(segments.slice(0, index + 1).join('/')));
}

function globMatchesAnyPath(rootDir, scanRoot, pattern) {
  const projectRoot = fs.realpathSync(rootDir);
  const absoluteRoot = path.resolve(projectRoot, scanRoot);
  if (!fs.existsSync(absoluteRoot)) return false;
  try {
    const realRoot = fs.realpathSync(absoluteRoot);
    const relative = path.relative(projectRoot, realRoot);
    if (
      relative === '..' ||
      relative.startsWith(`..${path.sep}`) ||
      path.isAbsolute(relative)
    ) {
      return false;
    }
  } catch (_error) {
    return false;
  }

  function visit(current) {
    const relative = path.relative(projectRoot, current);
    if (relative && matchesGlobPath(relative, pattern)) return true;

    let entries;
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch (_error) {
      return false;
    }
    return entries.some(entry => {
      if (entry.isDirectory() && IGNORED_SCAN_DIRS.has(entry.name)) return false;
      return visit(path.join(current, entry.name));
    });
  }

  return visit(absoluteRoot);
}

function countPythonTestFiles(rootDir) {
  const config = getActivePytestConfig(rootDir);
  const configured = config?.paths || [];
  const patterns = config?.pythonFiles?.length > 0
    ? config.pythonFiles
    : ['test_*.py', '*_test.py'];
  const isPythonTestFile = fileName => patterns.some(pattern =>
    matchesGlobPath(fileName, pattern)
  );
  let roots = configured.length > 0 ? configured : ['.'];
  const directRoots = roots.filter(value => !hasGlobSyntax(value));
  let files = walkFiles(rootDir, directRoots, isPythonTestFile);
  let configuredPathMatched = directRoots.some(relativeRoot => {
    const candidate = path.resolve(fs.realpathSync(rootDir), relativeRoot);
    const relative = path.relative(fs.realpathSync(rootDir), candidate);
    return relative !== '..' &&
      !relative.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relative) &&
      fs.existsSync(candidate);
  });

  for (const pattern of roots.filter(hasGlobSyntax)) {
    const scanRoot = getGlobScanRoot(pattern);
    const normalizedPattern = pattern.replace(/\\/g, '/').replace(/\/$/, '');
    const recursiveRootMatch = normalizedPattern.endsWith('/**') &&
      fs.existsSync(path.resolve(fs.realpathSync(rootDir), scanRoot));
    const matching = walkFiles(
      rootDir,
      [scanRoot],
      (fileName, filePath) => isPythonTestFile(fileName) &&
        matchesGlobPath(path.relative(fs.realpathSync(rootDir), filePath), pattern)
    );
    const matchingPaths = walkFiles(
      rootDir,
      [scanRoot],
      (_fileName, filePath) => matchesGlobPath(
        path.relative(fs.realpathSync(rootDir), filePath),
        pattern
      )
    );
    configuredPathMatched = configuredPathMatched ||
      recursiveRootMatch ||
      matchingPaths.size > 0 ||
      globMatchesAnyPath(rootDir, scanRoot, pattern);
    files = new Set([...files, ...matching]);
  }
  if (configured.length > 0 && !configuredPathMatched) {
    roots = ['.'];
    files = walkFiles(rootDir, roots, isPythonTestFile);
  }

  return files.size;
}

function toxInvokesPytest(text) {
  if (!text) return false;
  const lines = text.split(/\r?\n/);
  let inTestEnv = false;
  let collectingCommands = false;

  for (const line of lines) {
    const section = line.match(/^\s*\[([^\]]+)]\s*$/);
    if (section) {
      inTestEnv = /^testenv(?::|$)/i.test(section[1]);
      collectingCommands = false;
      continue;
    }
    if (!inTestEnv || /^\s*[#;]/.test(line)) continue;

    const command = line.match(/^\s*commands\s*=\s*(.*)$/i);
    if (command) {
      collectingCommands = true;
      if (command[1].trim().split(/\s+/).some(token => token === 'pytest')) return true;
      continue;
    }
    if (collectingCommands && /^\s+\S/.test(line)) {
      if (line.trim().split(/\s+/).some(token => token === 'pytest')) return true;
    } else if (line.trim()) {
      collectingCommands = false;
    }
  }

  return false;
}

function hasPythonTestSuite(rootDir, pythonTestCount = countPythonTestFiles(rootDir)) {
  return Boolean(getActivePytestConfig(rootDir)) ||
    pythonTestCount > 0 ||
    walkFiles(rootDir, ['.'], fileName => fileName === 'conftest.py').size > 0 ||
    toxInvokesPytest(safeRead(path.join(rootDir, 'tox.ini')));
}

function globToRegex(pattern) {
  let output = '';
  for (let index = 0; index < pattern.length; index += 1) {
    const char = pattern[index];
    if (char === '*' && pattern[index + 1] === '*') {
      if (pattern[index + 2] === '/') {
        output += '(?:.*/)?';
        index += 2;
      } else {
        output += '.*';
        index += 1;
      }
    } else if (char === '*') {
      output += '[^/]*';
    } else if (char === '?') {
      output += '[^/]';
    } else if (char === '[') {
      const closing = pattern.indexOf(']', index + 1);
      if (closing > index + 1) {
        let content = pattern.slice(index + 1, closing);
        const negated = content.startsWith('!') || content.startsWith('^');
        if (negated) content = content.slice(1);
        output += `[${negated ? '^' : ''}${content.replace(/\\/g, '\\\\')}]`;
        index = closing;
      } else {
        output += '\\[';
      }
    } else {
      output += char.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }
  }
  return output;
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
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-gitignore-'));
  const repoRoot = path.join(tempRoot, 'repo');
  const templateRoot = path.join(tempRoot, 'template');

  try {
    fs.mkdirSync(repoRoot);
    fs.mkdirSync(templateRoot);
    fs.writeFileSync(path.join(repoRoot, '.gitignore'), text);
    const init = spawnSync('git', ['init', '--quiet', `--template=${templateRoot}`, repoRoot], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 5000,
    });
    if (init.error || init.status !== 0) return false;

    const result = spawnSync(
      'git',
      ['-C', repoRoot, '-c', `core.excludesFile=${os.devNull}`, 'check-ignore', '--no-index', '--stdin'],
      {
        input: `${candidates.join('\n')}\n`,
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: 5000,
      }
    );
    return !result.error && result.status === 0 && Boolean(result.stdout.trim());
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

module.exports = {
  countPythonTestFiles,
  gitignoreIgnoresEnvFiles,
  hasPythonTestSuite,
};
