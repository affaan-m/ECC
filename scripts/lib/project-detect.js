/**
 * Project type and framework detection
 *
 * Cross-platform (Windows, macOS, Linux) project type detection
 * by inspecting files in the working directory.
 *
 * Resolves: https://github.com/affaan-m/ECC/issues/293
 */

const fs = require('fs');
const path = require('path');

/**
 * Language detection rules.
 * Each rule checks for marker files or glob patterns in the project root.
 */
const LANGUAGE_RULES = [
  {
    type: 'python',
    markers: ['requirements.txt', 'pyproject.toml', 'setup.py', 'setup.cfg', 'Pipfile', 'poetry.lock'],
    extensions: ['.py']
  },
  {
    type: 'typescript',
    markers: ['tsconfig.json', 'tsconfig.build.json'],
    extensions: ['.ts', '.tsx']
  },
  {
    type: 'javascript',
    markers: ['package.json', 'jsconfig.json'],
    extensions: ['.js', '.jsx', '.mjs']
  },
  {
    type: 'golang',
    markers: ['go.mod', 'go.sum'],
    extensions: ['.go']
  },
  {
    type: 'rust',
    markers: ['Cargo.toml', 'Cargo.lock'],
    extensions: ['.rs']
  },
  {
    type: 'ruby',
    markers: ['Gemfile', 'Gemfile.lock', 'Rakefile'],
    extensions: ['.rb']
  },
  {
    type: 'java',
    markers: ['pom.xml', 'build.gradle', 'build.gradle.kts'],
    extensions: ['.java']
  },
  {
    type: 'c',
    markers: [],
    extensions: ['.c']
  },
  {
    type: 'csharp',
    markers: [],
    extensions: ['.cs', '.csproj', '.sln']
  },
  {
    type: 'fsharp',
    markers: [],
    extensions: ['.fs', '.fsx', '.fsproj']
  },
  {
    type: 'swift',
    markers: ['Package.swift'],
    extensions: ['.swift']
  },
  {
    type: 'kotlin',
    markers: [],
    extensions: ['.kt', '.kts']
  },
  {
    type: 'elixir',
    markers: ['mix.exs'],
    extensions: ['.ex', '.exs']
  },
  {
    type: 'php',
    markers: ['composer.json', 'composer.lock'],
    extensions: ['.php']
  },
  {
    type: 'dart',
    markers: ['pubspec.yaml', 'pubspec.lock'],
    extensions: ['.dart']
  }
];

/**
 * Framework detection rules.
 * Checked after language detection for more specific identification.
 */
const FRAMEWORK_RULES = [
  // Python frameworks
  { framework: 'django', language: 'python', markers: ['manage.py'], packageKeys: ['django'] },
  { framework: 'fastapi', language: 'python', markers: [], packageKeys: ['fastapi'] },
  { framework: 'flask', language: 'python', markers: [], packageKeys: ['flask'] },

  // JavaScript/TypeScript frameworks
  { framework: 'nextjs', language: 'typescript', markers: ['next.config.js', 'next.config.mjs', 'next.config.ts'], packageKeys: ['next'] },
  { framework: 'react', language: 'typescript', markers: [], packageKeys: ['react'] },
  { framework: 'vue', language: 'typescript', markers: ['vue.config.js'], packageKeys: ['vue'] },
  { framework: 'angular', language: 'typescript', markers: ['angular.json'], packageKeys: ['@angular/core'] },
  { framework: 'svelte', language: 'typescript', markers: ['svelte.config.js'], packageKeys: ['svelte'] },
  { framework: 'express', language: 'javascript', markers: [], packageKeys: ['express'] },
  { framework: 'nestjs', language: 'typescript', markers: ['nest-cli.json'], packageKeys: ['@nestjs/core'] },
  { framework: 'remix', language: 'typescript', markers: [], packageKeys: ['@remix-run/node', '@remix-run/react'] },
  { framework: 'astro', language: 'typescript', markers: ['astro.config.mjs', 'astro.config.ts'], packageKeys: ['astro'] },
  { framework: 'nuxt', language: 'typescript', markers: ['nuxt.config.js', 'nuxt.config.ts'], packageKeys: ['nuxt'] },
  { framework: 'electron', language: 'typescript', markers: [], packageKeys: ['electron'] },

  // Ruby frameworks
  { framework: 'rails', language: 'ruby', markers: ['config/routes.rb', 'bin/rails'], packageKeys: [] },

  // Go frameworks
  { framework: 'gin', language: 'golang', markers: [], packageKeys: ['github.com/gin-gonic/gin'] },
  { framework: 'echo', language: 'golang', markers: [], packageKeys: ['github.com/labstack/echo'] },

  // Rust frameworks
  { framework: 'actix', language: 'rust', markers: [], packageKeys: ['actix-web'] },
  { framework: 'axum', language: 'rust', markers: [], packageKeys: ['axum'] },

  // Java frameworks
  { framework: 'spring', language: 'java', markers: [], packageKeys: ['spring-boot', 'org.springframework'] },

  // PHP frameworks
  { framework: 'laravel', language: 'php', markers: ['artisan'], packageKeys: ['laravel/framework'] },
  { framework: 'symfony', language: 'php', markers: ['symfony.lock'], packageKeys: ['symfony/framework-bundle'] },

  // Elixir frameworks
  { framework: 'phoenix', language: 'elixir', markers: [], packageKeys: ['phoenix'] },

  // Dart frameworks
  { framework: 'flutter', language: 'dart', markers: [], packageKeys: [], customCheck: hasFlutterSdkDependency }
];

/**
 * Check if a file exists relative to the project directory
 * @param {string} projectDir - Project root directory
 * @param {string} filePath - Relative file path
 * @returns {boolean}
 */
function fileExists(projectDir, filePath) {
  try {
    return fs.existsSync(path.join(projectDir, filePath));
  } catch {
    return false;
  }
}

/**
 * Read file extensions in the project root once (non-recursive, top-level only).
 * @param {string} projectDir - Project root directory
 * @returns {Set<string>}
 */
function readRootFileExtensions(projectDir) {
  try {
    const entries = fs.readdirSync(projectDir, { withFileTypes: true });
    return new Set(entries.filter(entry => entry.isFile()).map(entry => path.extname(entry.name)));
  } catch {
    return new Set();
  }
}

/**
 * Read and parse package.json dependencies
 * @param {string} projectDir - Project root directory
 * @returns {string[]} Array of dependency names
 */
function getPackageJsonDeps(projectDir) {
  try {
    const pkgPath = path.join(projectDir, 'package.json');
    if (!fs.existsSync(pkgPath)) return [];
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    return [...Object.keys(pkg.dependencies || {}), ...Object.keys(pkg.devDependencies || {})];
  } catch {
    return [];
  }
}

/** Read one quoted TOML value, advancing monotonically even if unfinished. */
function readTomlQuotedValue(content, start) {
  const quote = content[start];
  const delimiter = content.startsWith(quote.repeat(3), start) ? quote.repeat(3) : quote;
  const multiline = delimiter.length === 3;
  let index = start + delimiter.length;
  // TOML trims a newline immediately after a multiline opening delimiter.
  if (multiline && content.startsWith('\r\n', index)) index += 2;
  else if (multiline && content[index] === '\n') index++;
  let valueStart = index;
  let value = '';
  const continuation = /\\[ \t]*\r?\n[ \t\r\n]*/y;
  while (index < content.length) {
    if (quote === '"' && content[index] === '\\') {
      if (multiline) {
        continuation.lastIndex = index;
        const match = continuation.exec(content);
        if (match) {
          value += content.slice(valueStart, index);
          index = continuation.lastIndex;
          valueStart = index;
          continue;
        }
      }
      index += 2;
      continue;
    }
    if (content.startsWith(delimiter, index)) {
      let end = index + delimiter.length;
      // A multiline closing delimiter may be preceded by one or two quotes.
      if (multiline) {
        while (end < index + 5 && content[end] === quote) end++;
      }
      return { value: value + content.slice(valueStart, end - delimiter.length), end };
    }
    if (!multiline && (content[index] === '\n' || content[index] === '\r')) return null;
    index++;
  }
  return null;
}

/**
 * Find a dependency array while keeping quoted values and comments intact.
 * This lightweight scan accepts inline tables too. Its cursor never rewinds,
 * including when an editor has not written a closing quote or bracket yet.
 * @param {string} content - pyproject.toml contents
 * @returns {string[]} Quoted dependency values, or an empty array if unfinished
 */
function readTomlDependencyArray(content) {
  const key = /dependencies\s*=\s*\[/y;
  let values = null;
  let index = 0;
  while (index < content.length) {
    const character = content[index];
    if (character === '#') {
      const newline = content.indexOf('\n', index);
      if (newline < 0) break;
      index = newline + 1;
      continue;
    }
    if (character === '"' || character === "'") {
      const quoted = readTomlQuotedValue(content, index);
      if (!quoted) return [];
      if (values !== null) {
        values = { value: quoted.value, previous: values, length: values.length + 1 };
      }
      index = quoted.end;
      continue;
    }
    if (values === null && character === 'd' && !/[A-Za-z0-9_-]/.test(content[index - 1] || '')) {
      key.lastIndex = index;
      const match = key.exec(content);
      if (match) {
        values = { length: 0 };
        index = key.lastIndex;
        continue;
      }
    }
    // Dependency values are strings; an unquoted opening bracket here can be
    // a later table header while the dependency array is still unfinished.
    if (values !== null && character === '[') return [];
    if (values !== null && character === ']') {
      // Prepending immutable nodes keeps collection linear; restore source order once.
      let current = values;
      const reversed = Array.from({ length: values.length }, () => {
        const value = current.value;
        current = current.previous;
        return value;
      });
      return reversed.map((_, offset) => reversed[reversed.length - 1 - offset]);
    }
    index++;
  }
  return [];
}

/**
 * Read requirements.txt or pyproject.toml for Python package names
 * @param {string} projectDir - Project root directory
 * @returns {string[]} Array of dependency names (lowercase)
 */
function getPythonDeps(projectDir) {
  const deps = [];

  // requirements.txt
  try {
    const reqPath = path.join(projectDir, 'requirements.txt');
    if (fs.existsSync(reqPath)) {
      const content = fs.readFileSync(reqPath, 'utf8');
      content.split('\n').forEach(line => {
        const trimmed = line.trim();
        if (trimmed && !trimmed.startsWith('#') && !trimmed.startsWith('-')) {
          const name = trimmed
            .split(/[\s>=<!~@[;]/)[0]
            .trim()
            .toLowerCase();
          // Bare VCS/URL requirement lines (e.g. `git+https://...#egg=pkg`)
          // carry no leading package name; skip them instead of recording
          // the URL fragment as a dependency name.
          if (name && !name.startsWith('git+') && !name.includes('://')) deps.push(name);
        }
      });
    }
  } catch {
    /* ignore */
  }

  // pyproject.toml — simple extraction of dependency names
  try {
    const tomlPath = path.join(projectDir, 'pyproject.toml');
    if (fs.existsSync(tomlPath)) {
      const content = fs.readFileSync(tomlPath, 'utf8');
      for (const dependency of readTomlDependencyArray(content)) {
        const name = dependency
          .split(/[\s>=<!~@[;]/)[0]
          .trim()
          .toLowerCase();
        if (name) deps.push(name);
      }
    }
  } catch {
    /* ignore */
  }

  return deps;
}

/**
 * Decode the contents of a Go-quoted module path, rejecting malformed escapes.
 * @param {string} value - Quoted token contents without the surrounding quotes
 * @returns {string|null} Decoded UTF-8 path, or null for an invalid token
 */
function decodeGoQuotedPath(value) {
  if (!/^(?:[^"\\\r\n]|\\(?:[abfnrtv\\"]|[0-7]{3}|x[\da-fA-F]{2}|u[\da-fA-F]{4}|U[\da-fA-F]{8}))*$/.test(value)) return null;
  const escaped = { a: '\x07', b: '\b', f: '\f', n: '\n', r: '\r', t: '\t', v: '\v', '\\': '\\', '"': '"' };
  const chunks = [];
  for (const token of value.match(/[^\\]+|\\(?:[abfnrtv\\"]|[0-7]{3}|x[\da-fA-F]{2}|u[\da-fA-F]{4}|U[\da-fA-F]{8})/g) || []) {
    if (!token.startsWith('\\')) {
      chunks.push(Buffer.from(token));
      continue;
    }
    const escape = token.slice(1);
    if (Object.hasOwn(escaped, escape)) {
      chunks.push(Buffer.from(escaped[escape]));
      continue;
    }
    const octal = /^[0-7]/.test(escape);
    const codePoint = Number.parseInt(octal ? escape : escape.slice(1), octal ? 8 : 16);
    const byte = octal || escape.startsWith('x');
    if (byte ? codePoint > 255 : codePoint > 0x10ffff || (codePoint >= 0xd800 && codePoint <= 0xdfff)) return null;
    chunks.push(byte ? Buffer.from([codePoint]) : Buffer.from(String.fromCodePoint(codePoint)));
  }
  try {
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(Buffer.concat(chunks));
  } catch {
    return null;
  }
}

/**
 * Read go.mod for Go module dependencies
 * @param {string} projectDir - Project root directory
 * @returns {string[]} Array of module paths
 */
function getGoDeps(projectDir) {
  try {
    const modPath = path.join(projectDir, 'go.mod');
    if (!fs.existsSync(modPath)) return [];
    const content = fs.readFileSync(modPath, 'utf8');
    const deps = [];
    let inRequireBlock = false;
    for (const rawLine of content.split(/\r?\n/)) {
      const line = rawLine.split('//')[0].trim();
      if (!line) continue;
      if (line === ')' && inRequireBlock) {
        inRequireBlock = false;
        continue;
      }
      const directive = line.match(/^require(?:\s+|(?=\())(.+)$/);
      if (directive?.[1] === '(') {
        inRequireBlock = true;
        continue;
      }
      if (!directive && !inRequireBlock) continue;
      const requirement = (directive ? directive[1] : line)
        .match(/^(?:"((?:[^"\\]|\\.)+)"[ \t]*|([^"'`\s]+)[ \t]+)\S+/);
      if (!requirement) continue;
      const modulePath = requirement[1] === undefined
        ? requirement[2]
        : decodeGoQuotedPath(requirement[1]);
      if (modulePath) deps.push(modulePath);
    }
    return deps;
  } catch {
    return [];
  }
}

/**
 * Read Cargo.toml for Rust crate dependencies
 * @param {string} projectDir - Project root directory
 * @returns {string[]} Array of crate names
 */
function getRustDeps(projectDir) {
  try {
    const cargoPath = path.join(projectDir, 'Cargo.toml');
    if (!fs.existsSync(cargoPath)) return [];
    const content = fs.readFileSync(cargoPath, 'utf8');
    const deps = [];
    // Match [dependencies] and [dev-dependencies] sections
    const sections = content.match(/\[(dev-)?dependencies\]([\s\S]*?)(?=\n\[|$)/g);
    if (sections) {
      sections.forEach(section => {
        section.split('\n').forEach(line => {
          const match = line.match(/^([a-zA-Z0-9_-]+)\s*=/);
          if (match && !line.startsWith('[')) {
            deps.push(match[1]);
          }
        });
      });
    }
    return deps;
  } catch {
    return [];
  }
}

/**
 * Read composer.json for PHP package dependencies
 * @param {string} projectDir - Project root directory
 * @returns {string[]} Array of package names
 */
function getComposerDeps(projectDir) {
  try {
    const composerPath = path.join(projectDir, 'composer.json');
    if (!fs.existsSync(composerPath)) return [];
    const composer = JSON.parse(fs.readFileSync(composerPath, 'utf8'));
    return [...Object.keys(composer.require || {}), ...Object.keys(composer['require-dev'] || {})];
  } catch {
    return [];
  }
}

/**
 * Read mix.exs for Elixir dependencies (simple pattern match)
 * @param {string} projectDir - Project root directory
 * @returns {string[]} Array of dependency atom names
 */
function getElixirDeps(projectDir) {
  try {
    const mixPath = path.join(projectDir, 'mix.exs');
    if (!fs.existsSync(mixPath)) return [];
    const content = fs.readFileSync(mixPath, 'utf8');
    const deps = [];
    const matches = content.match(/\{:(\w+)/g);
    if (matches) {
      matches.forEach(m => deps.push(m.replace('{:', '')));
    }
    return deps;
  } catch {
    return [];
  }
}

/**
 * Check whether pubspec.yaml declares the Flutter SDK as a dependency,
 * which distinguishes a Flutter app from a plain Dart package.
 * @param {string} projectDir - Project root directory
 * @returns {boolean}
 */
function hasFlutterSdkDependency(projectDir) {
  try {
    const pubspecPath = path.join(projectDir, 'pubspec.yaml');
    if (!fs.existsSync(pubspecPath)) return false;
    const content = fs.readFileSync(pubspecPath, 'utf8');
    // Loaded here, not at the top: the SessionStart hook requires this module
    // from plugin installs that have no node_modules (#2822). Without js-yaml
    // the catch below costs only the Flutter check, not the whole hook.
    const yaml = require('js-yaml');
    const pubspec = yaml.load(content, { schema: yaml.JSON_SCHEMA });
    // Only a declared Flutter SDK dependency identifies the framework.
    // Unrelated configuration, comments, and strings must not count.
    return pubspec?.dependencies?.flutter?.sdk === 'flutter'
      || pubspec?.dev_dependencies?.flutter?.sdk === 'flutter';
  } catch {
    return false;
  }
}

/**
 * Detect project languages and frameworks
 * @param {string} [projectDir] - Project directory (defaults to cwd)
 * @returns {{ languages: string[], frameworks: string[], primary: string, projectDir: string }}
 */
function detectProjectType(projectDir) {
  projectDir = projectDir || process.cwd();
  const languages = [];
  const frameworks = [];
  const rootFileExtensions = readRootFileExtensions(projectDir);

  // Step 1: Detect languages
  for (const rule of LANGUAGE_RULES) {
    const hasMarker = rule.markers.some(m => fileExists(projectDir, m));
    const hasExt = rule.extensions.some(extension => rootFileExtensions.has(extension));

    if (hasMarker || hasExt) {
      languages.push(rule.type);
    }
  }

  // Deduplicate: if both typescript and javascript detected, keep typescript
  if (languages.includes('typescript') && languages.includes('javascript')) {
    const idx = languages.indexOf('javascript');
    if (idx !== -1) languages.splice(idx, 1);
  }

  // Step 2: Detect frameworks based on markers and dependencies
  const npmDeps = getPackageJsonDeps(projectDir);
  const pyDeps = getPythonDeps(projectDir);
  const goDeps = getGoDeps(projectDir);
  const rustDeps = getRustDeps(projectDir);
  const composerDeps = getComposerDeps(projectDir);
  const elixirDeps = getElixirDeps(projectDir);

  for (const rule of FRAMEWORK_RULES) {
    // Check marker files
    const hasMarker = rule.markers.some(m => fileExists(projectDir, m));

    // Check package dependencies
    let hasDep = false;
    if (rule.packageKeys.length > 0) {
      let depList = [];
      switch (rule.language) {
        case 'python':
          depList = pyDeps;
          break;
        case 'typescript':
        case 'javascript':
          depList = npmDeps;
          break;
        case 'golang':
          depList = goDeps;
          break;
        case 'rust':
          depList = rustDeps;
          break;
        case 'php':
          depList = composerDeps;
          break;
        case 'elixir':
          depList = elixirDeps;
          break;
      }
      // Boundary-aware match: a dependency matches a packageKey only when it
      // equals the key, or the key is a prefix immediately followed by a
      // delimiter (/ . _ -). Plain substring matching wrongly classified
      // `preact` / `reactive` as `react`. This still matches the real cases:
      // react-dom, @remix-run/node, spring-boot-starter, org.springframework.boot,
      // github.com/labstack/echo/v4, phoenix_live_view.
      hasDep = rule.packageKeys.some(key => {
        const k = key.toLowerCase();
        return depList.some(dep => {
          const d = dep.toLowerCase();
          if (!d.startsWith(k)) return false;
          return d.length === k.length || /[/._-]/.test(d[k.length]);
        });
      });
    }

    const hasCustom = typeof rule.customCheck === 'function' ? rule.customCheck(projectDir) : false;

    if (hasMarker || hasDep || hasCustom) {
      frameworks.push(rule.framework);
    }
  }

  // Step 3: Determine primary type
  let primary = 'unknown';
  if (frameworks.length > 0) {
    primary = frameworks[0];
  } else if (languages.length > 0) {
    primary = languages[0];
  }

  // Determine if fullstack (both frontend and backend languages)
  const frontendSignals = ['react', 'vue', 'angular', 'svelte', 'nextjs', 'nuxt', 'astro', 'remix'];
  const backendSignals = ['django', 'fastapi', 'flask', 'express', 'nestjs', 'rails', 'spring', 'laravel', 'phoenix', 'gin', 'echo', 'actix', 'axum'];
  const hasFrontend = frameworks.some(f => frontendSignals.includes(f));
  const hasBackend = frameworks.some(f => backendSignals.includes(f));

  if (hasFrontend && hasBackend) {
    primary = 'fullstack';
  }

  return {
    languages,
    frameworks,
    primary,
    projectDir
  };
}

module.exports = {
  detectProjectType,
  LANGUAGE_RULES,
  FRAMEWORK_RULES,
  // Exported for testing
  getPackageJsonDeps,
  getPythonDeps,
  getGoDeps,
  getRustDeps,
  getComposerDeps,
  getElixirDeps
};
