/**
 * Tests for the skill quality validator.
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const SCRIPT_PATH = path.join(__dirname, '..', '..', 'scripts', 'ci', 'validate-skill-quality.js');

function runValidator(files, extraArgs = [], cwd = null) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-skill-quality-'));
  try {
    for (const [name, contents] of Object.entries(files)) {
      const filePath = path.join(tempDir, name);
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, contents, 'utf8');
    }

    const result = spawnSync('node', [SCRIPT_PATH, ...extraArgs], {
      cwd: cwd || tempDir,
      encoding: 'utf8',
      env: {
        ...process.env,
        ECC_SKILLS_DIR: tempDir,
      },
    });

    return {
      status: result.status ?? 1,
      stdout: result.stdout || '',
      stderr: result.stderr || '',
    };
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

function run() {
  console.log('\n=== Testing skill quality validation ===\n');

  let passed = 0;
  let failed = 0;

  const check = (name, fn) => {
    try {
      fn();
      console.log(`  ✓ ${name}`);
      passed += 1;
    } catch (error) {
      console.log(`  ✗ ${name}`);
      console.log(`    Error: ${error.message}`);
      failed += 1;
    }
  };

  check('accepts a valid skill', () => {
    const result = runValidator({
      'skills/good-skill/SKILL.md': `---
name: good-skill
description: Useful workflow for validating a good skill.
---
# Good Skill

## When to Activate
Use when you need a good example.

## Core Concepts
Keep it practical.

## Examples
\`\`\`bash
node scripts/validate-skill-quality.js
\`\`\`

## Anti-Patterns
Avoid generic advice.

## Best Practices
- Keep it concrete.
`,
    });
    assert.strictEqual(result.status, 0, `${result.stderr || result.stdout}`);
  });

  check('handles the final required section without unsupported end-of-input assertions', () => {
    const result = runValidator({
      'skills/final-section/SKILL.md': `---
name: final-section
description: Regression check for final section parsing.
---
# Final Section

## When to Activate
Use when a final section should still parse.

## Core Concepts
This section is intentionally complete.

## Examples
\`\`\`bash
echo ready
\`\`\`

## Anti-Patterns
Avoid weak guidance.

## Best Practices
- Keep the section concrete and final.
`,
    });
    assert.strictEqual(result.status, 0, `${result.stderr || result.stdout}`);
  });

  check('reports missing activation section', () => {
    const result = runValidator({
      'skills/weak-skill/SKILL.md': `---
name: weak-skill
description: A weak skill.
---
# Weak Skill

## Core Concepts
No activation section.

## Examples
Example only.
`,
    });
    assert.notStrictEqual(result.status, 0, 'Expected validator to fail');
    assert.match(result.stderr || result.stdout, /When to Activate/i);
  });

  check('rejects hardcoded secrets in examples', () => {
    const result = runValidator({
      'skills/secret-skill/SKILL.md': `---
name: secret-skill
description: Demo skill.
---
# Secret Skill

## When to Activate
Use when you need a secret example.

## Core Concepts
Check for credentials.

## Examples
\`\`\`bash
export API_KEY=sk_live_1234567890
\`\`\`

## Anti-Patterns
Avoid leaked variables.

## Best Practices
- Avoid secrets.
`,
    });
    assert.notStrictEqual(result.status, 0, 'Expected validator to fail');
    assert.match(result.stderr || result.stdout, /secret|token|API_KEY/i);
  });

  check('supports strict-only length validation when every required section is present', () => {
    const shortValidSkill = `---
name: short-valid-skill
description: Very short skill.
---
# S
## When to Activate
Use.
## Core Concepts
One.
## Examples
\`\`\`bash
echo hi
\`\`\`
## Anti-Patterns
Avoid.
## Best Practices
Be brief.
`;

    const normalResult = runValidator({
      'skills/short-valid-skill/SKILL.md': shortValidSkill,
    });
    assert.strictEqual(normalResult.status, 0, `Expected non-strict run to pass: ${normalResult.stderr || normalResult.stdout}`);

    const strictResult = runValidator({
      'skills/short-valid-skill/SKILL.md': shortValidSkill,
    }, ['--strict']);
    assert.notStrictEqual(strictResult.status, 0, 'Expected strict mode to fail');
    assert.match(strictResult.stderr || strictResult.stdout, /very short and may not provide enough guidance/i);
  });

  check('rejects empty required sections in strict mode', () => {
    const result = runValidator({
      'skills/empty-sections/SKILL.md': `---
name: empty-sections
description: Synthetic skill with empty required sections.
---
# Empty Sections

## When to Activate
TODO

## Core Concepts
placeholder

## Examples
TBD

## Anti-Patterns
N/A

## Best Practices
-
`,
    }, ['--strict']);
    assert.notStrictEqual(result.status, 0, 'Expected strict mode to fail for empty or placeholder sections');
    assert.match(result.stderr || result.stdout, /When to Activate|Core Concepts|Examples|Anti-Patterns|Best Practices/i);
  });

  check('rejects syntactically invalid YAML frontmatter', () => {
    const result = runValidator({
      'skills/bad-frontmatter/SKILL.md': `---
name: [broken
description: invalid frontmatter
---
# Broken

## When to Activate
Use this when you need it.

## Core Concepts
This is malformed YAML.

## Examples
\`\`\`bash
echo bad
\`\`\`

## Anti-Patterns
Avoid broken YAML.

## Best Practices
- Validate input.
`,
    });
    assert.notStrictEqual(result.status, 0, 'Expected invalid YAML to fail');
    assert.match(result.stderr || result.stdout, /invalid YAML frontmatter/i);
  });

  check('defaults to the repo skills directory when no target is provided', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-skill-default-target-'));
    try {
      const skillPath = path.join(tempDir, 'skills', 'default-skill', 'SKILL.md');
      fs.mkdirSync(path.dirname(skillPath), { recursive: true });
      fs.writeFileSync(skillPath, `---
name: default-skill
description: Valid default target skill.
---
# Default Skill

## When to Activate
Use for validation.

## Core Concepts
Be explicit.

## Examples
\`\`\`bash
echo ok
\`\`\`

## Anti-Patterns
Avoid vague instructions.

## Best Practices
- Keep it concrete.
`, 'utf8');

      const result = spawnSync('node', [SCRIPT_PATH], {
        cwd: tempDir,
        encoding: 'utf8',
        env: { ...process.env },
      });

      assert.strictEqual(result.status, 0, `${result.stderr || result.stdout}`);
      assert.match(result.stdout || result.stderr, /Validated 1 skill file\(s\) successfully\./i);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  check('accepts a single SKILL.md target file without crashing', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-skill-single-target-'));
    try {
      const skillPath = path.join(tempDir, 'skills', 'single-target', 'SKILL.md');
      fs.mkdirSync(path.dirname(skillPath), { recursive: true });
      fs.writeFileSync(skillPath, `---
name: single-target
description: Valid single-file target.
---
# Single Target

## When to Activate
Use when validating one skill file.

## Core Concepts
Check directly.

## Examples
\`\`\`bash
echo ok
\`\`\`

## Anti-Patterns
Avoid generic input.

## Best Practices
- Keep it concise.
`, 'utf8');

      const result = spawnSync('node', [SCRIPT_PATH, path.join('skills', 'single-target', 'SKILL.md')], {
        cwd: tempDir,
        encoding: 'utf8',
        env: { ...process.env },
      });

      assert.strictEqual(result.status, 0, `${result.stderr || result.stdout}`);
      assert.match(result.stdout || result.stderr, /Validated 1 skill file\(s\) successfully\./i);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  console.log(`\nPassed: ${passed}`);
  console.log(`Failed: ${failed}`);
  process.exit(failed > 0 ? 1 : 0);
}

run();
