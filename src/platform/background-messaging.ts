import browser from 'webextension-polyfill';

import {
  isOperationResponse,
  type BackgroundRequest,
  type OperationResponse,
} from '@src/shared/messages';

export async function sendBackgroundMessage(message: BackgroundRequest): Promise<OperationResponse> {
  const response: unknown = await browser.runtime.sendMessage(message);
  if (!isOperationResponse(response)) throw new Error('Invalid background process response');
  return response;
}
