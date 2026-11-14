import { describe, expect, it, vi } from 'vitest';

import {
  captionBodyLooksValid,
  fetchCaptionTrackXml,
  matchAndroidCaptionUrl,
  PANEL_TRACK_URL,
  resolveCaptionFetchUrl,
  webCaptionUrlLikelyBlocked,
  withCaptionFormat,
} from './caption-fetch';
import type { CaptionTrack } from './transcript-operation';

const track: CaptionTrack = {
  id: 'a.en',
  languageCode: 'en',
  label: 'English (auto-generated)',
  kind: 'asr',
  baseUrl: 'https://www.youtube.com/api/timedtext?v=video&exp=xpe&lang=en',
};

const panelTrack: CaptionTrack = {
  id: 'modern-transcript',
  languageCode: 'ru',
  label: 'YouTube transcript',
  kind: 'manual',
  baseUrl: PANEL_TRACK_URL,
};

describe('YouTube caption fetch', () => {
  it('detects WEB caption URLs that require a player-client workaround', () => {
    expect(webCaptionUrlLikelyBlocked(track.baseUrl)).toBe(true);
    expect(webCaptionUrlLikelyBlocked('https://www.youtube.com/api/timedtext?v=video&lang=en')).toBe(false);
  });

  it('forces srv3 so timedtext returns parseable XML', () => {
    expect(withCaptionFormat('https://www.youtube.com/api/timedtext?v=video&lang=en')).toBe(
      'https://www.youtube.com/api/timedtext?v=video&lang=en&fmt=srv3',
    );
  });

  it('matches ANDROID tracks by language and kind', () => {
    const matched = matchAndroidCaptionUrl([
      { languageCode: 'en', kind: 'asr', vssId: 'a.en', baseUrl: 'https://www.youtube.com/api/timedtext?android=1' },
      { languageCode: 'en', baseUrl: 'https://www.youtube.com/api/timedtext?android=manual' },
    ], track);
    expect(matched).toBe('https://www.youtube.com/api/timedtext?android=1');
  });

  it('does not substitute a different language for a selected track', () => {
    expect(matchAndroidCaptionUrl([{ languageCode: 'ru', baseUrl: 'https://www.youtube.com/api/timedtext?lang=ru' }], track)).toBeUndefined();
  });

  it('tries the original WEB URL even when it has an exp parameter', async () => {
    const fetchImpl = vi.fn(async () => new Response('<text start="0">Direct captions</text>'));
    await expect(fetchCaptionTrackXml({ videoId: 'video', track, fetchImpl })).resolves.toContain('Direct captions');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('resolves blocked WEB URLs through the ANDROID player response', async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/youtubei/v1/player')) {
        return new Response(JSON.stringify({
          captions: {
            playerCaptionsTracklistRenderer: {
              captionTracks: [{
                languageCode: 'en',
                kind: 'asr',
                vssId: 'a.en',
                baseUrl: 'https://www.youtube.com/api/timedtext?v=video&android=1',
              }],
            },
          },
        }), { status: 200 });
      }
      throw new Error(`unexpected fetch: ${url}`);
    });

    await expect(resolveCaptionFetchUrl('video', track, fetchImpl)).resolves.toBe(
      'https://www.youtube.com/api/timedtext?v=video&android=1&fmt=srv3',
    );
  });

  it('fetches caption XML via ANDROID when the WEB timedtext body is empty', async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/youtubei/v1/player')) {
        return new Response(JSON.stringify({
          captions: {
            playerCaptionsTracklistRenderer: {
              captionTracks: [{
                languageCode: 'en',
                kind: 'asr',
                vssId: 'a.en',
                baseUrl: 'https://www.youtube.com/api/timedtext?v=video&android=1',
              }],
            },
          },
        }), { status: 200 });
      }
      if (url.includes('android=1')) {
        return new Response('<transcript><text start="0">Hello from android.</text></transcript>', { status: 200 });
      }
      return new Response('', { status: 200 });
    });

    await expect(fetchCaptionTrackXml({
      videoId: 'video',
      track,
      fetchImpl,
    })).resolves.toContain('Hello from android.');
  });

  it('retries through ANDROID when an unblocked WEB URL still returns empty', async () => {
    const openTrack: CaptionTrack = {
      ...track,
      baseUrl: 'https://www.youtube.com/api/timedtext?v=video&lang=en',
    };
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/youtubei/v1/player')) {
        return new Response(JSON.stringify({
          captions: {
            playerCaptionsTracklistRenderer: {
              captionTracks: [{
                languageCode: 'en',
                kind: 'asr',
                baseUrl: 'https://www.youtube.com/api/timedtext?v=video&android=1',
              }],
            },
          },
        }), { status: 200 });
      }
      if (url.includes('android=1')) {
        return new Response('<text start="1">Recovered</text>', { status: 200 });
      }
      return new Response('', { status: 200 });
    });

    await expect(fetchCaptionTrackXml({
      videoId: 'video',
      track: openTrack,
      fetchImpl,
    })).resolves.toContain('Recovered');
  });

  it('resolves panel placeholder tracks through ANDROID timedtext', async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/youtubei/v1/player')) {
        return new Response(JSON.stringify({
          captions: {
            playerCaptionsTracklistRenderer: {
              captionTracks: [{
                languageCode: 'ru',
                kind: 'asr',
                vssId: 'a.ru',
                baseUrl: 'https://www.youtube.com/api/timedtext?v=video&android=ru',
              }],
            },
          },
        }), { status: 200 });
      }
      if (url.includes('android=ru')) {
        return new Response('<text start="0">Привет</text>', { status: 200 });
      }
      throw new Error(`unexpected fetch: ${url}`);
    });

    await expect(fetchCaptionTrackXml({
      videoId: 'video',
      track: panelTrack,
      fetchImpl,
    })).resolves.toContain('Привет');
  });

  it('falls back to modern transcript panel when player clients have no tracks', async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/youtubei/v1/player')) {
        return new Response(JSON.stringify({}), { status: 200 });
      }
      if (url.includes('/youtubei/v1/get_panel')) {
        return new Response(JSON.stringify({
          content: {
            transcriptSegmentViewModel: {
              timestamp: '0:09',
              simpleText: 'Panel segment',
            },
          },
        }), { status: 200 });
      }
      throw new Error(`unexpected fetch: ${url}`);
    });

    await expect(fetchCaptionTrackXml({
      videoId: '1UNQ7GFb6Ck',
      track: panelTrack,
      fetchImpl,
    })).resolves.toContain('Panel segment');
  });

  it('accepts srv3 paragraph XML and modern text rows', () => {
    expect(captionBodyLooksValid('<timedtext><body><p t="0" d="1">Hi</p></body></timedtext>')).toBe(true);
    expect(captionBodyLooksValid('<text start="1">Hi</text>')).toBe(true);
    expect(captionBodyLooksValid('')).toBe(false);
    expect(captionBodyLooksValid('00:00 Chapter title')).toBe(false);
  });
});
