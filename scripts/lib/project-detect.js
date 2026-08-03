/**
 * Project type and framework detection
 *
 * Cross-platform (Windows, macOS, Linux) project type detection
 * by inspecting files in the working directory.
 *
 * Resolves: https://github.com/affaan-m/everything-claude-code/issues/293
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
  { framework: 'phoenix', language: 'elixir', markers: [], packageKeys: ['phoenix'] }
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
 * Check if any file with given extension exists in the project root (non-recursive, top-level only)
 * @param {string} projectDir - Project root directory
 * @param {string[]} extensions - File extensions to check
 * @returns {boolean}
 */
function hasFileWithExtension(projectDir, extensions) {
  try {
    const entries = fs.readdirSync(projectDir, { withFileTypes: true });
    return entries.some(entry => {
      if (!entry.isFile()) return false;
      const ext = path.extname(entry.name);
      return extensions.includes(ext);
    });
  } catch {
    return false;
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
      const depMatches = content.match(/dependencies\s*=\s*\[([\s\S]*?)\]/);
      if (depMatches) {
        const block = depMatches[1];
        block.match(/"([^"]+)"/g)?.forEach(m => {
          const name = m
            .replace(/"/g, '')
            .split(/[\s>=<!~@[;]/)[0]
            .trim()
            .toLowerCase();
          if (name) deps.push(name);
        });
      }
    }
  } catch {
    /* ignore */
  }

  return deps;
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
    const requireBlock = content.match(/require\s*\(([\s\S]*?)\)/);
    if (requireBlock) {
      requireBlock[1].split('\n').forEach(line => {
        const trimmed = line.trim();
        if (trimmed && !trimmed.startsWith('//')) {
          const parts = trimmed.split(/\s+/);
          if (parts[0]) deps.push(parts[0]);
        }
      });
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
 * Detect project languages and frameworks
 * @param {string} [projectDir] - Project directory (defaults to cwd)
 * @returns {{ languages: string[], frameworks: string[], primary: string, projectDir: string }}
 */
function detectProjectType(projectDir) {
  projectDir = projectDir || process.cwd();
  const languages = [];
  const frameworks = [];

  // Step 1: Detect languages
  for (const rule of LANGUAGE_RULES) {
    const hasMarker = rule.markers.some(m => fileExists(projectDir, m));
    const hasExt = rule.extensions.length > 0 && hasFileWithExtension(projectDir, rule.extensions);

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

    if (hasMarker || hasDep) {
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
