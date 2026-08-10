import { describe, expect, it, vi } from 'vitest';

import {
  fetchCaptionTrackXml,
  matchAndroidCaptionUrl,
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
});
