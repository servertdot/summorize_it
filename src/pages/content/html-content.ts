import browser from 'webextension-polyfill';

import { LargePayloadStore } from '@src/features/handoff/large-payload';
import { extractHtmlContent, htmlSummaryService, readHtmlPage } from '@src/features/summary-services/html-summary-service';
import { startSummaryOperation } from '@src/features/summary-operation/start-summary-operation';
import { sendBackgroundMessage } from '@src/platform/background-messaging';
import { browserLocalStorage } from '@src/platform/browser-storage';
import { isSummaryContentRequest, type SummaryContentRequest } from '@src/shared/messages';
import { estimateTokensFromChars } from '@src/shared/operation-policy';

import { storeClipboardContent } from './clipboard-content';

export function registerHtmlContent(): void {
  browser.runtime.onMessage.addListener((message: unknown) => {
    if (!isSummaryContentRequest(message)) return undefined;
    if (location.hostname === 'www.youtube.com' && location.pathname === '/watch') return undefined;
    return handleMessage(message);
  });
}

async function handleMessage(message: SummaryContentRequest) {
  if (message.type === 'GET_SUMMARY_PAGE') return readHtmlPage(document, location.href);
  const handoff = new LargePayloadStore(browserLocalStorage);
  let storedOperationId: string | undefined;
  try {
    if (message.type === 'PREPARE_CLIPBOARD_CONTENT') {
      return await storeClipboardContent(extractHtmlContent(document).content);
    }
    const prepared = await htmlSummaryService.prepare({
      document,
      url: location.href,
      summaryLanguage: message.summaryLanguage,
      systemPrompt: message.systemPrompt,
    });
    if (message.type === 'ESTIMATE_PROMPT_SIZE') {
      return {
        ok: true,
        charLength: prepared.prompt.length,
        estimatedTokens: estimateTokensFromChars(prepared.prompt.length),
      };
    }
    const result = await startSummaryOperation({
      destination: message.destination,
      prepare: async () => prepared,
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

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : 'Unknown error';
}
