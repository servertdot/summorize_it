import { afterEach, expect, it, vi } from 'vitest';

const { browser, storage, listeners } = vi.hoisted(() => {
  const storage = new Map<string, unknown>();
  const listeners: Array<(message: unknown) => unknown> = [];
  const browser = {
    tabs: {
      query: vi.fn(async () => [{ id: 1 }]),
      sendMessage: vi.fn(async (_tabId: number, message: unknown) => listeners[0](message)),
      create: vi.fn(),
    },
    storage: {
      local: {
        get: async (keys: string[]) => Object.fromEntries(keys.map((key) => [key, storage.get(key)])),
        set: async (values: Record<string, unknown>) => {
          for (const [key, value] of Object.entries(values)) storage.set(key, value);
        },
        remove: async (keys: string[]) => {
          for (const key of keys) storage.delete(key);
        },
      },
    },
    runtime: {
      onMessage: { addListener: (listener: (message: unknown) => unknown) => listeners.push(listener) },
      sendMessage: vi.fn(async () => ({ ok: true })),
    },
    alarms: { clear: vi.fn(async () => true) },
  };
  return { browser, storage, listeners };
});

vi.mock('webextension-polyfill', () => ({ default: browser }));

import { registerHtmlContent } from '../content/html-content';
import { browserPopupClient } from './popup-client';

afterEach(() => {
  listeners.length = 0;
  storage.clear();
  vi.unstubAllGlobals();
  document.title = '';
  document.body.replaceChildren();
});

it('copies the complete extracted page text and removes its temporary chunks without creating an AI operation', async () => {
  const writeText = vi.fn(async () => {
    expect(storage.size).toBeGreaterThan(2);
  });
  vi.stubGlobal('navigator', { clipboard: { writeText } });
  const url = 'https://example.com/article';
  vi.stubGlobal('location', new URL(url));
  document.title = 'Article';
  const text = 'Полный текст статьи. '.repeat(8_000).trimEnd();
  const article = document.createElement('article');
  article.textContent = text;
  document.body.append(article);
  registerHtmlContent();

  await browserPopupClient.copyContent({ type: 'html', id: url, title: 'Article', url });

  expect(writeText.mock.calls).toEqual([[text]]);
  expect(browser.tabs.create).not.toHaveBeenCalled();
  expect(browser.runtime.sendMessage.mock.calls).toEqual([[
    expect.objectContaining({ type: 'SCHEDULE_CLIPBOARD_EXPIRY' }),
  ]]);
  expect(storage.size).toBe(0);
});
