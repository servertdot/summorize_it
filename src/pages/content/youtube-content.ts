import browser from 'webextension-polyfill';

import { LargePayloadStore } from '@src/features/handoff/large-payload';
import { startSummaryOperation } from '@src/features/summary-operation/start-summary-operation';
import { youtubeSummaryService } from '@src/features/summary-services/youtube-summary-service';
import {
  fetchCaptionTrackXml,
  fetchCaptionTracksFromPlayers,
  isPanelTrackUrl,
  playerTracksToCaptionTracks,
} from '@src/features/youtube-transcript/caption-fetch';
import type { CaptionTrack, YouTubePage } from '@src/features/youtube-transcript/transcript-operation';
import { readYouTubePage, type YouTubeBridgeSnapshot } from '@src/features/youtube-transcript/youtube-page';
import { sendBackgroundMessage } from '@src/platform/background-messaging';
import { browserLocalStorage } from '@src/platform/browser-storage';
import { isSummaryContentRequest, type PromptSizeResponse } from '@src/shared/messages';
import { estimateTokensFromChars } from '@src/shared/operation-policy';

const REQUEST_EVENT = 'summarize-it:request-youtube-page';
const RESPONSE_ATTRIBUTE = 'data-summarize-it-youtube-page';
let activeExtraction: AbortController | undefined;

export function registerYouTubeContent(): void {
  window.addEventListener('yt-navigate-start', () => activeExtraction?.abort());
  browser.runtime.onMessage.addListener((message: unknown) => {
    if (!isSummaryContentRequest(message)) return undefined;
    if (location.hostname !== 'www.youtube.com' || location.pathname !== '/watch') return undefined;
    return handleMessage(message);
  });
}

async function handleMessage(message: import('@src/shared/messages').SummaryContentRequest) {
    if (message.type === 'GET_SUMMARY_PAGE') return getCurrentYouTubePage();
    if (message.type === 'ESTIMATE_PROMPT_SIZE') {
      return estimatePromptSize(message.summaryLanguage, message.selectedTrackId, message.systemPrompt);
    }

    activeExtraction?.abort();
    const controller = new AbortController();
    const handoff = new LargePayloadStore(browserLocalStorage);
    let storedOperationId: string | undefined;
    activeExtraction = controller;
    try {
      const page = await getCurrentYouTubePage();
      const bridge = requestYouTubeSnapshot();
      const result = await startSummaryOperation({
        destination: message.destination,
        prepare: () => youtubeSummaryService.prepare({
          page,
          summaryLanguage: message.summaryLanguage,
          selectedTrackId: message.selectedTrackId,
          systemPrompt: message.systemPrompt,
          fetchCaption: (track) => fetchCaptionXml(page.videoId, track, controller.signal, bridge),
        }),
        save: (prompt, destination) => handoff.save(prompt, destination),
      });
      storedOperationId = result.operationId;
      if (new URL(location.href).searchParams.get('v') !== page.videoId) {
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
}

async function estimatePromptSize(
  summaryLanguage: string,
  selectedTrackId?: string,
  systemPrompt?: string,
): Promise<PromptSizeResponse> {
  activeExtraction?.abort();
  const controller = new AbortController();
  activeExtraction = controller;
  try {
    const page = await getCurrentYouTubePage();
    const bridge = requestYouTubeSnapshot();
    const prepared = await youtubeSummaryService.prepare({
      page,
      summaryLanguage,
      selectedTrackId,
      systemPrompt,
      fetchCaption: (track) => fetchCaptionXml(page.videoId, track, controller.signal, bridge),
    });
    return {
      ok: true,
      charLength: prepared.prompt.length,
      estimatedTokens: estimateTokensFromChars(prepared.prompt.length),
    };
  } catch (cause) {
    if (cause instanceof DOMException && cause.name === 'AbortError') {
      return { ok: false, error: 'aborted' };
    }
    return { ok: false, error: errorMessage(cause) };
  } finally {
    if (activeExtraction === controller) activeExtraction = undefined;
  }
}

async function getCurrentYouTubePage(): Promise<YouTubePage> {
  if (location.pathname !== '/watch' || !new URL(location.href).searchParams.get('v')) {
    throw new Error('Open a standard YouTube video');
  }
  const page = readYouTubePage(document, location.href, requestYouTubeSnapshot());
  if (page.accessError) throw new Error(page.accessError);
  return enrichTracksFromPlayers(page);
}

/** When WEB playerResponse has no tracks, resolve real languages via ANDROID/IOS/TV. */
async function enrichTracksFromPlayers(page: YouTubePage): Promise<YouTubePage> {
  const onlyPanel = page.tracks.length === 1 && isPanelTrackUrl(page.tracks[0].baseUrl);
  if (!onlyPanel && page.tracks.length > 0) return page;

  try {
    const playerTracks = playerTracksToCaptionTracks(await fetchCaptionTracksFromPlayers(page.videoId));
    if (playerTracks.length === 0) return page;
    return { ...page, tracks: playerTracks };
  } catch {
    return page;
  }
}

function requestYouTubeSnapshot(): YouTubeBridgeSnapshot {
  document.documentElement.removeAttribute(RESPONSE_ATTRIBUTE);
  window.dispatchEvent(new CustomEvent(REQUEST_EVENT));
  const serialized = document.documentElement.getAttribute(RESPONSE_ATTRIBUTE);
  document.documentElement.removeAttribute(RESPONSE_ATTRIBUTE);
  if (!serialized) return {};
  try { return JSON.parse(serialized) as YouTubeBridgeSnapshot; } catch { return {}; }
}

function fetchCaptionXml(
  videoId: string,
  track: CaptionTrack,
  signal: AbortSignal,
  bridge: YouTubeBridgeSnapshot,
): Promise<string> {
  return fetchCaptionTrackXml({
    videoId,
    track,
    signal,
    innertubeApiKey: bridge.innertubeApiKey,
    innertubeContext: bridge.innertubeContext,
  });
}

function errorMessage(cause: unknown): string {
  if (cause instanceof DOMException && cause.name === 'AbortError') return 'Operation cancelled because the video changed';
  return cause instanceof Error ? cause.message : 'Unknown error';
}
