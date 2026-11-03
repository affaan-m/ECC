// Step 1 of a job: ask the LLM for the script, then render one prompt per clip.

import { systemPrompt, userPrompt } from '../lib/director-prompt.js';
import { parseScript } from '../lib/script-schema.js';
import { renderAllPrompts, validateConsistency } from '../lib/prompt-builder.js';
import { generateScriptText, PROVIDERS } from '../lib/llm/index.js';
import { getSettings, getJob, saveJob, emptyJob, withLog } from './storage.js';
import { resolveGeminiAuth } from './auth.js';

function planFromInput(input) {
  return {
    format: input.format,
    targetSeconds: Number(input.targetSeconds) || 45,
    clipSeconds: Number(input.clipSeconds) || 8,
    language: input.language || 'pt-BR',
  };
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

export async function writeScript(input) {
  const settings = await getSettings();
  let job = { ...emptyJob(), status: 'scripting', input };
  await saveJob(job);
  try {
    const images = input.reference ? [{ mimeType: input.reference.mimeType, base64: input.reference.base64 }] : [];
    const auth = settings.provider === PROVIDERS.OPENAI ? null : await resolveGeminiAuth(settings);
    const text = await generateScriptText({
      settings,
      auth,
      system: systemPrompt(),
      user: userPrompt({
        brief: input.brief,
        format: input.format,
        language: input.language,
        targetSeconds: input.targetSeconds,
        clipSeconds: input.clipSeconds,
        persona: input.persona,
        hasReferenceImage: input.reference?.kind === 'image',
        hasReferenceVideo: input.reference?.kind === 'video',
        referenceNotes: input.referenceNotes,
      }),
      images,
    });
    const script = parseScript(text, planFromInput(input));
    job = withLog({ ...job, script, prompts: renderPrompts(script, input), status: 'ready' }, `Script written by ${settings.provider} (${script.scenes.length} clips).`);
  } catch (err) {
    job = withLog({ ...job, status: 'error', error: err.message }, `Script failed: ${err.message}`);
  }
  return saveJob(job);
}

export async function updateScript(script) {
  const job = await getJob();
  if (!job.input) throw new Error('No job to update');
  const prompts = renderPrompts(script, job.input);
  return saveJob(withLog({ ...job, script, prompts, status: 'ready', error: '' }, 'Script edited; prompts re-rendered.'));
}
