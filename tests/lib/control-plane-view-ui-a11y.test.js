'use strict';

const assert = require('assert');
const { renderControlPlaneViewHtml } = require('../../scripts/lib/control-pane/control-plane-view-ui');

// Count successful assertion executions, including each palette-loop iteration.
// These are source/palette assertions, not browser accessibility test cases.
let assertions = 0;
const countedAssert = {};
for (const method of ['ok', 'strictEqual', 'deepStrictEqual']) {
  countedAssert[method] = (...args) => { assert[method](...args); assertions += 1; };
}

const html = renderControlPlaneViewHtml();

countedAssert.ok(html.includes('role="img"'), 'canvas should expose an image role');
countedAssert.ok(html.includes('aria-label='), 'canvas should carry a text alternative');
countedAssert.ok(html.includes("function riskLevel(risk)"), 'risk levels should be named independently of color');
countedAssert.ok(html.includes("ctx.rect(x - radius"), 'traffic advisories should use a square marker');
countedAssert.ok(html.includes("ctx.lineTo(x + radius"), 'resolution advisories should use a triangular marker');
countedAssert.ok(html.includes('●</span>clear'), 'legend should show the clear circle marker');
countedAssert.ok(html.includes('■</span>traffic advisory'), 'legend should show the advisory square marker');
countedAssert.ok(html.includes('▲</span>resolution'), 'legend should show the resolution triangle marker');
countedAssert.ok(!html.includes('class="dot"'), 'legend should not render color-only dots');

// Counts are polled every few seconds, so a screen-reader user needs a polite
// live region to hear an advisory move. The canvas keeps its own label as the
// on-demand description.
countedAssert.ok(html.includes('role="status" aria-live="polite"'),
  'polled counts should be announced through a polite live region');
countedAssert.ok(html.includes('class="sr"'), 'the live region should be hidden visually but not removed from the tree');

// Check numerical palette separation as an additional channel. This does not
// simulate color vision, establish glyph visibility, or test assistive tools.
function relativeLuminance(hex) {
  const channels = hex.replace('#', '').match(/../g).map(part => parseInt(part, 16) / 255)
    .map(value => (value <= 0.03928 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4)));
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function contrastRatio(left, right) {
  const a = relativeLuminance(left);
  const b = relativeLuminance(right);
  const [lighter, darker] = a > b ? [a, b] : [b, a];
  return (lighter + 0.05) / (darker + 0.05);
}

const BACKGROUND = html.match(/body \{[^}]*background: (#[0-9a-f]{6})/)[1];

// Read the palette back out of the rendered view instead of hard-coding it, so
// a colour change cannot leave these contrast assertions quietly passing.
const legend = [...html.matchAll(
  /<span class="shape" style="color:(#[0-9a-f]{6})">([\u25cf\u25a0\u25b2])<\/span>/g
)].map(match => ({ color: match[1], glyph: match[2] }));

countedAssert.strictEqual(legend.length, 3, 'the legend should declare three risk levels');
countedAssert.deepStrictEqual(legend.map(entry => entry.glyph), ['\u25cf', '\u25a0', '\u25b2'],
  'clear, traffic, and resolution should be marked circle, square, and triangle');

const [clear, traffic, resolution] = legend.map(entry => entry.color);

// The legend and the canvas must agree, otherwise the operator reads a different
// colour from the one the marker is drawn in.
const riskColorBody = html.match(/function riskColor\(risk\) \{([\s\S]*?)\n {2}\}/)[1];
const canvasColors = [...riskColorBody.matchAll(/return '(#[0-9a-f]{6})';/g)].map(match => match[1]);
countedAssert.deepStrictEqual(canvasColors, [resolution, traffic, clear],
  'the legend palette and the riskColor palette must match');

// Check numerical palette separation as an additional channel. This does not
// simulate color vision, establish glyph visibility, or test assistive tools.
countedAssert.ok(contrastRatio(clear, resolution) >= 1.3,
  `clear and resolution must differ by luminance, got ${contrastRatio(clear, resolution).toFixed(2)}:1`);
for (const level of legend) {
  countedAssert.ok(contrastRatio(level.color, BACKGROUND) >= 4.5,
    `the ${level.color} marker must meet 4.5:1 against the page background, got ${contrastRatio(level.color, BACKGROUND).toFixed(2)}:1`);
}

console.log('Reporting unit: source/palette assertions; no browser or assistive-tool acceptance.');
console.log(`Results: Passed: ${assertions}, Failed: 0`);
