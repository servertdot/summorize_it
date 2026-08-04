import { describe, expect, it } from 'vitest';

import type { SummaryOperationState } from '@src/shared/operation-state';

import {
  canCancelOperation,
  canClaimOperation,
  canClaimOperationInTab,
  findDuplicateOperation,
  markTargetClosed,
  remainingTtlMinutes,
} from './operation-coordinator';

function operation(overrides: Partial<SummaryOperationState> = {}): SummaryOperationState {
  return {
    id: 'one', destination: 'chatgpt', videoId: 'video', videoTitle: 'Video', trackId: 'en',
    charLength: 100, estimatedTokens: 25, createdAt: 1, expiresAt: 2,
    status: 'opening', statusMessage: 'Opening', targetTabId: 10, ...overrides,
  };
}

describe('operation coordinator', () => {
  it('deduplicates only a prepared operation for the same video and destination', () => {
    const prepared = operation({ status: 'prepared' });
    expect(findDuplicateOperation([prepared], 'video', 'chatgpt')).toBe(prepared);
    expect(findDuplicateOperation([prepared], 'video', 'perplexity')).toBeUndefined();
    expect(findDuplicateOperation([operation({ status: 'success' })], 'video', 'chatgpt')).toBeUndefined();
  });

  it('allows another summary after the destination tab has opened', () => {
    expect(findDuplicateOperation([operation({ status: 'prepared' })], 'video', 'chatgpt')).toBeDefined();

    for (const status of ['opening', 'waiting-editor', 'inserting', 'verifying', 'sending', 'recoverable-error'] as const) {
      expect(findDuplicateOperation([operation({ status })], 'video', 'chatgpt')).toBeUndefined();
    }
  });

  it('does not issue an operation again after sending has started', () => {
    expect(canClaimOperation(operation({ status: 'waiting-editor' }))).toBe(true);
    expect(canClaimOperation(operation({ status: 'sending' }))).toBe(false);
    expect(canClaimOperation(operation({ status: 'success' }))).toBe(false);
  });

  it('authorizes only the currently assigned destination tab after retry', () => {
    const retried = operation({ targetTabId: 20, status: 'opening' });
    expect(canClaimOperationInTab(retried, 10)).toBe(false);
    expect(canClaimOperationInTab(retried, 20)).toBe(true);
  });

  it('turns a closed target tab into a recoverable operation without losing it', () => {
    expect(markTargetClosed(operation())).toMatchObject({
      status: 'recoverable-error', targetTabId: undefined,
    });
  });

  it('makes cancellation and send authorization mutually exclusive', () => {
    expect(canCancelOperation(operation({ status: 'verifying' }))).toBe(true);
    expect(canCancelOperation(operation({ status: 'sending' }))).toBe(false);
    expect(canCancelOperation(operation({ status: 'cancelled' }))).toBe(false);
  });

  it('schedules expiry from the preparation deadline', () => {
    expect(remainingTtlMinutes(1_801_000, 1_000)).toBe(30);
  });
});
