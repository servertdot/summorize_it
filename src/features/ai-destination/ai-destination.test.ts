import { describe, expect, it, vi } from 'vitest';

import { createDeliveryMarker, detectDestinationRejection, deliverPrompt, isDeliveryConfirmed } from './ai-destination';

describe('AI destination contract', () => {
  it.each([
    {
      destination: 'chatgpt' as const,
      html: '<div id="prompt-textarea" contenteditable="true"></div><button data-testid="send-button">Send</button>',
      button: '[data-testid="send-button"]',
    },
    {
      destination: 'perplexity' as const,
      html: '<textarea placeholder="Ask anything"></textarea><button aria-label="Submit">Submit</button>',
      button: '[aria-label="Submit"]',
    },
  ])('inserts the complete prompt and sends it on $destination', ({ destination, html, button }) => {
    document.body.innerHTML = html;
    const onSend = vi.fn();
    document.querySelector(button)?.addEventListener('click', onSend);
    const prompt = 'Полный запрос\n\n[0:30] Unicode 🚀 text';

    const result = deliverPrompt(document, prompt, destination);

    expect(result).toEqual({ status: 'sent' });
    expect(onSend).toHaveBeenCalledOnce();
  });

  it('does not report success when the editor is unavailable', () => {
    document.body.innerHTML = '<main>Login required</main>';

    expect(deliverPrompt(document, 'prompt', 'chatgpt')).toEqual({
      status: 'editor-not-found',
    });
  });

  it('blocks sending when the page truncates the inserted prompt', () => {
    document.body.innerHTML = '<div id="prompt-textarea" contenteditable="true"></div><button data-testid="send-button">Send</button>';
    const editor = document.querySelector('#prompt-textarea') as HTMLElement;
    editor.addEventListener('input', () => { editor.textContent = 'truncated'; });

    expect(deliverPrompt(document, 'a complete prompt', 'chatgpt')).toEqual({ status: 'incomplete-insertion' });
  });

  it('keeps the complete prompt in place when the send button is disabled', () => {
    document.body.innerHTML = '<textarea placeholder="Ask anything"></textarea><button aria-label="Submit" disabled>Submit</button>';

    expect(deliverPrompt(document, 'complete prompt', 'perplexity')).toEqual({ status: 'send-unavailable' });
    expect((document.querySelector('textarea') as HTMLTextAreaElement).value).toBe('complete prompt');
  });

  it('does not treat an emptied editor as proof that generation started', () => {
    document.body.innerHTML = '<textarea placeholder="Ask anything"></textarea><button aria-label="Submit">Submit</button>';
    const editor = document.querySelector('textarea') as HTMLTextAreaElement;
    const button = document.querySelector('button') as HTMLButtonElement;
    button.addEventListener('click', () => {
      editor.value = '';
      editor.dispatchEvent(new InputEvent('input', { bubbles: true }));
    });
    const prompt = 'complete prompt';

    expect(deliverPrompt(document, prompt, 'perplexity')).toEqual({ status: 'sent' });
    expect(isDeliveryConfirmed(document, 'perplexity')).toBe(false);
  });

  it('confirms delivery when the service exposes generation state', () => {
    document.body.innerHTML = '<button data-testid="stop-button">Stop</button>';
    expect(isDeliveryConfirmed(document, 'chatgpt')).toBe(true);
  });

  it('confirms a fast response that appears after sending', () => {
    document.body.innerHTML = '<main></main>';
    const marker = createDeliveryMarker(document, 'perplexity');
    document.querySelector('main')?.insertAdjacentHTML('beforeend', '<article>Answer</article>');

    expect(isDeliveryConfirmed(document, 'perplexity', marker)).toBe(true);
  });

  it('detects an explicit context-length rejection without including prompt text', () => {
    document.body.innerHTML = '<div role="alert">This message is too long for the context window</div>';
    expect(detectDestinationRejection(document)).toBe('Сервис отклонил запрос из-за его длины');
  });
});
