import { afterEach, expect, it, vi } from 'vitest';

const { listeners } = vi.hoisted(() => ({ listeners: [] as Array<(message: unknown) => unknown> }));
vi.mock('webextension-polyfill', () => ({
  default: { runtime: { onMessage: { addListener: (listener: (message: unknown) => unknown) => listeners.push(listener) } } },
}));
vi.mock('@src/features/summary-services/html-summary-service', () => ({
  readHtmlPage: () => ({ type: 'html' }), htmlSummaryService: {},
}));
vi.mock('@src/features/youtube-transcript/youtube-page', () => ({
  readYouTubePage: () => ({ videoId: 'a_OXi5qAND0', tracks: [{ baseUrl: 'https://www.youtube.com/captions' }] }),
}));

import { registerHtmlContent } from './html-content';
import { registerYouTubeContent } from './youtube-content';

afterEach(() => { vi.unstubAllGlobals(); listeners.length = 0; });

it('routes each request using the current YouTube URL after in-page navigation', async () => {
  const currentLocation = { hostname: 'www.youtube.com', pathname: '/', href: 'https://www.youtube.com/' };
  vi.stubGlobal('location', currentLocation);
  registerYouTubeContent();
  registerHtmlContent();
  const request = { type: 'GET_SUMMARY_PAGE' };
  expect(listeners[0](request)).toBeUndefined();
  expect(await listeners[1](request)).toEqual({ type: 'html' });

  currentLocation.pathname = '/watch';
  currentLocation.href = 'https://www.youtube.com/watch?v=a_OXi5qAND0';
  expect(listeners[1](request)).toBeUndefined();
  expect(await listeners[0](request)).toMatchObject({ videoId: 'a_OXi5qAND0' });

  currentLocation.pathname = '/';
  expect(listeners[0](request)).toBeUndefined();
  expect(await listeners[1](request)).toEqual({ type: 'html' });
});
