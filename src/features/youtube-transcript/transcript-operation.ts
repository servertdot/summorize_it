export type CaptionTrackKind = 'manual' | 'asr';

export interface CaptionTrack {
  id: string;
  languageCode: string;
  label: string;
  kind: CaptionTrackKind;
  baseUrl: string;
}

export interface YouTubePage {
  videoId: string;
  title: string;
  url: string;
  pageLanguage: string;
  activeTrackId?: string;
  tracks: CaptionTrack[];
  accessError?: string;
}

export function isYouTubePage(value: unknown): value is YouTubePage {
  if (!value || typeof value !== 'object') return false;
  const page = value as Partial<YouTubePage>;
  return typeof page.videoId === 'string'
    && typeof page.title === 'string'
    && typeof page.url === 'string'
    && typeof page.pageLanguage === 'string'
    && Array.isArray(page.tracks)
    && page.tracks.every((track) => Boolean(track)
      && typeof track.id === 'string'
      && typeof track.languageCode === 'string'
      && typeof track.label === 'string'
      && (track.kind === 'manual' || track.kind === 'asr')
      && typeof track.baseUrl === 'string');
}

export interface TranscriptBlock {
  start: number;
  text: string;
}

export interface PreparedYouTubeSummary {
  blocks: TranscriptBlock[];
  prompt: string;
  track: CaptionTrack;
}

interface PrepareYouTubeSummaryInput {
  page: YouTubePage;
  summaryLanguage: string;
  selectedTrackId?: string;
  fetchCaption: (track: CaptionTrack) => Promise<string>;
}

const SENTENCE_END = /[.!?。！？]["'’”）』」)]*\s*$/;
const MAX_BLOCK_SECONDS = 30;

const SUMMARY_LANGUAGE_NAMES: Record<string, string> = {
  de: 'German',
  en: 'English',
  es: 'Spanish',
  fr: 'French',
  it: 'Italian',
  ja: 'Japanese',
  ko: 'Korean',
  pt: 'Portuguese',
  ru: 'Russian',
  uk: 'Ukrainian',
  zh: 'Chinese',
};

export class TranscriptPreparationError extends Error {
  constructor(public readonly code: 'captions-not-found' | 'caption-fetch-failed') {
    super(code === 'captions-not-found' ? 'No captions found' : 'Could not retrieve captions');
  }
}

export async function prepareYouTubeSummary({
  page,
  summaryLanguage,
  selectedTrackId,
  fetchCaption,
}: PrepareYouTubeSummaryInput): Promise<PreparedYouTubeSummary> {
  const track = selectCaptionTrack(page, selectedTrackId);
  if (!track) {
    throw new TranscriptPreparationError('captions-not-found');
  }

  const xml = await fetchCaption(track);
  const segments = parseCaptionXml(xml);
  if (segments.length === 0) {
    throw new TranscriptPreparationError('caption-fetch-failed');
  }

  const blocks = groupTranscriptSegments(segments);
  return {
    blocks,
    prompt: composeSummaryPrompt(page, track, blocks, summaryLanguage),
    track,
  };
}

export function selectCaptionTrack(page: YouTubePage, selectedTrackId?: string): CaptionTrack | undefined {
  const selected = page.tracks.find((track) => track.id === selectedTrackId);
  if (selected) return selected;

  const active = page.tracks.find((track) => track.id === page.activeTrackId);
  if (active) return active;

  const pageLanguage = normalizeLanguage(page.pageLanguage);
  const sameLanguage = page.tracks.filter(
    (track) => normalizeLanguage(track.languageCode).split('-')[0] === pageLanguage.split('-')[0],
  );
  const preferredPool = sameLanguage.length > 0 ? sameLanguage : page.tracks;
  return preferredPool.find((track) => track.kind === 'manual') ?? preferredPool[0];
}

export function parseCaptionXml(xml: string): TranscriptBlock[] {
  const segments: TranscriptBlock[] = [];
  const paragraphPattern = /<p\s+t="(\d+)"[^>]*>([\s\S]*?)<\/p>/g;
  let match: RegExpExecArray | null;

  while ((match = paragraphPattern.exec(xml)) !== null) {
    const wordPattern = /<s[^>]*>([^<]*)<\/s>/g;
    const words: string[] = [];
    let wordMatch: RegExpExecArray | null;
    while ((wordMatch = wordPattern.exec(match[2])) !== null) words.push(wordMatch[1]);
    const rawText = words.length > 0 ? words.join('') : match[2].replace(/<[^>]+>/g, '');
    pushSegment(segments, Number(match[1]) / 1000, rawText);
  }

  if (segments.length > 0) return segments;

  const textPattern = /<text\s+start="([^"]*)"[^>]*>([\s\S]*?)<\/text>/g;
  while ((match = textPattern.exec(xml)) !== null) {
    pushSegment(segments, Number(match[1]), match[2].replace(/<[^>]+>/g, ''));
  }
  return segments;
}

function pushSegment(segments: TranscriptBlock[], start: number, text: string): void {
  const normalized = decodeEntities(text).replace(/[\r\n]+/g, ' ').replace(/\s{2,}/g, ' ').trim();
  if (Number.isFinite(start) && normalized) segments.push({ start, text: normalized });
}

function decodeEntities(text: string): string {
  const textarea = document.createElement('textarea');
  textarea.innerHTML = text;
  return textarea.value;
}

// Grouping behavior is adapted from Defuddle 0.19.2's MIT-licensed YouTube extractor.
export function groupTranscriptSegments(segments: TranscriptBlock[]): TranscriptBlock[] {
  const groups: TranscriptBlock[] = [];
  let pending: TranscriptBlock[] = [];

  const flush = () => {
    if (pending.length === 0) return;
    groups.push({
      start: pending[0].start,
      text: pending.map((segment) => segment.text).join(' ').replace(/\s{2,}/g, ' ').trim(),
    });
    pending = [];
  };

  for (const segment of segments) {
    if (pending.length > 0 && segment.start - pending[pending.length - 1].start > 20) flush();
    pending.push(segment);
    if (SENTENCE_END.test(segment.text) || segment.start - pending[0].start >= MAX_BLOCK_SECONDS) flush();
  }
  flush();
  return groups;
}

export function formatTimestamp(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainingSeconds = Math.floor(seconds % 60);
  if (hours > 0) return `${hours}:${String(minutes).padStart(2, '0')}:${String(remainingSeconds).padStart(2, '0')}`;
  return `${minutes}:${String(remainingSeconds).padStart(2, '0')}`;
}

function composeSummaryPrompt(
  page: YouTubePage,
  track: CaptionTrack,
  blocks: TranscriptBlock[],
  summaryLanguage: string,
): string {
  const languageCode = normalizeLanguage(summaryLanguage).split('-')[0];
  const languageName = SUMMARY_LANGUAGE_NAMES[languageCode] ?? summaryLanguage;
  const transcript = blocks.map((block) => `[${formatTimestamp(block.start)}] ${block.text}`).join('\n\n');

  return [
    'Create a structured summary of this YouTube video.',
    'Highlight the main points, important details, and conclusions. When referring to specific moments, use timestamps from the transcript.',
    `Write the summary in ${languageName}.`,
    '',
    `Title: ${page.title}`,
    `URL: ${page.url}`,
    `Caption language: ${track.languageCode}`,
    '',
    'Transcript:',
    transcript,
  ].join('\n');
}

function normalizeLanguage(language: string): string {
  return language.trim().replace(/_/g, '-').toLocaleLowerCase();
}
