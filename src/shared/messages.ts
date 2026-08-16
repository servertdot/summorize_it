import type { AiDestination } from '@src/features/handoff/large-payload';
import type { StartedSummaryOperation } from '@src/features/summary-operation/start-summary-operation';
import type { PdfPage } from '@src/features/summary-services/pdf-page';
import { isSummarySource } from '@src/features/summary-services/summary-service';
import { isAiDestination } from '@src/shared/destinations';
import {
  OPERATION_STATUSES,
  isSummaryOperationState,
  type OperationStatus,
  type SummaryOperationState,
} from '@src/shared/operation-state';

export type SummaryContentRequest =
  | { type: 'GET_SUMMARY_PAGE' }
  | { type: 'START_SUMMARY'; destination: AiDestination; summaryLanguage: string; selectedTrackId?: string; systemPrompt?: string };

export type BackgroundRequest =
  | { type: 'REGISTER_OPERATION'; operation: StartedSummaryOperation }
  | { type: 'GET_PDF_PAGE'; url: string; title?: string }
  | { type: 'OPEN_DESTINATION'; destination: AiDestination; operationId: string }
  | { type: 'CLAIM_OPERATION'; destination: AiDestination }
  | { type: 'UPDATE_OPERATION'; operationId: string; status: OperationStatus; statusMessage: string }
  | { type: 'COMPLETE_OPERATION'; operationId: string }
  | { type: 'CANCEL_OPERATION'; operationId: string }
  | { type: 'GET_ACTIVE_OPERATION' }
  | { type: 'GET_TAB_OPERATION'; tabId: number }
  | { type: 'GET_OPERATION'; operationId: string }
  | { type: 'RETRY_OPERATION'; operationId: string };

export interface OperationResponse {
  ok: boolean;
  operation?: SummaryOperationState;
  error?: string;
  duplicate?: boolean;
}

export interface PdfPageResponse {
  ok: boolean;
  page?: PdfPage;
  error?: string;
}

export function isPdfPageResponse(value: unknown): value is PdfPageResponse {
  if (!isRecord(value) || typeof value.ok !== 'boolean') return false;
  return (value.page === undefined || (isRecord(value.page)
    && value.page.type === 'pdf'
    && typeof value.page.id === 'string'
    && typeof value.page.title === 'string'
    && typeof value.page.url === 'string'))
    && (value.error === undefined || typeof value.error === 'string');
}

export function isOperationResponse(value: unknown): value is OperationResponse {
  if (!isRecord(value) || typeof value.ok !== 'boolean') return false;
  return (value.operation === undefined || isSummaryOperationState(value.operation))
    && (value.error === undefined || typeof value.error === 'string')
    && (value.duplicate === undefined || typeof value.duplicate === 'boolean');
}

export function isSummaryContentRequest(value: unknown): value is SummaryContentRequest {
  if (!isRecord(value) || typeof value.type !== 'string') return false;
  if (value.type === 'GET_SUMMARY_PAGE') return true;
  return value.type === 'START_SUMMARY'
    && isAiDestination(value.destination)
    && typeof value.summaryLanguage === 'string'
    && (value.selectedTrackId === undefined || typeof value.selectedTrackId === 'string')
    && (value.systemPrompt === undefined || typeof value.systemPrompt === 'string');
}

export function isBackgroundRequest(value: unknown): value is BackgroundRequest {
  if (!isRecord(value) || typeof value.type !== 'string') return false;
  switch (value.type) {
    case 'GET_ACTIVE_OPERATION':
      return true;
    case 'GET_PDF_PAGE':
      return typeof value.url === 'string' && (value.title === undefined || typeof value.title === 'string');
    case 'GET_TAB_OPERATION': return typeof value.tabId === 'number';
    case 'CLAIM_OPERATION': return isAiDestination(value.destination);
    case 'GET_OPERATION':
    case 'CANCEL_OPERATION':
    case 'RETRY_OPERATION': return typeof value.operationId === 'string';
    case 'OPEN_DESTINATION': return typeof value.operationId === 'string' && isAiDestination(value.destination);
    case 'COMPLETE_OPERATION': return typeof value.operationId === 'string';
    case 'UPDATE_OPERATION':
      return typeof value.operationId === 'string'
        && typeof value.status === 'string'
        && OPERATION_STATUSES.includes(value.status as OperationStatus)
        && typeof value.statusMessage === 'string';
    case 'REGISTER_OPERATION':
      return isRecord(value.operation)
        && typeof value.operation.operationId === 'string'
        && isAiDestination(value.operation.destination)
        && isSummarySource(value.operation.source);
    default: return false;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object';
}
