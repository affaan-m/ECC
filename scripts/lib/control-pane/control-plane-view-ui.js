'use strict';

/**
 * Self-contained control-plane live view page, served at /control-plane.
 *
 * Draws the 2D PCA projection of the agent pairs (projection.js) on a canvas,
 * the lanes and tasks beside it, and the advisory event feed. Polls
 * /api/control-plane. No external scripts, no framework: it has to work on a
 * loopback server with a strict CSP and offline.
 */

function renderControlPlaneViewHtml() {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>ECC Control Plane</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body { margin: 0; font: 14px/1.4 -apple-system, system-ui, sans-serif; background: #0b0e14; color: #e6edf3; }
  header { display: flex; align-items: baseline; gap: 12px; padding: 12px 16px; border-bottom: 1px solid #1f2630; }
  header h1 { font-size: 15px; margin: 0; }
  header .sub { color: #8b949e; font-size: 12px; }
  header nav { margin-left: auto; font-size: 12px; }
  header nav a { color: #8b949e; margin-left: 12px; text-decoration: none; }
  header nav a:hover { color: #e6edf3; }
  #wrap { display: grid; grid-template-columns: 1fr 360px; height: calc(100vh - 49px); }
  #stage { position: relative; border-right: 1px solid #1f2630; }
  canvas { width: 100%; height: 100%; display: block; }
  #side { padding: 12px 14px; overflow-y: auto; }
  #side h2 { font-size: 12px; text-transform: uppercase; letter-spacing: .04em; color: #8b949e; margin: 14px 0 8px; }
  #side h2:first-child { margin-top: 0; }
  .ev { border: 1px solid #1f2630; border-radius: 8px; padding: 8px 10px; margin-bottom: 8px; }
  .ev.resolution { border-color: #b3402f; }
  .ev.traffic { border-color: #9a6700; }
  .ev.conflict { border-color: #58a6ff; }
  .ev .lv { font-size: 11px; text-transform: uppercase; letter-spacing: .04em; }
  .ev.resolution .lv { color: #ff7b72; }
  .ev.traffic .lv { color: #e3b341; }
  .ev.conflict .lv { color: #58a6ff; }
  .ev .msg { color: #c9d1d9; font-size: 12px; margin-top: 3px; }
  .lane { margin-bottom: 10px; }
  .lane .name { color: #c9d1d9; font-weight: 600; font-size: 12px; }
  .task { display: flex; gap: 8px; align-items: baseline; font-size: 12px; padding: 2px 0 2px 8px; color: #8b949e; }
  .task .id { color: #c9d1d9; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
  .task .risk { margin-left: auto; }
  .empty { color: #6e7681; font-size: 12px; }
  #legend { position: absolute; left: 12px; bottom: 12px; font-size: 11px; color: #8b949e; background: rgba(11,14,20,.7); padding: 6px 8px; border-radius: 6px; }
  #meta { position: absolute; right: 12px; top: 12px; font-size: 11px; color: #8b949e; background: rgba(11,14,20,.7); padding: 6px 8px; border-radius: 6px; text-align: right; }
  .dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-right: 5px; vertical-align: middle; }
</style>
</head>
<body>
  <header>
    <h1>ECC Control Plane</h1>
    <span class="sub" id="status">connecting...</span>
    <nav><a href="/">board</a><a href="/proximity">3D airspace</a><a href="/api/control-plane">json</a></nav>
  </header>
  <div id="wrap">
    <div id="stage">
      <canvas id="c"></canvas>
      <div id="meta"></div>
      <div id="legend">
        <div><span class="dot" style="background:#3fb950"></span>clear</div>
        <div><span class="dot" style="background:#e3b341"></span>traffic advisory (transmit)</div>
        <div><span class="dot" style="background:#ff7b72"></span>resolution advisory (steer)</div>
      </div>
    </div>
    <div id="side">
      <h2>Events</h2>
      <div id="events"><div class="empty">No events.</div></div>
      <h2>Lanes</h2>
      <div id="lanes"><div class="empty">No tasks.</div></div>
    </div>
  </div>
<script>
(function () {
  var canvas = document.getElementById('c');
  var ctx = canvas.getContext('2d');
  var view = { tasks: [], lanes: [], pairs: [], events: [], projection: { agents: [] }, thresholds: { ta: 0.35, ra: 0.7 } };

  function resize() {
    var r = canvas.parentElement.getBoundingClientRect();
    var dpr = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.floor(r.width * dpr));
    canvas.height = Math.max(1, Math.floor(r.height * dpr));
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    draw();
  }
  window.addEventListener('resize', resize);

  function riskColor(risk) {
    if (risk >= view.thresholds.ra) return '#ff7b72';
    if (risk >= view.thresholds.ta) return '#e3b341';
    return '#3fb950';
  }

  // Fit the projected points into the canvas with a margin. The PCA scores
  // are centred already, so we only need a scale.
  function fit(points, w, h) {
    var maxAbs = 1e-6;
    points.forEach(function (p) {
      maxAbs = Math.max(maxAbs, Math.abs(p[0] || 0), Math.abs(p[1] || 0));
    });
    var scale = (Math.min(w, h) * 0.4) / maxAbs;
    return function (p) { return [w / 2 + (p[0] || 0) * scale, h / 2 - (p[1] || 0) * scale]; };
  }

  function draw() {
    var w = canvas.clientWidth, h = canvas.clientHeight;
    ctx.clearRect(0, 0, w, h);
    var agents = view.projection.agents || [];
    var toScreen = fit(agents.map(function (a) { return a.point; }), w, h);
    var pos = {};
    agents.forEach(function (a) { pos[a.agentId] = toScreen(a.point); });

    // axes
    ctx.strokeStyle = '#1f2630';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(0, h / 2); ctx.lineTo(w, h / 2); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(w / 2, 0); ctx.lineTo(w / 2, h); ctx.stroke();

    // pair links under the points
    (view.pairs || []).forEach(function (pair) {
      if (pair.risk < 0.2) return;
      var pa = pos[pair.a], pb = pos[pair.b];
      if (!pa || !pb) return;
      ctx.strokeStyle = riskColor(pair.risk);
      ctx.globalAlpha = Math.min(1, 0.25 + pair.risk * 0.7);
      ctx.lineWidth = 1 + pair.risk * 3;
      ctx.beginPath(); ctx.moveTo(pa[0], pa[1]); ctx.lineTo(pb[0], pb[1]); ctx.stroke();
    });
    ctx.globalAlpha = 1;

    // agents
    var taskById = {};
    view.tasks.forEach(function (t) { taskById[t.id] = t; });
    agents.forEach(function (a) {
      var p = pos[a.agentId];
      var t = taskById[a.agentId] || {};
      var files = (t.workingSet && t.workingSet.fileCount) || 1;
      var radius = 6 + Math.sqrt(files) * 3;
      ctx.fillStyle = riskColor(a.maxRisk || 0);
      ctx.beginPath(); ctx.arc(p[0], p[1], radius, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#c9d1d9';
      ctx.font = '11px -apple-system, system-ui, sans-serif';
      ctx.fillText(String(a.agentId).slice(0, 18), p[0] + radius + 4, p[1] + 3);
    });

    // singleton tasks (no pair yet) sit at the origin, listed in the side panel
    var meta = document.getElementById('meta');
    var pj = view.projection || {};
    var ev = (pj.pca && pj.pca.explainedVariance) || [];
    meta.textContent = 'pca over x_tree, x_overlap, x_dep | ' + (pj.normalization || 'raw') +
      (pj.window && pj.window.samples ? ' | window ' + pj.window.samples : '') +
      (ev.length ? ' | var ' + ev.map(function (x) { return Math.round(x * 100) + '%'; }).join(' / ') : '');
  }

  function renderEvents() {
    var box = document.getElementById('events');
    box.textContent = '';
    if (!view.events.length) {
      var e = document.createElement('div'); e.className = 'empty';
      e.textContent = 'No events. Airspace clear, no declared lease conflicts.'; box.appendChild(e); return;
    }
    view.events.forEach(function (ev) {
      var el = document.createElement('div');
      el.className = 'ev ' + ev.level;
      var lv = document.createElement('div'); lv.className = 'lv';
      lv.textContent = (ev.risk !== undefined ? Math.round(ev.risk * 100) + '% ' : '') + ev.kind + ' / ' + ev.level;
      el.appendChild(lv);
      var msg = document.createElement('div'); msg.className = 'msg';
      msg.textContent = ev.message; el.appendChild(msg);
      box.appendChild(el);
    });
  }

  function renderLanes() {
    var box = document.getElementById('lanes');
    box.textContent = '';
    if (!view.tasks.length) {
      var e = document.createElement('div'); e.className = 'empty';
      e.textContent = 'No tasks.'; box.appendChild(e); return;
    }
    var taskById = {};
    view.tasks.forEach(function (t) { taskById[t.id] = t; });
    view.lanes.forEach(function (lane) {
      var el = document.createElement('div'); el.className = 'lane';
      var name = document.createElement('div'); name.className = 'name';
      name.textContent = lane.label + ' (' + lane.kind + ', ' + lane.taskIds.length + ')';
      el.appendChild(name);
      lane.taskIds.forEach(function (id) {
        var t = taskById[id]; if (!t) return;
        var row = document.createElement('div'); row.className = 'task';
        var idEl = document.createElement('span'); idEl.className = 'id'; idEl.textContent = t.id.slice(0, 20);
        var st = document.createElement('span'); st.textContent = t.harness + ' / ' + t.state + ' / ' + (t.workingSet.fileCount || 0) + ' files';
        var risk = document.createElement('span'); risk.className = 'risk';
        risk.style.color = riskColor(t.projection.maxRisk || 0);
        risk.textContent = t.projection.point ? Math.round((t.projection.maxRisk || 0) * 100) + '%' : 'no pair';
        row.appendChild(idEl); row.appendChild(st); row.appendChild(risk);
        el.appendChild(row);
      });
      box.appendChild(el);
    });
  }

  function apply(data) {
    view = data || view;
    view.tasks = view.tasks || []; view.lanes = view.lanes || []; view.pairs = view.pairs || [];
    view.events = view.events || []; view.projection = view.projection || { agents: [] };
    view.thresholds = view.thresholds || { ta: 0.35, ra: 0.7 };
    renderEvents(); renderLanes(); draw();
    var c = view.counts || {};
    document.getElementById('status').textContent =
      (c.tasks || 0) + ' tasks in ' + (c.lanes || 0) + ' lanes | ' + (c.agents || 0) + ' with edits | ' +
      (c.advisories || 0) + ' advisories (' + (c.resolutions || 0) + ' steering)' +
      (view.inventory && view.inventory.status !== 'ok' ? ' | inventory ' + view.inventory.status : '');
  }

  function poll() {
    fetch('/api/control-plane').then(function (r) { return r.json(); }).then(apply).catch(function () {
      document.getElementById('status').textContent = 'offline';
    });
  }

  resize();
  poll();
  setInterval(poll, 5000);
})();
</script>
</body>
</html>`;
}

module.exports = { renderControlPlaneViewHtml };
