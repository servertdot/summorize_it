import { describe, expect, it, vi } from 'vitest';

import type { AiDestination } from '@src/features/handoff/large-payload';

import { startSummaryOperation } from './start-summary-operation';

describe('summary operation', () => {
  it('prepares and stores the complete prompt before the popup opens a destination', async () => {
    const events: string[] = [];
    const save = vi.fn(async (prompt: string, destination: AiDestination) => {
      events.push(`saved:${destination}:${prompt.length}`);
      return {
        id: 'one-time-id', destination, chunkCount: 2, charLength: prompt.length,
        checksum: 'checksum', createdAt: 1, expiresAt: 2,
      };
    });

    const result = await startSummaryOperation({
      destination: 'perplexity',
      summaryLanguage: 'ru',
      page: {
        videoId: 'video',
        title: 'Video title',
        url: 'https://www.youtube.com/watch?v=video',
        pageLanguage: 'en',
        tracks: [{
          id: 'track', languageCode: 'en', label: 'English', kind: 'manual',
          baseUrl: 'https://www.youtube.com/api/timedtext?track',
        }],
      },
      fetchCaption: async () => '<text start="0">Complete transcript.</text>',
      save,
    });

    expect(events).toEqual([expect.stringMatching(/^saved:perplexity:/)]);
    expect(result).toMatchObject({ operationId: 'one-time-id', trackId: 'track', expiresAt: 2 });
    expect(result.charLength).toBeGreaterThan(20);
  });

  it('does not open a destination when captions are missing', async () => {
    await expect(startSummaryOperation({
      destination: 'chatgpt',
      summaryLanguage: 'ru',
      page: {
        videoId: 'video', title: 'No captions', url: 'https://www.youtube.com/watch?v=video',
        pageLanguage: 'ru', tracks: [],
      },
      fetchCaption: vi.fn(),
      save: vi.fn(),
    })).rejects.toThrow('No captions found');
  });
});
