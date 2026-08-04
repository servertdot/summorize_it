import type { AiDestination } from '@src/features/handoff/large-payload';

export const AI_DESTINATIONS = [
  'chatgpt', 'perplexity', 'claude', 'gemini', 'qwen', 'deepseek',
] as const satisfies readonly AiDestination[];

export const DEFAULT_DESTINATIONS = ['chatgpt', 'perplexity'] as const satisfies readonly AiDestination[];

export const DESTINATION_NAMES: Record<AiDestination, string> = {
  chatgpt: 'ChatGPT',
  perplexity: 'Perplexity',
  claude: 'Claude',
  gemini: 'Gemini',
  qwen: 'Qwen',
  deepseek: 'DeepSeek',
};

export function isAiDestination(value: unknown): value is AiDestination {
  return AI_DESTINATIONS.some((destination) => destination === value);
}
