#!/usr/bin/env node

const {
  SUPPORTED_INSTALL_TARGETS,
  listInstallComponents,
  listInstallProfiles,
  loadInstallManifests,
} = require('./lib/install-manifests');

const DEFAULT_TARGET = 'claude';
const DEFAULT_LIMIT = 5;
const MAX_LIMIT = 20;
const SCHEMA_VERSION = 'ecc.consult.v1';
const FUZZY_EXCLUDED_TOKENS = new Set(['review']);
const MACHINE_LEARNING_CONTEXT_TOKENS = new Set([
  'data-science',
  'evals',
  'evaluation',
  'inference',
  'ml',
  'mle',
  'mlops',
  'model',
  'models',
  'pytorch',
  'serving',
  'training',
]);

const STOP_WORDS = new Set([
  'a',
  'an',
  'and',
  'app',
  'are',
  'for',
  'from',
  'i',
  'in',
  'into',
  'me',
  'need',
  'of',
  'on',
  'please',
  'skill',
  'skills',
  'the',
  'to',
  'want',
  'with',
]);

const COMPONENT_ALIASES = Object.freeze({
  'capability:security': [
    'appsec',
    'auth',
    'authorization',
    'checklist',
    'hardening',
    'pentest',
    'secret',
    'secrets',
    'threat',
    'vulnerability',
    'vulnerabilities',
  ],
  'capability:database': ['db', 'migration', 'migrations', 'postgres', 'postgresql', 'schema', 'sql'],
  'capability:research': ['api', 'apis', 'exa', 'external', 'investigation', 'search'],
  'capability:content': ['article', 'brand', 'business', 'copy', 'linkedin', 'writing'],
  'capability:operators': ['automation', 'billing', 'connected', 'ops', 'operator', 'workspace'],
  'capability:social': ['distribution', 'post', 'posting', 'publish', 'publishing', 'twitter', 'x'],
  'capability:media': ['editing', 'image', 'remotion', 'slides', 'video'],
  'capability:orchestration': ['dmux', 'parallel', 'tmux', 'worktree', 'worktrees'],
  'capability:machine-learning': [
    'data-science',
    'ml',
    'mle',
    'mlops',
    'model',
    'models',
    'pytorch',
    'training',
  ],
  'agent:mle-reviewer': [
    'data-science',
    'ml',
    'mle',
    'mlops',
    'model',
    'models',
    'pytorch',
    'training',
    'inference',
    'serving',
    'evaluation',
    'evals',
    'model-review',
    'review-training',
  ],
  'framework:nextjs': ['next', 'next.js', 'nextjs'],
  'framework:react': ['react', 'tsx'],
  'framework:django': ['django'],
  'framework:springboot': ['spring', 'springboot'],
  'lang:typescript': ['javascript', 'js', 'node', 'nodejs', 'ts'],
  'lang:python': ['py'],
  'lang:go': ['golang'],
});

const PROFILE_ALIASES = Object.freeze({
  minimal: ['low-context', 'lean', 'no-hooks', 'base', 'lightweight'],
  core: ['baseline', 'default', 'starter'],
  developer: ['app', 'code', 'coding', 'engineering', 'software'],
  security: ['appsec', 'audit', 'hardening', 'review', 'threat', 'vulnerability'],
  research: ['content', 'investigation', 'publishing', 'synthesis'],
  full: ['all', 'complete', 'everything'],
});

function showHelp(exitCode = 0) {
  console.log(`
Consult ECC install components and profiles from any project

Usage:
  node scripts/consult.js "security reviews" [--target <target>] [--limit <n>] [--json]
  node scripts/consult.js security reviews --target codex

Options:
  --target <target>  Install target to include in suggested commands. Default: ${DEFAULT_TARGET}
  --limit <n>        Maximum component recommendations to return. Default: ${DEFAULT_LIMIT}
  --json             Emit machine-readable consultation JSON
  --help             Show this help text

Examples:
  node scripts/consult.js "security reviews"
  node scripts/consult.js "Next.js React app" --target cursor
  node scripts/consult.js "operator workflows" --target codex --json
`);

  process.exit(exitCode);
}

function normalizeToken(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/\.js\b/g, 'js')
    .replace(/[^a-z0-9:+-]+/g, ' ')
    .trim();
}

function expandToken(token) {
  const values = new Set([token]);

  if (token.endsWith('ies') && token.length > 4) {
    values.add(`${token.slice(0, -3)}y`);
  }
  if (token.endsWith('es') && token.length > 4 && !token.endsWith('js')) {
    values.add(token.slice(0, -2));
  }
  if (token.endsWith('s') && token.length > 4 && !token.endsWith('js')) {
    values.add(token.slice(0, -1));
  }
  if (token.endsWith('ing') && token.length > 6) {
    values.add(token.slice(0, -3));
  }

  return [...values].filter(Boolean);
}

function tokenize(value) {
  const normalized = normalizeToken(value);
  if (!normalized) {
    return [];
  }

  const tokens = [];
  for (const token of normalized.split(/\s+/)) {
    if (!token || STOP_WORDS.has(token)) {
      continue;
    }
    tokens.push(...expandToken(token));
  }
  return [...new Set(tokens)];
}

function parsePositiveInteger(value, label) {
  if (!/^[1-9]\d*$/.test(String(value || ''))) {
    throw new Error(`${label} must be a positive integer`);
  }
  return Number(value);
}

function parseArgs(argv) {
  const args = argv.slice(2);
  const parsed = {
    queryParts: [],
    target: DEFAULT_TARGET,
    limit: DEFAULT_LIMIT,
    json: false,
    help: false,
  };

  if (args.includes('--help') || args.includes('-h')) {
    parsed.help = true;
    return parsed;
  }

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === '--json') {
      parsed.json = true;
    } else if (arg === '--target') {
      if (!args[index + 1] || args[index + 1].startsWith('-')) {
        throw new Error('Missing value for --target');
      }
      parsed.target = args[index + 1];
      index += 1;
    } else if (arg === '--limit') {
      if (!args[index + 1]) {
        throw new Error('Missing value for --limit');
      }
      parsed.limit = Math.min(parsePositiveInteger(args[index + 1], '--limit'), MAX_LIMIT);
      index += 1;
    } else if (arg.startsWith('-')) {
      throw new Error(`Unknown argument: ${arg}`);
    } else {
      parsed.queryParts.push(arg);
    }
  }

  if (!SUPPORTED_INSTALL_TARGETS.includes(parsed.target)) {
    throw new Error(
      `Unknown install target: ${parsed.target}. Expected one of ${SUPPORTED_INSTALL_TARGETS.join(', ')}`
    );
  }

  parsed.query = parsed.queryParts.join(' ').trim();
  return parsed;
}

function commandFor(kind, id, target) {
  if (kind === 'profile') {
    return `npx ecc install --profile ${id} --target ${target}`;
  }

  return `npx ecc install --profile minimal --target ${target} --with ${id}`;
}

function planCommandFor(componentId, target) {
  return `npx ecc plan --profile minimal --target ${target} --with ${componentId}`;
}

function buildSearchCorpus(parts) {
  return tokenize(parts.filter(Boolean).join(' '));
}

function scoreAgainstQuery(queryTokens, corpusTokens, options = {}) {
  const corpus = new Set(corpusTokens);
  const reasons = [];
  let score = 0;

  queryTokens.forEach((token, index) => {
    if (corpus.has(token)) {
      score += index === 0 ? 5 : 4;
      reasons.push(`matched "${token}"`);
      return;
    }

    if (
      token.length >= 4
      && !FUZZY_EXCLUDED_TOKENS.has(token)
      && [...corpus].some(corpusToken => (
        corpusToken.length >= 4
        && (corpusToken.includes(token) || token.includes(corpusToken))
      ))
    ) {
      score += 1;
      reasons.push(`fuzzy matched "${token}"`);
    }
  });

  if (options.preferred && reasons.length > 0) {
    score += options.preferred;
  }

  return { score, reasons: [...new Set(reasons)] };
}

function preferredComponentBonus(component, queryTokens) {
  let bonus = 0;
  const suffix = component.id.split(':')[1];
  const hasMachineLearningContext = queryTokens.some(token => MACHINE_LEARNING_CONTEXT_TOKENS.has(token));

  if (queryTokens[0] === suffix) {
    bonus += 5;
  }

  if (component.family === 'capability') {
    bonus += 3;
  }

  if (component.id === 'agent:mle-reviewer' && hasMachineLearningContext) {
    bonus += 2;
  }

  if (
    component.id === 'capability:security'
    && (
      queryTokens.some(token => ['audit', 'security', 'threat', 'vulnerability'].includes(token))
      || (!hasMachineLearningContext && queryTokens.includes('review'))
    )
  ) {
    bonus += 4;
  }

  return bonus;
}

function rankComponents({ queryTokens, target, limit }) {
  return listInstallComponents({ target })
    .map(component => {
      const aliases = COMPONENT_ALIASES[component.id] || [];
      const corpusTokens = buildSearchCorpus([
        component.id.replace(':', ' '),
        component.family,
        component.description,
        component.moduleIds.join(' '),
        aliases.join(' '),
      ]);
      const { score, reasons } = scoreAgainstQuery(queryTokens, corpusTokens, {
        preferred: preferredComponentBonus(component, queryTokens),
      });

      return {
        component,
        score,
        reasons,
      };
    })
    .filter(result => result.score > 0)
    .sort((left, right) => (
      right.score - left.score
      || left.component.family.localeCompare(right.component.family)
      || left.component.id.localeCompare(right.component.id)
    ))
    .slice(0, limit)
    .map(result => ({
      componentId: result.component.id,
      family: result.component.family,
      description: result.component.description,
      moduleIds: result.component.moduleIds,
      targets: result.component.targets,
      score: result.score,
      reasons: result.reasons.length > 0 ? result.reasons : ['related install component'],
      installCommand: commandFor('component', result.component.id, target),
      planCommand: planCommandFor(result.component.id, target),
    }));
}

function rankProfiles({ queryTokens, target, limit }) {
  const manifests = loadInstallManifests();
  return listInstallProfiles()
    .map(profile => {
      const profileDefinition = manifests.profiles[profile.id] || {};
      const aliases = PROFILE_ALIASES[profile.id] || [];
      const corpusTokens = buildSearchCorpus([
        profile.id,
        profile.description,
        (profileDefinition.modules || []).join(' '),
        aliases.join(' '),
      ]);
      const preferred = queryTokens.includes(profile.id) ? 4 : 0;
      const { score, reasons } = scoreAgainstQuery(queryTokens, corpusTokens, { preferred });

      return {
        profile,
        score,
        reasons,
      };
    })
    .filter(result => result.score > 0)
    .sort((left, right) => right.score - left.score || left.profile.id.localeCompare(right.profile.id))
    .slice(0, Math.min(3, limit))
    .map(result => ({
      id: result.profile.id,
      description: result.profile.description,
      moduleCount: result.profile.moduleCount,
      score: result.score,
      reasons: result.reasons.length > 0 ? result.reasons : ['related install profile'],
      installCommand: commandFor('profile', result.profile.id, target),
    }));
}

function buildConsultation(options) {
  const queryTokens = tokenize(options.query);
  if (queryTokens.length === 0) {
    throw new Error('Consult requires a natural language query, for example: security reviews');
  }

  const matches = rankComponents({
    queryTokens,
    target: options.target,
    limit: options.limit,
  });
  const profiles = rankProfiles({
    queryTokens,
    target: options.target,
    limit: options.limit,
  });

  return {
    schemaVersion: SCHEMA_VERSION,
    query: options.query,
    target: options.target,
    generatedAt: new Date().toISOString(),
    matches,
    profiles,
    nextSteps: matches.length > 0
      ? [
        `Preview the top component: ${matches[0].planCommand}`,
        `Install it: ${matches[0].installCommand}`,
      ]
      : [
        'Run `npx ecc catalog components` to browse all components.',
        'Try a more specific query such as "security review", "Next.js", or "operator workflows".',
      ],
  };
}

function formatText(payload) {
  const lines = [
    `ECC consult (${payload.generatedAt})`,
    `Query: ${payload.query}`,
    `Target: ${payload.target}`,
    '',
  ];

  if (payload.matches.length === 0) {
    lines.push('No strong component matches found.');
    lines.push('Try: npx ecc catalog components');
  } else {
    lines.push('Recommended components:');
    payload.matches.forEach((match, index) => {
      lines.push(`${index + 1}. ${match.componentId} [${match.family}]`);
      lines.push(`   ${match.description}`);
      lines.push(`   Install: ${match.installCommand}`);
      lines.push(`   Preview: ${match.planCommand}`);
      lines.push(`   Why: ${match.reasons.join('; ')}`);
    });
  }

  if (payload.profiles.length > 0) {
    lines.push('');
    lines.push('Related profiles:');
    payload.profiles.forEach(profile => {
      lines.push(`- ${profile.id}: ${profile.description}`);
      lines.push(`  Install: ${profile.installCommand}`);
    });
  }

  lines.push('');
  lines.push('Next steps:');
  payload.nextSteps.forEach(step => lines.push(`- ${step}`));

  return `${lines.join('\n')}\n`;
}

function main() {
  try {
    const options = parseArgs(process.argv);

    if (options.help) {
      showHelp(0);
    }

    const payload = buildConsultation(options);
    if (options.json) {
      console.log(JSON.stringify(payload, null, 2));
    } else {
      process.stdout.write(formatText(payload));
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
  buildConsultation,
  formatText,
  parseArgs,
  tokenize,
};
