// Renders the editable script (bible + scenes) and the TikTok publish block.
// Reads edits back into a script object the worker can re-render.

import { buildCaption } from '../lib/tiktok.js';

const BIBLE_FIELDS = [
  ['character.gender', 'Gênero'], ['character.age', 'Idade'], ['character.ethnicity', 'Etnia'], ['character.face', 'Rosto'],
  ['character.hair', 'Cabelo'], ['character.build', 'Corpo'], ['character.outfit', 'Roupa'], ['character.accessories', 'Acessórios'],
  ['character.voice', 'Voz'], ['product.name', 'Produto'], ['product.look', 'Aparência'], ['product.packaging', 'Embalagem'],
  ['product.key_detail', 'Detalhe-chave'], ['setting', 'Cenário'], ['lighting', 'Luz'], ['camera_style', 'Câmera'],
  ['color_grade', 'Cor'], ['audio_style', 'Áudio'], ['negative', 'Evitar'],
];

const ROLE_LABELS = { hook: 'gancho', problem: 'problema', reveal: 'revelação', demo: 'demonstração', proof: 'prova', cta: 'chamada' };

function getPath(obj, path) {
  return path.split('.').reduce((o, k) => (o ? o[k] : undefined), obj) ?? '';
}

function setPath(obj, path, value) {
  const keys = path.split('.');
  const last = keys.pop();
  const target = keys.reduce((o, k) => (o[k] = o[k] || {}), obj);
  target[last] = value;
}

function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v);
  }
  for (const c of children) node.append(c);
  return node;
}

function roleLabel(role) {
  const base = String(role).replace(/_\d+$/, '');
  return ROLE_LABELS[base] || role;
}

function bibleEditor(bible) {
  const grid = el('div', { class: 'bible-grid' });
  for (const [path, label] of BIBLE_FIELDS) {
    const input = el('input', { type: 'text', 'data-bible': path, value: getPath(bible, path) });
    grid.append(el('label', {}, [el('span', { text: label }), input]));
  }
  return el('details', { class: 'bible' }, [el('summary', { text: 'Bíblia visual (repetida em todos os clipes)' }), grid]);
}

function sceneCard(scene, prompt) {
  const promptBox = el('div', { class: 'scene-prompt' }, [el('pre', { text: prompt?.prompt || '' })]);
  const toggle = el('button', {
    type: 'button', class: 'link-button', text: 'ver prompt final',
    onclick: () => promptBox.classList.toggle('is-open'),
  });
  const copy = el('button', {
    type: 'button', class: 'link-button', text: 'copiar',
    onclick: () => navigator.clipboard.writeText(prompt?.prompt || ''),
  });
  return el('article', { class: 'scene', 'data-index': scene.index }, [
    el('div', { class: 'scene-head' }, [
      el('span', { class: 'scene-role', text: `${scene.index} · ${roleLabel(scene.role)}` }),
      el('span', { class: 'scene-time', text: `${scene.seconds}s` }),
    ]),
    el('label', { class: 'field' }, [el('span', { class: 'field-label', text: 'Ação' }), el('textarea', { rows: '3', 'data-scene': 'action', text: scene.action })]),
    el('label', { class: 'field' }, [el('span', { class: 'field-label', text: 'Fala' }), el('textarea', { rows: '2', 'data-scene': 'dialogue', text: scene.dialogue })]),
    el('label', { class: 'field' }, [el('span', { class: 'field-label', text: 'Câmera' }), el('input', { type: 'text', 'data-scene': 'camera', value: scene.camera })]),
    el('div', { class: 'actions' }, [toggle, copy]),
    promptBox,
  ]);
}

export function renderScript(root, script, prompts = []) {
  root.replaceChildren();
  if (!script) return;
  root.append(
    el('h3', { class: 'script-title', text: script.title || 'Roteiro' }),
    el('p', { class: 'script-concept', text: script.concept }),
    bibleEditor(script.bible),
    ...script.scenes.map(s => sceneCard(s, prompts.find(p => p.index === s.index))),
  );
}

export function readScript(root, base) {
  const script = JSON.parse(JSON.stringify(base));
  for (const input of root.querySelectorAll('[data-bible]')) {
    setPath(script.bible, input.dataset.bible, input.value.trim());
  }
  for (const card of root.querySelectorAll('.scene')) {
    const index = Number(card.dataset.index);
    const scene = script.scenes.find(s => s.index === index);
    if (!scene) continue;
    for (const field of card.querySelectorAll('[data-scene]')) scene[field.dataset.scene] = field.value.trim();
  }
  return script;
}

export function renderPublish(root, script) {
  root.replaceChildren();
  if (!script?.tiktok) return;
  const caption = buildCaption(script.tiktok);
  const textarea = el('textarea', { rows: '6', readonly: 'readonly', text: caption });
  root.append(el('div', { class: 'publish-card' }, [
    el('div', { class: 'hook', text: script.tiktok.hook_text || '' }),
    el('span', { class: 'field-label', text: `Capa: ${script.tiktok.cover_text || '—'}` }),
    textarea,
    el('div', { class: 'actions' }, [
      el('button', { type: 'button', class: 'secondary', text: 'Copiar legenda + hashtags', onclick: () => navigator.clipboard.writeText(caption) }),
    ]),
    el('p', { class: 'muted', text: 'Junte os clipes em ordem no CapCut (corte seco, sem transições), adicione o texto de gancho no primeiro segundo e as legendas automáticas. Publique em 9:16.' }),
  ]));
}
