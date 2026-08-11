import browser from 'webextension-polyfill';

import {
  isOperationResponse,
  isPdfPageResponse,
  type BackgroundRequest,
  type OperationResponse,
  type PdfPageResponse,
} from '@src/shared/messages';

export function sendBackgroundMessage(message: Extract<BackgroundRequest, { type: 'GET_PDF_PAGE' }>): Promise<PdfPageResponse>;
export function sendBackgroundMessage(message: Exclude<BackgroundRequest, { type: 'GET_PDF_PAGE' }>): Promise<OperationResponse>;
export async function sendBackgroundMessage(message: BackgroundRequest): Promise<OperationResponse | PdfPageResponse> {
  const response: unknown = await browser.runtime.sendMessage(message);
  if (message.type === 'GET_PDF_PAGE') {
    if (!isPdfPageResponse(response)) throw new Error('Invalid background process response');
    return response;
  }
  if (!isOperationResponse(response)) throw new Error('Invalid background process response');
  return response;
}
