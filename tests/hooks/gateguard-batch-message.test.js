'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');
const runner = path.resolve(__dirname, '../../scripts/hooks/run-with-flags.js');

test('comment-first batch edits retain a re-read warning after later first-touch and sibling denials', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-batch-message-'));
  try {
    const file = path.join(root, 'table.js');
    const state = path.join(root, 'state');
    fs.mkdirSync(state);
    fs.writeFileSync(file, '// old\nconst value = 1;\n');
    const comment = { file_path: file, old_string: '// old\n', new_string: '// revised\n' };
    const edit = { file_path: file, old_string: '1', new_string: '2' };
    const calls = [['comment', comment], ['code', edit], ['sibling', { ...edit, new_string: '3' }]];
    const transcript = path.join(root, 'transcript.jsonl');
    const message = (id, entries) => ({ type: 'assistant', message: { id, role: 'assistant', content:
      entries.map(([toolId, input]) => ({ type: 'tool_use', id: toolId, name: 'Edit', input })) } });
    const initial = [{ type: 'user', message: { role: 'user', content: 'Update the table' } }, message('batch-one', calls)];
    fs.writeFileSync(transcript, initial.map(JSON.stringify).join('\n') + '\n');
    const run = (id, input) => {
      const result = spawnSync(process.execPath, [runner, 'pre:edit-write:gateguard-fact-force',
        'scripts/hooks/gateguard-fact-force.js', 'standard,strict'], {
        input: JSON.stringify({ tool_name: 'Edit', tool_use_id: id, tool_input: input, cwd: root, transcript_path: transcript }),
        encoding: 'utf8', timeout: 15000,
        env: { ...process.env, CLAUDE_PROJECT_DIR: root, GATEGUARD_STATE_DIR: state,
          CLAUDE_SESSION_ID: 'batch-message', ECC_HOOK_PROFILE: 'standard', ECC_HOOKS_ENABLED: 'true', ECC_DISABLED_HOOKS: '',
          GATEGUARD_EXEMPT_GLOBS: '', GATEGUARD_FACT_FORCE_FULL_DENIALS: '3',
          ECC_GATEGUARD: 'on', GATEGUARD_DISABLED: '', GATEGUARD_FACT_FORCE_MAX_DENIALS: '',
          GATEGUARD_EXTERNAL_CONTRACT_QUESTION: '', CLAUDE_TRANSCRIPT_PATH: '' },
      });
      assert.ifError(result.error);
      assert.equal(result.status, 0, result.stderr);
      const output = JSON.parse(result.stdout);
      return output.hookSpecificOutput || {};
    };
    assert.notEqual(run('comment', comment).permissionDecision, 'deny');
    // Apply exactly the edit the hook permitted, as the harness would.
    fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace(comment.old_string, comment.new_string));
    const afterComment = fs.readFileSync(file, 'utf8');
    assert.match(afterComment, /revised/);
    for (const [id, input] of calls.slice(1)) {
      const denial = run(id, input);
      assert.equal(denial.permissionDecision, 'deny');
      assert.doesNotMatch(denial.permissionDecisionReason, /(?:file|table\.js) is unchanged/);
      assert.match(denial.permissionDecisionReason, /may already have been applied/);
      assert.match(denial.permissionDecisionReason, /re-read/i);
      assert.equal(fs.readFileSync(file, 'utf8'), afterComment);
    }
    const saved = JSON.parse(fs.readFileSync(path.join(state, 'state-batch-message.json'), 'utf8'));
    assert.equal(saved.fact_force_denials, 1, 'sibling denial must not spend another first-touch denial');
    fs.writeFileSync(transcript, [...initial, message('batch-two', [['retry', edit]])].map(JSON.stringify).join('\n') + '\n');
    assert.notEqual(run('retry', edit).permissionDecision, 'deny');
    fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace(edit.old_string, edit.new_string));
    assert.equal(fs.readFileSync(file, 'utf8'), '// revised\nconst value = 2;\n');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
