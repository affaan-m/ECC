import { mergeSelectors } from '../lib/gemini-app.js';

const $ = id => document.getElementById(id);
const send = message => chrome.runtime.sendMessage(message).then(r => {
  if (r?.error) throw new Error(r.error);
  return r;
});

const TEXT_FIELDS = ['projectId', 'geminiApiKey', 'geminiModel', 'openaiApiKey', 'openaiModel', 'omniResolution', 'clipTimeoutMinutes', 'selectorOverrides'];
const RADIO_FIELDS = ['provider', 'renderMode', 'conversationMode'];

function syncBlocks() {
  const provider = document.querySelector('input[name="provider"]:checked')?.value;
  $('gemini-block').hidden = provider !== 'gemini';
  $('openai-block').hidden = provider !== 'openai';
}

async function load() {
  const settings = await send({ type: 'settings:get' });
  for (const f of TEXT_FIELDS) $(f).value = settings[f] ?? '';
  for (const f of RADIO_FIELDS) {
    const input = document.querySelector(`input[name="${f}"][value="${settings[f]}"]`);
    if (input) input.checked = true;
  }
  syncBlocks();
  const auth = await send({ type: 'auth:status' });
  $('google-status').textContent = auth.oauthConfigured ? '' : 'client_id não configurado no manifest';
  $('google-signin').disabled = !auth.oauthConfigured;
}

async function save() {
  const settings = {};
  for (const f of TEXT_FIELDS) settings[f] = $(f).value.trim();
  for (const f of RADIO_FIELDS) settings[f] = document.querySelector(`input[name="${f}"]:checked`)?.value;
  if (settings.selectorOverrides) {
    try {
      mergeSelectors(JSON.parse(settings.selectorOverrides));
    } catch (err) {
      $('saved').textContent = `JSON de seletores inválido: ${err.message}`;
      return;
    }
  }
  await send({ type: 'settings:set', settings });
  $('saved').textContent = 'salvo';
  setTimeout(() => { $('saved').textContent = ''; }, 2000);
}

document.querySelectorAll('input[name="provider"]').forEach(i => i.addEventListener('change', syncBlocks));
$('save').addEventListener('click', save);
$('google-signin').addEventListener('click', async () => {
  try {
    await send({ type: 'auth:google' });
    $('google-status').textContent = 'conectado';
  } catch (err) {
    $('google-status').textContent = err.message;
  }
});
$('google-signout').addEventListener('click', async () => {
  await send({ type: 'auth:google:signout' });
  $('google-status').textContent = 'desconectado';
});
load();
