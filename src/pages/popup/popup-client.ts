import browser from 'webextension-polyfill';

import { LargePayloadStore, type AiDestination } from '@src/features/handoff/large-payload';
import { createPdfPage, isLikelyPdfUrl, type PdfPage } from '@src/features/summary-services/pdf-page';
import { startSummaryOperation } from '@src/features/summary-operation/start-summary-operation';
import { sendBackgroundMessage } from '@src/platform/background-messaging';
import { browserLocalStorage } from '@src/platform/browser-storage';
import { AI_DESTINATIONS, DEFAULT_DESTINATIONS, isAiDestination } from '@src/shared/destinations';
import {
  isOperationResponse,
  type OperationResponse,
  type SummaryContentRequest,
} from '@src/shared/messages';
import { isSummaryPage, type SummaryPage } from '@src/shared/summary-page';
import type { SummaryOperationState } from '@src/shared/operation-state';

import type { PopupClient } from './Popup';

export const browserPopupClient: PopupClient = {
  async load() {
    const [activeTab] = await browser.tabs.query({ active: true, currentWindow: true });
    const settings = await browser.storage.local.get(['summaryLanguage', 'selectedDestinations', 'systemPrompt']);
    const browserLanguage = supportedLanguage(browser.i18n.getUILanguage().split('-')[0]);
    const summaryLanguage = typeof settings.summaryLanguage === 'string' ? settings.summaryLanguage : browserLanguage;
    const systemPrompt = typeof settings.systemPrompt === 'string' ? settings.systemPrompt : '';
    const selectedDestinations = readSelectedDestinations(settings.selectedDestinations);
    if (activeTab?.id && isAiUrl(activeTab.url)) {
      const tabOperation = await sendBackgroundMessage({ type: 'GET_TAB_OPERATION', tabId: activeTab.id });
      if (tabOperation.operation) return { summaryLanguage, systemPrompt, selectedDestinations, operation: tabOperation.operation };
    }

    if (activeTab?.id && isSummarizableUrl(activeTab.url)) {
      const page = await getSummaryPage(activeTab.id, activeTab.url!, activeTab.title);
      return { page, summaryLanguage, systemPrompt, selectedDestinations };
    }

    const activeOperation = await sendBackgroundMessage({ type: 'GET_ACTIVE_OPERATION' });
    if (activeOperation.operation) return { summaryLanguage, systemPrompt, selectedDestinations, operation: activeOperation.operation };
    throw new Error('Open a YouTube video, web page, or PDF');
  },
  async saveSummaryLanguage(summaryLanguage) { await browser.storage.local.set({ summaryLanguage }); },
  async saveSystemPrompt(systemPrompt) { await browser.storage.local.set({ systemPrompt }); },
  async saveDestinations(selectedDestinations) { await browser.storage.local.set({ selectedDestinations }); },
  async prepare(destination, summaryLanguage, page, selectedTrackId, systemPrompt) {
    const [activeTab] = await browser.tabs.query({ active: true, currentWindow: true });
    if (!activeTab?.id) throw new Error('The source tab is unavailable');
    if ('type' in page && page.type === 'pdf') {
      return preparePdfSummary(destination, summaryLanguage, page, systemPrompt);
    }
    const request = {
      type: 'START_SUMMARY', destination, summaryLanguage, selectedTrackId, systemPrompt,
    } satisfies SummaryContentRequest;
    const response: unknown = await browser.tabs.sendMessage(activeTab.id, request);
    if (!isOperationResponse(response)) throw new Error('Invalid response from the page adapter');
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

async function getSummaryPage(tabId: number, url: string, title?: string): Promise<SummaryPage> {
  if (isLikelyPdfUrl(url)) return createPdfPage(url, title);
  try {
    const request = { type: 'GET_SUMMARY_PAGE' } satisfies SummaryContentRequest;
    const response: unknown = await browser.tabs.sendMessage(tabId, request);
    if (isSummaryPage(response)) return response;
  } catch {
    // PDF viewers do not expose a normal content-script document.
  }
  const response = await sendBackgroundMessage({ type: 'GET_PDF_PAGE', url, title });
  if (response.ok && 'page' in response && isSummaryPage(response.page)) return response.page;
  throw new Error('Could not read this page');
}

async function preparePdfSummary(
  destination: AiDestination,
  summaryLanguage: string,
  page: PdfPage,
  systemPrompt?: string,
): Promise<SummaryOperationState> {
  const handoff = new LargePayloadStore(browserLocalStorage);
  let storedOperationId: string | undefined;
  try {
    const response = await fetch(page.url, { credentials: 'include' });
    if (!response.ok) throw new Error(`Could not download the PDF (${response.status})`);
    const contentType = response.headers.get('content-type')?.toLocaleLowerCase();
    if (contentType && !contentType.includes('application/pdf') && !isLikelyPdfUrl(page.url)) {
      throw new Error('The active page is not a PDF');
    }

    const data = await response.arrayBuffer();
    const { pdfSummaryService } = await import('@src/features/summary-services/pdf-summary-service');
    const result = await startSummaryOperation({
      destination,
      prepare: () => pdfSummaryService.prepare({ data, url: page.url, title: page.title, summaryLanguage, systemPrompt }),
      save: (prompt, target) => handoff.save(prompt, target),
    });
    storedOperationId = result.operationId;
    const registered = await sendBackgroundMessage({ type: 'REGISTER_OPERATION', operation: result });
    const operation = requireOperation(registered, 'Could not prepare the PDF summary');
    storedOperationId = undefined;
    return operation;
  } catch (cause) {
    if (storedOperationId) await handoff.cancel(storedOperationId);
    throw cause;
  }
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
function isSummarizableUrl(url?: string): boolean {
  return Boolean(url && /^(https?|file):/i.test(url) && !isAiUrl(url));
}
