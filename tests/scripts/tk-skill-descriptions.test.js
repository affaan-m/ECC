'use strict';

const assert = require('assert');
const path = require('path');
const { spawnSync } = require('child_process');

const source = `
import ast, logging, os, tempfile
from pathlib import Path
from scripts.lib import ecc_dashboard_runtime
tree = ast.parse(Path('ecc_dashboard.py').read_text(encoding='utf-8'))
loader = next(node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name == 'load_skills')
namespace = dict(os=os, List=list, Dict=dict, logger=logging.getLogger('test'))
namespace.update(vars(ecc_dashboard_runtime))
exec(compile(ast.Module(body=[loader], type_ignores=[]), 'ecc_dashboard.py', 'exec'), namespace)
cases = [
 ('scalar', '---\\nname: sample\\ndescription: "Useful: workflow"\\n---\\n# Heading\\n', 'Useful: workflow'),
 ('folded', '---\\nname: sample\\ndescription: >-\\n  Useful workflow\\n  across lines.\\n---\\n# Heading\\n', 'Useful workflow across lines.'),
 ('body fallback', '---\\nname: sample\\n---\\n# Body heading\\n', 'Body heading'),
 ('plain colon', 'Use this: useful workflow.\\n', 'Use this: useful workflow.'),
 ('BOM CRLF', '\\ufeff---\\r\\nname: sample\\r\\ndescription: Useful workflow\\r\\n---\\r\\n# Heading\\r\\n', 'Useful workflow'),
 ('empty body', '---\\nname: sample\\n---\\n', 'Sample'),
]
passed = failed = 0
for name, value, expected in [
 ('plain comment', 'Plan work # editor note', 'Plan work'),
 ('comment only', '# TODO', 'Heading'),
 ('block comment', '>2- # summary\\n  Useful workflow', 'Useful workflow'),
 ('block sign first', '|+2\\n  Useful workflow', 'Useful workflow'),
 ('null', 'null', 'Heading'),
 ('tilde', '~', 'Heading'),
 ('quoted null', '"null" # note', 'null'),
 ('quoted hash', '"Useful # workflow" # note', 'Useful # workflow'),
 ('single quoted hash', "'Useful # workflow' # note", 'Useful # workflow'),
 ('plain hash', 'Useful#workflow', 'Useful#workflow'),
 ('YAML hex escape', '"Plan\\\\x20work"', 'Plan work'),
 ('YAML unicode escape', '"Plan\\\\u0020work"', 'Plan work'),
]:
 cases.append((name, '---\\nname: sample\\ndescription: ' + value + '\\n---\\n# Heading\\n', expected))
for name, content, expected in cases:
 with tempfile.TemporaryDirectory(prefix='ecc-tk-skills-') as root:
  target = Path(root) / 'skills' / 'sample' / 'SKILL.md'
  target.parent.mkdir(parents=True)
  target.write_bytes(content.encode('utf-8'))
  actual = namespace['load_skills'](root)[0]['description']
  if actual == expected and target.read_bytes() == content.encode('utf-8'):
   passed += 1
   print('PASS ' + name)
  else:
   failed += 1
   print('FAIL ' + name + ': ' + repr(actual))
print(f'Passed: {passed}, Failed: {failed}')
raise SystemExit(bool(failed))
`;
const command = process.platform === 'win32' ? 'python' : 'python3';
const result = spawnSync(command, ['-B', '-c', source], { cwd: path.resolve(__dirname, '../..'), encoding: 'utf8' });
process.stdout.write(result.stdout || '');
process.stderr.write(result.stderr || '');
assert.strictEqual(result.status, 0, result.error?.message || result.stderr);
