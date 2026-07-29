'use strict';

const assert = require('assert');
const {
  buildDescription,
  transformRuleContentForCursor,
} = require('../../scripts/lib/cursor-rule-format');

function test(name, fn) {
  try {
    fn();
    console.log(`  ok ${name}`);
    return true;
  } catch (error) {
    console.error(`  not ok ${name}`);
    console.error(`    ${error.message}`);
    return false;
  }
}

let passed = 0;
let failed = 0;

if (test('language rules use Apply Intelligently without globs', () => {
  const source = `---
paths:
  - "**/*.rs"
---
# Rust Patterns
`;
  const result = transformRuleContentForCursor(source, 'rust-patterns');
  assert.match(result, /description: "Rust architecture and patterns for Rust crates, modules, and Cargo projects/);
  assert.match(result, /alwaysApply: false/);
  assert.doesNotMatch(result, /globs:/);
  assert.doesNotMatch(result, /paths:/);
})) passed++; else failed++;

if (test('common rules stay alwaysApply without globs', () => {
  const source = '# Code Review Standards\n\nReview everything.\n';
  const result = transformRuleContentForCursor(source, 'common-code-review');
  assert.match(result, /description: "Code review standards, checklist, and merge guidance"/);
  assert.match(result, /alwaysApply: true/);
  assert.doesNotMatch(result, /globs:/);
})) passed++; else failed++;

if (test('strips globs from pre-translated language rules', () => {
  const source = `---
description: "TypeScript patterns extending common rules"
globs: ["**/*.ts", "**/*.tsx"]
alwaysApply: false
---
# TypeScript Patterns
`;
  const result = transformRuleContentForCursor(source, 'typescript-patterns');
  assert.match(result, /description: "TypeScript architecture and patterns for TypeScript, JavaScript, TSX, and JSX code/);
  assert.match(result, /alwaysApply: false/);
  assert.doesNotMatch(result, /globs:/);
})) passed++; else failed++;

if (test('web rules use intelligent apply mode', () => {
  const source = '# Web Patterns\n\nUse composition.\n';
  const result = transformRuleContentForCursor(source, 'web-patterns');
  assert.match(result, /description: "Web architecture and patterns for frontend HTML, CSS, and component code/);
  assert.match(result, /alwaysApply: false/);
  assert.doesNotMatch(result, /globs:/);
})) passed++; else failed++;

if (test('buildDescription handles python fastapi rules', () => {
  assert.match(
    buildDescription('python-fastapi'),
    /Python FastAPI patterns for Python services, scripts, and FastAPI\/Django apps/
  );
})) passed++; else failed++;

console.log(`\ncursor-rule-format: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
