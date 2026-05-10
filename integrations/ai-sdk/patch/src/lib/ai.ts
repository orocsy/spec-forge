/**
 * AI SDK provider — swap providers by changing one import.
 *
 * The Vercel AI SDK (`ai`) is FREE OSS. The provider packages
 * (`@ai-sdk/openai`, `@openrouter/ai-sdk-provider`, etc.) are also
 * free; you only pay the underlying model API.
 *
 * Default: OpenRouter — one key gives access to hundreds of models,
 * including FREE ones (Llama 3, Mistral, Gemma). To use a different
 * provider, comment/uncomment the relevant block below.
 */

import { createOpenRouter } from '@openrouter/ai-sdk-provider';

// ─── Default: OpenRouter (free models available) ───────────────────
const openrouter = createOpenRouter({
  apiKey: process.env.OPENROUTER_API_KEY ?? '',
});

// Pick a model — these are all free on OpenRouter as of writing.
// See https://openrouter.ai/models?max_price=0 for the latest list.
export const aiModel = openrouter('meta-llama/llama-3.1-8b-instruct:free');

// ─── Alternative: OpenAI ───────────────────────────────────────────
// import { openai } from '@ai-sdk/openai';
// export const aiModel = openai('gpt-4o-mini');

// ─── Alternative: Anthropic Claude ─────────────────────────────────
// import { anthropic } from '@ai-sdk/anthropic';
// export const aiModel = anthropic('claude-3-5-sonnet-20241022');

// ─── Alternative: Ollama (local, fully free) ───────────────────────
// import { createOllama } from 'ollama-ai-provider';
// const ollama = createOllama({
//   baseURL: process.env.OLLAMA_BASE_URL ?? 'http://localhost:11434/api',
// });
// export const aiModel = ollama('llama3.2');
