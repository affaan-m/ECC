'use strict';

const assert = require('assert');
const { renderProximityVizHtml } = require('../../scripts/lib/control-pane/proximity-viz');

const html = renderProximityVizHtml();

assert.ok(html.includes('role="img"'), 'canvas should expose an image role');
assert.ok(html.includes('id="agents"'), 'airspace should include a text alternative for every agent');
assert.ok(html.includes("function riskLevel(risk)"), 'risk levels should be named independently of color');
assert.ok(html.includes("ctx.rect(x - radius"), 'traffic advisories should use a square marker');
assert.ok(html.includes("ctx.lineTo(x + radius"), 'resolution advisories should use a triangular marker');
assert.ok(html.includes('●</span>clear'), 'legend should show the clear circle marker');
assert.ok(html.includes('■</span>traffic advisory'), 'legend should show the advisory square marker');
assert.ok(html.includes('▲</span>resolution'), 'legend should show the resolution triangle marker');

console.log('Results: Passed: 8, Failed: 0');
