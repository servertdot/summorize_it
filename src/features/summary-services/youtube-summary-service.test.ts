import { describe, expect, it } from 'vitest';

import { youtubeSummaryService } from './youtube-summary-service';

describe('YouTube summary service', () => {
  it('adapts the selected caption track to the common summary source contract', async () => {
    const prepared = await youtubeSummaryService.prepare({
      page: {
        videoId: 'video', title: 'Video', url: 'https://www.youtube.com/watch?v=video', pageLanguage: 'en',
        tracks: [{ id: 'en', languageCode: 'en', label: 'English', kind: 'manual', baseUrl: 'captions' }],
      },
      summaryLanguage: 'en',
      fetchCaption: async () => '<text start="0">Complete transcript.</text>',
    });

    expect(prepared.source).toEqual({
      type: 'youtube', id: 'video', title: 'Video', url: 'https://www.youtube.com/watch?v=video',
    });
    expect(prepared.variantId).toBe('en');
    expect(prepared.prompt).toContain('Complete transcript.');
  });
});
