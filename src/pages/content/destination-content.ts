import {
  detectDestinationRejection,
  createDeliveryMarker,
  isDeliveryConfirmed,
  preparePromptForDelivery,
} from '@src/features/ai-destination/ai-destination';
import { LargePayloadStore, type AiDestination } from '@src/features/handoff/large-payload';
import { sendBackgroundMessage } from '@src/platform/background-messaging';
import { browserLocalStorage } from '@src/platform/browser-storage';
import type { OperationResponse } from '@src/shared/messages';
import { OPERATION_TTL_MS } from '@src/shared/operation-policy';

export async function runDestinationDelivery(destination: AiDestination): Promise<void> {
  const claimed = await claimOperation(destination);
  if (!claimed?.operation) return;
  const operation = claimed.operation;
  const handoff = new LargePayloadStore(browserLocalStorage);
  let prompt: string;
  try {
    prompt = await handoff.read(operation.id);
  } catch (cause) {
    await update(operation.id, 'failed', errorMessage(cause));
    return;
  }

  const deadline = Math.min(operation.expiresAt, Date.now() + OPERATION_TTL_MS);
  await update(operation.id, 'waiting-editor', 'Waiting for the editor or sign-in…');
  while (Date.now() < deadline) {
    if (await isCancelled(operation.id)) return;
    const rejection = detectDestinationRejection(document);
    if (rejection) {
      await update(operation.id, 'recoverable-error', `${rejection}. The prompt was saved so you can retry or copy it.`);
      return;
    }

    await update(operation.id, 'inserting', 'Inserting the complete prompt…');
    const result = await preparePromptForDelivery(document, prompt, destination);
    if (result.status === 'editor-not-found') {
      await update(operation.id, 'waiting-editor', 'Waiting for the editor or sign-in…');
      await delay(1_000);
      continue;
    }
    if (result.status === 'incomplete-insertion') {
      await update(operation.id, 'recoverable-error', 'The complete prompt did not fit in the field. Sending was stopped and the prompt was saved.');
      return;
    }
    if (result.status === 'send-unavailable') {
      await update(operation.id, 'recoverable-error', 'The complete prompt was inserted, but sending is unavailable. You can send it manually or retry.');
      return;
    }

    await update(operation.id, 'verifying', 'Complete prompt verified. Sending…');
    const authorization = await update(operation.id, 'sending', 'Prompt is being sent. Confirming submission…');
    if (!authorization.ok) return;
    const marker = createDeliveryMarker(document, destination);
    result.send();
    const confirmation = await waitForDeliveryConfirmation(operation.id, destination, marker);
    if (confirmation === 'confirmed') {
      await sendBackgroundMessage({ type: 'COMPLETE_OPERATION', operationId: operation.id });
    } else if (confirmation === 'rejected') {
      await update(operation.id, 'recoverable-error', 'The service rejected the prompt because it is too long. The complete prompt was saved.');
    } else if (confirmation === 'timeout') {
      await update(operation.id, 'recoverable-error', 'The service did not confirm submission. The complete prompt was saved.');
    }
    return;
  }
  await update(operation.id, 'recoverable-error', 'Sign-in timed out. The complete prompt was saved.');
}

async function waitForDeliveryConfirmation(
  operationId: string,
  destination: AiDestination,
  marker: import('@src/features/ai-destination/ai-destination').DeliveryMarker,
): Promise<'confirmed' | 'rejected' | 'cancelled' | 'timeout'> {
  let firstConfirmationAttempt: number | undefined;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (detectDestinationRejection(document)) return 'rejected';
    if (isDeliveryConfirmed(document, destination, marker) && firstConfirmationAttempt === undefined) {
      firstConfirmationAttempt = attempt;
    }
    if (firstConfirmationAttempt !== undefined && attempt - firstConfirmationAttempt >= 12) return 'confirmed';
    if (await isCancelled(operationId)) return 'cancelled';
    await delay(250);
  }
  return 'timeout';
}

async function claimOperation(destination: AiDestination): Promise<OperationResponse | undefined> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const response = await sendBackgroundMessage({ type: 'CLAIM_OPERATION', destination });
    if (response.ok && response.operation) return response;
    await delay(250);
  }
  return undefined;
}

async function isCancelled(operationId: string): Promise<boolean> {
  const response = await sendBackgroundMessage({ type: 'GET_OPERATION', operationId });
  return response.operation?.status === 'cancelled' || response.operation?.status === 'failed';
}

async function update(
  operationId: string,
  status: 'waiting-editor' | 'inserting' | 'verifying' | 'sending' | 'recoverable-error' | 'failed',
  statusMessage: string,
): Promise<OperationResponse> {
  return sendBackgroundMessage({ type: 'UPDATE_OPERATION', operationId, status, statusMessage });
}

function errorMessage(cause: unknown): string { return cause instanceof Error ? cause.message : 'Unknown error'; }
function delay(milliseconds: number): Promise<void> { return new Promise((resolve) => window.setTimeout(resolve, milliseconds)); }
