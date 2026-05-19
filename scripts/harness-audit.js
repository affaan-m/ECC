#!/usr/bin/env node

const fs = require('fs');
const os = require('os');
const path = require('path');

const CATEGORIES = [
  'Tool Coverage',
  'Context Efficiency',
  'Quality Gates',
  'Memory Persistence',
  'Eval Coverage',
  'Security Guardrails',
  'Cost Efficiency',
  'GitHub Integration',
  'Vercel Integration',
  'Netlify Integration',
  'Cloudflare Integration',
  'Fly Integration',
];

const RUBRIC_VERSION = '2026-05-19';

const PROVIDERS = {
  Vercel: {
    detect: (rootDir) =>
      fileExists(rootDir, 'vercel.json') ||
      fileExists(rootDir, '.vercel/project.json') ||
      fileExists(rootDir, '.vercel'),
    keyPattern: /vercel/i,
    buildPattern: /vercel/i,
    workflowPattern: /(vercel-action|vercel\s+(deploy|--prod))/i,
  },
  Netlify: {
    detect: (rootDir) =>
      fileExists(rootDir, 'netlify.toml') || fileExists(rootDir, '.netlify'),
    keyPattern: /netlify/i,
    buildPattern: /netlify/i,
    workflowPattern: /(netlify\/actions|netlify\s+deploy)/i,
  },
  Cloudflare: {
    detect: (rootDir) =>
      fileExists(rootDir, 'wrangler.toml') || fileExists(rootDir, 'wrangler.jsonc'),
    keyPattern: /\b(cloudflare|wrangler)\b/i,
    buildPattern: /(wrangler|cloudflare)/i,
    workflowPattern: /(cloudflare\/wrangler-action|wrangler\s+(deploy|publish))/i,
  },
  Fly: {
    detect: (rootDir) => fileExists(rootDir, 'fly.toml'),
    keyPattern: /fly[_-]?(api|io)/i,
    buildPattern: /fly\s+(deploy|launch)/i,
    workflowPattern: /(superfly\/flyctl-actions|flyctl\s+deploy|fly\s+deploy)/i,
  },
};

function getApplicableProviders(rootDir) {
  return Object.entries(PROVIDERS)
    .filter(([_, spec]) => spec.detect(rootDir))
    .map(([name]) => name);
}

function normalizeScope(scope) {
  const value = (scope || 'repo').toLowerCase();
  if (!['repo', 'hooks', 'skills', 'commands', 'agents'].includes(value)) {
    throw new Error(`Invalid scope: ${scope}`);
  }
  return value;
}

function parseArgs(argv) {
  const args = argv.slice(2);
  const parsed = {
    scope: 'repo',
    format: 'text',
    help: false,
    root: path.resolve(process.env.AUDIT_ROOT || process.cwd()),
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === '--help' || arg === '-h') {
      parsed.help = true;
      continue;
    }

    if (arg === '--format') {
      parsed.format = (args[index + 1] || '').toLowerCase();
      index += 1;
      continue;
    }

    if (arg === '--scope') {
      parsed.scope = normalizeScope(args[index + 1]);
      index += 1;
      continue;
    }

    if (arg === '--root') {
      parsed.root = path.resolve(args[index + 1] || process.cwd());
      index += 1;
      continue;
    }

    if (arg.startsWith('--format=')) {
      parsed.format = arg.split('=')[1].toLowerCase();
      continue;
    }

    if (arg.startsWith('--scope=')) {
      parsed.scope = normalizeScope(arg.split('=')[1]);
      continue;
    }

    if (arg.startsWith('--root=')) {
      parsed.root = path.resolve(arg.slice('--root='.length));
      continue;
    }

    if (arg.startsWith('-')) {
      throw new Error(`Unknown argument: ${arg}`);
    }

    parsed.scope = normalizeScope(arg);
  }

  if (!['text', 'json'].includes(parsed.format)) {
    throw new Error(`Invalid format: ${parsed.format}. Use text or json.`);
  }

  return parsed;
}

function fileExists(rootDir, relativePath) {
  return fs.existsSync(path.join(rootDir, relativePath));
}

function readText(rootDir, relativePath) {
  return fs.readFileSync(path.join(rootDir, relativePath), 'utf8');
}

function countFiles(rootDir, relativeDir, extension) {
  const dirPath = path.join(rootDir, relativeDir);
  if (!fs.existsSync(dirPath)) {
    return 0;
  }

  const stack = [dirPath];
  let count = 0;

  while (stack.length > 0) {
    const current = stack.pop();
    const entries = fs.readdirSync(current, { withFileTypes: true });

    for (const entry of entries) {
      const nextPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(nextPath);
      } else if (!extension || entry.name.endsWith(extension)) {
        count += 1;
      }
    }
  }

  return count;
}

function safeRead(rootDir, relativePath) {
  try {
    return readText(rootDir, relativePath);
  } catch (_error) {
    return '';
  }
}

function safeParseJson(text) {
  if (!text || !text.trim()) {
    return null;
  }

  try {
    return JSON.parse(text);
  } catch (_error) {
    return null;
  }
}

function hasFileWithExtension(rootDir, relativeDir, extensions) {
  const dirPath = path.join(rootDir, relativeDir);
  if (!fs.existsSync(dirPath)) {
    return false;
  }

  const allowed = Array.isArray(extensions) ? extensions : [extensions];
  const stack = [dirPath];

  while (stack.length > 0) {
    const current = stack.pop();
    const entries = fs.readdirSync(current, { withFileTypes: true });

    for (const entry of entries) {
      const nextPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(nextPath);
        continue;
      }

      if (allowed.some((extension) => entry.name.endsWith(extension))) {
        return true;
      }
    }
  }

  return false;
}

function detectTargetMode(rootDir) {
  const packageJson = safeParseJson(safeRead(rootDir, 'package.json'));
  if (packageJson?.name === 'everything-claude-code') {
    return 'repo';
  }

  if (
    fileExists(rootDir, 'scripts/harness-audit.js') &&
    fileExists(rootDir, '.claude-plugin/plugin.json') &&
    fileExists(rootDir, 'agents') &&
    fileExists(rootDir, 'skills')
  ) {
    return 'repo';
  }

  return 'consumer';
}

const ECC_PLUGIN_KEY_PATTERNS = [
  /^ecc@/i,
  /^everything-claude-code@/i,
];

const ECC_LEGACY_PLUGIN_DIRS = [
  'ecc',
  'ecc@ecc',
  'everything-claude-code',
  'everything-claude-code@everything-claude-code',
];

const ECC_CACHE_MARKETPLACES = ['everything-claude-code', 'ecc'];
const ECC_CACHE_PLUGIN_NAMES = ['ecc', 'everything-claude-code'];

function uniquePaths(paths) {
  return [...new Set(paths.filter(Boolean))];
}

function compareVersionDesc(a, b) {
  const partsA = String(a).split('.').map(part => parseInt(part, 10) || 0);
  const partsB = String(b).split('.').map(part => parseInt(part, 10) || 0);
  const length = Math.max(partsA.length, partsB.length);

  for (let index = 0; index < length; index += 1) {
    const valueA = partsA[index] || 0;
    const valueB = partsB[index] || 0;
    if (valueA !== valueB) {
      return valueB - valueA;
    }
  }

  return 0;
}

function findPluginJsonUnder(installRoot) {
  const pluginJson = path.join(installRoot, '.claude-plugin', 'plugin.json');
  if (fs.existsSync(pluginJson)) {
    return pluginJson;
  }

  const fallback = path.join(installRoot, 'plugin.json');
  return fs.existsSync(fallback) ? fallback : null;
}

function findPluginInstallFromManifest(installedPluginsPaths) {
  for (const installedPath of installedPluginsPaths) {
    if (!fs.existsSync(installedPath)) {
      continue;
    }

    const manifest = safeParseJson(safeRead(path.dirname(installedPath), path.basename(installedPath)));
    if (!manifest || !manifest.plugins) {
      continue;
    }

    for (const [key, value] of Object.entries(manifest.plugins)) {
      if (!ECC_PLUGIN_KEY_PATTERNS.some(pattern => pattern.test(key))) {
        continue;
      }

      const entries = Array.isArray(value) ? value : [];
      for (const entry of entries) {
        if (!entry || typeof entry.installPath !== 'string' || !entry.installPath.trim()) {
          continue;
        }

        const installRoot = path.isAbsolute(entry.installPath)
          ? entry.installPath
          : path.resolve(path.dirname(installedPath), entry.installPath);
        const hit = findPluginJsonUnder(installRoot);
        if (hit) {
          return hit;
        }
      }
    }
  }

  return null;
}

function findPluginInstallFlatLayout(candidateRoots) {
  for (const pluginsDir of candidateRoots) {
    for (const pluginDir of ECC_LEGACY_PLUGIN_DIRS) {
      const hit = findPluginJsonUnder(path.join(pluginsDir, pluginDir));
      if (hit) {
        return hit;
      }
    }
  }

  return null;
}

function findPluginInstallMarketplaceCache(candidateRoots) {
  for (const pluginsDir of candidateRoots) {
    for (const marketplace of ECC_CACHE_MARKETPLACES) {
      for (const pluginName of ECC_CACHE_PLUGIN_NAMES) {
        const pluginRoot = path.join(pluginsDir, 'cache', marketplace, pluginName);
        if (!fs.existsSync(pluginRoot)) {
          continue;
        }

        let versions = [];
        try {
          versions = fs
            .readdirSync(pluginRoot, { withFileTypes: true })
            .filter(entry => entry.isDirectory())
            .map(entry => entry.name)
            .sort(compareVersionDesc);
        } catch {
          continue;
        }

        for (const version of versions) {
          const hit = findPluginJsonUnder(path.join(pluginRoot, version));
          if (hit) {
            return hit;
          }
        }
      }
    }
  }

  return null;
}

function findPluginInstall(rootDir) {
  const homeDirs = uniquePaths([
    process.env.HOME,
    process.env.USERPROFILE,
    os.homedir(),
  ]);
  const pluginRoots = uniquePaths([
    path.join(rootDir, '.claude', 'plugins'),
    ...homeDirs.map(homeDir => path.join(homeDir, '.claude', 'plugins')),
  ]);
  const installedPluginsPaths = uniquePaths([
    path.join(rootDir, '.claude', 'plugins', 'installed_plugins.json'),
    ...homeDirs.map(homeDir => path.join(homeDir, '.claude', 'plugins', 'installed_plugins.json')),
  ]);
  const flatRoots = uniquePaths([
    ...pluginRoots,
    ...pluginRoots.map(pluginsDir => path.join(pluginsDir, 'marketplaces')),
  ]);

  return (
    findPluginInstallFromManifest(installedPluginsPaths)
    || findPluginInstallFlatLayout(flatRoots)
    || findPluginInstallMarketplaceCache(pluginRoots)
  );
}

function getRepoChecks(rootDir) {
  const packageJson = JSON.parse(readText(rootDir, 'package.json'));
  const commandPrimary = safeRead(rootDir, 'commands/harness-audit.md').trim();
  const commandParity = safeRead(rootDir, '.opencode/commands/harness-audit.md').trim();
  const hooksJson = safeRead(rootDir, 'hooks/hooks.json');

  return [
    {
      id: 'tool-hooks-config',
      category: 'Tool Coverage',
      points: 2,
      scopes: ['repo', 'hooks'],
      path: 'hooks/hooks.json',
      description: 'Hook configuration file exists',
      pass: fileExists(rootDir, 'hooks/hooks.json'),
      fix: 'Create hooks/hooks.json and define baseline hook events.',
    },
    {
      id: 'tool-hooks-impl-count',
      category: 'Tool Coverage',
      points: 2,
      scopes: ['repo', 'hooks'],
      path: 'scripts/hooks/',
      description: 'At least 8 hook implementation scripts exist',
      pass: countFiles(rootDir, 'scripts/hooks', '.js') >= 8,
      fix: 'Add missing hook implementations in scripts/hooks/.',
    },
    {
      id: 'tool-agent-count',
      category: 'Tool Coverage',
      points: 2,
      scopes: ['repo', 'agents'],
      path: 'agents/',
      description: 'At least 10 agent definitions exist',
      pass: countFiles(rootDir, 'agents', '.md') >= 10,
      fix: 'Add or restore agent definitions under agents/.',
    },
    {
      id: 'tool-skill-count',
      category: 'Tool Coverage',
      points: 2,
      scopes: ['repo', 'skills'],
      path: 'skills/',
      description: 'At least 20 skill definitions exist',
      pass: countFiles(rootDir, 'skills', 'SKILL.md') >= 20,
      fix: 'Add missing skill directories with SKILL.md definitions.',
    },
    {
      id: 'tool-command-parity',
      category: 'Tool Coverage',
      points: 2,
      scopes: ['repo', 'commands'],
      path: '.opencode/commands/harness-audit.md',
      description: 'Harness-audit command parity exists between primary and OpenCode command docs',
      pass: commandPrimary.length > 0 && commandPrimary === commandParity,
      fix: 'Sync commands/harness-audit.md and .opencode/commands/harness-audit.md.',
    },
    {
      id: 'context-strategic-compact',
      category: 'Context Efficiency',
      points: 3,
      scopes: ['repo', 'skills'],
      path: 'skills/strategic-compact/SKILL.md',
      description: 'Strategic compaction guidance is present',
      pass: fileExists(rootDir, 'skills/strategic-compact/SKILL.md'),
      fix: 'Add strategic context compaction guidance at skills/strategic-compact/SKILL.md.',
    },
    {
      id: 'context-suggest-compact-hook',
      category: 'Context Efficiency',
      points: 3,
      scopes: ['repo', 'hooks'],
      path: 'scripts/hooks/suggest-compact.js',
      description: 'Suggest-compact automation hook exists',
      pass: fileExists(rootDir, 'scripts/hooks/suggest-compact.js'),
      fix: 'Implement scripts/hooks/suggest-compact.js for context pressure hints.',
    },
    {
      id: 'context-model-route',
      category: 'Context Efficiency',
      points: 2,
      scopes: ['repo', 'commands'],
      path: 'commands/model-route.md',
      description: 'Model routing command exists',
      pass: fileExists(rootDir, 'commands/model-route.md'),
      fix: 'Add model-route command guidance in commands/model-route.md.',
    },
    {
      id: 'context-token-doc',
      category: 'Context Efficiency',
      points: 2,
      scopes: ['repo'],
      path: 'docs/token-optimization.md',
      description: 'Token optimization documentation exists',
      pass: fileExists(rootDir, 'docs/token-optimization.md'),
      fix: 'Add docs/token-optimization.md with concrete context-cost controls.',
    },
    {
      id: 'quality-test-runner',
      category: 'Quality Gates',
      points: 3,
      scopes: ['repo'],
      path: 'tests/run-all.js',
      description: 'Central test runner exists',
      pass: fileExists(rootDir, 'tests/run-all.js'),
      fix: 'Add tests/run-all.js to enforce complete suite execution.',
    },
    {
      id: 'quality-ci-validations',
      category: 'Quality Gates',
      points: 3,
      scopes: ['repo'],
      path: 'package.json',
      description: 'Test script runs validator chain before tests',
      pass: typeof packageJson.scripts?.test === 'string' && packageJson.scripts.test.includes('validate-commands.js') && packageJson.scripts.test.includes('tests/run-all.js'),
      fix: 'Update package.json test script to run validators plus tests/run-all.js.',
    },
    {
      id: 'quality-hook-tests',
      category: 'Quality Gates',
      points: 2,
      scopes: ['repo', 'hooks'],
      path: 'tests/hooks/hooks.test.js',
      description: 'Hook coverage test file exists',
      pass: fileExists(rootDir, 'tests/hooks/hooks.test.js'),
      fix: 'Add tests/hooks/hooks.test.js for hook behavior validation.',
    },
    {
      id: 'quality-doctor-script',
      category: 'Quality Gates',
      points: 2,
      scopes: ['repo'],
      path: 'scripts/doctor.js',
      description: 'Installation drift doctor script exists',
      pass: fileExists(rootDir, 'scripts/doctor.js'),
      fix: 'Add scripts/doctor.js for install-state integrity checks.',
    },
    {
      id: 'memory-hooks-dir',
      category: 'Memory Persistence',
      points: 4,
      scopes: ['repo', 'hooks'],
      path: 'hooks/memory-persistence/',
      description: 'Memory persistence hooks directory exists',
      pass: fileExists(rootDir, 'hooks/memory-persistence'),
      fix: 'Add hooks/memory-persistence with lifecycle hook definitions.',
    },
    {
      id: 'memory-session-hooks',
      category: 'Memory Persistence',
      points: 4,
      scopes: ['repo', 'hooks'],
      path: 'scripts/hooks/session-start.js',
      description: 'Session start/end persistence scripts exist',
      pass: fileExists(rootDir, 'scripts/hooks/session-start.js') && fileExists(rootDir, 'scripts/hooks/session-end.js'),
      fix: 'Implement scripts/hooks/session-start.js and scripts/hooks/session-end.js.',
    },
    {
      id: 'memory-learning-skill',
      category: 'Memory Persistence',
      points: 2,
      scopes: ['repo', 'skills'],
      path: 'skills/continuous-learning-v2/SKILL.md',
      description: 'Continuous learning v2 skill exists',
      pass: fileExists(rootDir, 'skills/continuous-learning-v2/SKILL.md'),
      fix: 'Add skills/continuous-learning-v2/SKILL.md for memory evolution flow.',
    },
    {
      id: 'eval-skill',
      category: 'Eval Coverage',
      points: 4,
      scopes: ['repo', 'skills'],
      path: 'skills/eval-harness/SKILL.md',
      description: 'Eval harness skill exists',
      pass: fileExists(rootDir, 'skills/eval-harness/SKILL.md'),
      fix: 'Add skills/eval-harness/SKILL.md for pass/fail regression evaluation.',
    },
    {
      id: 'eval-commands',
      category: 'Eval Coverage',
      points: 4,
      scopes: ['repo', 'commands', 'skills'],
      path: 'commands/checkpoint.md',
      description: 'Checkpoint command and eval/verification skills exist',
      pass: fileExists(rootDir, 'commands/checkpoint.md') && fileExists(rootDir, 'skills/eval-harness/SKILL.md') && fileExists(rootDir, 'skills/verification-loop/SKILL.md'),
      fix: 'Add checkpoint command plus eval-harness and verification-loop skills to standardize verification loops.',
    },
    {
      id: 'eval-tests-presence',
      category: 'Eval Coverage',
      points: 2,
      scopes: ['repo'],
      path: 'tests/',
      description: 'At least 10 test files exist',
      pass: countFiles(rootDir, 'tests', '.test.js') >= 10,
      fix: 'Increase automated test coverage across scripts/hooks/lib.',
    },
    {
      id: 'security-review-skill',
      category: 'Security Guardrails',
      points: 3,
      scopes: ['repo', 'skills'],
      path: 'skills/security-review/SKILL.md',
      description: 'Security review skill exists',
      pass: fileExists(rootDir, 'skills/security-review/SKILL.md'),
      fix: 'Add skills/security-review/SKILL.md for security checklist coverage.',
    },
    {
      id: 'security-agent',
      category: 'Security Guardrails',
      points: 3,
      scopes: ['repo', 'agents'],
      path: 'agents/security-reviewer.md',
      description: 'Security reviewer agent exists',
      pass: fileExists(rootDir, 'agents/security-reviewer.md'),
      fix: 'Add agents/security-reviewer.md for delegated security audits.',
    },
    {
      id: 'security-prompt-hook',
      category: 'Security Guardrails',
      points: 2,
      scopes: ['repo', 'hooks'],
      path: 'hooks/hooks.json',
      description: 'Hooks include prompt submission guardrail event references',
      pass: hooksJson.includes('beforeSubmitPrompt') || hooksJson.includes('PreToolUse'),
      fix: 'Add prompt/tool preflight security guards in hooks/hooks.json.',
    },
    {
      id: 'security-scan-command',
      category: 'Security Guardrails',
      points: 2,
      scopes: ['repo', 'commands'],
      path: 'commands/security-scan.md',
      description: 'Security scan command exists',
      pass: fileExists(rootDir, 'commands/security-scan.md'),
      fix: 'Add commands/security-scan.md with scan and remediation workflow.',
    },
    {
      id: 'cost-skill',
      category: 'Cost Efficiency',
      points: 4,
      scopes: ['repo', 'skills'],
      path: 'skills/cost-aware-llm-pipeline/SKILL.md',
      description: 'Cost-aware LLM skill exists',
      pass: fileExists(rootDir, 'skills/cost-aware-llm-pipeline/SKILL.md'),
      fix: 'Add skills/cost-aware-llm-pipeline/SKILL.md for budget-aware routing.',
    },
    {
      id: 'cost-doc',
      category: 'Cost Efficiency',
      points: 3,
      scopes: ['repo'],
      path: 'docs/token-optimization.md',
      description: 'Cost optimization documentation exists',
      pass: fileExists(rootDir, 'docs/token-optimization.md'),
      fix: 'Create docs/token-optimization.md with target settings and tradeoffs.',
    },
    {
      id: 'cost-model-route-command',
      category: 'Cost Efficiency',
      points: 3,
      scopes: ['repo', 'commands'],
      path: 'commands/model-route.md',
      description: 'Model route command exists for complexity-aware routing',
      pass: fileExists(rootDir, 'commands/model-route.md'),
      fix: 'Add commands/model-route.md and route policies for cheap-default execution.',
    },
    ...buildGithubChecks(rootDir),
  ];
}

// GitHub Integration is intentionally repo-scoped. Scoped audits such as hooks,
// skills, commands, and agents should keep reporting only that surface.
function buildGithubChecks(rootDir) {
  return [
    {
      id: 'github-workflows',
      category: 'GitHub Integration',
      points: 3,
      scopes: ['repo'],
      path: '.github/workflows/',
      description: 'GitHub Actions workflows are checked in',
      pass: hasFileWithExtension(rootDir, '.github/workflows', ['.yml', '.yaml']),
      fix: 'Add at least one workflow under .github/workflows/ so CI runs on every PR.',
    },
    {
      id: 'github-pr-template',
      category: 'GitHub Integration',
      points: 2,
      scopes: ['repo'],
      path: '.github/PULL_REQUEST_TEMPLATE.md',
      description: 'A pull request template is configured',
      pass:
        fileExists(rootDir, '.github/PULL_REQUEST_TEMPLATE.md') ||
        fileExists(rootDir, '.github/pull_request_template.md'),
      fix: 'Add .github/PULL_REQUEST_TEMPLATE.md so PR descriptions follow a consistent shape.',
    },
    {
      id: 'github-issue-templates',
      category: 'GitHub Integration',
      points: 2,
      scopes: ['repo'],
      path: '.github/ISSUE_TEMPLATE/',
      description: 'Issue templates are configured',
      pass: hasFileWithExtension(rootDir, '.github/ISSUE_TEMPLATE', ['.md', '.yml', '.yaml']),
      fix: 'Add at least one issue template under .github/ISSUE_TEMPLATE/.',
    },
    {
      id: 'github-codeowners',
      category: 'GitHub Integration',
      points: 1,
      scopes: ['repo'],
      path: '.github/CODEOWNERS',
      description: 'A CODEOWNERS file routes reviews',
      pass:
        fileExists(rootDir, 'CODEOWNERS') ||
        fileExists(rootDir, '.github/CODEOWNERS') ||
        fileExists(rootDir, 'docs/CODEOWNERS'),
      fix: 'Add a CODEOWNERS file so PRs auto-request the right reviewers.',
    },
    {
      id: 'github-dep-updates',
      category: 'GitHub Integration',
      points: 2,
      scopes: ['repo'],
      path: '.github/dependabot.yml',
      description: 'Automated dependency updates are configured',
      pass:
        fileExists(rootDir, '.github/dependabot.yml') ||
        fileExists(rootDir, '.github/dependabot.yaml') ||
        fileExists(rootDir, 'renovate.json') ||
        fileExists(rootDir, '.github/renovate.json') ||
        fileExists(rootDir, '.renovaterc'),
      fix: 'Add a Dependabot or Renovate config so dependency updates land automatically.',
    },
  ];
}

function readAllWorkflowsText(rootDir) {
  const dir = path.join(rootDir, '.github/workflows');
  if (!fs.existsSync(dir)) {
    return '';
  }

  const stack = [dir];
  let combined = '';

  while (stack.length > 0) {
    const current = stack.pop();
    const entries = fs.readdirSync(current, { withFileTypes: true });

    for (const entry of entries) {
      const nextPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(nextPath);
      } else if (entry.name.endsWith('.yml') || entry.name.endsWith('.yaml')) {
        try {
          combined += `${fs.readFileSync(nextPath, 'utf8')}\n`;
        } catch (_error) {
          // Ignore unreadable workflow files; the finding should stay deterministic.
        }
      }
    }
  }

  return combined;
}

function buildProviderChecks(rootDir, provider, sharedContext) {
  const spec = PROVIDERS[provider];
  const packageJson = sharedContext.packageJson || {};
  const scriptsText = Object.values(packageJson.scripts || {}).join('\n');
  const category = `${provider} Integration`;

  return [
    {
      id: `${provider.toLowerCase()}-config`,
      category,
      points: 3,
      scopes: ['repo'],
      path: `${provider} config`,
      description: `${provider} deployment config is checked in`,
      pass: spec.detect(rootDir),
      fix: `Commit ${provider} configuration so deploys are reproducible from source.`,
    },
    {
      id: `${provider.toLowerCase()}-build-script`,
      category,
      points: 2,
      scopes: ['repo'],
      path: 'package.json scripts',
      description: `package.json scripts reference ${provider}`,
      pass: spec.buildPattern.test(scriptsText),
      fix: `Add a build or deploy script in package.json that runs ${provider}.`,
    },
    {
      id: `${provider.toLowerCase()}-env-doc`,
      category,
      points: 2,
      scopes: ['repo'],
      path: '.env.example',
      description: `${provider} env keys are documented in .env.example`,
      pass: spec.keyPattern.test(sharedContext.envExample),
      fix: `Document ${provider} environment variables in .env.example.`,
    },
    {
      id: `${provider.toLowerCase()}-workflow-uses`,
      category,
      points: 3,
      scopes: ['repo'],
      path: '.github/workflows/',
      description: `A GitHub workflow uses the ${provider} action or CLI`,
      pass: spec.workflowPattern.test(sharedContext.workflowsText),
      fix: `Reference the ${provider} action or CLI from a workflow under .github/workflows/.`,
    },
  ];
}

function collectProviderChecks(rootDir, packageJson) {
  const providers = getApplicableProviders(rootDir);
  if (providers.length === 0) {
    return [];
  }

  const sharedContext = {
    packageJson: packageJson || {},
    envExample: `${safeRead(rootDir, '.env.example')}\n${safeRead(rootDir, '.env.sample')}`,
    workflowsText: readAllWorkflowsText(rootDir),
  };

  return providers.flatMap(provider => buildProviderChecks(rootDir, provider, sharedContext));
}

function getConsumerChecks(rootDir) {
  const packageJson = safeParseJson(safeRead(rootDir, 'package.json'));
  const gitignore = safeRead(rootDir, '.gitignore');
  const projectHooks = safeRead(rootDir, '.claude/settings.json');
  const pluginInstall = findPluginInstall(rootDir);

  return [
    {
      id: 'consumer-plugin-install',
      category: 'Tool Coverage',
      points: 4,
      scopes: ['repo'],
      path: '~/.claude/plugins/ecc/ (legacy everything-claude-code paths also supported)',
      description: 'Everything Claude Code is installed for the active user or project',
      pass: Boolean(pluginInstall),
      fix: 'Install the ECC plugin for this user or project before auditing project-specific harness quality.',
    },
    {
      id: 'consumer-project-overrides',
      category: 'Tool Coverage',
      points: 3,
      scopes: ['repo', 'hooks', 'skills', 'commands', 'agents'],
      path: '.claude/',
      description: 'Project-specific harness overrides exist under .claude/',
      pass: countFiles(rootDir, '.claude/agents', '.md') > 0 ||
        countFiles(rootDir, '.claude/skills', 'SKILL.md') > 0 ||
        countFiles(rootDir, '.claude/commands', '.md') > 0 ||
        fileExists(rootDir, '.claude/settings.json') ||
        fileExists(rootDir, '.claude/hooks.json'),
      fix: 'Add project-local .claude hooks, commands, skills, or settings that tailor ECC to this repo.',
    },
    {
      id: 'consumer-instructions',
      category: 'Context Efficiency',
      points: 3,
      scopes: ['repo'],
      path: 'AGENTS.md',
      description: 'The project has explicit agent or instruction context',
      pass: fileExists(rootDir, 'AGENTS.md') || fileExists(rootDir, 'CLAUDE.md') || fileExists(rootDir, '.claude/CLAUDE.md'),
      fix: 'Add AGENTS.md or CLAUDE.md so the harness has project-specific instructions.',
    },
    {
      id: 'consumer-project-config',
      category: 'Context Efficiency',
      points: 2,
      scopes: ['repo', 'hooks'],
      path: '.mcp.json',
      description: 'The project declares local MCP or Claude settings',
      pass: fileExists(rootDir, '.mcp.json') || fileExists(rootDir, '.claude/settings.json') || fileExists(rootDir, '.claude/settings.local.json'),
      fix: 'Add .mcp.json or .claude/settings.json so project-local tool configuration is explicit.',
    },
    {
      id: 'consumer-test-suite',
      category: 'Quality Gates',
      points: 4,
      scopes: ['repo'],
      path: 'tests/',
      description: 'The project has an automated test entrypoint',
      pass: typeof packageJson?.scripts?.test === 'string' || countFiles(rootDir, 'tests', '.test.js') > 0 || hasFileWithExtension(rootDir, '.', ['.spec.js', '.spec.ts', '.test.ts']),
      fix: 'Add a test script or checked-in tests so harness recommendations can be verified automatically.',
    },
    {
      id: 'consumer-ci-workflow',
      category: 'Quality Gates',
      points: 3,
      scopes: ['repo'],
      path: '.github/workflows/',
      description: 'The project has CI workflows checked in',
      pass: hasFileWithExtension(rootDir, '.github/workflows', ['.yml', '.yaml']),
      fix: 'Add at least one CI workflow so harness and test checks run outside local development.',
    },
    {
      id: 'consumer-memory-notes',
      category: 'Memory Persistence',
      points: 2,
      scopes: ['repo'],
      path: '.claude/memory.md',
      description: 'Project memory or durable notes are checked in',
      pass: fileExists(rootDir, '.claude/memory.md') || countFiles(rootDir, 'docs/adr', '.md') > 0,
      fix: 'Add durable project memory such as .claude/memory.md or ADRs under docs/adr/.',
    },
    {
      id: 'consumer-eval-coverage',
      category: 'Eval Coverage',
      points: 2,
      scopes: ['repo'],
      path: 'evals/',
      description: 'The project has evals or multiple automated tests',
      pass: countFiles(rootDir, 'evals', null) > 0 || countFiles(rootDir, 'tests', '.test.js') >= 3,
      fix: 'Add eval fixtures or at least a few focused automated tests for critical flows.',
    },
    {
      id: 'consumer-security-policy',
      category: 'Security Guardrails',
      points: 2,
      scopes: ['repo'],
      path: 'SECURITY.md',
      description: 'The project exposes a security policy or automated dependency scanning',
      pass: fileExists(rootDir, 'SECURITY.md') || fileExists(rootDir, '.github/dependabot.yml') || fileExists(rootDir, '.github/codeql.yml'),
      fix: 'Add SECURITY.md or dependency/code scanning configuration to document the project security posture.',
    },
    {
      id: 'consumer-secret-hygiene',
      category: 'Security Guardrails',
      points: 2,
      scopes: ['repo'],
      path: '.gitignore',
      description: 'The project ignores common secret env files',
      pass: gitignore.includes('.env'),
      fix: 'Ignore .env-style files in .gitignore so secrets do not land in the repo.',
    },
    {
      id: 'consumer-hook-guardrails',
      category: 'Security Guardrails',
      points: 2,
      scopes: ['repo', 'hooks'],
      path: '.claude/settings.json',
      description: 'Project-local hook settings reference tool/prompt guardrails',
      pass: projectHooks.includes('PreToolUse') || projectHooks.includes('beforeSubmitPrompt') || fileExists(rootDir, '.claude/hooks.json'),
      fix: 'Add project-local hook settings or hook definitions for prompt/tool guardrails.',
    },
    ...buildGithubChecks(rootDir),
    ...collectProviderChecks(rootDir, packageJson),
  ];
}

function summarizeCategoryScores(checks) {
  const scores = {};
  for (const category of CATEGORIES) {
    const inCategory = checks.filter(check => check.category === category);
    const max = inCategory.reduce((sum, check) => sum + check.points, 0);
    const earned = inCategory
      .filter(check => check.pass)
      .reduce((sum, check) => sum + check.points, 0);

    const normalized = max === 0 ? 0 : Math.round((earned / max) * 10);
    scores[category] = {
      score: normalized,
      earned,
      max,
    };
  }

  return scores;
}

function buildReport(scope, options = {}) {
  const rootDir = path.resolve(options.rootDir || process.cwd());
  const targetMode = options.targetMode || detectTargetMode(rootDir);
  const checks = (targetMode === 'repo' ? getRepoChecks(rootDir) : getConsumerChecks(rootDir))
    .filter(check => check.scopes.includes(scope));
  const categoryScores = summarizeCategoryScores(checks);
  const maxScore = checks.reduce((sum, check) => sum + check.points, 0);
  const overallScore = checks
    .filter(check => check.pass)
    .reduce((sum, check) => sum + check.points, 0);
  const applicableCategories = CATEGORIES.filter(name => categoryScores[name]?.max > 0);

  const failedChecks = checks.filter(check => !check.pass);
  const topActions = failedChecks
    .sort((left, right) => right.points - left.points)
    .slice(0, 3)
    .map(check => ({
      action: check.fix,
      path: check.path,
      category: check.category,
      points: check.points,
    }));

  return {
    scope,
    root_dir: rootDir,
    target_mode: targetMode,
    deterministic: true,
    rubric_version: RUBRIC_VERSION,
    overall_score: overallScore,
    max_score: maxScore,
    categories: categoryScores,
    applicable_categories: applicableCategories,
    category_count: applicableCategories.length,
    checks: checks.map(check => ({
      id: check.id,
      category: check.category,
      points: check.points,
      path: check.path,
      description: check.description,
      pass: check.pass,
    })),
    top_actions: topActions,
  };
}

function printText(report) {
  console.log(`Harness Audit (${report.scope}, ${report.target_mode}): ${report.overall_score}/${report.max_score}`);
  console.log(`Root: ${report.root_dir}`);
  console.log('');

  for (const category of CATEGORIES) {
    const data = report.categories[category];
    if (!data || data.max === 0) {
      continue;
    }

    console.log(`- ${category}: ${data.score}/10 (${data.earned}/${data.max} pts)`);
  }

  const failed = report.checks.filter(check => !check.pass);
  console.log('');
  console.log(`Checks: ${report.checks.length} total, ${failed.length} failing`);

  if (failed.length > 0) {
    console.log('');
    console.log('Top 3 Actions:');
    report.top_actions.forEach((action, index) => {
      console.log(`${index + 1}) [${action.category}] ${action.action} (${action.path})`);
    });
  }
}

function showHelp(exitCode = 0) {
  console.log(`
Usage: node scripts/harness-audit.js [scope] [--scope <repo|hooks|skills|commands|agents>] [--format <text|json>]
       [--root <path>]

Deterministic harness audit based on explicit file/rule checks.
Audits the current working directory by default and auto-detects ECC repo mode vs consumer-project mode.
`);
  process.exit(exitCode);
}

function main() {
  try {
    const args = parseArgs(process.argv);

    if (args.help) {
      showHelp(0);
      return;
    }

    const report = buildReport(args.scope, { rootDir: args.root });

    if (args.format === 'json') {
      console.log(JSON.stringify(report, null, 2));
    } else {
      printText(report);
    }
  } catch (error) {
    console.error(`Error: ${error.message}`);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  buildReport,
  parseArgs,
  findPluginInstall,
  compareVersionDesc,
};
