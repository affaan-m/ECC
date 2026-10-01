'use strict';

const assert = require('assert');
const vm = require('vm');
const { renderHTML } = require('../../scripts/dashboard-web');
const html = renderHTML({ agents: [], skills: [], commands: [], rules: [], mcps: [], hooks: [] });
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
const routing = script.slice(script.indexOf('function handleRoute()'), script.indexOf('// Render Main Dashboard'));
const tabs = script.slice(script.indexOf('function showTab('), script.indexOf('// Render functions'));
const names = ['agents', 'skills', 'commands', 'rules', 'mcps', 'hooks'];
let passed = 0;
let failed = 0;

for (const scenario of ['detail to tab', 'direct tab route', 'tab history return']) {
  try {
    let panels = [];
    const makeNode = name => {
      const node = { dataset: { tab: name }, active: false };
      node.classList = {
        add: () => { node.active = true; },
        remove: () => { node.active = false; },
      };
      return node;
    };
    const navigation = names.map(makeNode);
    const context = vm.createContext({
      location: { hash: '' },
      window: { addEventListener: () => {} },
      document: {
        querySelectorAll: selector => selector === '.panel' ? panels : navigation,
        getElementById: id => panels.find(node => node.id === id),
        querySelector: selector => navigation.find(node => selector.includes(`"${node.dataset.tab}"`)),
      },
      renderMain: () => {
        panels = names.map(name => Object.assign(makeNode(name), { id: 'panel-' + name }));
      },
      renderPage: () => { panels = []; },
    });
    vm.runInContext(routing + tabs, context);
    if (scenario === 'detail to tab') {
      context.location.hash = '#/skills/sample';
      context.handleRoute();
      context.showTab('skills', navigation[1]);
    } else if (scenario === 'direct tab route') {
      context.location.hash = '#/tabs/skills';
    } else {
      context.renderMain();
      context.showTab('skills', navigation[1]);
      const previous = context.location.hash;
      context.location.hash = '#/skills/sample';
      context.handleRoute();
      context.location.hash = previous;
    }
    context.handleRoute();
    assert.strictEqual(navigation[1].active, true, 'Skills navigation button is active');
    assert.strictEqual(panels.find(node => node.id === 'panel-skills')?.active, true, 'Skills panel is active');
    assert.strictEqual(context.location.hash, '#/tabs/skills');
    assert.ok(panels.some(node => node.id === 'panel-skills'));
    passed += 1;
    console.log(`PASS ${scenario}`);
  } catch (error) {
    failed += 1;
    console.error(`FAIL ${scenario}: ${error.message}`);
  }
}
const details = script.slice(script.indexOf('function renderPage('), script.indexOf('// Filters'));
const suggestions = script.slice(script.indexOf('function showSuggestions('), script.indexOf('function onSearchKey('));
for (const scenario of ['command card route', 'command suggestion route']) {
  try {
    const app = { innerHTML: '', querySelectorAll: () => [] };
    const suggest = { innerHTML: '', classList: { add: () => {}, remove: () => {} } };
    const context = vm.createContext({
      location: { hash: '#/commands/plan' },
      window: { addEventListener: () => {} },
      document: {
        getElementById: id => id === 'app' ? app : id === 'suggest' ? suggest : { value: 'plan' },
        querySelectorAll: () => [],
      },
      AGENTS: [], SKILLS: [], COMMANDS: [{ n: '/plan', d: 'Create a plan', c: 'workflow', b: 'Plan details' }],
      addRecent: () => {}, esc: value => String(value), t: value => value,
      renderMain: () => {},
    });
    vm.runInContext(routing + details + suggestions, context);
    if (scenario === 'command suggestion route') {
      context.showSuggestions();
      const route = suggest.innerHTML.match(/location.hash='([^']+)'/);
      assert.ok(route, 'suggestion contains a navigation route');
      context.location.hash = route[1];
    }
    context.handleRoute();
    assert.ok(app.innerHTML.includes('<h2>/plan</h2>'));
    assert.ok(app.innerHTML.includes('Plan details'));
    passed += 1;
    console.log(`PASS ${scenario}`);
  } catch (error) {
    failed += 1;
    console.error(`FAIL ${scenario}: ${error.message}`);
  }
}
console.log(`Passed: ${passed}, Failed: ${failed}`);
process.exitCode = failed ? 1 : 0;
