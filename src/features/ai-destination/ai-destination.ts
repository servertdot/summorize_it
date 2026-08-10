import type { AiDestination } from '@src/features/handoff/large-payload';

type DeliveryResult =
  | { status: 'sent' }
  | { status: 'editor-not-found' }
  | { status: 'incomplete-insertion' }
  | { status: 'send-unavailable' };

export type PreparedDelivery =
  | { status: 'ready'; send: () => void }
  | Exclude<DeliveryResult, { status: 'sent' }>;

const SELECTORS: Record<AiDestination, { editors: string[]; sendButtons: string[] }> = {
  chatgpt: {
    editors: ['#prompt-textarea', 'div[contenteditable="true"][data-virtualkeyboard="true"]'],
    sendButtons: ['[data-testid="send-button"]', '#composer-submit-button', 'button[aria-label*="Send"]'],
  },
  perplexity: {
    editors: ['#ask-input', 'textarea[placeholder]', 'div[contenteditable="true"]'],
    sendButtons: ['[data-testid="submit-button"]', 'button[aria-label="Submit"]', 'button[aria-label*="Send"]'],
  },
  claude: {
    editors: ['[data-testid="chat-input"]', '.ProseMirror[contenteditable="true"]', 'div[contenteditable="true"][role="textbox"]'],
    sendButtons: ['[data-testid="send-button"]', 'button[aria-label*="Send"]', 'button[aria-label*="send"]'],
  },
  gemini: {
    editors: ['rich-textarea .ql-editor[contenteditable="true"]', '.ql-editor[contenteditable="true"]', 'div[contenteditable="true"][role="textbox"]'],
    sendButtons: ['button[aria-label*="Send message"]', 'button.send-button', 'button[aria-label*="Send"]'],
  },
  qwen: {
    editors: ['textarea.message-input-textarea', 'textarea[placeholder]', 'div[contenteditable="true"][role="textbox"]'],
    sendButtons: ['button.send-button', 'button[aria-label="Send"]', 'button[aria-label*="Send"]'],
  },
  deepseek: {
    editors: ['textarea[placeholder]', 'div[contenteditable="true"][role="textbox"]', 'div[contenteditable="true"]'],
    sendButtons: ['button[type="submit"]', 'button[aria-label*="Send"]', '[role="button"][aria-label*="Send"]'],
  },
};

const GENERATION_SELECTORS: Record<AiDestination, string[]> = {
  chatgpt: ['[data-testid="stop-button"]', 'button[aria-label*="Stop"]'],
  perplexity: ['button[aria-label*="Stop"]', '[data-testid="stop-generating"]'],
  claude: ['button[aria-label*="Stop"]', 'button[aria-label*="stop"]', '[data-testid="stop-button"]'],
  gemini: ['button[aria-label*="Stop"]', 'button[aria-label*="stop"]', '.stop-button'],
  qwen: ['button[aria-label*="Stop"]', 'button[aria-label*="stop"]', '[data-testid*="stop"]'],
  deepseek: ['button[aria-label*="Stop"]', 'button[aria-label*="stop"]', '[data-testid*="stop"]'],
};

const RESPONSE_SELECTORS: Record<AiDestination, string> = {
  chatgpt: '[data-message-author-role="assistant"]',
  perplexity: '[data-testid="answer"], main article',
  claude: '[data-is-streaming], [data-testid="assistant-message"], .font-claude-response',
  gemini: 'model-response, message-content, [data-test-id="model-response"]',
  qwen: '[data-role="assistant"], [data-testid="assistant-message"], .message-assistant, [class*="assistant-message"]',
  deepseek: '[data-role="assistant"], [data-testid="assistant-message"], .ds-markdown, [class*="assistant-message"]',
};

/** Initial pause so React/UI can begin handling a synthetic paste. */
const PASTE_SETTLE_MS = 150;
/** How long to wait for async paste text or a finished long-paste attachment. */
const PASTE_READY_TIMEOUT_MS = 10_000;
/** Extra time to wait for Send after the full prompt is already in the editor. */
const SEND_BUTTON_WAIT_MS = 2_000;
const PASTE_POLL_MS = 100;

export interface DeliveryMarker { responseCount: number }

export async function deliverPrompt(document: Document, prompt: string, destination: AiDestination): Promise<DeliveryResult> {
  const prepared = await preparePromptForDelivery(document, prompt, destination);
  if (prepared.status !== 'ready') return prepared;
  prepared.send();
  return { status: 'sent' };
}

export async function preparePromptForDelivery(
  document: Document,
  prompt: string,
  destination: AiDestination,
): Promise<PreparedDelivery> {
  const selectors = SELECTORS[destination];
  const editor = findFirst<HTMLElement>(document, selectors.editors);
  if (!editor) return { status: 'editor-not-found' };

  const paste = await pastePrompt(document, editor, prompt);
  const normalizedPrompt = normalizeEditorText(prompt);
  const deadline = Date.now() + PASTE_READY_TIMEOUT_MS;
  let sendWaitDeadline: number | undefined;
  await delay(PASTE_SETTLE_MS);

  let settled: PreparedDelivery | undefined;
  while (!settled) {
    const completeInEditor = normalizeEditorText(readEditorText(editor)) === normalizedPrompt;
    const sendButton = findFirst<HTMLButtonElement>(document, selectors.sendButtons);
    const sendAvailable = Boolean(
      sendButton && !sendButton.disabled && sendButton.getAttribute('aria-disabled') !== 'true',
    );
    const attachment = detectPasteAttachment(document);

    if (completeInEditor) {
      if (sendAvailable) {
        settled = { status: 'ready', send: () => sendButton!.click() };
        break;
      }
      sendWaitDeadline ??= Date.now() + SEND_BUTTON_WAIT_MS;
      if (Date.now() >= sendWaitDeadline) {
        settled = { status: 'send-unavailable' };
        break;
      }
      await delay(PASTE_POLL_MS);
      continue;
    }

    // Direct insert already finished and the field does not hold the full prompt.
    if (!paste.customHandled) {
      settled = { status: 'incomplete-insertion' };
      break;
    }

    // Long-paste handlers (Perplexity, Qwen) may move text into an attachment instead of the field.
    if (sendAvailable) {
      if (attachment?.ready) {
        settled = { status: 'ready', send: () => sendButton!.click() };
        break;
      }
      // Qwen shows Send while the pasted file is still "Parsing…"; wait or fail closed.
      if (attachment && !attachment.ready) {
        if (Date.now() >= deadline) {
          settled = { status: 'incomplete-insertion' };
          break;
        }
        await delay(PASTE_POLL_MS);
        continue;
      }
      if (destination === 'qwen') {
        if (Date.now() >= deadline) {
          settled = { status: 'incomplete-insertion' };
          break;
        }
        await delay(PASTE_POLL_MS);
        continue;
      }
      // Perplexity and similar: empty field + custom paste + Send is the attachment path.
      settled = { status: 'ready', send: () => sendButton!.click() };
      break;
    }

    if (Date.now() >= deadline) {
      settled = { status: 'incomplete-insertion' };
      break;
    }
    await delay(PASTE_POLL_MS);
  }

  return settled!;
}

export function createDeliveryMarker(document: Document, destination: AiDestination): DeliveryMarker {
  return { responseCount: document.querySelectorAll(RESPONSE_SELECTORS[destination]).length };
}

export function isDeliveryConfirmed(document: Document, destination: AiDestination, marker?: DeliveryMarker): boolean {
  if (findFirst(document, GENERATION_SELECTORS[destination])) return true;
  return marker !== undefined
    && document.querySelectorAll(RESPONSE_SELECTORS[destination]).length > marker.responseCount;
}

export function detectDestinationRejection(document: Document): string | undefined {
  const messages = Array.from(document.querySelectorAll('[role="alert"], [data-testid*="error"], [class*="toast"]'))
    .map((element) => element.textContent?.toLocaleLowerCase() ?? '')
    .join(' ');
  if (/too long|context (window|length)|token limit|maximum.*token/.test(messages)) {
    return 'The service rejected the prompt because it is too long';
  }
  return undefined;
}

async function pastePrompt(
  document: Document,
  editor: HTMLElement,
  prompt: string,
): Promise<{ customHandled: boolean }> {
  editor.focus();
  selectEditorContents(document, editor);

  const before = normalizeEditorText(readEditorText(editor));
  const pasteEvent = createPasteEvent(prompt);
  editor.dispatchEvent(pasteEvent);

  if (pasteEvent.defaultPrevented) return { customHandled: true };

  // Synthetic paste does not insert by itself; fall back if the page ignored the event.
  await delay(0);
  const after = normalizeEditorText(readEditorText(editor));
  const promptStart = normalizeEditorText(prompt).slice(0, 32);
  if (after !== before && promptStart.length > 0 && after.includes(promptStart)) {
    return { customHandled: false };
  }

  insertPromptDirectly(document, editor, prompt);
  return { customHandled: false };
}

function detectPasteAttachment(document: Document): { ready: boolean } | undefined {
  const qwenFile = document.querySelector('.message-input-column-file, .file-card-list');
  if (qwenFile) {
    const text = qwenFile.textContent ?? '';
    return { ready: !/parsing|uploading|processing/i.test(text) };
  }

  const generic = document.querySelector(
    '[class*="attachment"], [data-testid*="attachment"], [class*="file-card"], [class*="FileCard"]',
  );
  if (!generic) return undefined;
  const text = generic.textContent ?? '';
  return { ready: !/parsing|uploading|processing/i.test(text) };
}

function createPasteEvent(prompt: string): ClipboardEvent {
  const clipboardData = createClipboardData(prompt);
  let event: ClipboardEvent;
  try {
    event = new ClipboardEvent('paste', {
      bubbles: true,
      cancelable: true,
      clipboardData,
    });
  } catch {
    event = new Event('paste', { bubbles: true, cancelable: true }) as ClipboardEvent;
  }

  // Chromium often ignores clipboardData from the constructor for untrusted events.
  if (event.clipboardData !== clipboardData) {
    Object.defineProperty(event, 'clipboardData', {
      configurable: true,
      value: clipboardData,
    });
  }
  return event;
}

function createClipboardData(prompt: string): DataTransfer {
  if (typeof DataTransfer !== 'undefined') {
    const clipboardData = new DataTransfer();
    clipboardData.setData('text/plain', prompt);
    clipboardData.setData('text/html', escapeHtml(prompt));
    return clipboardData;
  }

  const store = new Map<string, string>([
    ['text/plain', prompt],
    ['text/html', escapeHtml(prompt)],
  ]);
  return {
    getData: (type: string) => store.get(type) ?? '',
    setData: (type: string, value: string) => { store.set(type, value); },
    clearData: (type?: string) => {
      if (type) store.delete(type);
      else store.clear();
    },
    get types() { return Array.from(store.keys()); },
    files: [] as unknown as FileList,
    items: [] as unknown as DataTransferItemList,
    dropEffect: 'none',
    effectAllowed: 'uninitialized',
  } as DataTransfer;
}

function insertPromptDirectly(document: Document, editor: HTMLElement, prompt: string): void {
  editor.focus();
  if (editor instanceof HTMLTextAreaElement || editor instanceof HTMLInputElement) {
    const prototype = editor instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
    setter?.call(editor, prompt);
    editor.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertFromPaste', data: prompt }));
    return;
  }

  const execCommand = (document as Document & { execCommand?: (command: string, showUi: boolean, value?: string) => boolean }).execCommand;
  let inserted = false;
  if (execCommand) {
    execCommand.call(document, 'selectAll', false);
    inserted = execCommand.call(document, 'insertText', false, prompt);
  }
  if (!inserted) {
    editor.textContent = prompt;
    editor.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertFromPaste', data: prompt }));
  }
}

function selectEditorContents(document: Document, editor: HTMLElement): void {
  if (editor instanceof HTMLTextAreaElement || editor instanceof HTMLInputElement) {
    editor.select();
    return;
  }
  const selection = document.getSelection();
  if (!selection) return;
  const range = document.createRange();
  range.selectNodeContents(editor);
  selection.removeAllRanges();
  selection.addRange(range);
}

function readEditorText(editor: HTMLElement): string {
  if (editor instanceof HTMLTextAreaElement || editor instanceof HTMLInputElement) return editor.value;
  return editor.innerText || editor.textContent || '';
}

function normalizeEditorText(value: string): string {
  return value.replace(/\r\n/g, '\n').replace(/\u00a0/g, ' ').trim();
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function findFirst<T extends Element>(document: Document, selectors: string[]): T | null {
  for (const selector of selectors) {
    const element = document.querySelector<T>(selector);
    if (element) return element;
  }
  return null;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}
