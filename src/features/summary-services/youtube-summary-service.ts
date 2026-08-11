import {
  prepareYouTubeSummary,
  type CaptionTrack,
  type YouTubePage,
} from '@src/features/youtube-transcript/transcript-operation';

import type { SummaryService } from './summary-service';

export interface YouTubeSummaryInput {
  page: YouTubePage;
  summaryLanguage: string;
  selectedTrackId?: string;
  fetchCaption: (track: CaptionTrack) => Promise<string>;
}

export const youtubeSummaryService: SummaryService<YouTubeSummaryInput> = {
  async prepare(input) {
    const prepared = await prepareYouTubeSummary(input);
    return {
      source: {
        type: 'youtube',
        id: input.page.videoId,
        title: input.page.title,
        url: input.page.url,
      },
      prompt: prepared.prompt,
      variantId: prepared.track.id,
    };
  },
};
