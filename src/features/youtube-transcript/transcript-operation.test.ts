import { describe, expect, it, vi } from 'vitest';

import { payloadChecksum } from '@src/features/handoff/large-payload';

import { prepareYouTubeSummary } from './transcript-operation';

describe('YouTube summary preparation', () => {
  it('writes the fixed instruction in the selected summary language', async () => {
    const prepared = await prepareYouTubeSummary({
      page: {
        videoId: 'video', title: 'Title', url: 'https://www.youtube.com/watch?v=video', pageLanguage: 'en',
        tracks: [{ id: 'en', languageCode: 'en', label: 'English', kind: 'manual', baseUrl: 'https://www.youtube.com/captions' }],
      },
      summaryLanguage: 'en',
      fetchCaption: async () => '<text start="0">Complete transcript.</text>',
    });

    expect(prepared.prompt).toContain('Create a structured summary of this YouTube video.');
    expect(prepared.prompt).toContain('Transcript:');
    expect(prepared.prompt).not.toContain('Сделай структурированную');
  });

  it('uses the active caption track and preserves every caption in timestamped blocks', async () => {
    const fetchCaption = vi.fn().mockResolvedValue(`
      <transcript>
        <text start="0.0" dur="4.0">Hello &amp; welcome.</text>
        <text start="4.0" dur="7.0">This video explains resilient systems</text>
        <text start="12.0" dur="7.0">without losing the important details.</text>
        <text start="39.0" dur="5.0">Now we move to the second idea.</text>
      </transcript>
    `);

    const result = await prepareYouTubeSummary({
      page: {
        videoId: 'abc123',
        title: 'Resilient systems',
        url: 'https://www.youtube.com/watch?v=abc123',
        pageLanguage: 'en',
        activeTrackId: 'en-auto',
        tracks: [
          {
            id: 'en-manual',
            languageCode: 'en',
            label: 'English',
            kind: 'manual',
            baseUrl: 'https://www.youtube.com/api/timedtext?manual',
          },
          {
            id: 'en-auto',
            languageCode: 'en',
            label: 'English (auto-generated)',
            kind: 'asr',
            baseUrl: 'https://www.youtube.com/api/timedtext?auto',
          },
        ],
      },
      summaryLanguage: 'ru',
      fetchCaption,
    });

    expect(fetchCaption).toHaveBeenCalledWith('https://www.youtube.com/api/timedtext?auto');
    expect(result.track.id).toBe('en-auto');
    expect(result.blocks).toEqual([
      { start: 0, text: 'Hello & welcome.' },
      {
        start: 4,
        text: 'This video explains resilient systems without losing the important details.',
      },
      { start: 39, text: 'Now we move to the second idea.' },
    ]);
    expect(result.prompt).toContain('Язык ответа: русский');
    expect(result.prompt).toContain('Название: Resilient systems');
    expect(result.prompt).toContain('[0:00] Hello & welcome.');
    expect(result.prompt).toContain('[0:04] This video explains resilient systems without losing the important details.');
    expect(result.prompt).toContain('[0:39] Now we move to the second idea.');
  });

  it('preserves a multi-megabyte Unicode transcript without truncation', async () => {
    const transcript = 'Полный текст 🚀 漢字. '.repeat(110_000);
    const prepared = await prepareYouTubeSummary({
      page: {
        videoId: 'large', title: 'Large', url: 'https://www.youtube.com/watch?v=large', pageLanguage: 'ru',
        tracks: [{ id: 'ru', languageCode: 'ru', label: 'Русский', kind: 'manual', baseUrl: 'https://www.youtube.com/captions' }],
      },
      summaryLanguage: 'ru',
      fetchCaption: async () => `<text start="0">${transcript}</text>`,
    });
    const transferredTranscript = prepared.prompt.slice(prepared.prompt.indexOf('[0:00] ') + 7);

    expect(transferredTranscript.length).toBeGreaterThan(2_000_000);
    expect(payloadChecksum(transferredTranscript)).toBe(payloadChecksum(transcript.trim()));
  });
});
