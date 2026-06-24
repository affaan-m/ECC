'use strict';

// Token pricing per 1M tokens (USD) and gCO2 per 1M tokens
// Sources: public pricing pages + ML Carbon estimates (2024)
const PROVIDERS = {
  openai: {
    name: 'OpenAI',
    baseUrl: 'https://api.openai.com',
    models: {
      'gpt-4o': { inputCost: 2.50, outputCost: 10.00, co2Per1MInput: 180, co2Per1MOutput: 180 },
      'gpt-4o-mini': { inputCost: 0.15, outputCost: 0.60, co2Per1MInput: 20, co2Per1MOutput: 20 },
      'gpt-4-turbo': { inputCost: 10.00, outputCost: 30.00, co2Per1MInput: 480, co2Per1MOutput: 480 },
      'gpt-3.5-turbo': { inputCost: 0.50, outputCost: 1.50, co2Per1MInput: 40, co2Per1MOutput: 40 },
      'o1': { inputCost: 15.00, outputCost: 60.00, co2Per1MInput: 800, co2Per1MOutput: 800 },
      'o1-mini': { inputCost: 3.00, outputCost: 12.00, co2Per1MInput: 200, co2Per1MOutput: 200 },
    }
  },
  anthropic: {
    name: 'Anthropic (Claude)',
    baseUrl: 'https://api.anthropic.com',
    models: {
      'claude-opus-4-8': { inputCost: 15.00, outputCost: 75.00, co2Per1MInput: 700, co2Per1MOutput: 700 },
      'claude-sonnet-4-6': { inputCost: 3.00, outputCost: 15.00, co2Per1MInput: 200, co2Per1MOutput: 200 },
      'claude-haiku-4-5': { inputCost: 0.80, outputCost: 4.00, co2Per1MInput: 60, co2Per1MOutput: 60 },
      'claude-3-5-sonnet-20241022': { inputCost: 3.00, outputCost: 15.00, co2Per1MInput: 200, co2Per1MOutput: 200 },
      'claude-3-5-haiku-20241022': { inputCost: 0.80, outputCost: 4.00, co2Per1MInput: 60, co2Per1MOutput: 60 },
      'claude-3-opus-20240229': { inputCost: 15.00, outputCost: 75.00, co2Per1MInput: 700, co2Per1MOutput: 700 },
    }
  },
  google: {
    name: 'Google Vertex AI',
    baseUrl: 'https://us-central1-aiplatform.googleapis.com',
    models: {
      'gemini-1.5-pro': { inputCost: 1.25, outputCost: 5.00, co2Per1MInput: 100, co2Per1MOutput: 100 },
      'gemini-1.5-flash': { inputCost: 0.075, outputCost: 0.30, co2Per1MInput: 15, co2Per1MOutput: 15 },
      'gemini-2.0-flash': { inputCost: 0.10, outputCost: 0.40, co2Per1MInput: 18, co2Per1MOutput: 18 },
    }
  },
  bedrock: {
    name: 'AWS Bedrock',
    baseUrl: 'https://bedrock-runtime.us-east-1.amazonaws.com',
    models: {
      'amazon.titan-text-express-v1': { inputCost: 0.80, outputCost: 1.00, co2Per1MInput: 50, co2Per1MOutput: 50 },
      'meta.llama3-70b-instruct-v1': { inputCost: 2.65, outputCost: 3.50, co2Per1MInput: 180, co2Per1MOutput: 180 },
      'mistral.mixtral-8x7b-instruct-v0': { inputCost: 0.45, outputCost: 0.70, co2Per1MInput: 35, co2Per1MOutput: 35 },
    }
  }
};

function getModel(provider, modelId) {
  const p = PROVIDERS[provider];
  if (!p) return null;
  return p.models[modelId] || p.models[Object.keys(p.models)[0]] || null;
}

function calculateCost(provider, modelId, inputTokens, outputTokens) {
  const model = getModel(provider, modelId);
  if (!model) return { cost: 0, co2Grams: 0 };
  const cost = (inputTokens / 1_000_000) * model.inputCost + (outputTokens / 1_000_000) * model.outputCost;
  const co2Grams = (inputTokens / 1_000_000) * model.co2Per1MInput + (outputTokens / 1_000_000) * model.co2Per1MOutput;
  return { cost: parseFloat(cost.toFixed(6)), co2Grams: parseFloat(co2Grams.toFixed(4)) };
}

module.exports = { PROVIDERS, getModel, calculateCost };
