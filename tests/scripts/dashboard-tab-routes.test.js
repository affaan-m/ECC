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
    let selected = null;
    const makeNode = name => ({
      dataset: { tab: name },
      classList: {
        add: () => { selected = name; },
        remove: () => {},
      },
    });
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
        panels = names.map(name => ({ ...makeNode(name), id: 'panel-' + name }));
        selected = 'agents';
      },
      renderPage: () => { panels = []; selected = null; },
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
    assert.strictEqual(selected, 'skills');
    assert.strictEqual(context.location.hash, '#/tabs/skills');
    assert.ok(panels.some(node => node.id === 'panel-skills'));
    passed += 1;
    console.log(`PASS ${scenario}`);
  } catch (error) {
    failed += 1;
    console.error(`FAIL ${scenario}: ${error.message}`);
  }
}
console.log(`Passed: ${passed}, Failed: ${failed}`);
process.exitCode = failed ? 1 : 0;
