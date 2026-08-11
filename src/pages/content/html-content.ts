import browser from 'webextension-polyfill';

import { LargePayloadStore } from '@src/features/handoff/large-payload';
import { htmlSummaryService, readHtmlPage } from '@src/features/summary-services/html-summary-service';
import { startSummaryOperation } from '@src/features/summary-operation/start-summary-operation';
import { sendBackgroundMessage } from '@src/platform/background-messaging';
import { browserLocalStorage } from '@src/platform/browser-storage';
import { isSummaryContentRequest } from '@src/shared/messages';

export function registerHtmlContent(): void {
  browser.runtime.onMessage.addListener(async (message: unknown) => {
    if (!isSummaryContentRequest(message)) return undefined;
    if (message.type === 'GET_SUMMARY_PAGE') return readHtmlPage(document, location.href);

    const handoff = new LargePayloadStore(browserLocalStorage);
    let storedOperationId: string | undefined;
    try {
      const result = await startSummaryOperation({
        destination: message.destination,
        prepare: () => htmlSummaryService.prepare({
          document,
          url: location.href,
          summaryLanguage: message.summaryLanguage,
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
  });
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : 'Unknown error';
}
