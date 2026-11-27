const assert = require('assert');
const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const CANONICAL_SKILL = path.join(REPO_ROOT, 'skills', 'mle-workflow', 'SKILL.md');
const CODEX_SKILL = path.join(REPO_ROOT, '.agents', 'skills', 'mle-workflow', 'SKILL.md');

const EXPECTED_TASKS = [
  'MLE-01',
  'MLE-02',
  'MLE-03',
  'MLE-04',
  'MLE-05',
  'MLE-06',
  'MLE-07',
  'MLE-08',
  'MLE-09',
  'MLE-10',
];

const PIPELINE_LANES = [
  'product contract',
  'stakeholder loss',
  'data contract',
  'metric design',
  'leakage',
  'feature pipeline',
  'baseline',
  'scoring',
  'serving parity',
  'training',
  'artifacts',
  'evaluation',
  'threshold',
  'promotion',
  'error analysis',
  'bug trace',
  'iteration',
  'inference contract',
  'serving',
  'batch inference',
  'deployment',
  'canary',
  'rollback',
  'monitoring',
  'incident response',
  'retraining',
  'security',
  'cost',
];

const SWE_SURFACES = [
  'product-capability',
  'architecture-decision-records',
  'repo-scan',
  'database-reviewer',
  'tdd-workflow',
  'python-testing',
  'python-patterns',
  'pytorch-patterns',
  'docker-patterns',
  'deployment-patterns',
  'eval-harness',
  'quality-gate',
  'api-design',
  'security-review',
  'e2e-testing',
  'browser-qa',
  'build-fix',
  'pr-test-analyzer',
  'canary-watch',
  'dashboard-builder',
  'verification-loop',
  'performance-optimizer',
  'silent-failure-hunter',
  'doc-updater',
  'github-ops',
];

const JUDGMENT_PRIMITIVES = [
  'Iteration Compact',
  'Who cares',
  'Decision owner',
  'Mistake budget',
  'Unacceptable mistakes',
  'Acceptable mistakes',
  'Decision Brain',
  'adversarial behavior',
  'selective disclosure',
  '(probability, confidence) x (cost, severity, importance, impact)',
  'Metric and Mistake Economics',
  'confusion matrix',
  'false positives',
  'false negatives',
  'precision',
  'recall',
  'F1',
  'AUC',
  'latency',
  'cost',
  'Data and Feature Hypotheses',
  'label confidence',
  'class imbalance',
  'missing values',
  'outliers',
  'correlated features',
  'Error Analysis Loop',
  'Observation Ledger',
  'Lesson captured',
  'Regression added',
  'Next iteration',
];

const FORBIDDEN_DOMAIN_EXAMPLES = [
  'reddit',
  'subreddit',
  'moderation',
  'moderator',
];

const SCOPE_CALIBRATION_PHRASES = [
  'Use only the lanes that fit the system in front of you',
  'Do not assume every model has supervised labels',
  'Do not add heavyweight MLOps machinery',
  'Replace metrics, serving mode, data stores, and rollout mechanics',
];

function stripFrontmatter(content) {
  return content.replace(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/, '');
}

function readSkill(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

function extractSimulationRows(content) {
  return content
    .split('\n')
    .filter(line => /^\| MLE-\d{2} \|/.test(line));
}

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    return true;
  } catch (error) {
    console.log(`  ✗ ${name}`);
    console.log(`    Error: ${error.message}`);
    return false;
  }
}

function run() {
  console.log('\n=== Testing MLE workflow coverage ===\n');

  let passed = 0;
  let failed = 0;

  const canonical = readSkill(CANONICAL_SKILL);
  const codex = readSkill(CODEX_SKILL);
  const canonicalRows = extractSimulationRows(canonical);

  if (test('canonical and Codex MLE workflow bodies stay in sync', () => {
    assert.strictEqual(stripFrontmatter(codex), stripFrontmatter(canonical));
  })) passed++; else failed++;

  if (test('frontmatter stripping tolerates CRLF and EOF delimiters', () => {
    assert.strictEqual(stripFrontmatter('---\r\nname: mle\r\n---\r\n# Body'), '# Body');
    assert.strictEqual(stripFrontmatter('---\nname: mle\n---'), '');
  })) passed++; else failed++;

  if (test('MLE workflow simulates ten common MLE tasks', () => {
    assert.strictEqual(canonicalRows.length, 10, 'Expected exactly ten MLE simulation rows');
    for (const taskId of EXPECTED_TASKS) {
      assert.ok(canonicalRows.some(row => row.includes(`| ${taskId} |`)), `Missing ${taskId}`);
    }
  })) passed++; else failed++;

  if (test('simulations cover the full production ML pipeline', () => {
    const normalized = canonicalRows.join('\n').toLowerCase();
    for (const lane of PIPELINE_LANES) {
      assert.ok(normalized.includes(lane), `Missing pipeline lane: ${lane}`);
    }
  })) passed++; else failed++;

  if (test('simulations reuse the existing SWE workflow surface', () => {
    for (const surface of SWE_SURFACES) {
      assert.ok(canonical.includes(`\`${surface}\``), `Missing SWE surface: ${surface}`);
    }
  })) passed++; else failed++;

  if (test('workflow captures MLE judgment primitives beyond a checklist', () => {
    for (const primitive of JUDGMENT_PRIMITIVES) {
      assert.ok(canonical.includes(primitive), `Missing judgment primitive: ${primitive}`);
    }
  })) passed++; else failed++;

  if (test('workflow calibrates scope instead of forcing one ML architecture', () => {
    for (const phrase of SCOPE_CALIBRATION_PHRASES) {
      assert.ok(canonical.includes(phrase), `Missing scope calibration phrase: ${phrase}`);
    }
  })) passed++; else failed++;

  if (test('promotion gate example reports missing metrics explicitly', () => {
    assert.ok(canonical.includes('missing = sorted(name for name in PROMOTION_GATES if name not in metrics)'));
    assert.ok(canonical.includes('Model promotion metrics missing required gates'));
  })) passed++; else failed++;

  if (test('workflow stays general and avoids narrow domain examples', () => {
    const normalized = canonical.toLowerCase();
    for (const forbidden of FORBIDDEN_DOMAIN_EXAMPLES) {
      assert.ok(!normalized.includes(forbidden), `Found narrow domain example: ${forbidden}`);
    }
  })) passed++; else failed++;

  console.log(`\nPassed: ${passed}`);
  console.log(`Failed: ${failed}`);
  process.exit(failed > 0 ? 1 : 0);
}

run();
