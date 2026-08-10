import type { AiDestination, StoredOperation } from '@src/features/handoff/large-payload';
import {
  prepareYouTubeSummary,
  type CaptionTrack,
  type YouTubePage,
} from '@src/features/youtube-transcript/transcript-operation';

interface StartSummaryOperationInput {
  destination: AiDestination;
  summaryLanguage: string;
  selectedTrackId?: string;
  page: YouTubePage;
  fetchCaption: (track: CaptionTrack) => Promise<string>;
  save: (prompt: string, destination: AiDestination) => Promise<StoredOperation>;
}

export interface StartedSummaryOperation {
  operationId: string;
  trackId: string;
  charLength: number;
  estimatedTokens: number;
  expiresAt: number;
}

export async function startSummaryOperation({
  destination,
  summaryLanguage,
  selectedTrackId,
  page,
  fetchCaption,
  save,
}: StartSummaryOperationInput): Promise<StartedSummaryOperation> {
  const prepared = await prepareYouTubeSummary({
    page,
    summaryLanguage,
    selectedTrackId,
    fetchCaption,
  });
  const operation = await save(prepared.prompt, destination);
  return {
    operationId: operation.id,
    trackId: prepared.track.id,
    charLength: prepared.prompt.length,
    estimatedTokens: Math.ceil(prepared.prompt.length / 4),
    expiresAt: operation.expiresAt,
  };
}
