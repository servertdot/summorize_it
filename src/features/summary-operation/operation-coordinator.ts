import type { AiDestination } from '@src/features/handoff/large-payload';
import {
  isTerminalOperation,
  type SummaryOperationState,
} from '@src/shared/operation-state';

const DUPLICATE_BLOCKING_STATUS = 'prepared';

export function findDuplicateOperation(
  operations: Iterable<SummaryOperationState>,
  videoId: string,
  destination: AiDestination,
): SummaryOperationState | undefined {
  return Array.from(operations).find((operation) =>
    operation.videoId === videoId
    && operation.destination === destination
    && operation.status === DUPLICATE_BLOCKING_STATUS,
  );
}

export function canClaimOperation(operation: SummaryOperationState): boolean {
  return operation.status === 'opening' || operation.status === 'waiting-editor';
}

export function canClaimOperationInTab(operation: SummaryOperationState, tabId: number): boolean {
  return operation.targetTabId === tabId && canClaimOperation(operation);
}

export function canCancelOperation(operation: SummaryOperationState): boolean {
  return !['sending', 'success', 'failed', 'cancelled'].includes(operation.status);
}

export function remainingTtlMinutes(expiresAt: number, now = Date.now()): number {
  return Math.max((expiresAt - now) / 60_000, 1 / 60);
}

export function markTargetClosed(operation: SummaryOperationState): SummaryOperationState {
  if (isTerminalOperation(operation)) return operation;
  return {
    ...operation,
    status: 'recoverable-error',
    statusMessage: 'Вкладка ИИ была закрыта. Можно повторить или скопировать запрос.',
    targetTabId: undefined,
  };
}
