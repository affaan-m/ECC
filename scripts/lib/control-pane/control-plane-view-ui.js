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
  #wrap { display: grid; grid-template-columns: 1fr 360px; grid-template-rows: minmax(0, 1fr); height: calc(100vh - 49px); }
  #stage { position: relative; height: 100%; min-height: 0; border-right: 1px solid #1f2630; }
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
  .shape { display: inline-block; width: 12px; margin-right: 5px; text-align: center; font-weight: 700; }
  /* Off-screen, not display:none, so assistive tech still reads the node. */
  .sr { position: absolute; width: 1px; height: 1px; margin: -1px; padding: 0; border: 0; clip: rect(0 0 0 0); clip-path: inset(50%); overflow: hidden; white-space: nowrap; }
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
      <canvas id="c" role="img" aria-label="Control-plane projection. See the Lanes panel for a text alternative.">Control-plane projection; see the Lanes panel for per-task risk.</canvas>
      <div id="meta"></div>
      <div id="legend">
        <div><span class="shape" style="color:#2ea043">●</span>clear</div>
        <div><span class="shape" style="color:#e3b341">■</span>traffic advisory (transmit)</div>
        <div><span class="shape" style="color:#ff7b72">▲</span>resolution advisory (steer)</div>
      </div>
      <div id="announce" class="sr" role="status" aria-live="polite" aria-atomic="true"></div>
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
  // Last message handed to the live region, so a poll that changes nothing
  // stays silent.
  var lastSpoken = null;

  function resize() {
    var r = canvas.parentElement.getBoundingClientRect();
    var dpr = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.floor(r.width * dpr));
    canvas.height = Math.max(1, Math.floor(r.height * dpr));
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    draw();
  }
  window.addEventListener('resize', resize);

  // The previous clear/resolution palette had similar relative luminance.
  // Separate luminance values plus redundant shapes and text reduce reliance
  // on hue; palette math alone does not establish a user's visual experience.
  function riskLevel(risk) {
    if (risk >= view.thresholds.ra) return 'resolution';
    if (risk >= view.thresholds.ta) return 'traffic';
    return 'clear';
  }

  function riskColor(risk) {
    if (risk >= view.thresholds.ra) return '#ff7b72';
    if (risk >= view.thresholds.ta) return '#e3b341';
    return '#2ea043';
  }

  // Shape is the second, non-colour channel: circle / square / triangle.
  function drawRiskMarker(x, y, radius, level) {
    ctx.beginPath();
    if (level === 'resolution') {
      ctx.moveTo(x, y - radius);
      ctx.lineTo(x + radius, y + radius);
      ctx.lineTo(x - radius, y + radius);
      ctx.closePath();
    } else if (level === 'traffic') {
      ctx.rect(x - radius, y - radius, radius * 2, radius * 2);
    } else {
      ctx.arc(x, y, radius, 0, Math.PI * 2);
    }
    ctx.fill();
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
      var risk = a.maxRisk || 0;
      ctx.fillStyle = riskColor(risk);
      drawRiskMarker(p[0], p[1], radius, riskLevel(risk));
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
        risk.textContent = (t.projection.point
          ? Math.round((t.projection.maxRisk || 0) * 100) + '% - ' + riskLevel(t.projection.maxRisk || 0)
          : 'no pair');
        row.appendChild(idEl); row.appendChild(st); row.appendChild(risk);
        el.appendChild(row);
      });
      box.appendChild(el);
    });
  }

  // Wording shared by the canvas label and the live region so an outage reads
  // the same way however the operator reaches it.
  var UNAVAILABLE = 'Control-plane data is unavailable. Advisories and steering are unknown.';
  // Polls are not sequenced, so a slow request can settle out of order. Only
  // the newest poll that has already settled may update the view: a success
  // from a superseded poll would show older counts, and a failure from a
  // superseded poll would erase newer counts. Anchoring to the last settled
  // poll rather than the last started one also lets a failure land while a
  // newer poll is still pending, instead of leaving stale guidance on screen.
  var settledPoll = 0;
  // Monotonic id handed to each poll as it starts.
  var pollSeq = 0;
  // A poll that never answers must not stay pending forever, or the last
  // steering guidance stays on screen indefinitely.
  var TIMEOUT_MS = 10000;

  // Polling runs every few seconds, so only speak when the advisory and
  // steering counts actually move. Repeating an unchanged summary would talk
  // over the operator without telling them anything new.
  function announce(message) {
    if (message === lastSpoken) return;
    lastSpoken = message;
    document.getElementById('announce').textContent = message;
  }

  function unavailable() {
    document.getElementById('status').textContent = 'offline';
    // The last guidance is now stale, so replace it rather than leaving the
    // live region claiming the airspace is clear. The canvas label goes with
    // it, or it would still report the last successful counts.
    canvas.setAttribute('aria-label', UNAVAILABLE);
    announce(UNAVAILABLE);
  }

  function apply(data) {
    if (!data || data.schemaVersion !== 'ecc.control-plane.view.v1' ||
        !['tasks', 'lanes', 'pairs', 'events'].every(function (key) { return Array.isArray(data[key]); }) ||
        !data.projection || !Array.isArray(data.projection.agents) || !data.thresholds ||
        !Number.isFinite(data.thresholds.ta) || !Number.isFinite(data.thresholds.ra)) {
      throw new Error('Invalid control-plane view');
    }
    var previous = view;
    var drawStarted = false;
    view = Object.assign({}, data);
    try {
      renderEvents(); renderLanes();
      drawStarted = true;
      draw();
    } catch (error) {
      view = previous;
      try {
        renderEvents(); renderLanes();
        if (drawStarted) draw();
      } catch (_) {
        // Keep the accepted model even if the DOM cannot be restored.
      }
      throw error;
    }
    var c = view.counts || {};
    var summary = (c.tasks || 0) + ' tasks in ' + (c.lanes || 0) + ' lanes, ' +
      (c.advisories || 0) + ' advisories, ' + (c.resolutions || 0) + ' steering. ' +
      'See the Lanes panel for per-task risk.';
    canvas.setAttribute('aria-label', summary);
    document.getElementById('status').textContent =
      (c.tasks || 0) + ' tasks in ' + (c.lanes || 0) + ' lanes | ' + (c.agents || 0) + ' with edits | ' +
      (c.advisories || 0) + ' advisories (' + (c.resolutions || 0) + ' steering)' +
      (view.inventory && view.inventory.status !== 'ok' ? ' | inventory ' + view.inventory.status : '');

    announce((c.advisories || 0) + ' advisories, ' +
      (c.resolutions || 0) + ' steering. ' +
      ((c.resolutions || 0) > 0 ? 'Steering is required.' : 'No steering is required.'));
  }

  function poll() {
    var token = ++pollSeq;
    var timer = null;
    var controller = new AbortController();
    // Reject on a timer so a hung request cannot keep the previous guidance on
    // screen forever. The abort is what wakes this poll up, so a timeout is
    // reported as an outage rather than swallowed.
    timer = setTimeout(function () { controller.abort(); }, TIMEOUT_MS);
    // Claim before rendering or reporting failure: two JSON bodies may settle
    // in the same turn, before a later cleanup continuation can run. Equality
    // lets a render failure report unavailable for the token that just claimed.
    function claim() {
      if (token < settledPoll) return false;
      settledPoll = token;
      return true;
    }
    function settle() {
      clearTimeout(timer);
    }
    fetch('/api/control-plane', { signal: controller.signal }).then(function (r) {
      if (!r.ok) throw new Error('Control-plane request failed');
      return r.json();
    }).then(function (data) {
      // A newer poll already owns the view, so do not resurrect older counts.
      if (!claim()) return;
      apply(data);
    }).catch(function () {
      if (!claim()) return;
      unavailable();
    }).then(settle, settle);
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
