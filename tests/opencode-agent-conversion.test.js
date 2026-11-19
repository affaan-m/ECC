const assert = require('node:assert/strict');
const test = require('node:test');
const yaml = require('js-yaml');
const { convertAgent } = require('../scripts/build-opencode-agents');

const cases = [
  ['comma-separated read-only tools', 'Read, Grep, Glob', 'deny', 'deny'],
  ['array with Edit', ['Read', 'Edit'], 'allow', 'deny'],
  ['comma-separated Write and Bash', 'Read, Write, Bash', 'allow', 'ask'],
  ['array with Bash and no edit tools', ['Read', 'Bash'], 'deny', 'ask'],
];

for (const [name, tools, edit, bash] of cases) {
  test(`converts OpenCode agent permissions for ${name}`, () => {
    const prompt = '## Review instructions\n\nKeep the original prompt.\n';
    const frontmatter = yaml.dump({
      description: 'Example reviewer',
      model: 'sonnet',
      tools,
    });
    const output = convertAgent(`---\n${frontmatter}---\n${prompt}`, 'example.md');
    const [, generatedFrontmatter, generatedPrompt] = output.split('---\n');

    assert.deepEqual(yaml.load(generatedFrontmatter), {
      description: 'Example reviewer',
      mode: 'subagent',
      permission: { edit, bash },
    });
    assert.equal(generatedPrompt, prompt);
  });
}
