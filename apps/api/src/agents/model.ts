import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import type { LanguageModel } from 'ai';

export class AgentNotConfiguredError extends Error {}

// The model is chosen by env (OPENROUTER_MODEL) so it can be swapped without a code change.
export function chatModel(): LanguageModel {
  const apiKey = process.env.OPENROUTER_API_KEY;
  const modelId = process.env.OPENROUTER_MODEL;
  if (!apiKey || !modelId) {
    throw new AgentNotConfiguredError('OPENROUTER_API_KEY and OPENROUTER_MODEL must be set');
  }

  const openrouter = createOpenAICompatible({
    name: 'openrouter',
    baseURL: process.env.OPENROUTER_BASE_URL ?? 'https://openrouter.ai/api/v1',
    apiKey,
    headers: { 'X-Title': 'Quartermaster' },
  });
  return openrouter.chatModel(modelId);
}
