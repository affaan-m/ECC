'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { test } = require('node:test');

const script = path.resolve(__dirname, '../../scripts/hooks/session-start.js');

for (const [marker, content, domain] of [
  ['next.config.js', 'module.exports = {};', 'Next.js'],
  ['app.csproj', '<Project />', 'C#'],
  ['go.mod', 'module example.com/app', 'Go'],
]) {
  test(`SessionStart selects a ${domain} instinct at the injection limit`, () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-instinct-alias-'));
    try {
      const project = path.join(root, 'project');
      const homunculus = path.join(root, 'homunculus');
      const instincts = path.join(homunculus, 'instincts', 'personal');
      fs.mkdirSync(project, { recursive: true });
      fs.mkdirSync(instincts, { recursive: true });
      fs.writeFileSync(path.join(project, marker), content);
      fs.writeFileSync(path.join(instincts, 'relevant.md'),
        `---\nid: relevant\nconfidence: 0.75\ndomain: "${domain}"\n---\n## Action\nRELEVANT_STACK_GUIDANCE\n`);
      fs.writeFileSync(path.join(instincts, 'unrelated.md'),
        '---\nid: unrelated\nconfidence: 0.9\ndomain: terraform\n---\n## Action\nUNRELATED_STACK_GUIDANCE\n');

      for (const ranking of ['on', 'off']) {
        const result = spawnSync(process.execPath, [script], {
          cwd: project, input: '{}', encoding: 'utf8', timeout: 20000,
          env: {
            ...process.env,
            ECC_AGENT_DATA_HOME: path.join(root, 'agent-data'),
            CLV2_HOMUNCULUS_DIR: homunculus,
            CLAUDE_PROJECT_DIR: project,
            CLAUDE_SESSION_ID: '', ECC_SESSION_ID: '',
            ECC_SESSION_START_CONTEXT: 'on', ECC_SESSION_START_MAX_CHARS: '10000',
            ECC_INSTINCT_RELEVANCE_RANKING: ranking,
            ECC_INSTINCT_CONFIDENCE_THRESHOLD: '0.7', ECC_MAX_INJECTED_INSTINCTS: '1',
          },
        });
        assert.ifError(result.error);
        assert.strictEqual(result.status, 0, result.stderr);
        const context = JSON.parse(result.stdout).hookSpecificOutput.additionalContext;
        const expected = ranking === 'on' ? 'RELEVANT_STACK_GUIDANCE' : 'UNRELATED_STACK_GUIDANCE';
        const excluded = ranking === 'on' ? 'UNRELATED_STACK_GUIDANCE' : 'RELEVANT_STACK_GUIDANCE';
        assert.ok(context.includes(expected), context);
        assert.ok(!context.includes(excluded), context);
      }
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
}
