import browser from 'webextension-polyfill';

import { LargePayloadStore } from '@src/features/handoff/large-payload';
import { htmlSummaryService, readHtmlPage } from '@src/features/summary-services/html-summary-service';
import { startSummaryOperation } from '@src/features/summary-operation/start-summary-operation';
import { sendBackgroundMessage } from '@src/platform/background-messaging';
import { browserLocalStorage } from '@src/platform/browser-storage';
import { isSummaryContentRequest, type PromptSizeResponse } from '@src/shared/messages';
import { estimateTokensFromChars } from '@src/shared/operation-policy';

export function registerHtmlContent(): void {
  browser.runtime.onMessage.addListener((message: unknown) => {
    if (!isSummaryContentRequest(message)) return undefined;
    if (location.hostname === 'www.youtube.com' && location.pathname === '/watch') return undefined;
    return handleMessage(message);
  });
}

async function handleMessage(message: import('@src/shared/messages').SummaryContentRequest) {
    if (message.type === 'GET_SUMMARY_PAGE') return readHtmlPage(document, location.href);
    if (message.type === 'ESTIMATE_PROMPT_SIZE') {
      return estimatePromptSize(message.summaryLanguage, message.systemPrompt);
    }

    const handoff = new LargePayloadStore(browserLocalStorage);
    let storedOperationId: string | undefined;
    try {
      const result = await startSummaryOperation({
        destination: message.destination,
        prepare: () => htmlSummaryService.prepare({
          document,
          url: location.href,
          summaryLanguage: message.summaryLanguage,
          systemPrompt: message.systemPrompt,
        }),
        save: (prompt, destination) => handoff.save(prompt, destination),
      });
      storedOperationId = result.operationId;
      const response = await sendBackgroundMessage({ type: 'REGISTER_OPERATION', operation: result });
      if (!response.ok || !response.operation) throw new Error(response.error || 'Could not save the operation');
      storedOperationId = undefined;
      return { ok: true, operation: response.operation };
    } catch (cause) {
      if (storedOperationId) await handoff.cancel(storedOperationId);
      return { ok: false, error: errorMessage(cause) };
    }
}

async function estimatePromptSize(
  summaryLanguage: string,
  systemPrompt?: string,
): Promise<PromptSizeResponse> {
  try {
    const prepared = await htmlSummaryService.prepare({
      document,
      url: location.href,
      summaryLanguage,
      systemPrompt,
    });
    return {
      ok: true,
      charLength: prepared.prompt.length,
      estimatedTokens: estimateTokensFromChars(prepared.prompt.length),
    };
  } catch (cause) {
    return { ok: false, error: errorMessage(cause) };
  }
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : 'Unknown error';
}
