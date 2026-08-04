import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import Popup, { type PopupClient } from './Popup';

const page = {
  videoId: 'video',
  title: 'Video title',
  url: 'https://www.youtube.com/watch?v=video',
  pageLanguage: 'en',
  activeTrackId: 'ru',
  tracks: [
    { id: 'en', languageCode: 'en', label: 'English', kind: 'manual' as const, baseUrl: 'https://www.youtube.com/en' },
    { id: 'ru', languageCode: 'ru', label: 'Russian', kind: 'asr' as const, baseUrl: 'https://www.youtube.com/ru' },
  ],
};

function makeClient(overrides: Partial<PopupClient> = {}): PopupClient {
  return {
    load: vi.fn().mockResolvedValue({ page, summaryLanguage: 'ru', selectedDestinations: ['chatgpt', 'perplexity'] }),
    saveSummaryLanguage: vi.fn().mockResolvedValue(undefined),
    saveDestinations: vi.fn().mockResolvedValue(undefined),
    prepare: vi.fn().mockResolvedValue({
      id: 'id', destination: 'chatgpt', videoId: 'video', videoTitle: 'Video title', trackId: 'ru',
      charLength: 1200, estimatedTokens: 300, createdAt: 1, expiresAt: 2,
      status: 'prepared', statusMessage: 'Transcript prepared',
    }),
    open: vi.fn().mockImplementation(async (id, destination) => ({
      id, destination, videoId: 'video', videoTitle: 'Video title', trackId: 'ru',
      charLength: 1200, estimatedTokens: 300, createdAt: 1, expiresAt: 2,
      status: 'opening', statusMessage: 'Opening…',
    })),
    refresh: vi.fn().mockResolvedValue(undefined),
    retry: vi.fn(), cancel: vi.fn(), copy: vi.fn(),
    ...overrides,
  };
}

afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = '';
});

describe('popup', () => {
  it('starts the chosen service with the saved language and active caption track', async () => {
    const client = makeClient();
    const container = document.createElement('div');
    document.body.appendChild(container);

    await act(async () => createRoot(container).render(<Popup client={client} />));
    await act(async () => Promise.resolve());

    expect(container.textContent).toContain('Video title');
    expect((container.querySelector('select[aria-label="Summary language"]') as HTMLSelectElement).value).toBe('ru');
    expect((container.querySelector('select[aria-label="Caption track"]') as HTMLSelectElement).selectedOptions[0].textContent).toBe('Russian · auto-generated');
    const chatGptButton = Array.from(container.querySelectorAll('button')).find((button) => button.textContent === 'ChatGPT');
    await act(async () => chatGptButton?.click());

    expect(client.prepare).toHaveBeenCalledWith('chatgpt', 'ru', 'ru');
  });

  it('persists chosen services and renders them as summary buttons', async () => {
    const client = makeClient();
    const container = document.createElement('div');
    document.body.appendChild(container);

    await act(async () => createRoot(container).render(<Popup client={client} />));
    await act(async () => Promise.resolve());
    const picker = container.querySelector('select[aria-label="Choose visible AI services"]') as HTMLSelectElement;

    await act(async () => {
      picker.value = 'claude';
      picker.dispatchEvent(new Event('change', { bubbles: true }));
      await Promise.resolve();
    });

    expect(client.saveDestinations).toHaveBeenCalledWith(['chatgpt', 'perplexity', 'claude']);
    const claudeButton = Array.from(container.querySelectorAll('button')).find((button) => button.textContent === 'Claude');
    await act(async () => claudeButton?.click());
    expect(client.prepare).toHaveBeenCalledWith('claude', 'ru', 'ru');
  });

  it('shows an immediate error when the video has no caption tracks', async () => {
    const client = makeClient({
      load: vi.fn().mockResolvedValue({
        page: { ...page, tracks: [] }, summaryLanguage: 'ru', selectedDestinations: ['chatgpt', 'perplexity'],
      }),
    });
    const container = document.createElement('div');
    document.body.appendChild(container);

    await act(async () => createRoot(container).render(<Popup client={client} />));
    await act(async () => Promise.resolve());

    expect(container.textContent).toContain('No captions found');
    expect(container.querySelectorAll('button')).toHaveLength(0);
  });

  it('warns before automatically opening a very large prompt from the same click', async () => {
    vi.useFakeTimers();
    const client = makeClient({
      prepare: vi.fn().mockResolvedValue({
        id: 'large', destination: 'perplexity', videoId: 'video', videoTitle: 'Video title', trackId: 'ru',
        charLength: 800_000, estimatedTokens: 200_000, createdAt: 1, expiresAt: 2,
        status: 'prepared', statusMessage: 'Transcript prepared',
      }),
    });
    const container = document.createElement('div');
    document.body.appendChild(container);
    await act(async () => createRoot(container).render(<Popup client={client} />));
    await act(async () => Promise.resolve());
    const perplexity = Array.from(container.querySelectorAll('button')).find((button) => button.textContent === 'Perplexity');
    await act(async () => perplexity?.click());

    expect(container.textContent).toContain('200,000 tokens');
    expect(container.textContent).toContain('Opening Perplexity');
    expect(client.open).not.toHaveBeenCalled();
    await act(async () => { vi.advanceTimersByTime(700); await Promise.resolve(); });
    expect(client.open).toHaveBeenCalledWith('large', 'perplexity');
    vi.useRealTimers();
  });

  it('offers retry, copy, and cancel for a recoverable operation', async () => {
    const operation = {
      id: 'recover', destination: 'chatgpt' as const, videoId: 'video', videoTitle: 'Video title', trackId: 'ru',
      charLength: 1200, estimatedTokens: 300, createdAt: 1, expiresAt: 2,
      status: 'recoverable-error' as const, statusMessage: 'Prompt saved',
    };
    const client = makeClient({
      load: vi.fn().mockResolvedValue({
        summaryLanguage: 'ru', selectedDestinations: ['chatgpt', 'perplexity'], operation,
      }),
      retry: vi.fn().mockRejectedValue(new Error('retry failed')),
      copy: vi.fn().mockResolvedValue(undefined),
      cancel: vi.fn().mockResolvedValue(undefined),
    });
    const container = document.createElement('div');
    document.body.appendChild(container);
    await act(async () => createRoot(container).render(<Popup client={client} />));
    await act(async () => Promise.resolve());

    expect(container.textContent).toContain('Retry');
    expect(container.textContent).toContain('Copy prompt');
    expect(container.textContent).toContain('Cancel');
    const buttons = () => Array.from(container.querySelectorAll('button'));
    await act(async () => buttons().find((button) => button.textContent === 'Retry')?.click());
    expect(client.retry).toHaveBeenCalledWith('recover');
    await act(async () => buttons().find((button) => button.textContent === 'Copy prompt')?.click());
    expect(client.copy).toHaveBeenCalledWith('recover');
    await act(async () => buttons().find((button) => button.textContent === 'Cancel')?.click());
    expect(client.cancel).toHaveBeenCalledWith('recover');
  });
});
