import browser, { type Runtime } from 'webextension-polyfill';

import { LargePayloadStore, type AiDestination } from '@src/features/handoff/large-payload';
import {
  canClaimOperationInTab,
  canCancelOperation,
  findDuplicateOperation,
  markTargetClosed,
  remainingTtlMinutes,
} from '@src/features/summary-operation/operation-coordinator';
import { browserLocalStorage } from '@src/platform/browser-storage';
import { DESTINATION_NAMES } from '@src/shared/destinations';
import { isBackgroundRequest, type BackgroundRequest, type OperationResponse } from '@src/shared/messages';
import {
  isRecoverableOperation,
  isTerminalOperation,
  isSummaryOperationState,
  type SummaryOperationState,
} from '@src/shared/operation-state';

const DESTINATION_URL: Record<AiDestination, string> = {
  chatgpt: 'https://chatgpt.com/',
  perplexity: 'https://www.perplexity.ai/',
};
const OPERATIONS_KEY = 'summary:operation-registry';
let registryQueue = Promise.resolve();

browser.runtime.onMessage.addListener(async (message: unknown, sender: Runtime.MessageSender) => {
  if (!isBackgroundRequest(message)) return undefined;

  switch (message.type) {
    case 'REGISTER_OPERATION':
      return registerOperation(message);
    case 'OPEN_DESTINATION':
      return openDestination(message.operationId, message.destination);
    case 'RETRY_OPERATION': {
      const operation = await getOperation(message.operationId);
      return operation ? openDestination(operation.id, operation.destination) : failure('Операция не найдена');
    }
    case 'CLAIM_OPERATION':
      return claimOperation(sender.tab?.id, message.destination);
    case 'UPDATE_OPERATION':
      return updateOperation(message.operationId, {
        status: message.status,
        statusMessage: message.statusMessage,
      });
    case 'COMPLETE_OPERATION':
      await new LargePayloadStore(browserLocalStorage).complete(message.operationId);
      await browser.alarms.clear(expiryAlarm(message.operationId));
      return updateOperation(message.operationId, { status: 'success', statusMessage: 'Запрос отправлен', targetTabId: undefined });
    case 'CANCEL_OPERATION':
      return cancelOperation(message.operationId);
    case 'GET_ACTIVE_OPERATION':
      return { ok: true, operation: await getActiveOperation() } satisfies OperationResponse;
    case 'GET_TAB_OPERATION':
      return { ok: true, operation: await getTabOperation(message.tabId) } satisfies OperationResponse;
    case 'GET_OPERATION':
      return { ok: true, operation: await getOperation(message.operationId) } satisfies OperationResponse;
  }
});

browser.tabs.onRemoved.addListener((tabId) => {
  void handleTargetTabClosed(tabId);
});

browser.alarms.onAlarm.addListener((alarm) => {
  if (!alarm.name.startsWith('summary:expire:')) return;
  const operationId = alarm.name.slice('summary:expire:'.length);
  void expireOperation(operationId);
});

async function registerOperation(
  message: Extract<BackgroundRequest, { type: 'REGISTER_OPERATION' }>,
): Promise<OperationResponse> {
  const response = await withRegistry<OperationResponse>(async (registry) => {
    const duplicate = findDuplicateOperation(Object.values(registry), message.videoId, message.destination);
    if (duplicate) {
      await new LargePayloadStore(browserLocalStorage).cancel(message.operation.operationId);
      return { registry, result: { ok: false, duplicate: true, operation: duplicate, error: 'Такая операция уже выполняется' } };
    }

    const operation: SummaryOperationState = {
      id: message.operation.operationId,
      destination: message.destination,
      videoId: message.videoId,
      videoTitle: message.videoTitle,
      trackId: message.operation.trackId,
      charLength: message.operation.charLength,
      estimatedTokens: message.operation.estimatedTokens,
      createdAt: Date.now(),
      expiresAt: message.expiresAt,
      status: 'prepared',
      statusMessage: 'Расшифровка подготовлена',
    };
    return { registry: { ...registry, [operation.id]: operation }, result: { ok: true, operation } };
  });
  if (response.ok && response.operation) {
    await browser.alarms.create(expiryAlarm(response.operation.id), {
      delayInMinutes: remainingTtlMinutes(response.operation.expiresAt),
    });
  }
  return response;
}

async function openDestination(operationId: string, destination: AiDestination): Promise<OperationResponse> {
  const operation = await getOperation(operationId);
  if (!operation || operation.destination !== destination) return failure('Операция не найдена');
  if (!isRecoverableOperation(operation)) {
    return failure('Операция уже запущена');
  }
  try {
    if (operation.targetTabId !== undefined) await browser.storage.session.remove(targetKey(operation.targetTabId));
    const tab = await browser.tabs.create({ url: DESTINATION_URL[destination], active: true });
    if (tab.id === undefined) throw new Error('Целевая вкладка не создана');
    await browser.storage.session.set({ [targetKey(tab.id)]: { operationId, destination } });
    return updateOperation(operationId, {
      status: 'opening', statusMessage: `Открываем ${DESTINATION_NAMES[destination]}…`, targetTabId: tab.id,
    });
  } catch (cause) {
    return updateOperation(operationId, {
      status: 'recoverable-error', statusMessage: errorMessage(cause), targetTabId: undefined,
    });
  }
}

async function claimOperation(tabId: number | undefined, destination: AiDestination): Promise<OperationResponse> {
  if (tabId === undefined) return failure('Целевая вкладка недоступна');
  const stored = await browser.storage.session.get(targetKey(tabId));
  const target = stored[targetKey(tabId)];
  if (!isTarget(target) || target.destination !== destination) return failure('Операция не назначена этой вкладке');
  const operation = await getOperation(target.operationId);
  if (!operation) return failure('Операция не найдена');
  if (!canClaimOperationInTab(operation, tabId)) return failure('Операция уже была выдана другой вкладке');
  return updateOperation(operation.id, { status: 'waiting-editor', statusMessage: 'Ожидаем редактор или вход в аккаунт…' });
}

async function handleTargetTabClosed(tabId: number): Promise<void> {
  const key = targetKey(tabId);
  const stored = await browser.storage.session.get(key);
  await browser.storage.session.remove(key);
  const target = stored[key];
  if (!isTarget(target)) return;
  const operation = await getOperation(target.operationId);
  if (operation && operation.targetTabId === tabId && !isTerminalOperation(operation)) {
    await updateOperation(operation.id, markTargetClosed(operation));
  }
}

async function expireOperation(operationId: string): Promise<void> {
  await new LargePayloadStore(browserLocalStorage).complete(operationId);
  await updateOperation(operationId, { status: 'failed', statusMessage: 'Время операции истекло', targetTabId: undefined });
}

async function getActiveOperation(): Promise<SummaryOperationState | undefined> {
  const operations = Object.values(await readRegistry())
    .filter((operation) => !isTerminalOperation(operation))
    .sort((left, right) => right.createdAt - left.createdAt);
  return operations[0];
}

async function getTabOperation(tabId: number): Promise<SummaryOperationState | undefined> {
  const stored = await browser.storage.session.get(targetKey(tabId));
  const target = stored[targetKey(tabId)];
  return isTarget(target) ? getOperation(target.operationId) : undefined;
}

async function getOperation(operationId: string): Promise<SummaryOperationState | undefined> {
  return (await readRegistry())[operationId];
}

async function updateOperation(operationId: string, changes: Partial<SummaryOperationState>): Promise<OperationResponse> {
  return withRegistry(async (registry) => {
    const operation = registry[operationId];
    if (!operation) return { registry, result: failure('Операция не найдена') };
    if (isTerminalOperation(operation)) return { registry, result: failure('Операция уже завершена') };
    const updated = { ...operation, ...changes };
    return { registry: { ...registry, [operationId]: updated }, result: { ok: true, operation: updated } };
  });
}

async function cancelOperation(operationId: string): Promise<OperationResponse> {
  const response = await withRegistry<OperationResponse>(async (registry) => {
    const operation = registry[operationId];
    if (!operation) return { registry, result: failure('Операция не найдена') };
    if (!canCancelOperation(operation)) return { registry, result: failure('Запрос уже отправляется или операция завершена') };
    const cancelled: SummaryOperationState = {
      ...operation, status: 'cancelled', statusMessage: 'Операция отменена', targetTabId: undefined,
    };
    return { registry: { ...registry, [operationId]: cancelled }, result: { ok: true, operation: cancelled } };
  });
  if (!response.ok || !response.operation) return response;
  await new LargePayloadStore(browserLocalStorage).cancel(operationId);
  await browser.alarms.clear(expiryAlarm(operationId));
  return response;
}

async function readRegistry(): Promise<Record<string, SummaryOperationState>> {
  const stored = await browser.storage.session.get(OPERATIONS_KEY);
  const value = stored[OPERATIONS_KEY];
  if (!value || typeof value !== 'object') return {};
  return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, SummaryOperationState] => isSummaryOperationState(entry[1])));
}

async function withRegistry<T>(
  update: (registry: Record<string, SummaryOperationState>) => Promise<{ registry: Record<string, SummaryOperationState>; result: T }>,
): Promise<T> {
  const previous = registryQueue;
  let release!: () => void;
  registryQueue = new Promise<void>((resolve) => { release = resolve; });
  await previous;
  try {
    const { registry, result } = await update(await readRegistry());
    await browser.storage.session.set({ [OPERATIONS_KEY]: registry });
    return result;
  } finally {
    release();
  }
}

function targetKey(tabId: number): string { return `summary:target:${tabId}`; }
function expiryAlarm(operationId: string): string { return `summary:expire:${operationId}`; }
function failure(error: string): OperationResponse { return { ok: false, error }; }
function errorMessage(cause: unknown): string { return cause instanceof Error ? cause.message : 'Не удалось открыть вкладку'; }
function isTarget(value: unknown): value is { operationId: string; destination: AiDestination } {
  if (!value || typeof value !== 'object') return false;
  const target = value as { operationId?: unknown; destination?: unknown };
  return typeof target.operationId === 'string' && (target.destination === 'chatgpt' || target.destination === 'perplexity');
}
