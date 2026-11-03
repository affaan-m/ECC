// Step 1 of a job: get the script, then render one prompt per clip. The
// script can come from the Gemini web app (no key: the content script asks
// the chat and the answer arrives as a 'script:result' event), or from the
// Gemini / OpenAI APIs.

import { systemPrompt, userPrompt, chatScriptPrompt } from '../lib/director-prompt.js';
import { parseScript } from '../lib/script-schema.js';
import { renderAllPrompts, validateConsistency } from '../lib/prompt-builder.js';
import { generateScriptText, PROVIDERS } from '../lib/llm/index.js';
import { cleanChatAnswer, mergeSelectors } from '../lib/gemini-app.js';
import { getSettings, getJob, saveJob, emptyJob, withLog } from './storage.js';
import { resolveGeminiAuth } from './auth.js';
import { ensureGeminiTab } from './gemini-tab.js';

export const APP_PROVIDER = 'app';

function planFromInput(input) {
  return {
    format: input.format,
    targetSeconds: Number(input.targetSeconds) || 45,
    clipSeconds: Number(input.clipSeconds) || 8,
    language: input.language || 'pt-BR',
  };
}

function promptOptions(input) {
  return {
    brief: input.brief,
    format: input.format,
    language: input.language,
    targetSeconds: input.targetSeconds,
    clipSeconds: input.clipSeconds,
    persona: input.persona,
    hasReferenceImage: input.reference?.kind === 'image',
    hasReferenceVideo: input.reference?.kind === 'video',
    referenceNotes: input.referenceNotes,
  };
}

function referenceImages(input) {
  return input.reference ? [{ mimeType: input.reference.mimeType, base64: input.reference.base64 }] : [];
}

export function renderPrompts(script, input) {
  const rendered = renderAllPrompts(script, {
    hasReference: Boolean(input.reference),
    language: input.language,
    format: input.format,
  });
  const problems = validateConsistency(script, rendered);
  if (problems.length) {
    throw new Error(`Prompt consistency check failed for clip ${problems[0].index}: missing "${problems[0].missing}"`);
  }
  return rendered.map(r => ({ ...r, status: 'pending', videoUrl: '', error: '', downloadId: null }));
}

function selectorOverrides(settings) {
  try {
    const merged = mergeSelectors(settings.selectorOverrides ? JSON.parse(settings.selectorOverrides) : {});
    return Object.fromEntries(Object.entries(merged).map(([k, v]) => [k, v instanceof RegExp ? v.source : v]));
  } catch {
    return null;
  }
}

// Turns the raw answer into a ready job (or an error job). Shared by both paths.
export async function finishScript(job, text, source) {
  try {
    const script = parseScript(cleanChatAnswer(text), planFromInput(job.input));
    return saveJob(withLog({ ...job, script, prompts: renderPrompts(script, job.input), status: 'ready', error: '' }, `Script written by ${source} (${script.scenes.length} clips).`));
  } catch (err) {
    return saveJob(withLog({ ...job, status: 'error', error: err.message }, `Script failed: ${err.message}`));
  }
}

async function writeViaApp(job, settings) {
  const tab = await ensureGeminiTab(job.geminiTabId);
  const ack = await chrome.tabs.sendMessage(tab.id, {
    type: 'gemini:ask',
    jobId: job.id,
    prompt: chatScriptPrompt(promptOptions(job.input)),
    images: referenceImages(job.input),
    newChat: true,
    model: settings.appModel || '',
    timeoutMs: 5 * 60 * 1000,
    selectors: selectorOverrides(settings),
  });
  if (ack?.error) throw new Error(ack.error);
  return saveJob(withLog({ ...job, geminiTabId: tab.id, dispatchedAt: Date.now() }, 'Asked the Gemini app for the script; waiting for the answer.'));
}

async function writeViaApi(job, settings) {
  const auth = settings.provider === PROVIDERS.OPENAI ? null : await resolveGeminiAuth(settings);
  const text = await generateScriptText({
    settings,
    auth,
    system: systemPrompt(),
    user: userPrompt(promptOptions(job.input)),
    images: referenceImages(job.input),
  });
  return finishScript(job, text, settings.provider);
}

export async function writeScript(input) {
  const settings = await getSettings();
  const job = await saveJob({ ...emptyJob(), status: 'scripting', input });
  try {
    return settings.provider === APP_PROVIDER ? await writeViaApp(job, settings) : await writeViaApi(job, settings);
  } catch (err) {
    return saveJob(withLog({ ...job, status: 'error', error: err.message }, `Script failed: ${err.message}`));
  }
}

// Event from the content script when the Gemini app answered (or failed).
export async function onScriptAnswer({ jobId, result, error }) {
  const job = await getJob();
  if (job.id !== jobId || job.status !== 'scripting') return;
  if (error) {
    await saveJob(withLog({ ...job, status: 'error', error }, `Script failed: ${error}`));
    return;
  }
  // Prefer the raw code block; fall back to the whole answer's text.
  const answer = result?.code && result.code.includes('{') ? result.code : (result?.text || '');
  await finishScript(job, answer, 'Gemini app');
}

export async function updateScript(script) {
  const job = await getJob();
  if (!job.input) throw new Error('No job to update');
  const prompts = renderPrompts(script, job.input);
  return saveJob(withLog({ ...job, script, prompts, status: 'ready', error: '' }, 'Script edited; prompts re-rendered.'));
}
