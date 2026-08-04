import browser from 'webextension-polyfill';

import { LargePayloadStore } from '@src/features/handoff/large-payload';
import { isYouTubePage } from '@src/features/youtube-transcript/transcript-operation';
import { sendBackgroundMessage } from '@src/platform/background-messaging';
import { browserLocalStorage } from '@src/platform/browser-storage';
import { AI_DESTINATIONS, DEFAULT_DESTINATIONS, isAiDestination } from '@src/shared/destinations';
import {
  isOperationResponse,
  type OperationResponse,
  type YouTubeContentRequest,
} from '@src/shared/messages';

import type { PopupClient } from './Popup';

export const browserPopupClient: PopupClient = {
  async load() {
    const [activeTab] = await browser.tabs.query({ active: true, currentWindow: true });
    const settings = await browser.storage.local.get(['summaryLanguage', 'selectedDestinations']);
    const browserLanguage = supportedLanguage(browser.i18n.getUILanguage().split('-')[0]);
    const summaryLanguage = typeof settings.summaryLanguage === 'string' ? settings.summaryLanguage : browserLanguage;
    const selectedDestinations = readSelectedDestinations(settings.selectedDestinations);
    if (activeTab?.id && isAiUrl(activeTab.url)) {
      const tabOperation = await sendBackgroundMessage({ type: 'GET_TAB_OPERATION', tabId: activeTab.id });
      if (tabOperation.operation) return { summaryLanguage, selectedDestinations, operation: tabOperation.operation };
    }

    if (activeTab?.id && activeTab.url?.startsWith('https://www.youtube.com/watch')) {
      const page = await getYouTubePage(activeTab.id);
      return { page, summaryLanguage, selectedDestinations };
    }

    const activeOperation = await sendBackgroundMessage({ type: 'GET_ACTIVE_OPERATION' });
    if (activeOperation.operation) return { summaryLanguage, selectedDestinations, operation: activeOperation.operation };
    throw new Error('Open a standard YouTube video');
  },
  async saveSummaryLanguage(summaryLanguage) { await browser.storage.local.set({ summaryLanguage }); },
  async saveDestinations(selectedDestinations) { await browser.storage.local.set({ selectedDestinations }); },
  async prepare(destination, summaryLanguage, selectedTrackId) {
    const [activeTab] = await browser.tabs.query({ active: true, currentWindow: true });
    if (!activeTab?.id) throw new Error('The YouTube tab is unavailable');
    const request = {
      type: 'START_SUMMARY', destination, summaryLanguage, selectedTrackId,
    } satisfies YouTubeContentRequest;
    const response: unknown = await browser.tabs.sendMessage(activeTab.id, request);
    if (!isOperationResponse(response)) throw new Error('Invalid response from the YouTube adapter');
    return requireOperation(response, 'Could not prepare the summary');
  },
  async open(operationId, destination) {
    return requireOperation(await sendBackgroundMessage({ type: 'OPEN_DESTINATION', operationId, destination }), 'Could not open the AI service');
  },
  async refresh(operationId) {
    return (await sendBackgroundMessage({ type: 'GET_OPERATION', operationId })).operation;
  },
  async retry(operationId) {
    return requireOperation(await sendBackgroundMessage({ type: 'RETRY_OPERATION', operationId }), 'Could not retry the operation');
  },
  async cancel(operationId) {
    const response = await sendBackgroundMessage({ type: 'CANCEL_OPERATION', operationId });
    if (!response.ok) throw new Error(response.error || 'Could not cancel the operation');
  },
  async copy(operationId) {
    const prompt = await new LargePayloadStore(browserLocalStorage).read(operationId);
    await copyText(prompt);
  },
};

async function getYouTubePage(tabId: number) {
  const request = { type: 'GET_YOUTUBE_PAGE' } satisfies YouTubeContentRequest;
  const response: unknown = await browser.tabs.sendMessage(tabId, request);
  if (!isYouTubePage(response)) throw new Error('Invalid response from the YouTube adapter');
  return response;
}
function requireOperation(response: OperationResponse, fallback: string) {
  if (!response.ok || !response.operation) throw new Error(response.error || fallback);
  return response.operation;
}
async function copyText(value: string): Promise<void> {
  if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(value);
  const textarea = document.createElement('textarea');
  textarea.value = value;
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand('copy');
  textarea.remove();
}
function supportedLanguage(language: string): string {
  return ['ru', 'en', 'uk', 'de', 'es', 'fr', 'it', 'pt', 'ja', 'ko', 'zh'].includes(language) ? language : 'en';
}
function readSelectedDestinations(value: unknown) {
  if (!Array.isArray(value)) return [...DEFAULT_DESTINATIONS];
  const selected = new Set(value.filter(isAiDestination));
  const destinations = AI_DESTINATIONS.filter((destination) => selected.has(destination));
  return destinations.length > 0 ? destinations : [...DEFAULT_DESTINATIONS];
}
function isAiUrl(url?: string): boolean {
  return Boolean(url && [
    'https://chatgpt.com/', 'https://chat.openai.com/', 'https://www.perplexity.ai/', 'https://perplexity.ai/',
    'https://claude.ai/', 'https://gemini.google.com/', 'https://chat.qwen.ai/', 'https://chat.deepseek.com/',
  ].some((origin) => url.startsWith(origin)));
}
