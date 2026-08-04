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
    editors: ['textarea[placeholder]', 'div[contenteditable="true"][role="textbox"]', 'div[contenteditable="true"]'],
    sendButtons: ['[data-testid="send-button"]', 'button[type="submit"]', 'button[aria-label*="Send"]', '[role="button"][aria-label*="Send"]'],
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

export interface DeliveryMarker { responseCount: number }

export function deliverPrompt(document: Document, prompt: string, destination: AiDestination): DeliveryResult {
  const prepared = preparePromptForDelivery(document, prompt, destination);
  if (prepared.status !== 'ready') return prepared;
  prepared.send();
  return { status: 'sent' };
}

export function preparePromptForDelivery(document: Document, prompt: string, destination: AiDestination): PreparedDelivery {
  const selectors = SELECTORS[destination];
  const editor = findFirst<HTMLElement>(document, selectors.editors);
  if (!editor) return { status: 'editor-not-found' };

  insertPrompt(document, editor, prompt);
  if (normalizeEditorText(readEditorText(editor)) !== normalizeEditorText(prompt)) {
    return { status: 'incomplete-insertion' };
  }

  const sendButton = findFirst<HTMLButtonElement>(document, selectors.sendButtons);
  if (!sendButton || sendButton.disabled || sendButton.getAttribute('aria-disabled') === 'true') {
    return { status: 'send-unavailable' };
  }
  return { status: 'ready', send: () => sendButton.click() };
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

function insertPrompt(document: Document, editor: HTMLElement, prompt: string): void {
  editor.focus();
  if (editor instanceof HTMLTextAreaElement || editor instanceof HTMLInputElement) {
    const prototype = editor instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
    setter?.call(editor, prompt);
    editor.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: prompt }));
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
    editor.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: prompt }));
  }
}

function readEditorText(editor: HTMLElement): string {
  if (editor instanceof HTMLTextAreaElement || editor instanceof HTMLInputElement) return editor.value;
  return editor.innerText || editor.textContent || '';
}

function normalizeEditorText(value: string): string {
  return value.replace(/\r\n/g, '\n').replace(/\u00a0/g, ' ').trim();
}

function findFirst<T extends Element>(document: Document, selectors: string[]): T | null {
  for (const selector of selectors) {
    const element = document.querySelector<T>(selector);
    if (element) return element;
  }
  return null;
}
