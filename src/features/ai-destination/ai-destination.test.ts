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
    {
      destination: 'claude' as const,
      html: '<div data-testid="chat-input" contenteditable="true"></div><button data-testid="send-button">Send</button>',
      button: '[data-testid="send-button"]',
    },
    {
      destination: 'gemini' as const,
      html: '<rich-textarea><div class="ql-editor" contenteditable="true"></div></rich-textarea><button aria-label="Send message">Send</button>',
      button: '[aria-label="Send message"]',
    },
    {
      destination: 'qwen' as const,
      html: '<textarea class="message-input-textarea" placeholder="Ask Qwen"></textarea><button class="send-button" aria-label="Send">Send</button>',
      button: 'button.send-button',
    },
    {
      destination: 'deepseek' as const,
      html: '<textarea placeholder="Message DeepSeek"></textarea><button type="submit">Send</button>',
      button: '[type="submit"]',
    },
  ])('inserts the complete prompt and sends it on $destination', async ({ destination, html, button }) => {
    document.body.innerHTML = html;
    const onSend = vi.fn();
    document.querySelector(button)?.addEventListener('click', onSend);
    const prompt = 'Complete prompt\n\n[0:30] Unicode 🚀 text';

    const result = await deliverPrompt(document, prompt, destination);

    expect(result).toEqual({ status: 'sent' });
    expect(onSend).toHaveBeenCalledOnce();
  });

  it('does not report success when the editor is unavailable', async () => {
    document.body.innerHTML = '<main>Login required</main>';

    expect(await deliverPrompt(document, 'prompt', 'chatgpt')).toEqual({
      status: 'editor-not-found',
    });
  });

  it('blocks sending when the page truncates the inserted prompt', async () => {
    document.body.innerHTML = '<div id="prompt-textarea" contenteditable="true"></div><button data-testid="send-button">Send</button>';
    const editor = document.querySelector('#prompt-textarea') as HTMLElement;
    editor.addEventListener('input', () => { editor.textContent = 'truncated'; });

    expect(await deliverPrompt(document, 'a complete prompt', 'chatgpt')).toEqual({ status: 'incomplete-insertion' });
  });

  it('keeps the complete prompt in place when the send button is disabled', async () => {
    document.body.innerHTML = '<textarea placeholder="Ask anything"></textarea><button aria-label="Submit" disabled>Submit</button>';

    expect(await deliverPrompt(document, 'complete prompt', 'perplexity')).toEqual({ status: 'send-unavailable' });
    expect((document.querySelector('textarea') as HTMLTextAreaElement).value).toBe('complete prompt');
  });

  it('sends when a long-paste handler attaches the payload instead of leaving it in the editor', async () => {
    document.body.innerHTML = '<textarea placeholder="Ask anything"></textarea><button aria-label="Submit">Submit</button>';
    const editor = document.querySelector('textarea') as HTMLTextAreaElement;
    const onSend = vi.fn();
    document.querySelector('button')?.addEventListener('click', onSend);
    editor.addEventListener('paste', (event) => {
      event.preventDefault();
      editor.value = '';
      editor.dataset.attached = 'true';
    });

    const result = await deliverPrompt(document, 'a very long pasted transcript payload', 'perplexity');

    expect(result).toEqual({ status: 'sent' });
    expect(editor.value).toBe('');
    expect(editor.dataset.attached).toBe('true');
    expect(onSend).toHaveBeenCalledOnce();
  });

  it('waits for Qwen pasted-file parsing before sending', async () => {
    document.body.innerHTML = `
      <div class="message-input-column-file">Pasted_Text.txt 10 KB Parsing...</div>
      <textarea class="message-input-textarea" placeholder="Ask Qwen"></textarea>
      <button class="send-button" aria-label="Send">Send</button>
    `;
    const editor = document.querySelector('textarea') as HTMLTextAreaElement;
    const file = document.querySelector('.message-input-column-file') as HTMLElement;
    const onSend = vi.fn();
    document.querySelector('button')?.addEventListener('click', onSend);
    editor.addEventListener('paste', (event) => {
      event.preventDefault();
      editor.value = '';
    });
    window.setTimeout(() => {
      file.textContent = 'Pasted_Text.txt 10 KB';
    }, 250);

    const result = await deliverPrompt(document, 'a very long pasted transcript payload for qwen', 'qwen');

    expect(result).toEqual({ status: 'sent' });
    expect(onSend).toHaveBeenCalledOnce();
    expect(file.textContent).toBe('Pasted_Text.txt 10 KB');
  });

  it('does not send on Qwen when the editor is empty and no pasted file appeared', async () => {
    vi.useFakeTimers();
    try {
      document.body.innerHTML = `
        <textarea class="message-input-textarea" placeholder="Ask Qwen"></textarea>
        <button class="send-button" aria-label="Send">Send</button>
      `;
      const editor = document.querySelector('textarea') as HTMLTextAreaElement;
      const onSend = vi.fn();
      document.querySelector('button')?.addEventListener('click', onSend);
      editor.addEventListener('paste', (event) => {
        event.preventDefault();
        editor.value = '';
      });

      const resultPromise = deliverPrompt(document, 'prompt that never lands', 'qwen');
      await vi.advanceTimersByTimeAsync(11_000);
      const result = await resultPromise;

      expect(result).toEqual({ status: 'incomplete-insertion' });
      expect(onSend).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('accepts Qwen text that appears asynchronously after paste', async () => {
    document.body.innerHTML = `
      <textarea class="message-input-textarea" placeholder="Ask Qwen"></textarea>
      <button class="send-button" aria-label="Send" disabled>Send</button>
    `;
    const editor = document.querySelector('textarea') as HTMLTextAreaElement;
    const button = document.querySelector('button') as HTMLButtonElement;
    const onSend = vi.fn();
    button.addEventListener('click', onSend);
    const prompt = 'async qwen prompt';
    editor.addEventListener('paste', (event) => {
      event.preventDefault();
      window.setTimeout(() => {
        editor.value = prompt;
        button.disabled = false;
      }, 200);
    });

    const result = await deliverPrompt(document, prompt, 'qwen');

    expect(result).toEqual({ status: 'sent' });
    expect(editor.value).toBe(prompt);
    expect(onSend).toHaveBeenCalledOnce();
  });

  it('does not treat an emptied editor as proof that generation started', async () => {
    document.body.innerHTML = '<textarea placeholder="Ask anything"></textarea><button aria-label="Submit">Submit</button>';
    const editor = document.querySelector('textarea') as HTMLTextAreaElement;
    const button = document.querySelector('button') as HTMLButtonElement;
    button.addEventListener('click', () => {
      editor.value = '';
      editor.dispatchEvent(new InputEvent('input', { bubbles: true }));
    });
    const prompt = 'complete prompt';

    expect(await deliverPrompt(document, prompt, 'perplexity')).toEqual({ status: 'sent' });
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
    expect(detectDestinationRejection(document)).toBe('The service rejected the prompt because it is too long');
  });
});
