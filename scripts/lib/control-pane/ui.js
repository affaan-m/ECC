'use strict';

function renderControlPaneHtml() {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>ECC Control Pane</title>
  <style>
    :root {
      color-scheme: dark;
      --bg: #101312;
      --panel: #181d1b;
      --panel-2: #202622;
      --ink: #f4f0e8;
      --muted: #aab3aa;
      --line: #344038;
      --accent: #6fd8b5;
      --accent-2: #e6c35c;
      --danger: #ff7a72;
      --blue: #82aaff;
      --shadow: rgba(0, 0, 0, 0.28);
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }

    * { box-sizing: border-box; }
    body {
      margin: 0;
      background: var(--bg);
      color: var(--ink);
      min-width: 320px;
    }

    button, input {
      font: inherit;
    }

    .shell {
      min-height: 100vh;
      display: grid;
      grid-template-rows: auto 1fr;
    }

    header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 18px;
      padding: 14px 18px;
      border-bottom: 1px solid var(--line);
      background: #121715;
      position: sticky;
      top: 0;
      z-index: 4;
    }

    .brand {
      display: flex;
      align-items: center;
      gap: 10px;
      min-width: 180px;
    }

    .brand img {
      width: 28px;
      height: 28px;
    }

    h1 {
      font-size: 18px;
      line-height: 1.1;
      margin: 0;
      letter-spacing: 0;
    }

    .query {
      flex: 1;
      display: flex;
      gap: 8px;
      min-width: 220px;
      max-width: 780px;
    }

    input[type="search"] {
      width: 100%;
      color: var(--ink);
      background: #0c0f0e;
      border: 1px solid var(--line);
      border-radius: 6px;
      padding: 9px 10px;
      outline: none;
    }

    input[type="search"]:focus {
      border-color: var(--accent);
    }

    button {
      color: var(--ink);
      background: var(--panel-2);
      border: 1px solid var(--line);
      border-radius: 6px;
      padding: 9px 12px;
      cursor: pointer;
      white-space: nowrap;
    }

    button:hover {
      border-color: var(--accent);
    }

    button.primary {
      color: #06100c;
      background: var(--accent);
      border-color: var(--accent);
      font-weight: 700;
    }

    main {
      padding: 18px;
      display: grid;
      gap: 16px;
      grid-template-columns: minmax(0, 1.2fr) minmax(360px, 0.8fr);
      align-items: start;
    }

    .metrics {
      display: grid;
      gap: 10px;
      grid-template-columns: repeat(4, minmax(0, 1fr));
    }

    .metric,
    section {
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 8px;
      box-shadow: 0 12px 30px var(--shadow);
    }

    .metric {
      padding: 12px;
      min-height: 84px;
    }

    .metric span {
      display: block;
      color: var(--muted);
      font-size: 12px;
      text-transform: uppercase;
      letter-spacing: 0;
    }

    .metric strong {
      display: block;
      margin-top: 8px;
      font-size: 26px;
      line-height: 1;
    }

    section {
      overflow: hidden;
    }

    .section-head {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 12px;
      padding: 12px 14px;
      border-bottom: 1px solid var(--line);
      background: #151a18;
    }

    h2 {
      margin: 0;
      font-size: 14px;
      letter-spacing: 0;
    }

    .subtle {
      color: var(--muted);
      font-size: 12px;
      overflow-wrap: anywhere;
    }

    table {
      width: 100%;
      border-collapse: collapse;
      table-layout: fixed;
    }

    th, td {
      padding: 10px 12px;
      border-bottom: 1px solid rgba(52, 64, 56, 0.7);
      text-align: left;
      vertical-align: top;
      font-size: 13px;
      overflow-wrap: anywhere;
    }

    th {
      color: var(--muted);
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0;
      background: #131816;
    }

    .stack {
      display: grid;
      gap: 16px;
    }

    .result,
    .connector,
    .work-item,
    .action {
      padding: 12px 14px;
      border-bottom: 1px solid rgba(52, 64, 56, 0.7);
      display: grid;
      gap: 8px;
    }

    .result:last-child,
    .connector:last-child,
    .work-item:last-child,
    .action:last-child {
      border-bottom: 0;
    }

    .kanban {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 8px;
      padding: 12px 14px;
      border-bottom: 1px solid rgba(52, 64, 56, 0.7);
    }

    .kanban-lane {
      min-width: 0;
      padding: 9px;
      border: 1px solid rgba(52, 64, 56, 0.8);
      border-radius: 6px;
      background: #141917;
    }

    .kanban-lane span {
      display: block;
      color: var(--muted);
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0;
    }

    .kanban-lane strong {
      display: block;
      margin-top: 6px;
      font-size: 20px;
      line-height: 1;
    }

    .row {
      display: flex;
      justify-content: space-between;
      gap: 12px;
      align-items: start;
      min-width: 0;
    }

    .row > * {
      min-width: 0;
    }

    .pill {
      display: inline-flex;
      align-items: center;
      min-height: 22px;
      padding: 2px 7px;
      border-radius: 999px;
      background: #222a26;
      color: var(--muted);
      font-size: 12px;
      white-space: nowrap;
    }

    .pill.good { color: #07110d; background: var(--accent); }
    .pill.warn { color: #171000; background: var(--accent-2); }
    .pill.bad { color: #190706; background: var(--danger); }
    .pill.blue { color: #071020; background: var(--blue); }

    code {
      display: block;
      width: 100%;
      padding: 9px;
      background: #0c0f0e;
      border: 1px solid var(--line);
      border-radius: 6px;
      color: #d6e7dc;
      overflow-x: auto;
      white-space: pre;
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      font-size: 12px;
    }

    #run-output {
      min-height: 44px;
      max-height: 260px;
    }

    #app {
      position: fixed;
      right: 16px;
      bottom: 16px;
      max-width: min(640px, calc(100vw - 32px));
      max-height: 45vh;
      overflow: auto;
      padding: 12px 14px;
      background: #190706;
      border: 1px solid var(--danger);
      border-radius: 8px;
      color: #ffe5e2;
      box-shadow: 0 12px 30px var(--shadow);
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      font-size: 12px;
      white-space: pre-wrap;
      z-index: 10;
    }

    .empty {
      padding: 18px 14px;
      color: var(--muted);
    }

    @media (max-width: 1040px) {
      main { grid-template-columns: 1fr; }
      .metrics { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      header { align-items: stretch; flex-direction: column; }
      .query { max-width: none; width: 100%; }
    }

    @media (max-width: 560px) {
      main { padding: 12px; }
      .metrics { grid-template-columns: 1fr; }
      .kanban { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .query { flex-direction: column; }
      th:nth-child(4), td:nth-child(4) { display: none; }
    }
  </style>
</head>
<body>
  <div class="shell">
    <header>
      <div class="brand">
        <img src="/assets/ecc-icon.svg" alt="">
        <h1>ECC Control Pane</h1>
      </div>
      <form class="query" id="query-form">
        <input id="query" type="search" placeholder="Recall operator memory, session context, runbooks">
        <button class="primary" type="submit">Recall</button>
        <button type="button" id="refresh">Refresh</button>
      </form>
    </header>
    <main>
      <div class="stack">
        <div class="metrics" id="metrics"></div>
        <section>
          <div class="section-head">
            <h2>Sessions</h2>
            <span class="subtle" id="db-path"></span>
          </div>
          <div id="sessions"></div>
        </section>
        <section>
          <div class="section-head">
            <h2>Work Items</h2>
            <span class="subtle" id="work-item-count"></span>
          </div>
          <div id="work-items"></div>
        </section>
      </div>
      <div class="stack">
        <section>
          <div class="section-head">
            <h2>Knowledge</h2>
            <span class="subtle" id="knowledge-count"></span>
          </div>
          <div id="knowledge"></div>
        </section>
        <section>
          <div class="section-head">
            <h2>Connectors</h2>
            <span class="subtle" id="connector-count"></span>
          </div>
          <div id="connectors"></div>
        </section>
        <section>
          <div class="section-head">
            <h2>Actions</h2>
            <span class="subtle" id="action-status">local allowlist</span>
          </div>
          <div id="actions"></div>
          <div class="action">
            <code id="run-output">No action output yet.</code>
          </div>
        </section>
      </div>
    </main>
  </div>
  <div id="app" hidden></div>
  <script>
    const state = { query: '' };
    const $ = selector => document.querySelector(selector);
    const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[char]);
    const fmt = new Intl.NumberFormat('en-US');

    function formatError(error) {
      if (!error) return 'Unknown error';
      return error.stack || error.message || String(error);
    }

    function showError(targetSelector, error) {
      const target = $(targetSelector);
      if (!target) return;
      target.hidden = false;
      target.textContent = formatError(error);
    }

    function clearError(targetSelector) {
      const target = $(targetSelector);
      if (!target) return;
      target.hidden = true;
      target.textContent = '';
    }

    async function readJsonResponse(response) {
      let payload;
      try {
        payload = await response.json();
      } catch (error) {
        throw new Error('Expected JSON response from control pane: ' + error.message);
      }

      if (!response.ok) {
        const detail = payload && payload.error ? payload.error : response.status + ' ' + response.statusText;
        throw new Error(detail);
      }

      return payload;
    }

    function statePill(stateName) {
      const state = String(stateName || 'unknown');
      const klass = ['running', 'done'].includes(state)
        ? 'good'
        : ['failed', 'blocked'].includes(state)
          ? 'bad'
          : ['pending', 'ready'].includes(state)
            ? 'warn'
            : 'blue';
      return '<span class="pill ' + klass + '">' + escapeHtml(state) + '</span>';
    }

    function renderMetrics(summary) {
      const items = [
        ['Sessions', summary.totalSessions],
        ['Running', summary.runningSessions],
        ['Unread', summary.unreadMessages],
        ['Tokens', fmt.format(summary.totalTokens || 0)],
      ];
      $('#metrics').innerHTML = items.map(([label, value]) =>
        '<div class="metric"><span>' + escapeHtml(label) + '</span><strong>' + escapeHtml(value) + '</strong></div>'
      ).join('');
    }

    function renderSessions(sessions) {
      if (!sessions.length) {
        $('#sessions').innerHTML = '<div class="empty">No ECC2 sessions found.</div>';
        return;
      }

      $('#sessions').innerHTML = '<table><thead><tr><th>State</th><th>Session</th><th>Harness</th><th>Worktree</th><th>Updated</th></tr></thead><tbody>' +
        sessions.map(session => '<tr>' +
          '<td>' + statePill(session.state) + '</td>' +
          '<td><strong>' + escapeHtml(session.id) + '</strong><br><span class="subtle">' + escapeHtml(session.task) + '</span></td>' +
          '<td>' + escapeHtml(session.agentType || session.harness) + '<br><span class="subtle">' + escapeHtml((session.detectedHarnesses || []).join(', ')) + '</span></td>' +
          '<td>' + escapeHtml(session.worktree ? session.worktree.branch || session.worktree.path : '-') + '</td>' +
          '<td>' + escapeHtml(session.updatedAt || '-') + '</td>' +
        '</tr>').join('') +
      '</tbody></table>';
    }

    function renderWorkItems(workItems) {
      const summary = workItems || { totalCount: 0, openCount: 0, blockedCount: 0, doneCount: 0, kanban: {}, items: [] };
      const items = Array.isArray(summary.items) ? summary.items : [];
      const kanban = summary.kanban || {};
      $('#work-item-count').textContent = summary.openCount + ' open / ' + summary.blockedCount + ' blocked';

      const lanes = ['ready', 'running', 'blocked', 'done'];
      const laneHtml = '<div class="kanban">' + lanes.map(lane =>
        '<div class="kanban-lane"><span>' + escapeHtml(lane) + '</span><strong>' + escapeHtml(kanban[lane] || 0) + '</strong></div>'
      ).join('') + '</div>';

      if (!items.length) {
        $('#work-items').innerHTML = laneHtml + '<div class="empty">No agent work items found.</div>';
        return;
      }

      $('#work-items').innerHTML = laneHtml + items.slice(0, 8).map(item => {
        const branch = item.branch || (item.metadata && item.metadata.branch) || '';
        const mergeGate = item.mergeGate || (item.metadata && item.metadata.mergeGate) || '';
        const blocker = item.blocker || (item.metadata && item.metadata.blocker) || '';
        const owner = item.owner || item.source || 'unassigned';
        return '<div class="work-item">' +
          '<div class="row"><strong>' + escapeHtml(item.title || item.id) + '</strong>' + statePill(item.kanbanState || item.status) + '</div>' +
          '<div class="subtle">' + escapeHtml(owner) + ' - ' + escapeHtml(item.source || 'manual') + (item.priority ? ' - ' + escapeHtml(item.priority) : '') + '</div>' +
          (branch ? '<div class="subtle">branch: ' + escapeHtml(branch) + '</div>' : '') +
          (mergeGate ? '<div class="subtle">merge gate: ' + escapeHtml(mergeGate) + '</div>' : '') +
          (blocker ? '<div class="subtle">blocker: ' + escapeHtml(blocker) + '</div>' : '') +
        '</div>';
      }).join('');
    }

    function renderKnowledge(knowledge) {
      $('#knowledge-count').textContent = knowledge.entityCount + ' entities';
      if (!knowledge.results.length) {
        $('#knowledge').innerHTML = '<div class="empty">No recall results for this query.</div>';
        return;
      }

      $('#knowledge').innerHTML = knowledge.results.map(result => {
        const entity = result.entity;
        const obs = result.latestObservation;
        return '<div class="result">' +
          '<div class="row"><strong>' + escapeHtml(entity.name) + '</strong><span class="pill good">score ' + escapeHtml(result.score) + '</span></div>' +
          '<div class="subtle">' + escapeHtml(entity.entityType) + (entity.path ? ' - ' + escapeHtml(entity.path) : '') + '</div>' +
          '<div>' + escapeHtml(entity.summary || '') + '</div>' +
          (obs ? '<div class="subtle">' + (result.hasPinnedObservation ? 'Pinned - ' : '') + escapeHtml(obs.summary) + '</div>' : '') +
          '<div class="subtle">terms: ' + escapeHtml((result.matchedTerms || []).join(', ') || '-') + '</div>' +
        '</div>';
      }).join('');
    }

    function renderConnectors(connectors) {
      $('#connector-count').textContent = connectors.length + ' configured';
      if (!connectors.length) {
        $('#connectors').innerHTML = '<div class="empty">No memory connectors configured.</div>';
        return;
      }

      $('#connectors').innerHTML = connectors.map(connector => {
        const status = connector.syncedSources > 0 ? '<span class="pill good">synced</span>' : '<span class="pill warn">not synced</span>';
        return '<div class="connector">' +
          '<div class="row"><strong>' + escapeHtml(connector.name) + '</strong>' + status + '</div>' +
          '<div class="subtle">' + escapeHtml(connector.kind) + ' - ' + escapeHtml(connector.path || '-') + '</div>' +
          '<div class="subtle">sources ' + escapeHtml(connector.syncedSources) + ' - last ' + escapeHtml(connector.lastSyncedAt || '-') + '</div>' +
        '</div>';
      }).join('');
    }

    function renderActions(actions) {
      $('#actions').innerHTML = actions.map(action => '<div class="action">' +
        '<div class="row"><strong>' + escapeHtml(action.label) + '</strong>' +
        (action.executable ? '<button data-action="' + escapeHtml(action.id) + '">Run</button>' : '<span class="pill">copy</span>') + '</div>' +
        '<div class="subtle">' + escapeHtml(action.description) + '</div>' +
        '<code>' + escapeHtml(action.commandLine) + '</code>' +
      '</div>').join('');

      document.querySelectorAll('[data-action]').forEach(button => {
        button.addEventListener('click', () => {
          runAction(button.dataset.action);
        });
      });
    }

    async function runAction(actionId) {
      const output = $('#run-output');
      output.textContent = 'Running ' + actionId + '...';

      try {
        const response = await fetch('/api/actions/' + encodeURIComponent(actionId), {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ query: state.query })
        });
        const payload = await readJsonResponse(response);
        output.textContent = JSON.stringify(payload, null, 2);
        await load();
      } catch (error) {
        output.textContent = formatError(error);
      }
    }

    async function load() {
      const url = new URL('/api/snapshot', window.location.href);
      if (state.query) url.searchParams.set('query', state.query);
      const response = await fetch(url);
      const snapshot = await readJsonResponse(response);
      $('#query').value = snapshot.knowledge.query || state.query;
      $('#db-path').textContent = snapshot.database.exists ? snapshot.dbPath : 'database missing';
      $('#action-status').textContent = snapshot.execution.allowActions ? 'local allowlist' : 'read-only';
      renderMetrics(snapshot.summary);
      renderSessions(snapshot.sessions);
      renderWorkItems(snapshot.workItems);
      renderKnowledge(snapshot.knowledge);
      renderConnectors(snapshot.connectors);
      renderActions(snapshot.actions.map(action => ({
        ...action,
        executable: snapshot.execution.allowActions && action.executable
      })));
      clearError('#app');
    }

    $('#query-form').addEventListener('submit', event => {
      event.preventDefault();
      state.query = $('#query').value.trim();
      load().catch(error => showError('#app', error));
    });
    $('#refresh').addEventListener('click', () => {
      load().catch(error => showError('#app', error));
    });
    load().catch(error => showError('#app', error));
  </script>
</body>
</html>`;
}

module.exports = {
  renderControlPaneHtml,
};
