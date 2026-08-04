import type { AiDestination } from '@src/features/handoff/large-payload';
import type { StartedSummaryOperation } from '@src/features/summary-operation/start-summary-operation';
import { isAiDestination } from '@src/shared/destinations';
import {
  OPERATION_STATUSES,
  isSummaryOperationState,
  type OperationStatus,
  type SummaryOperationState,
} from '@src/shared/operation-state';

export type YouTubeContentRequest =
  | { type: 'GET_YOUTUBE_PAGE' }
  | { type: 'START_SUMMARY'; destination: AiDestination; summaryLanguage: string; selectedTrackId?: string };

export type BackgroundRequest =
  | { type: 'REGISTER_OPERATION'; operation: StartedSummaryOperation; destination: AiDestination; videoId: string; videoTitle: string; expiresAt: number }
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

export function isOperationResponse(value: unknown): value is OperationResponse {
  if (!isRecord(value) || typeof value.ok !== 'boolean') return false;
  return (value.operation === undefined || isSummaryOperationState(value.operation))
    && (value.error === undefined || typeof value.error === 'string')
    && (value.duplicate === undefined || typeof value.duplicate === 'boolean');
}

export function isYouTubeContentRequest(value: unknown): value is YouTubeContentRequest {
  if (!isRecord(value) || typeof value.type !== 'string') return false;
  if (value.type === 'GET_YOUTUBE_PAGE') return true;
  return value.type === 'START_SUMMARY'
    && isAiDestination(value.destination)
    && typeof value.summaryLanguage === 'string'
    && (value.selectedTrackId === undefined || typeof value.selectedTrackId === 'string');
}

export function isBackgroundRequest(value: unknown): value is BackgroundRequest {
  if (!isRecord(value) || typeof value.type !== 'string') return false;
  switch (value.type) {
    case 'GET_ACTIVE_OPERATION':
      return true;
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
      return isAiDestination(value.destination)
        && typeof value.videoId === 'string'
        && typeof value.videoTitle === 'string'
        && typeof value.expiresAt === 'number'
        && isRecord(value.operation)
        && typeof value.operation.operationId === 'string';
    default: return false;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object';
}
