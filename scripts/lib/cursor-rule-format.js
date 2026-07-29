'use strict';

const COMMON_RULE_METADATA = Object.freeze({
  'common-agents': {
    description: 'Agent orchestration: available agents, parallel execution, multi-perspective analysis',
    alwaysApply: true,
  },
  'common-code-review': {
    description: 'Code review standards, checklist, and merge guidance',
    alwaysApply: true,
  },
  'common-coding-style': {
    description: 'ECC coding style: immutability, file organization, error handling, validation',
    alwaysApply: true,
  },
  'common-development-workflow': {
    description: 'Development workflow: plan, TDD, review, commit pipeline',
    alwaysApply: true,
  },
  'common-git-workflow': {
    description: 'Git workflow: conventional commits, PR process',
    alwaysApply: true,
  },
  'common-hooks': {
    description: 'Hooks system: types, auto-accept permissions, TodoWrite best practices',
    alwaysApply: true,
  },
  'common-patterns': {
    description: 'Common patterns: repository, API response, skeleton projects',
    alwaysApply: true,
  },
  'common-performance': {
    description: 'Performance: model selection, context management, build troubleshooting',
    alwaysApply: true,
  },
  'common-security': {
    description: 'Security: mandatory checks, secret management, response protocol',
    alwaysApply: true,
  },
  'common-testing': {
    description: 'Testing requirements: 80% coverage, TDD workflow, test types',
    alwaysApply: true,
  },
});

const LANGUAGE_LABELS = Object.freeze({
  angular: 'Angular',
  arkts: 'ArkTS',
  cpp: 'C++',
  csharp: 'C#',
  dart: 'Dart',
  fsharp: 'F#',
  golang: 'Go',
  java: 'Java',
  kotlin: 'Kotlin',
  nuxt: 'Nuxt',
  perl: 'Perl',
  php: 'PHP',
  python: 'Python',
  react: 'React',
  ruby: 'Ruby',
  rust: 'Rust',
  swift: 'Swift',
  typescript: 'TypeScript',
  vue: 'Vue',
  web: 'Web',
});

const LANGUAGE_CONTEXT = Object.freeze({
  angular: 'Angular TypeScript applications and templates',
  arkts: 'HarmonyOS ArkTS and ArkUI code',
  cpp: 'C and C++ source files and CMake projects',
  csharp: 'C# and .NET projects',
  dart: 'Dart and Flutter applications',
  fsharp: 'F# and .NET functional code',
  golang: 'Go modules, packages, and services',
  java: 'Java and JVM application code',
  kotlin: 'Kotlin, Android, and KMP projects',
  nuxt: 'Nuxt 4 applications, server routes, and app config',
  perl: 'Perl scripts, modules, and tests',
  php: 'PHP and Laravel application code',
  python: 'Python services, scripts, and FastAPI/Django apps',
  react: 'React TSX/JSX components and hooks',
  ruby: 'Ruby and Rails application code',
  rust: 'Rust crates, modules, and Cargo projects',
  swift: 'Swift packages and Apple platform code',
  typescript: 'TypeScript, JavaScript, TSX, and JSX code',
  vue: 'Vue 3 SFCs, composables, and Pinia stores',
  web: 'frontend HTML, CSS, and component code',
});

const TOPIC_LABELS = Object.freeze({
  'coding-style': 'coding style',
  'design-quality': 'design quality',
  fastapi: 'FastAPI patterns',
  hooks: 'hook usage',
  patterns: 'architecture and patterns',
  performance: 'performance',
  security: 'security',
  testing: 'testing',
});

const TOPIC_CONTEXT = Object.freeze({
  'coding-style': 'formatting, naming, structure, and readability',
  'design-quality': 'UI quality, layout, spacing, and visual polish',
  fastapi: 'FastAPI routes, dependencies, schemas, and services',
  hooks: 'hook permissions, automation boundaries, and guardrails',
  patterns: 'architecture, APIs, state, and idiomatic structure',
  performance: 'performance tuning and optimization',
  security: 'validation, secrets, auth, and vulnerability prevention',
  testing: 'tests, coverage, fixtures, and verification',
});

function splitFrontmatter(content) {
  const match = String(content || '').match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!match) {
    return { frontmatter: null, body: String(content || '') };
  }

  return {
    frontmatter: match[1],
    body: content.slice(match[0].length),
  };
}

function parseScalarListBlock(frontmatter, key) {
  if (!frontmatter) {
    return [];
  }

  const inlineMatch = frontmatter.match(new RegExp(`^\\s*${key}:\\s*(\\[[^\\n]+\\])\\s*$`, 'm'));
  if (inlineMatch) {
    try {
      const parsed = JSON.parse(inlineMatch[1].replace(/'/g, '"'));
      if (Array.isArray(parsed)) {
        return parsed.map(String);
      }
    } catch {
      // fall through to block parsing
    }
  }

  const lines = frontmatter.split(/\r?\n/);
  const values = [];
  let collecting = false;

  for (const line of lines) {
    if (new RegExp(`^\\s*${key}:\\s*$`).test(line)) {
      collecting = true;
      continue;
    }

    if (collecting) {
      const listMatch = line.match(/^\s*-\s+(.+)\s*$/);
      if (listMatch) {
        values.push(listMatch[1].replace(/^['"]|['"]$/g, ''));
        continue;
      }

      if (/^\S/.test(line)) {
        collecting = false;
      }
    }
  }

  return values;
}

function parseFrontmatterFields(frontmatter) {
  const fields = {
    description: null,
    alwaysApply: null,
    globs: [],
    paths: [],
  };

  if (!frontmatter) {
    return fields;
  }

  const descriptionMatch = frontmatter.match(/^\s*description:\s*(.+)\s*$/m);
  if (descriptionMatch) {
    fields.description = descriptionMatch[1].replace(/^['"]|['"]$/g, '');
  }

  const alwaysApplyMatch = frontmatter.match(/^\s*alwaysApply:\s*(true|false)\s*$/m);
  if (alwaysApplyMatch) {
    fields.alwaysApply = alwaysApplyMatch[1] === 'true';
  }

  fields.globs = parseScalarListBlock(frontmatter, 'globs');
  fields.paths = parseScalarListBlock(frontmatter, 'paths');

  return fields;
}

function parseRuleBasename(basename) {
  const normalized = String(basename || '').replace(/\.mdc$/i, '');

  if (normalized.startsWith('common-')) {
    return {
      scope: 'common',
      topic: normalized.slice('common-'.length),
    };
  }

  const dashIndex = normalized.indexOf('-');
  if (dashIndex === -1) {
    return { scope: normalized, topic: 'patterns' };
  }

  return {
    scope: normalized.slice(0, dashIndex),
    topic: normalized.slice(dashIndex + 1),
  };
}

function isCommonRule(basename) {
  return String(basename || '').startsWith('common-');
}

function buildDescription(basename) {
  const commonMeta = COMMON_RULE_METADATA[basename];
  if (commonMeta) {
    return commonMeta.description;
  }

  const { scope, topic } = parseRuleBasename(basename);
  const languageLabel = LANGUAGE_LABELS[scope] || scope.charAt(0).toUpperCase() + scope.slice(1);
  const topicLabel = TOPIC_LABELS[topic] || topic.replace(/-/g, ' ');
  const languageContext = LANGUAGE_CONTEXT[scope] || `${languageLabel} code`;
  const topicContext = TOPIC_CONTEXT[topic] || topicLabel;

  return `${languageLabel} ${topicLabel} for ${languageContext}. Apply when writing, reviewing, or refactoring ${topicContext}.`;
}

function formatFrontmatter({ description, alwaysApply }) {
  const lines = ['---', `description: "${description.replace(/"/g, '\\"')}"`];

  if (alwaysApply) {
    lines.push('alwaysApply: true');
  } else {
    lines.push('alwaysApply: false');
  }

  lines.push('---', '');
  return lines.join('\n');
}

function transformRuleContentForCursor(content, basename) {
  const { frontmatter, body } = splitFrontmatter(content);
  const fields = parseFrontmatterFields(frontmatter);
  const description = fields.description || buildDescription(basename);

  if (isCommonRule(basename)) {
    return `${formatFrontmatter({
      description,
      alwaysApply: true,
    })}${body}`;
  }

  // Language/framework rules use Cursor "Apply Intelligently": description only.
  return `${formatFrontmatter({
    description: buildDescription(basename),
    alwaysApply: false,
  })}${body}`;
}

function isCursorRuleDestination(plan, destinationPath) {
  if (!plan?.adapter || plan.adapter.target !== 'cursor') {
    return false;
  }

  const normalized = String(destinationPath || '').replace(/\\/g, '/');
  return normalized.includes('/.cursor/rules/') && normalized.endsWith('.mdc');
}

module.exports = {
  COMMON_RULE_METADATA,
  buildDescription,
  isCommonRule,
  isCursorRuleDestination,
  transformRuleContentForCursor,
};
