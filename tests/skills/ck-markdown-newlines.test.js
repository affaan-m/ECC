'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const root = path.resolve(__dirname, '../..');
const markdown = '# Project\n\n## What This Is\nSynthetic project\n\n## Tech Stack\nNode.js, JavaScript\n\n## Current Goal\nShip feature\n\n## Do Not Do\n- Change unrelated files\n\n## Where I Left Off\n- Review complete\n\n## Next Steps\n- Implement feature\n\n## Blockers\n- None\n';
let passed = 0;
let failed = 0;
for (const newline of ['\n', '\r\n']) {
  for (const entry of ['init', 'migrate', 'session-start']) {
    const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-ck-newlines-'));
    try {
      const project = path.join(fixture, 'project');
      const home = path.join(fixture, 'home');
      const ck = path.join(home, '.claude/ck');
      const contextDir = path.join(ck, 'contexts/sample');
      fs.mkdirSync(project, { recursive: true });
      fs.mkdirSync(contextDir, { recursive: true });
      const inputMarkdown = entry === 'migrate' ? markdown
        .replace('- Change unrelated files', '- Change unrelated files\n  Preserve user data')
        .replace('- Review complete', '- Review complete\n  Follow-up pending')
        .replace('- Implement feature', '1. Implement feature\n   Include docs')
        + '\n## Decisions Made\n| Decision | Why | Date |\n|---|---|---|\n| Keep old\nstate | Preserve data | 2026-10-01 |\n| Retain backup | Recovery | 2026-10-02\n| Wrapped date | Preserve date | 2026-\n10-03 |\n| Final wrapped date | Preserve final date | 2026-\n10-04\n' : markdown;
      const source = inputMarkdown.replace(/\n/g, newline);
      fs.writeFileSync(path.join(project, 'CLAUDE.md'), source);
      if (entry !== 'init') {
        fs.writeFileSync(path.join(ck, 'projects.json'), JSON.stringify({ [project]: { name: 'sample', contextDir: 'sample' } }));
      }
      if (entry === 'migrate') fs.writeFileSync(path.join(contextDir, 'CONTEXT.md'), source);
      if (entry === 'session-start') {
        fs.writeFileSync(path.join(contextDir, 'context.json'), JSON.stringify({ version: 2, name: 'sample', goal: 'Old goal', sessions: [] }));
      }
      const relative = entry === 'session-start' ? 'hooks/session-start.mjs' : `commands/${entry}.mjs`;
      const result = spawnSync(process.execPath, [path.join(root, 'skills/ck', relative)], {
        cwd: project, input: '{"session_id":"fixture-session"}', encoding: 'utf8', timeout: 10000,
        env: { ...process.env, HOME: home, USERPROFILE: home, PWD: project },
      });
      assert.strictEqual(result.status, 0, result.stderr || result.error?.message);
      if (entry === 'session-start') {
        assert.ok(JSON.parse(result.stdout).additionalContext.includes('WARNING Goal mismatch'));
      } else {
        const data = entry === 'init' ? JSON.parse(result.stdout) : JSON.parse(fs.readFileSync(path.join(contextDir, 'context.json'), 'utf8'));
        assert.strictEqual(data.description, 'Synthetic project');
        assert.strictEqual(data.goal, 'Ship feature');
        assert.deepStrictEqual(data.stack, ['Node.js', 'JavaScript']);
        assert.deepStrictEqual(data.constraints, [entry === 'migrate' ? 'Change unrelated files\nPreserve user data' : 'Change unrelated files']);
        if (entry === 'migrate') {
          assert.strictEqual(data.sessions[0].leftOff, 'Review complete\nFollow-up pending');
          assert.deepStrictEqual(data.sessions[0].nextSteps, ['Implement feature\nInclude docs']);
          assert.deepStrictEqual(data.sessions[0].decisions, [{what: 'Keep old\nstate', why: 'Preserve data', date: '2026-10-01'}, {what: 'Retain backup', why: 'Recovery', date: '2026-10-02'}, {what: 'Wrapped date', why: 'Preserve date', date: '2026-10-03'}, {what: 'Final wrapped date', why: 'Preserve final date', date: '2026-10-04'}]);
          const rendered = fs.readFileSync(path.join(contextDir, 'CONTEXT.md'), 'utf8');
          assert.ok(rendered.includes('| Keep old<br>state | Preserve data |'));
          assert.deepStrictEqual(data.sessions[0].blockers, []);
        }
      }
      assert.strictEqual(fs.readFileSync(path.join(project, 'CLAUDE.md'), 'utf8'), source);
      passed++;
      console.log(`PASS ${entry} ${JSON.stringify(newline)}`);
    } catch (error) {
      failed++;
      console.error(`FAIL ${entry} ${JSON.stringify(newline)}: ${error.message}`);
    } finally {
      fs.rmSync(fixture, { recursive: true, force: true });
    }
  }
}
console.log(`Passed: ${passed}, Failed: ${failed}`);
process.exitCode = failed ? 1 : 0;
