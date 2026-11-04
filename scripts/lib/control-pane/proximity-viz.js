'use strict';

// Canonical ECC web tokens (Plan Canvas is the master). This dark-only viz
// sources its palette from the shared block so it reads as one product with the
// board, the 2D control plane, and Plan Canvas. The "clear/good" green matches
// the 2D view exactly (same --green token); risk stays redundant (shape+color+text).
const { ROOT_TOKENS_CSS, TOKEN_HEX } = require('../shared/theme-tokens');

/**
 * Self-contained 3D "agent airspace" visualization, served by the control pane.
 *
 * Renders each agent as a point in code-space (positions from the proximity
 * embedding), sized by working-set size and colored by collision risk, with
 * links between converging pairs (amber = transmit advisory, red = steer). The
 * scene auto-rotates so you can read the cloud. Dependency-free: a hand-rolled
 * 3D2D projection on a <canvas>, no external scripts (CSP/offline friendly).
 *
 * This is the operator/Enterprise view of Layer 4: multi-agent observability:
 * literally watch the swarm and watch one agent steer away from a collision.
 */

function renderProximityVizHtml() {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>ECC Agent Airspace</title>
<style>
${ROOT_TOKENS_CSS}
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body { margin: 0; font: 14px/1.4 var(--font); background: var(--bg); color: var(--text); }
  header { display: flex; align-items: baseline; gap: 12px; padding: 12px 16px; border-bottom: 1px solid var(--border); }
  header h1 { font-size: 15px; margin: 0; }
  header .sub { color: var(--text2); font-size: 12px; }
  #wrap { display: grid; grid-template-columns: 1fr 320px; grid-template-rows: minmax(0, 1fr); height: calc(100vh - 49px); }
  #stage { position: relative; height: 100%; min-height: 0; }
  canvas { width: 100%; height: 100%; display: block; }
  #side { border-left: 1px solid var(--border); padding: 12px 14px; overflow-y: auto; }
  #side h2 { font-size: 12px; text-transform: uppercase; letter-spacing: .04em; color: var(--text2); margin: 0 0 8px; }
  #side h2:not(:first-child) { margin-top: 16px; }
  .adv { border: 1px solid var(--border); border-radius: var(--radius); padding: 8px 10px; margin-bottom: 8px; }
  .adv.resolution { border-color: var(--red); }
  .adv.advisory { border-color: var(--orange); }
  .adv .lv { font-size: 11px; text-transform: uppercase; letter-spacing: .04em; }
  .adv.resolution .lv { color: var(--red); }
  .adv.advisory .lv { color: var(--orange); }
  .adv .who { color: var(--text); }
  .adv .act { color: var(--text2); font-size: 12px; margin-top: 3px; }
  .empty { color: var(--text3); }
  .agent-row { display: flex; gap: 8px; align-items: baseline; padding: 3px 0; font-size: 12px; }
  .agent-row .who { color: var(--text); overflow-wrap: anywhere; }
  .agent-row .risk { margin-left: auto; color: var(--text2); white-space: nowrap; }
  #legend { position: absolute; left: 12px; bottom: 12px; font-size: 11px; color: var(--text2); background: color-mix(in srgb, var(--bg) 70%, transparent); padding: 6px 8px; border-radius: var(--radius-sm); }
  #motion-toggle { position: absolute; right: 12px; top: 12px; font: inherit; font-size: 12px; color: var(--text); background: color-mix(in srgb, var(--bg) 70%, transparent); border: 1px solid var(--border); border-radius: var(--radius-sm); padding: 5px 10px; cursor: pointer; }
  #motion-toggle:hover { border-color: var(--green); }
  #motion-toggle:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  .shape { display: inline-block; width: 12px; margin-right: 5px; text-align: center; font-weight: 700; }
  /* Off-screen, not display:none, so assistive tech still reads the node. */
  .sr { position: absolute; width: 1px; height: 1px; margin: -1px; padding: 0; border: 0; clip: rect(0 0 0 0); clip-path: inset(50%); overflow: hidden; white-space: nowrap; }
</style>
</head>
<body>
  <header>
    <h1>ECC - Agent Airspace</h1>
    <span class="sub" id="status">connecting...</span>
    <a class="sub" href="/control-plane" style="margin-left:auto;text-decoration:none">2D control plane</a>
  </header>
  <main id="wrap">
    <div id="stage">
      <canvas id="c" role="img" aria-label="Agent airspace visualization. See the Agents panel for a text alternative.">Agent airspace visualization; see the Agents panel for per-agent risk.</canvas>
      <button id="motion-toggle" type="button" aria-pressed="false">Pause rotation</button>
      <div id="legend">
        <div><span class="shape" style="color:var(--green)">●</span>clear</div>
        <div><span class="shape" style="color:var(--orange)">■</span>traffic advisory (transmit)</div>
        <div><span class="shape" style="color:var(--red)">▲</span>resolution (steer)</div>
      </div>
      <div id="announce" class="sr" role="status" aria-live="polite" aria-atomic="true"></div>
    </div>
    <div id="side">
      <h2>Advisories</h2>
      <div id="advisories"><div class="empty">No advisories - airspace clear.</div></div>
      <h2>Agents</h2>
      <div id="agents"><div class="empty">No agents.</div></div>
    </div>
  </main>
<script>
(function () {
  var canvas = document.getElementById('c');
  var ctx = canvas.getContext('2d');
  var state = { positions: [], links: [], advisories: [], riskByAgent: {} };
  var angle = 0;
  // Respect the OS "reduce motion" setting (WCAG 2.2.2): default to paused and
  // render a single static frame rather than auto-rotating forever. The toggle
  // below still lets an operator start the rotation deliberately.
  var reduceMotion = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  var paused = reduceMotion;
  var rafId = null;
  // Last message handed to the live region, so a poll that changes nothing
  // stays silent.
  var lastSpoken = null;
  // Wording shared by the canvas label and the live region so an outage reads
  // the same way however the operator reaches it.
  var UNAVAILABLE = 'Agent airspace data is unavailable. Advisories and steering are unknown.';

  function announce(message) {
    if (message === lastSpoken) return;
    lastSpoken = message;
    var node = document.getElementById('announce');
    if (node) node.textContent = message;
  }

  function resize() {
    var r = canvas.parentElement.getBoundingClientRect();
    var dpr = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.floor(r.width * dpr));
    canvas.height = Math.max(1, Math.floor(r.height * dpr));
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  window.addEventListener('resize', resize);

  function riskLevel(risk) {
    if (risk >= 0.7) return 'resolution';
    if (risk >= 0.35) return 'advisory';
    return 'clear';
  }

  function riskColor(risk) {
    if (risk >= 0.7) return '${TOKEN_HEX.red}';
    if (risk >= 0.35) return '${TOKEN_HEX.orange}';
    return '${TOKEN_HEX.green}';
  }

  function drawRiskMarker(x, y, radius, level) {
    ctx.beginPath();
    if (level === 'resolution') {
      ctx.moveTo(x, y - radius);
      ctx.lineTo(x + radius, y + radius);
      ctx.lineTo(x - radius, y + radius);
      ctx.closePath();
    } else if (level === 'advisory') {
      ctx.rect(x - radius, y - radius, radius * 2, radius * 2);
    } else {
      ctx.arc(x, y, radius, 0, Math.PI * 2);
    }
    ctx.fill();
  }

  // 3D to 2D: rotate around Y, simple perspective.
  function project(p, w, h) {
    var x = p[0], y = p[1] || 0, z = p[2] || 0;
    var ca = Math.cos(angle), sa = Math.sin(angle);
    var rx = x * ca - z * sa;
    var rz = x * sa + z * ca;
    var scale = 2.4 / (3.2 + rz); // perspective
    return [w / 2 + rx * scale * (Math.min(w, h) * 0.32), h / 2 + y * scale * (Math.min(w, h) * 0.32), scale];
  }

  function draw() {
    var w = canvas.clientWidth, h = canvas.clientHeight;
    ctx.clearRect(0, 0, w, h);
    var pos = {};
    for (var i = 0; i < state.positions.length; i++) {
      var a = state.positions[i];
      pos[a.agentId] = project(a.position || [0, 0, 0], w, h);
    }
    // links first (under the points)
    for (var l = 0; l < state.links.length; l++) {
      var link = state.links[l];
      if (link.risk < 0.2) continue;
      var pa = pos[link.a], pb = pos[link.b];
      if (!pa || !pb) continue;
      ctx.strokeStyle = riskColor(link.risk);
      ctx.globalAlpha = Math.min(1, 0.25 + link.risk * 0.7);
      ctx.lineWidth = 1 + link.risk * 3;
      ctx.beginPath(); ctx.moveTo(pa[0], pa[1]); ctx.lineTo(pb[0], pb[1]); ctx.stroke();
    }
    ctx.globalAlpha = 1;
    // points
    for (var k = 0; k < state.positions.length; k++) {
      var ag = state.positions[k];
      var p = pos[ag.agentId];
      var radius = (6 + Math.sqrt(ag.fileCount || 1) * 3) * p[2];
      var agentRisk = state.riskByAgent[ag.agentId] || 0;
      ctx.fillStyle = riskColor(agentRisk);
      drawRiskMarker(p[0], p[1], radius, riskLevel(agentRisk));
      ctx.fillStyle = '${TOKEN_HEX.text}';
      ctx.font = '11px -apple-system, system-ui, sans-serif';
      ctx.fillText(String(ag.agentId).slice(0, 18), p[0] + radius + 4, p[1] + 3);
    }
  }

  // Draw is one static frame; the loop advances the rotation. When paused (or
  // under reduced motion) nothing is scheduled, so the scene holds still.
  function loop() {
    draw();
    if (paused) { rafId = null; return; }
    angle += 0.0035;
    rafId = requestAnimationFrame(loop);
  }

  function startRotation() {
    if (paused || rafId !== null) return;
    rafId = requestAnimationFrame(loop);
  }

  function stopRotation() {
    if (rafId !== null) { cancelAnimationFrame(rafId); rafId = null; }
  }

  var toggleBtn = document.getElementById('motion-toggle');
  function updateToggle() {
    if (!toggleBtn) return;
    toggleBtn.textContent = paused ? 'Play rotation' : 'Pause rotation';
    toggleBtn.setAttribute('aria-pressed', paused ? 'true' : 'false');
  }
  function togglePause() {
    paused = !paused;
    updateToggle();
    if (paused) { stopRotation(); draw(); }
    else startRotation();
  }
  if (toggleBtn) toggleBtn.addEventListener('click', togglePause);
  updateToggle();

  function renderAdvisories() {
    var box = document.getElementById('advisories');
    box.textContent = '';
    if (!state.advisories.length) {
      var e = document.createElement('div'); e.className = 'empty';
      e.textContent = 'No advisories - airspace clear.'; box.appendChild(e); return;
    }
    state.advisories.forEach(function (adv) {
      var el = document.createElement('div');
      el.className = 'adv ' + (adv.level === 'resolution' ? 'resolution' : 'advisory');
      var lv = document.createElement('div'); lv.className = 'lv';
      lv.textContent = Math.round(adv.risk * 100) + '% - ' + adv.level; el.appendChild(lv);
      var who = document.createElement('div'); who.className = 'who';
      who.textContent = (adv.aLabel || adv.a) + '  <->  ' + (adv.bLabel || adv.b); el.appendChild(who);
      var act = document.createElement('div'); act.className = 'act';
      act.textContent = adv.level === 'resolution'
        ? (adv.steer + ' steers - ' + adv.hold + ' holds')
        : 'both transmit intent';
      el.appendChild(act);
      box.appendChild(el);
    });
  }

  function renderAgents() {
    var box = document.getElementById('agents');
    box.textContent = '';
    if (!state.positions.length) {
      var empty = document.createElement('div'); empty.className = 'empty';
      empty.textContent = 'No agents.'; box.appendChild(empty); return;
    }
    state.positions.forEach(function (agent) {
      var risk = state.riskByAgent[agent.agentId] || 0;
      var row = document.createElement('div'); row.className = 'agent-row';
      var who = document.createElement('span'); who.className = 'who';
      who.textContent = String(agent.agentId); row.appendChild(who);
      var riskText = document.createElement('span'); riskText.className = 'risk';
      riskText.textContent = Math.round(risk * 100) + '% - ' + riskLevel(risk);
      row.appendChild(riskText);
      box.appendChild(row);
    });
  }

  function applySnapshot(prox) {
    state.positions = prox.positions || [];
    state.links = prox.links || [];
    state.advisories = prox.advisories || [];
    var risk = {};
    state.links.forEach(function (l) {
      risk[l.a] = Math.max(risk[l.a] || 0, l.risk);
      risk[l.b] = Math.max(risk[l.b] || 0, l.risk);
    });
    state.riskByAgent = risk;
    renderAdvisories();
    renderAgents();
    var c = prox.counts || {};
    canvas.setAttribute('aria-label',
      (c.agents || state.positions.length) + ' agents in airspace, ' +
      (c.advisories || state.advisories.length) + ' advisories. See the Agents panel for per-agent risk.');
    document.getElementById('status').textContent =
      (c.agents || 0) + ' agents - ' + (c.advisories || 0) + ' advisories - ' + (c.resolutions || 0) + ' steering';
    announce((c.advisories || state.advisories.length) + ' advisories, ' +
      (c.resolutions || 0) + ' steering. ' +
      ((c.resolutions || 0) > 0 ? 'Steering is required.' : 'No steering is required.'));
    // While rotating, the loop repaints with the new data on the next frame;
    // when held still it will not, so paint the updated static frame now.
    if (paused) draw();
  }

  // The last guidance is now stale, so replace it rather than leaving the
  // canvas label and live region claiming the airspace is clear.
  function unavailable() {
    document.getElementById('status').textContent = 'offline';
    canvas.setAttribute('aria-label', UNAVAILABLE);
    announce(UNAVAILABLE);
  }

  function poll() {
    fetch('/api/proximity').then(function (r) {
      if (!r.ok) throw new Error('http ' + r.status);
      return r.json();
    }).then(function (data) {
      applySnapshot(data && data.enabled ? data : (data || {}));
    }).catch(function () {
      unavailable();
    });
  }

  resize();
  poll();
  setInterval(poll, 5000);
  // Under reduced motion we start paused: paint one static frame and wait for
  // the operator to opt into rotation. Otherwise begin the animation loop.
  if (paused) draw();
  else startRotation();
})();
</script>
</body>
</html>`;
}

module.exports = { renderProximityVizHtml };
