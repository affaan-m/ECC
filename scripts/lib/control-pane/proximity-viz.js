'use strict';

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
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body { margin: 0; font: 14px/1.4 -apple-system, system-ui, sans-serif; background: #0b0e14; color: #e6edf3; }
  header { display: flex; align-items: baseline; gap: 12px; padding: 12px 16px; border-bottom: 1px solid #1f2630; }
  header h1 { font-size: 15px; margin: 0; }
  header .sub { color: #8b949e; font-size: 12px; }
  #wrap { display: grid; grid-template-columns: 1fr 320px; height: calc(100vh - 49px); }
  #stage { position: relative; }
  canvas { width: 100%; height: 100%; display: block; }
  #side { border-left: 1px solid #1f2630; padding: 12px 14px; overflow-y: auto; }
  #side h2 { font-size: 12px; text-transform: uppercase; letter-spacing: .04em; color: #8b949e; margin: 0 0 8px; }
  .adv { border: 1px solid #1f2630; border-radius: 8px; padding: 8px 10px; margin-bottom: 8px; }
  .adv.resolution { border-color: #b3402f; }
  .adv.advisory { border-color: #9a6700; }
  .adv .lv { font-size: 11px; text-transform: uppercase; letter-spacing: .04em; }
  .adv.resolution .lv { color: #ff7b72; }
  .adv.advisory .lv { color: #e3b341; }
  .adv .who { color: #c9d1d9; }
  .adv .act { color: #8b949e; font-size: 12px; margin-top: 3px; }
  .empty { color: #6e7681; }
  #legend { position: absolute; left: 12px; bottom: 12px; font-size: 11px; color: #8b949e; background: rgba(11,14,20,.7); padding: 6px 8px; border-radius: 6px; }
  .dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-right: 5px; vertical-align: middle; }
</style>
</head>
<body>
  <header>
    <h1>ECC - Agent Airspace</h1>
    <span class="sub" id="status">connecting...</span>
  </header>
  <div id="wrap">
    <div id="stage">
      <canvas id="c"></canvas>
      <div id="legend">
        <div><span class="dot" style="background:#3fb950"></span>clear</div>
        <div><span class="dot" style="background:#e3b341"></span>traffic advisory (transmit)</div>
        <div><span class="dot" style="background:#ff7b72"></span>resolution (steer)</div>
      </div>
    </div>
    <div id="side">
      <h2>Advisories</h2>
      <div id="advisories"><div class="empty">No advisories - airspace clear.</div></div>
    </div>
  </div>
<script>
(function () {
  var canvas = document.getElementById('c');
  var ctx = canvas.getContext('2d');
  var state = { positions: [], links: [], advisories: [], riskByAgent: {} };
  var angle = 0;

  function resize() {
    var r = canvas.parentElement.getBoundingClientRect();
    var dpr = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.floor(r.width * dpr));
    canvas.height = Math.max(1, Math.floor(r.height * dpr));
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  window.addEventListener('resize', resize);

  function riskColor(risk) {
    if (risk >= 0.7) return '#ff7b72';
    if (risk >= 0.35) return '#e3b341';
    return '#3fb950';
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
      ctx.fillStyle = riskColor(state.riskByAgent[ag.agentId] || 0);
      ctx.beginPath(); ctx.arc(p[0], p[1], radius, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#c9d1d9';
      ctx.font = '11px -apple-system, system-ui, sans-serif';
      ctx.fillText(String(ag.agentId).slice(0, 18), p[0] + radius + 4, p[1] + 3);
    }
    angle += 0.0035;
    requestAnimationFrame(draw);
  }

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
    var c = prox.counts || {};
    document.getElementById('status').textContent =
      (c.agents || 0) + ' agents - ' + (c.advisories || 0) + ' advisories - ' + (c.resolutions || 0) + ' steering';
  }

  function poll() {
    fetch('/api/proximity').then(function (r) { return r.json(); }).then(function (data) {
      applySnapshot(data && data.enabled ? data : (data || {}));
    }).catch(function () {
      document.getElementById('status').textContent = 'offline';
    });
  }

  resize();
  poll();
  setInterval(poll, 5000);
  requestAnimationFrame(draw);
})();
</script>
</body>
</html>`;
}

module.exports = { renderProximityVizHtml };
