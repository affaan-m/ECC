const fs = require('node:fs');
const path = require('node:path');
const yaml = require('js-yaml');

const repoRoot = path.resolve(__dirname, '..');
const outputDir = path.join(repoRoot, '.opencode', 'agents');
const agentNames = [
  'code-simplifier',
  'comment-analyzer',
  'pr-test-analyzer',
  'silent-failure-hunter',
  'type-design-analyzer',
  'react-reviewer',
  'typescript-reviewer',
  'react-build-resolver',
  'vue-reviewer',
  'code-architect',
  'code-explorer',
  'fastapi-reviewer',
  'flutter-reviewer',
  'dart-build-resolver',
  'gan-planner',
  'gan-generator',
  'gan-evaluator',
  'conversation-analyzer',
  'marketing-agent',
];

function convertAgent(source, sourcePath) {
  const match = source.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!match) throw new Error(`Expected YAML frontmatter in ${sourcePath}`);

  const [, frontmatter, prompt] = match;
  const agent = yaml.load(frontmatter);
  const tools = Array.isArray(agent.tools)
    ? agent.tools
    : String(agent.tools ?? '').split(',').map(tool => tool.trim());

  const definition = {
    description: agent.description,
    mode: 'subagent',
    permission: {
      edit: tools.includes('Edit') || tools.includes('Write') ? 'allow' : 'deny',
      bash: tools.includes('Bash') ? 'ask' : 'deny',
    },
  };

  return `---\n${yaml.dump(definition)}---\n${prompt}`;
}

function buildOpencodeAgents() {
  fs.mkdirSync(outputDir, { recursive: true });

  for (const name of agentNames) {
    const sourcePath = path.join(repoRoot, 'agents', `${name}.md`);
    const source = fs.readFileSync(sourcePath, 'utf8');
    const output = convertAgent(source, sourcePath);
    fs.writeFileSync(path.join(outputDir, `${name}.md`), output);
  }
}

module.exports = { buildOpencodeAgents, convertAgent };
