import browser from 'webextension-polyfill';

import { LargePayloadStore } from '@src/features/handoff/large-payload';
import { startSummaryOperation } from '@src/features/summary-operation/start-summary-operation';
import { readYouTubePage, type YouTubeBridgeSnapshot } from '@src/features/youtube-transcript/youtube-page';
import { sendBackgroundMessage } from '@src/platform/background-messaging';
import { browserLocalStorage } from '@src/platform/browser-storage';
import { isYouTubeContentRequest } from '@src/shared/messages';

const REQUEST_EVENT = 'summarize-it:request-youtube-page';
const RESPONSE_ATTRIBUTE = 'data-summarize-it-youtube-page';
let activeExtraction: AbortController | undefined;

export function registerYouTubeContent(): void {
  window.addEventListener('yt-navigate-start', () => activeExtraction?.abort());
  browser.runtime.onMessage.addListener(async (message: unknown) => {
    if (!isYouTubeContentRequest(message)) return undefined;
    if (message.type === 'GET_YOUTUBE_PAGE') return getCurrentYouTubePage();

    activeExtraction?.abort();
    const controller = new AbortController();
    const handoff = new LargePayloadStore(browserLocalStorage);
    let storedOperationId: string | undefined;
    activeExtraction = controller;
    try {
      const page = getCurrentYouTubePage();
      const result = await startSummaryOperation({
        destination: message.destination,
        summaryLanguage: message.summaryLanguage,
        selectedTrackId: message.selectedTrackId,
        page,
        fetchCaption: (url) => fetchCaptionXml(url, controller.signal),
        save: (prompt, destination) => handoff.save(prompt, destination),
      });
      storedOperationId = result.operationId;
      if (getCurrentYouTubePage().videoId !== page.videoId) {
        await handoff.cancel(result.operationId);
        throw new Error('The video changed while captions were being retrieved');
      }
      const response = await sendBackgroundMessage({
        type: 'REGISTER_OPERATION', operation: result, destination: message.destination,
        videoId: page.videoId, videoTitle: page.title, expiresAt: result.expiresAt,
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

async function fetchCaptionXml(baseUrl: string, signal: AbortSignal): Promise<string> {
  const url = new URL(baseUrl);
  if (url.protocol !== 'https:' || !(url.hostname === 'youtube.com' || url.hostname.endsWith('.youtube.com'))) {
    throw new Error('Invalid captions URL');
  }
  const response = await fetch(url, { credentials: 'include', signal });
  if (!response.ok) throw new Error('Could not retrieve captions');
  return response.text();
}

function errorMessage(cause: unknown): string {
  if (cause instanceof DOMException && cause.name === 'AbortError') return 'Operation cancelled because the video changed';
  return cause instanceof Error ? cause.message : 'Unknown error';
}
