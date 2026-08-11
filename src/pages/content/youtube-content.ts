import browser from 'webextension-polyfill';

import { LargePayloadStore } from '@src/features/handoff/large-payload';
import { startSummaryOperation } from '@src/features/summary-operation/start-summary-operation';
import { youtubeSummaryService } from '@src/features/summary-services/youtube-summary-service';
import { fetchCaptionTrackXml } from '@src/features/youtube-transcript/caption-fetch';
import type { CaptionTrack } from '@src/features/youtube-transcript/transcript-operation';
import { readYouTubePage, type YouTubeBridgeSnapshot } from '@src/features/youtube-transcript/youtube-page';
import { sendBackgroundMessage } from '@src/platform/background-messaging';
import { browserLocalStorage } from '@src/platform/browser-storage';
import { isSummaryContentRequest } from '@src/shared/messages';

const REQUEST_EVENT = 'summarize-it:request-youtube-page';
const RESPONSE_ATTRIBUTE = 'data-summarize-it-youtube-page';
let activeExtraction: AbortController | undefined;

export function registerYouTubeContent(): void {
  window.addEventListener('yt-navigate-start', () => activeExtraction?.abort());
  browser.runtime.onMessage.addListener(async (message: unknown) => {
    if (!isSummaryContentRequest(message)) return undefined;
    if (message.type === 'GET_SUMMARY_PAGE') return getCurrentYouTubePage();

    activeExtraction?.abort();
    const controller = new AbortController();
    const handoff = new LargePayloadStore(browserLocalStorage);
    let storedOperationId: string | undefined;
    activeExtraction = controller;
    try {
      const page = getCurrentYouTubePage();
      const result = await startSummaryOperation({
        destination: message.destination,
        prepare: () => youtubeSummaryService.prepare({
          page,
          summaryLanguage: message.summaryLanguage,
          selectedTrackId: message.selectedTrackId,
          fetchCaption: (track) => fetchCaptionXml(page.videoId, track, controller.signal),
        }),
        save: (prompt, destination) => handoff.save(prompt, destination),
      });
      storedOperationId = result.operationId;
      if (getCurrentYouTubePage().videoId !== page.videoId) {
        await handoff.cancel(result.operationId);
        throw new Error('The video changed while captions were being retrieved');
      }
      const response = await sendBackgroundMessage({
        type: 'REGISTER_OPERATION', operation: result,
      });
      if (!response.ok || !response.operation) throw new Error(response.error || 'Could not save the operation');
      storedOperationId = undefined;
      return { ok: true, operation: response.operation };
    } catch (cause) {
      if (storedOperationId) {
        await sendBackgroundMessage({ type: 'CANCEL_OPERATION', operationId: storedOperationId }).catch(() => undefined);
        await handoff.cancel(storedOperationId);
      }
      return { ok: false, error: errorMessage(cause) };
    } finally {
      if (activeExtraction === controller) activeExtraction = undefined;
    }
  });
}

function getCurrentYouTubePage() {
  if (location.pathname !== '/watch' || !new URL(location.href).searchParams.get('v')) {
    throw new Error('Open a standard YouTube video');
  }
  const page = readYouTubePage(document, location.href, requestYouTubeSnapshot());
  if (page.accessError) throw new Error(page.accessError);
  return page;
}

function requestYouTubeSnapshot(): YouTubeBridgeSnapshot {
  document.documentElement.removeAttribute(RESPONSE_ATTRIBUTE);
  window.dispatchEvent(new CustomEvent(REQUEST_EVENT));
  const serialized = document.documentElement.getAttribute(RESPONSE_ATTRIBUTE);
  document.documentElement.removeAttribute(RESPONSE_ATTRIBUTE);
  if (!serialized) return {};
  try { return JSON.parse(serialized) as YouTubeBridgeSnapshot; } catch { return {}; }
}

function fetchCaptionXml(videoId: string, track: CaptionTrack, signal: AbortSignal): Promise<string> {
  return fetchCaptionTrackXml({ videoId, track, signal });
}

function errorMessage(cause: unknown): string {
  if (cause instanceof DOMException && cause.name === 'AbortError') return 'Operation cancelled because the video changed';
  return cause instanceof Error ? cause.message : 'Unknown error';
}
