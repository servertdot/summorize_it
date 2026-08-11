import type { AiDestination } from '@src/features/handoff/large-payload';
import { isSummarySource, type SummarySource } from '@src/features/summary-services/summary-service';
import { isAiDestination } from '@src/shared/destinations';

export const OPERATION_STATUSES = [
  'prepared', 'opening', 'waiting-editor', 'inserting', 'verifying', 'sending',
  'success', 'recoverable-error', 'failed', 'cancelled',
] as const;
export type OperationStatus = typeof OPERATION_STATUSES[number];

export interface SummaryOperationState {
  id: string;
  destination: AiDestination;
  source: SummarySource;
  variantId?: string;
  charLength: number;
  estimatedTokens: number;
  createdAt: number;
  expiresAt: number;
  status: OperationStatus;
  statusMessage: string;
  targetTabId?: number;
}

export const TERMINAL_OPERATION_STATUSES = ['success', 'failed', 'cancelled'] as const satisfies readonly OperationStatus[];

export function isTerminalOperation(operation: SummaryOperationState): boolean {
  return TERMINAL_OPERATION_STATUSES.some((status) => status === operation.status);
}

export function isRecoverableOperation(operation: SummaryOperationState): boolean {
  return operation.status === 'prepared' || operation.status === 'recoverable-error';
}

export function isSummaryOperationState(value: unknown): value is SummaryOperationState {
  if (!value || typeof value !== 'object') return false;
  const operation = value as Partial<SummaryOperationState>;
  return typeof operation.id === 'string'
    && isAiDestination(operation.destination)
    && isSummarySource(operation.source)
    && (operation.variantId === undefined || typeof operation.variantId === 'string')
    && typeof operation.charLength === 'number'
    && typeof operation.estimatedTokens === 'number'
    && typeof operation.status === 'string'
    && typeof operation.statusMessage === 'string';
}
