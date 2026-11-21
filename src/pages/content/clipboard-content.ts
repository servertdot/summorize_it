import { LargePayloadStore } from '@src/features/handoff/large-payload';
import { sendBackgroundMessage } from '@src/platform/background-messaging';
import { browserLocalStorage } from '@src/platform/browser-storage';
import type { ClipboardContentResponse } from '@src/shared/messages';

export async function storeClipboardContent(content: string): Promise<ClipboardContentResponse> {
  const store = new LargePayloadStore(browserLocalStorage);
  const payload = await store.save(content);
  try {
    const response = await sendBackgroundMessage({
      type: 'SCHEDULE_CLIPBOARD_EXPIRY', payloadId: payload.id, expiresAt: payload.expiresAt,
    });
    if (!response.ok) throw new Error(response.error || 'Could not prepare content for copying');
    return { ok: true, payloadId: payload.id };
  } catch (cause) {
    await store.complete(payload.id);
    throw cause;
  }
}
