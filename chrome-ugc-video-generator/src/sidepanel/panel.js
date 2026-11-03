import { clipCountFor, DEFAULT_CLIP_SECONDS } from '../lib/plan.js';
import { fileToReference } from './reference.js';
import { renderScript, readScript, renderPublish } from './render-script.js';

const $ = id => document.getElementById(id);
const send = message => chrome.runtime.sendMessage(message).then(r => {
  if (r?.error) throw new Error(r.error);
  return r;
});

const state = { job: null, reference: null, settings: null };

function checked(name) {
  return document.querySelector(`input[name="${name}"]:checked`)?.value;
}

function updateDuration() {
  const target = Number($('target-seconds').value);
  const n = clipCountFor(target, DEFAULT_CLIP_SECONDS);
  $('duration-out').textContent = `${target} s · ${n} clipes × ${DEFAULT_CLIP_SECONDS} s = ${n * DEFAULT_CLIP_SECONDS} s`;
}

function showError(message) {
  const box = $('brief-error');
  box.textContent = message || '';
  box.hidden = !message;
}

async function setReference(file) {
  try {
    state.reference = await fileToReference(file);
    $('reference-preview').src = state.reference.previewUrl;
    $('reference-name').textContent = `${state.reference.kind === 'video' ? 'quadro do vídeo' : 'imagem'} · ${state.reference.name}`;
    $('dropzone').querySelector('.dropzone-empty').hidden = true;
    $('dropzone').querySelector('.dropzone-preview').hidden = false;
  } catch (err) {
    showError(err.message);
  }
}

function clearReference() {
  state.reference = null;
  $('reference-file').value = '';
  $('dropzone').querySelector('.dropzone-empty').hidden = false;
  $('dropzone').querySelector('.dropzone-preview').hidden = true;
}

function collectInput() {
  const brief = $('brief').value.trim();
  if (brief.length < 20) throw new Error('Descreva o vídeo com pelo menos uma frase completa.');
  const ref = state.reference ? { kind: state.reference.kind, mimeType: state.reference.mimeType, base64: state.reference.base64 } : null;
  return {
    brief,
    format: checked('format'),
    persona: checked('persona'),
    language: $('language').value,
    targetSeconds: Number($('target-seconds').value),
    clipSeconds: DEFAULT_CLIP_SECONDS,
    reference: ref,
    referenceNotes: $('reference-notes').value.trim(),
  };
}

function clipRow(p) {
  const li = document.createElement('li');
  li.className = 'clip';
  const dot = document.createElement('span');
  dot.className = `clip-dot ${p.status}`;
  const main = document.createElement('div');
  main.className = 'clip-main';
  const label = document.createElement('span');
  label.className = 'clip-label';
  label.textContent = `Clipe ${p.index} · ${p.role} · ${p.seconds}s`;
  const sub = document.createElement('span');
  sub.className = 'clip-sub';
  sub.textContent = p.error || ({ pending: 'na fila', running: 'gerando no Gemini…', done: p.downloadedByPage || p.downloadId ? 'baixado' : 'pronto' })[p.status] || p.status;
  main.append(label, sub);
  const action = document.createElement('button');
  action.type = 'button';
  action.className = 'link-button';
  if ((p.status === 'error' || p.status === 'done') && state.job?.status !== 'running') {
    action.textContent = 'refazer';
    action.onclick = () => send({ type: 'job:retryClip', index: p.index });
  } else {
    action.hidden = true;
  }
  li.append(dot, main, action);
  if (/^https:\/\//.test(p.videoUrl || '')) {
    const a = document.createElement('a');
    a.href = p.videoUrl;
    a.target = '_blank';
    a.rel = 'noreferrer';
    a.textContent = 'abrir';
    a.className = 'link-button';
    li.append(a);
  }
  return li;
}

const STATUS_LABELS = { idle: 'pronto', scripting: 'escrevendo roteiro', ready: 'roteiro ok', running: 'gerando', stopped: 'parado', done: 'concluído', error: 'erro' };

function renderStatus(job, status) {
  const pill = $('status-pill');
  pill.textContent = STATUS_LABELS[status] || status;
  pill.className = `pill pill-${status}`;
  const busy = status === 'scripting' || status === 'running';
  $('write-script').disabled = busy;
  $('run-clips').disabled = busy;
  $('save-script').disabled = status === 'running';
  $('stop-clips').hidden = status !== 'running';
  $('render-mode').textContent = state.settings?.renderMode === 'api' ? 'via API (Omni Flash)' : 'via app do Gemini';
  const clipFailed = job?.prompts?.some(p => p.status === 'error');
  showError(status === 'error' && !clipFailed ? job.error : '');
}

function renderScriptSection(job, hasScript) {
  const root = $('script-root');
  if (!hasScript) {
    root.replaceChildren();
    delete root.dataset.rendered;
    return;
  }
  if (root.dataset.rendered !== job.id) {
    renderScript(root, job.script, job.prompts);
    root.dataset.rendered = job.id;
  }
}

function render() {
  const job = state.job;
  const status = job?.status || 'idle';
  const hasScript = Boolean(job?.script);
  renderStatus(job, status);
  $('step-script').classList.toggle('step-locked', !hasScript);
  $('step-render').classList.toggle('step-locked', !hasScript);
  $('step-publish').classList.toggle('step-locked', status !== 'done');
  $('script-actions').hidden = !hasScript;
  renderScriptSection(job, hasScript);
  $('clip-list').replaceChildren(...(job?.prompts || []).map(clipRow));
  $('log').textContent = (job?.log || []).slice(-12).join('\n');
  renderPublish($('publish-root'), status === 'done' ? job.script : null);
}

async function refresh() {
  state.job = await send({ type: 'job:get' });
  state.settings = await send({ type: 'settings:get' });
  render();
}

function bind() {
  $('target-seconds').addEventListener('input', updateDuration);
  $('open-options').addEventListener('click', () => chrome.runtime.openOptionsPage());

  const zone = $('dropzone');
  zone.addEventListener('click', () => $('reference-file').click());
  zone.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') $('reference-file').click(); });
  zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('is-over'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('is-over'));
  zone.addEventListener('drop', e => { e.preventDefault(); zone.classList.remove('is-over'); setReference(e.dataTransfer.files[0]); });
  $('reference-file').addEventListener('change', e => setReference(e.target.files[0]));
  $('reference-clear').addEventListener('click', e => { e.stopPropagation(); clearReference(); });

  $('write-script').addEventListener('click', async () => {
    try {
      showError('');
      delete $('script-root').dataset.rendered;
      state.job = await send({ type: 'job:writeScript', input: collectInput() });
      render();
    } catch (err) {
      showError(err.message);
    }
  });
  $('save-script').addEventListener('click', async () => {
    try {
      const script = readScript($('script-root'), state.job.script);
      delete $('script-root').dataset.rendered;
      state.job = await send({ type: 'job:updateScript', script });
      render();
    } catch (err) {
      showError(err.message);
    }
  });
  $('run-clips').addEventListener('click', async () => {
    try {
      // Unsaved edits in the form would otherwise be silently ignored.
      const script = readScript($('script-root'), state.job.script);
      if (JSON.stringify(script) !== JSON.stringify(state.job.script)) {
        delete $('script-root').dataset.rendered;
        state.job = await send({ type: 'job:updateScript', script });
        render();
      }
      await send({ type: 'job:run' });
    } catch (err) {
      showError(err.message);
    }
  });
  $('stop-clips').addEventListener('click', () => send({ type: 'job:stop' }));
  $('probe-gemini').addEventListener('click', async () => {
    const report = await chrome.runtime.sendMessage({ type: 'gemini:probe' });
    $('log').textContent = JSON.stringify(report, null, 2);
  });
  $('reset-job').addEventListener('click', async () => {
    state.job = await send({ type: 'job:reset' });
    clearReference();
    render();
  });

  chrome.runtime.onMessage.addListener(message => {
    if (message?.type === 'job:changed') {
      state.job = message.job;
      render();
    }
  });
}

bind();
updateDuration();
refresh();
