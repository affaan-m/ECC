/**
 * Regression tests for skill quality validation rules.
 *
 * Tests validate that the rules-based quality checks in validate-skills.js
 * provide actionable feedback (file path, line number, fix hint) based on
 * patterns from 100+ skills analysis.
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { checkQualityRules } = require('../../scripts/ci/skill-quality-rules');

const QUALITY_SCRIPT_PATH = path.join(__dirname, '..', '..', 'scripts', 'ci', 'validate-skill-quality.js');
const SCRIPT_PATH = QUALITY_SCRIPT_PATH;

function runValidator(skillsDir, extraArgs = [], strict = true) {
  const result = spawnSync('node', [SCRIPT_PATH, skillsDir, ...extraArgs], {
    encoding: 'utf8',
    env: {
      ...process.env,
      CI_STRICT_SKILLS: strict ? '1' : '0',
    },
  });

  return {
    status: result.status ?? 1,
    stdout: `${result.stdout || ''}\n${result.stderr || ''}`,
    stderr: '',
  };
}

function runStandaloneValidator(skillPath, extraArgs = [], strict = true) {
  const result = spawnSync('node', [QUALITY_SCRIPT_PATH, skillPath, ...extraArgs], {
    encoding: 'utf8',
    env: {
      ...process.env,
      CI_STRICT_SKILLS: strict ? '1' : '0',
    },
  });

  return {
    status: result.status ?? 1,
    stdout: `${result.stdout || ''}\n${result.stderr || ''}`,
    stderr: '',
  };
}

function createTestSkill(dir, filename, contents) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, filename), contents, 'utf8');
}

function run() {
  console.log('\n=== Skill Quality Validation Regression Tests ===\n');

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

  check('accepts a valid skill with all required sections', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-skill-test-'));
    try {
      createTestSkill(
        path.join(tempDir, 'skills', 'good-skill'),
        'SKILL.md',
        `---
name: good-skill
description: Useful workflow for validating a good skill with proper structure and content.
---
# Good Skill

## When to Activate
Use when you need to validate quality gates and ensure compliance with quality standards. This section provides practical activation criteria based on careful analysis of over 100 production skills. Choose this skill when testing validator implementations or implementing quality checks in CI/CD pipelines.

## Core Concepts
Keep it practical and actionable in all technical guidance. Base concepts on proven patterns observed across real projects and teams. Understand the foundational principles behind quality validation so you can adapt them to your own scenarios and requirements.

## Examples
The validator provides comprehensive examples of quality checks. You can run validation on skill directories using the provided script. Here is a practical example command that validates a custom skill directory with strict mode enabled: \`node scripts/ci/validate-skills.js ./skills --strict\`. The output includes line numbers and actionable fix hints for quick resolution.

## Anti-Patterns
Avoid generic advice without concrete examples to guide implementation decisions. Do not create vague instructions that require readers to guess implementation details or make assumptions. Never skip validation steps, even when they seem unnecessary or redundant for your use case.

## Best Practices
- Keep it concrete with specific actionable guidance that developers can follow immediately without additional research or consultation
- Focus on evidence-backed patterns derived from analysis of successful implementations and real-world project structures
- Provide line numbers and fix hints in all validation output for developer convenience and faster resolution of issues
`
      );
      const result = runValidator(path.join(tempDir, 'skills'));
      assert.strictEqual(result.status, 0, `Expected valid skill to pass: ${result.stderr || result.stdout}`);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  check('provides actionable feedback with line numbers and fix hints for missing sections', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-skill-test-'));
    try {
      createTestSkill(
        path.join(tempDir, 'skills', 'weak-skill'),
        'SKILL.md',
        `---
name: weak-skill
description: A weak skill.
---
# Weak Skill

## Core Concepts
No activation section.

## Examples
Example only.
`
      );
      const result = runValidator(path.join(tempDir, 'skills'), ['--strict']);
      assert.notStrictEqual(result.status, 0, 'Expected validator to fail');
      assert.match(result.stderr || result.stdout, /missing required section|When to Activate/i);
      assert.match(result.stderr || result.stdout, /Fix:|hint:/i); // Verify fix hint is provided
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  check('detects hardcoded secrets and provides fix hints', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-skill-test-'));
    try {
      const skillContent = '---\n' +
        'name: secret-skill\n' +
        'description: Demo skill for testing secret detection.\n' +
        '---\n' +
        '# Secret Skill\n' +
        '\n' +
        '## When to Activate\n' +
        'Use this skill when you need to demonstrate proper secret handling patterns. This skill tests that the validator correctly identifies leaked credentials in documentation without false positives from code block examples.\n' +
        '\n' +
        '## Core Concepts\n' +
        'Understanding secret detection patterns is critical for security. This skill demonstrates how to properly handle credentials using environment variables, configuration management, and secure storage patterns rather than embedding sensitive data in code.\n' +
        '\n' +
        '## Examples\n' +
        'Documentation showing proper patterns with code blocks should not trigger false positives:\n' +
        '```bash\n' +
        '# Example: Use environment variables safely\n' +
        'export CREDS=secret\n' +
        '```\n' +
        'But avoid patterns like this outside of code blocks: api_key="testkey123456789testkey123456789"\n' +
        '\n' +
        '## Anti-Patterns\n' +
        'Avoid storing credentials directly in source code or configuration files. Never hardcode tokens like password="secretpass123456789secretpass1234". Always use placeholders.\n' +
        '\n' +
        '## Best Practices\n' +
        'Use environment variables for all secrets. Implement secure secret management using HashiCorp Vault or AWS Secrets Manager. Never print sensitive values in logs.';
      
      createTestSkill(
        path.join(tempDir, 'skills', 'secret-skill'),
        'SKILL.md',
        skillContent
      );
      const result = runValidator(path.join(tempDir, 'skills'));
      assert.notStrictEqual(result.status, 0, 'Expected validator to fail for hardcoded secrets');
      assert.match(result.stderr || result.stdout, /secret-like pattern|api_key|sk_live|ghp_/i);
      assert.match(result.stderr || result.stdout, /Fix:/i); // Verify fix hint
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  check('enforces content depth (200+ chars) in strict mode', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-skill-test-'));
    try {
      createTestSkill(
        path.join(tempDir, 'skills', 'shallow-skill'),
        'SKILL.md',
        `---
name: shallow-skill
description: Very short skill.
---
# Shallow

## When to Activate
Use now.

## Core Concepts
One.

## Examples
\`\`\`bash
echo hi
\`\`\`

## Anti-Patterns
Bad.

## Best Practices
Good.
`
      );
      const result = runValidator(path.join(tempDir, 'skills'), ['--strict']);
      assert.notStrictEqual(result.status, 0, 'Expected strict mode to fail for shallow content');
      assert.match(result.stderr || result.stdout, /too short|200/i);
      assert.match(result.stderr || result.stdout, /expand/i); // Verify fix hint mentions expansion
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  check('rejects empty or placeholder-only sections in strict mode', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-skill-test-'));
    try {
      createTestSkill(
        path.join(tempDir, 'skills', 'empty-sections'),
        'SKILL.md',
        `---
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
`
      );
      const result = runValidator(path.join(tempDir, 'skills'), ['--strict']);
      assert.notStrictEqual(result.status, 0, 'Expected strict mode to fail for empty or placeholder sections');
      assert.match(result.stderr || result.stdout, /empty|placeholder/i);
      assert.match(result.stderr || result.stdout, /Fix:/i); // Verify fix hint provided
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  check('reports syntactically invalid YAML frontmatter with fix hints', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-skill-test-'));
    try {
      createTestSkill(
        path.join(tempDir, 'skills', 'bad-frontmatter'),
        'SKILL.md',
        `---
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
`
      );
      const result = runValidator(path.join(tempDir, 'skills'), ['--strict']);
      assert.notStrictEqual(result.status, 0, 'Expected invalid YAML to fail');
      assert.match(result.stderr || result.stdout, /invalid YAML|frontmatter/i);
      assert.match(result.stderr || result.stdout, /Fix:/i); // Verify fix hint
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  check('validates directory structures without crashing on nested skills', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-skill-nested-'));
    try {
      createTestSkill(
        path.join(tempDir, 'skills', 'nested-skill'),
        'SKILL.md',
        `---
name: nested-skill
description: Valid nested skill demonstrating proper directory structure handling and validation patterns.
---
# Nested Skill

## When to Activate
Use for validation of nested directory structures and complex project hierarchies. This skill demonstrates how the validator handles skills organized in subdirectories without issues or performance degradation. Perfect for verifying recursive directory traversal and handling of deeply nested file systems with proper isolation.

## Core Concepts
Be explicit and evidence-backed in all recommendations and guidance. Ensure that nested directory structures are properly traversed and validated at every level. Maintain consistency across all levels of directory nesting and provide clear error messages when validation fails. Document patterns observed from analyzing 100+ real project structures.

## Examples
Here are practical examples of validating nested skill structures. You can use the validator recursively across directory trees. The first command shows basic directory listing, the second finds all SKILL.md files recursively, and the third demonstrates running the full validator on a custom target directory:
\`\`\`bash
echo ok
ls -la nested-skill/
find . -name "SKILL.md" -type f
node scripts/ci/validate-skills.js ./test-dir
\`\`\`

## Anti-Patterns
Avoid vague instructions without clear examples that developers can follow immediately. Do not skip validation steps for nested or deeply nested structures because they appear to be less important. Never assume directory organization without explicit validation and verification of structure integrity.

## Best Practices
- Keep validation logic concrete and actionable for implementers working with complex project hierarchies.
- Focus on patterns from analyzing real project structures and ensure the validator handles edge cases correctly.
- Provide detailed error messages with line numbers and fix hints for quick resolution of issues.
`
      );
      const result = runValidator(path.join(tempDir, 'skills'));
      assert.strictEqual(result.status, 0, `Expected nested skill to pass: ${result.stderr || result.stdout}`);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  check('detects empty sections followed by non-empty sections in strict mode', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-skill-boundary-'));
    try {
      createTestSkill(
        path.join(tempDir, 'skills', 'boundary-test'),
        'SKILL.md',
        `---
name: boundary-test
description: Tests section boundary handling when sections have varying content levels and proper state management.
---
# Boundary Test

## When to Activate
Use this skill when testing validator boundary detection and section state management across multiple sections. This skill ensures the validator properly stops collecting content when encountering the next section heading, preventing content from later sections being incorrectly attributed to empty earlier sections. Critical for validating untrusted CLI inputs and file processing paths.

## Core Concepts


## Examples
This section intentionally has content to test that it is not incorrectly attributed to the empty Core Concepts section above. The validator must properly detect section boundaries and reset state when moving to the next section. This is a critical security requirement for validating file paths and CLI inputs without path traversal or content misattribution issues.

## Anti-Patterns
Do not allow later section content to leak into earlier sections due to improper boundary handling or state management failures. Never skip validation when processing untrusted file inputs or CLI paths, even if they appear to be from trusted sources.

## Best Practices
- Properly manage section state in reduce functions to prevent closure variable persistence across iterations
- Always test boundary conditions when processing structured document formats with section headers
- Verify that section collection stops at proper boundaries and does not continue into subsequent sections
`
      );
      const result = runValidator(path.join(tempDir, 'skills'), ['--strict']);
      assert.notStrictEqual(result.status, 0, 'Expected strict mode to fail when Core Concepts section is empty');
      const output = result.stderr || result.stdout;
      assert.match(output, /empty|placeholder-only/i, 'Should report empty sections');
      assert.match(output, /Core Concepts/i, 'Should specifically mention Core Concepts as empty');
      assert.match(output, /Fix:/i, 'Should provide fix hint');
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  check('standalone validator detects empty Core Concepts with boundary misattribution (untrusted CLI path)', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-skill-standalone-'));
    try {
      const skillDir = path.join(tempDir, 'test-skill');
      fs.mkdirSync(skillDir, { recursive: true });
      const skillFile = path.join(skillDir, 'SKILL.md');
      fs.writeFileSync(
        skillFile,
        `---
name: test-skill
description: Test for standalone validator CLI path to ensure extractSectionBody state machine is robust against untrusted file inputs.
---
# Standalone Boundary Test

## When to Activate
This test validates that the standalone validate-skill-quality.js module properly enforces section boundaries when processing untrusted file inputs. This is critical for the CLI path which accepts arbitrary file paths and must not be vulnerable to crafted markdown that exploits state machine bugs. Repository requirement: all untrusted input paths (CLI args, file paths, subprocess arguments) must have regression coverage.

## Core Concepts


## Examples
Content in Examples section should NOT be collected into the empty Core Concepts section above. If the section boundary state machine fails, this content will leak and cause false negatives in strict mode validation. This is a security-relevant bug that must be caught by regression tests for the untrusted CLI path.

## Anti-Patterns
- Closure variables that persist state across iterations in reduce functions
- Section boundary detection that fails when sections are empty
- Missing regression tests for the untrusted CLI input handling path

## Best Practices
- Use immutable accumulator objects with explicit boundary flags
- Test section extraction with empty sections followed by non-empty sections
- Ensure CLI path regression coverage for all untrusted input handling
`
      );
      const result = runStandaloneValidator(skillFile, ['--strict']);
      assert.notStrictEqual(result.status, 0, 'Expected standalone validator to reject skill with empty Core Concepts in strict mode');
      const output = result.stderr || result.stdout;
      assert.match(output, /empty|placeholder-only/i, 'Standalone validator should detect empty sections');
      assert.match(output, /Core Concepts/i, 'Should specifically identify Core Concepts as empty');
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  check('standalone validator follows the shared quality-rule verdicts', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-skill-contract-'));
    try {
      const skillDir = path.join(tempDir, 'skills', 'contract-skill');
      const skillFile = path.join(skillDir, 'SKILL.md');
      const requiredSections = [
        'When to Activate',
        'Core Concepts',
        'Examples',
        'Anti-Patterns',
        'Best Practices',
      ];
      const body = 'This section contains practical guidance, clear decision criteria, and concrete steps that contributors can apply consistently across real projects. '.repeat(2);

      const createSkill = (sections) => {
        const content = [
          '---',
          'name: contract-skill',
          'description: A contract fixture for comparing skill validator quality-rule verdicts.',
          '---',
          '# Contract Skill',
          ...sections.flatMap((section) => [`## ${section}`, body]),
          '',
        ].join('\n');
        createTestSkill(skillDir, 'SKILL.md', content);
        return content;
      };

      const assertBothVerdicts = (sections, strict, expectedStatus, label) => {
        const content = createSkill(sections);
        const findings = checkQualityRules(content, 'contract-skill/SKILL.md', strict);
        const standalone = runStandaloneValidator(skillFile, [], strict);
        const ruleStatus = findings.some((finding) => finding.severity === 'error' || (strict && finding.severity === 'warning')) ? 1 : 0;
        assert.strictEqual(ruleStatus, expectedStatus, `${label}: shared rules verdict`);
        assert.strictEqual(standalone.status, expectedStatus, `${label}: standalone validator verdict`);
      };

      const withoutActivation = requiredSections.filter((section) => section !== 'When to Activate');
      assertBothVerdicts(withoutActivation, false, 1, 'missing section in default mode');
      assertBothVerdicts(withoutActivation, true, 1, 'missing section in strict mode');
      assertBothVerdicts(requiredSections.map((section) => section.toUpperCase()), true, 0, 'uppercase headings in strict mode');
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  check('rejects missing required sections without strict mode', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-skill-missing-default-'));
    try {
      createTestSkill(
        path.join(tempDir, 'skills', 'missing-section'),
        'SKILL.md',
        `---
name: missing-section
description: Valid metadata for the missing-section quality regression fixture.
---
# Missing Section

## Core Concepts
${'Concrete core guidance for this regression fixture. '.repeat(5)}

## Examples
${'Practical examples that show the expected workflow and outcomes. '.repeat(5)}

## Anti-Patterns
${'Avoid unsafe shortcuts and document the reason for each restriction. '.repeat(5)}

## Best Practices
${'Use repeatable checks and describe the expected successful result. '.repeat(5)}
`
      );
      const result = runValidator(path.join(tempDir, 'skills'), [], false);
      assert.notStrictEqual(result.status, 0, 'Expected missing required section to fail in default mode');
      assert.match(result.stderr || result.stdout, /Missing required section: "When to Activate"/i);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  check('detects unquoted hardcoded credential assignments', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-skill-unquoted-secret-'));
    try {
      const skillDir = path.join(tempDir, 'skills', 'unquoted-secret');
      createTestSkill(
        skillDir,
        'SKILL.md',
        `---
name: unquoted-secret
description: Valid metadata for the unquoted credential regression fixture.
---
# Unquoted Secret

## When to Activate
${'Use this skill to validate concrete guidance for a real implementation. '.repeat(4)}

## Core Concepts
${'Explain the relevant concepts with enough useful context for the reader. '.repeat(4)}

## Examples
${'Show a practical example and describe how to verify its result. '.repeat(4)}

## Anti-Patterns
${'Describe unsafe patterns and provide a safer alternative. '.repeat(4)}

## Best Practices
${'Use checks that are repeatable, specific, and easy to review. '.repeat(4)}

password=Passw0rd1234
`
      );
      const result = runStandaloneValidator(path.join(skillDir, 'SKILL.md'), [], false);
      assert.notStrictEqual(result.status, 0, 'Expected unquoted credential assignment to fail');
      assert.match(result.stderr || result.stdout, /secret-like pattern/i);
      assert.doesNotMatch(result.stderr || result.stdout, /Passw0rd1234/);

      const nonLiteralCredentials = fs.readFileSync(path.join(skillDir, 'SKILL.md'), 'utf8')
        .replace('password=Passw0rd1234', [
          'password=hashedPassword',
          'token=generateTestJWT(userId)',
          'api_key=PropertyMock(...)',
        ].join('\n'));
      fs.writeFileSync(path.join(skillDir, 'SKILL.md'), nonLiteralCredentials, 'utf8');
      const nonLiteralResult = runStandaloneValidator(path.join(skillDir, 'SKILL.md'), [], false);
      assert.strictEqual(nonLiteralResult.status, 0, 'Expected non-literal credential expressions to pass');
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  check('detects credential assignments on bullet lines', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-skill-bulleted-secret-'));
    try {
      const skillDir = path.join(tempDir, 'skills', 'bulleted-secret');
      createTestSkill(
        skillDir,
        'SKILL.md',
        `---
name: bulleted-secret
description: Valid metadata for the bullet-prefixed credential regression fixture.
---
# Bulleted Secret

## When to Activate
${'Use this skill to validate concrete guidance for a real implementation. '.repeat(4)}

## Core Concepts
${'Explain the relevant concepts with enough useful context for the reader. '.repeat(4)}

## Examples
${'Show a practical example and describe how to verify its result. '.repeat(4)}

## Anti-Patterns
${'Describe unsafe patterns and provide a safer alternative. '.repeat(4)}

## Best Practices
${'Use checks that are repeatable, specific, and easy to review. '.repeat(4)}

- api_key="actualcredentialvalue12345"
`
      );
      const result = runStandaloneValidator(path.join(skillDir, 'SKILL.md'), [], false);
      assert.notStrictEqual(result.status, 0, 'Expected bullet-prefixed credential assignment to fail');
      assert.match(result.stderr || result.stdout, /secret-like pattern/i);
      assert.doesNotMatch(result.stderr || result.stdout, /actualcredentialvalue12345/);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  check('--changed gates only skills added since the base ref', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-skill-changed-'));
    const git = (...args) => {
      const r = spawnSync('git', args, { cwd: tempDir, encoding: 'utf8' });
      assert.strictEqual(r.status, 0, r.stderr);
    };
    const runChanged = () => {
      const r = spawnSync('node', [QUALITY_SCRIPT_PATH, '--strict', '--changed', 'base'], {
        cwd: tempDir,
        encoding: 'utf8',
      });
      return { status: r.status ?? 1, output: `${r.stdout}\n${r.stderr}` };
    };
    try {
      // Pre-existing legacy skill that would fail the quality rules.
      createTestSkill(path.join(tempDir, 'skills', 'legacy'), 'SKILL.md', '---\nname: legacy\ndescription: old\n---\n# Legacy\n');
      git('init', '-q');
      git('config', 'user.email', 't@example.com');
      git('config', 'user.name', 't');
      git('add', '.');
      git('commit', '-qm', 'base');
      git('tag', 'base');

      assert.strictEqual(runChanged().status, 0, 'Untouched legacy skills must not be gated');

      createTestSkill(
        path.join(tempDir, 'skills', 'café-skill'),
        'SKILL.md',
        '---\nname: café-skill\ndescription: New skill missing sections.\n---\n# New\n\napi_key="actualcredentialvalue12345"\n'
      );
      git('add', '.');
      git('commit', '-qm', 'add skill');

      const result = runChanged();
      assert.notStrictEqual(result.status, 0, 'Expected newly added bad skill to fail');
      assert.match(result.output, /Missing required section: "When to Activate"/);
      assert.match(result.output, /secret-like pattern/i);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  console.log(`\nPassed: ${passed}`);
  console.log(`Failed: ${failed}`);
  process.exit(failed > 0 ? 1 : 0);
}

run();
