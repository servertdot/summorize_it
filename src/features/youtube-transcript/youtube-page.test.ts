import { describe, expect, it } from 'vitest';

import { readYouTubePage } from './youtube-page';

describe('YouTube page contract', () => {
  it('exposes current video metadata, caption tracks, and the player-selected track', () => {
    document.head.innerHTML = `
      <meta property="og:url" content="https://www.youtube.com/watch?v=abc123">
      <meta property="og:title" content="A useful video">
    `;

    const page = readYouTubePage(document, 'https://www.youtube.com/watch?v=abc123', {
      videoId: 'abc123',
      title: 'A useful video from player',
      activeCaption: { vssId: '.ru', languageCode: 'ru' },
      playerResponse: {
        videoDetails: { videoId: 'abc123', title: 'A useful video from player' },
        captions: {
          playerCaptionsTracklistRenderer: {
            captionTracks: [
              {
                vssId: '.en',
                languageCode: 'en',
                name: { simpleText: 'English' },
                baseUrl: 'https://www.youtube.com/api/timedtext?lang=en',
              },
              {
                vssId: '.ru',
                languageCode: 'ru',
                kind: 'asr',
                name: { runs: [{ text: 'Russian' }, { text: ' (auto-generated)' }] },
                baseUrl: 'https://www.youtube.com/api/timedtext?lang=ru',
              },
            ],
          },
        },
      },
    });

    expect(page).toEqual({
      videoId: 'abc123',
      title: 'A useful video from player',
      url: 'https://www.youtube.com/watch?v=abc123',
      pageLanguage: 'en',
      activeTrackId: '.ru',
      tracks: [
        {
          id: '.en',
          languageCode: 'en',
          label: 'English',
          kind: 'manual',
          baseUrl: 'https://www.youtube.com/api/timedtext?lang=en',
        },
        {
          id: '.ru',
          languageCode: 'ru',
          label: 'Russian (auto-generated)',
          kind: 'asr',
          baseUrl: 'https://www.youtube.com/api/timedtext?lang=ru',
        },
      ],
    });
  });

  it('distinguishes an unavailable video from a video without captions', () => {
    const page = readYouTubePage(document, 'https://www.youtube.com/watch?v=private', {
      videoId: 'private',
      playerResponse: {
        playabilityStatus: { status: 'LOGIN_REQUIRED', reason: 'Sign in to confirm your age' },
      },
    });

    expect(page.accessError).toBe('Video unavailable: Sign in to confirm your age');
    expect(page.tracks).toEqual([]);
  });
});
