import browser from 'webextension-polyfill';

import { LargePayloadStore } from '@src/features/handoff/large-payload';
import { isYouTubePage } from '@src/features/youtube-transcript/transcript-operation';
import { sendBackgroundMessage } from '@src/platform/background-messaging';
import { browserLocalStorage } from '@src/platform/browser-storage';
import {
  isOperationResponse,
  type OperationResponse,
  type YouTubeContentRequest,
} from '@src/shared/messages';

import type { PopupClient } from './Popup';

export const browserPopupClient: PopupClient = {
  async load() {
    const [activeTab] = await browser.tabs.query({ active: true, currentWindow: true });
    const settings = await browser.storage.local.get('summaryLanguage');
    const browserLanguage = supportedLanguage(browser.i18n.getUILanguage().split('-')[0]);
    const summaryLanguage = typeof settings.summaryLanguage === 'string' ? settings.summaryLanguage : browserLanguage;
    if (activeTab?.id && isAiUrl(activeTab.url)) {
      const tabOperation = await sendBackgroundMessage({ type: 'GET_TAB_OPERATION', tabId: activeTab.id });
      if (tabOperation.operation) return { summaryLanguage, operation: tabOperation.operation };
    }

    if (activeTab?.id && activeTab.url?.startsWith('https://www.youtube.com/watch')) {
      const page = await getYouTubePage(activeTab.id);
      return { page, summaryLanguage };
    }

    const activeOperation = await sendBackgroundMessage({ type: 'GET_ACTIVE_OPERATION' });
    if (activeOperation.operation) return { summaryLanguage, operation: activeOperation.operation };
    throw new Error('Откройте обычное YouTube-видео');
  },
  async saveSummaryLanguage(summaryLanguage) { await browser.storage.local.set({ summaryLanguage }); },
  async prepare(destination, summaryLanguage, selectedTrackId) {
    const [activeTab] = await browser.tabs.query({ active: true, currentWindow: true });
    if (!activeTab?.id) throw new Error('Вкладка YouTube недоступна');
    const request = {
      type: 'START_SUMMARY', destination, summaryLanguage, selectedTrackId,
    } satisfies YouTubeContentRequest;
    const response: unknown = await browser.tabs.sendMessage(activeTab.id, request);
    if (!isOperationResponse(response)) throw new Error('Некорректный ответ YouTube-адаптера');
    return requireOperation(response, 'Не удалось подготовить суммаризацию');
  },
  async open(operationId, destination) {
    return requireOperation(await sendBackgroundMessage({ type: 'OPEN_DESTINATION', operationId, destination }), 'Не удалось открыть ИИ-сервис');
  },
  async refresh(operationId) {
    return (await sendBackgroundMessage({ type: 'GET_OPERATION', operationId })).operation;
  },
  async retry(operationId) {
    return requireOperation(await sendBackgroundMessage({ type: 'RETRY_OPERATION', operationId }), 'Не удалось повторить операцию');
  },
  async cancel(operationId) {
    const response = await sendBackgroundMessage({ type: 'CANCEL_OPERATION', operationId });
    if (!response.ok) throw new Error(response.error || 'Не удалось отменить операцию');
  },
  async copy(operationId) {
    const prompt = await new LargePayloadStore(browserLocalStorage).read(operationId);
    await copyText(prompt);
  },
};

async function getYouTubePage(tabId: number) {
  const request = { type: 'GET_YOUTUBE_PAGE' } satisfies YouTubeContentRequest;
  const response: unknown = await browser.tabs.sendMessage(tabId, request);
  if (!isYouTubePage(response)) throw new Error('Некорректный ответ YouTube-адаптера');
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
function isAiUrl(url?: string): boolean {
  return Boolean(url && [
    'https://chatgpt.com/', 'https://chat.openai.com/', 'https://www.perplexity.ai/', 'https://perplexity.ai/',
  ].some((origin) => url.startsWith(origin)));
}
