export const OPERATION_TTL_MS = 30 * 60 * 1000;
export const LARGE_PROMPT_WARNING_TOKENS = 32_000;

export function clipboardExpiryAlarm(payloadId: string): string {
  return `summary:clipboard-expire:${payloadId}`;
}

/** Rough chat-model estimate used for UI warnings and footer metrics. */
export function estimateTokensFromChars(charLength: number): number {
  return Math.ceil(charLength / 4);
}
