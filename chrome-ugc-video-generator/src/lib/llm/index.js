import { geminiGenerate, DEFAULT_GEMINI_MODEL } from './gemini.js';
import { openaiGenerate, DEFAULT_OPENAI_MODEL } from './openai.js';

export const PROVIDERS = Object.freeze({ GEMINI: 'gemini', OPENAI: 'openai' });

// settings: { provider, geminiModel, openaiModel, openaiApiKey, geminiApiKey, projectId }
// auth: { accessToken } resolved by the background worker when provider is gemini.
export async function generateScriptText({ settings, auth, system, user, images, fetchImpl }) {
  if (settings.provider === PROVIDERS.OPENAI) {
    return openaiGenerate({ apiKey: settings.openaiApiKey, model: settings.openaiModel || DEFAULT_OPENAI_MODEL, system, user, images, fetchImpl });
  }
  return geminiGenerate({
    auth: { accessToken: auth?.accessToken, apiKey: settings.geminiApiKey, projectId: settings.projectId },
    model: settings.geminiModel || DEFAULT_GEMINI_MODEL,
    system,
    user,
    images,
    fetchImpl,
  });
}
