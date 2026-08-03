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
  fetchCaption: (url: string) => Promise<string>;
}

const SENTENCE_END = /[.!?。！？]["'’”）』」)]*\s*$/;
const MAX_BLOCK_SECONDS = 30;

const SUMMARY_LANGUAGE_NAMES: Record<string, string> = {
  de: 'Deutsch',
  en: 'English',
  es: 'español',
  fr: 'français',
  it: 'italiano',
  ja: '日本語',
  ko: '한국어',
  pt: 'português',
  ru: 'русский',
  uk: 'українська',
  zh: '中文',
};

const PROMPT_COPY: Record<string, {
  instruction: string;
  details: string;
  responseLanguage: string;
  title: string;
  captionLanguage: string;
  transcript: string;
}> = {
  en: {
    instruction: 'Create a structured summary of this YouTube video.',
    details: 'Highlight the main points, important details, and conclusions. When referring to fragments, use timestamps from the transcript.',
    responseLanguage: 'Response language', title: 'Title', captionLanguage: 'Caption language', transcript: 'Transcript',
  },
  ru: {
    instruction: 'Сделай структурированную суммаризацию этого YouTube-видео.',
    details: 'Выдели основные тезисы, важные детали и выводы. При ссылках на фрагменты используй таймкоды из расшифровки.',
    responseLanguage: 'Язык ответа', title: 'Название', captionLanguage: 'Язык субтитров', transcript: 'Расшифровка',
  },
  uk: {
    instruction: 'Створи структурований підсумок цього YouTube-відео.',
    details: 'Виділи головні тези, важливі деталі та висновки. Для посилань на фрагменти використовуй таймкоди з розшифровки.',
    responseLanguage: 'Мова відповіді', title: 'Назва', captionLanguage: 'Мова субтитрів', transcript: 'Розшифровка',
  },
  de: {
    instruction: 'Erstelle eine strukturierte Zusammenfassung dieses YouTube-Videos.',
    details: 'Hebe die wichtigsten Aussagen, Details und Schlussfolgerungen hervor. Verwende bei Verweisen die Zeitstempel aus dem Transkript.',
    responseLanguage: 'Antwortsprache', title: 'Titel', captionLanguage: 'Untertitelsprache', transcript: 'Transkript',
  },
  es: {
    instruction: 'Crea un resumen estructurado de este video de YouTube.',
    details: 'Destaca las ideas principales, los detalles importantes y las conclusiones. Usa las marcas de tiempo de la transcripción al citar fragmentos.',
    responseLanguage: 'Idioma de respuesta', title: 'Título', captionLanguage: 'Idioma de subtítulos', transcript: 'Transcripción',
  },
  fr: {
    instruction: 'Crée un résumé structuré de cette vidéo YouTube.',
    details: 'Mets en évidence les idées principales, les détails importants et les conclusions. Utilise les horodatages de la transcription pour citer des passages.',
    responseLanguage: 'Langue de réponse', title: 'Titre', captionLanguage: 'Langue des sous-titres', transcript: 'Transcription',
  },
  it: {
    instruction: 'Crea un riepilogo strutturato di questo video YouTube.',
    details: 'Evidenzia i punti principali, i dettagli importanti e le conclusioni. Usa i timestamp della trascrizione quando citi i passaggi.',
    responseLanguage: 'Lingua della risposta', title: 'Titolo', captionLanguage: 'Lingua dei sottotitoli', transcript: 'Trascrizione',
  },
  pt: {
    instruction: 'Crie um resumo estruturado deste vídeo do YouTube.',
    details: 'Destaque os pontos principais, detalhes importantes e conclusões. Use os timestamps da transcrição ao citar trechos.',
    responseLanguage: 'Idioma da resposta', title: 'Título', captionLanguage: 'Idioma das legendas', transcript: 'Transcrição',
  },
  ja: {
    instruction: 'このYouTube動画の構造化された要約を作成してください。',
    details: '主なポイント、重要な詳細、結論を示してください。箇所を参照するときは文字起こしのタイムコードを使用してください。',
    responseLanguage: '回答言語', title: 'タイトル', captionLanguage: '字幕言語', transcript: '文字起こし',
  },
  ko: {
    instruction: '이 YouTube 동영상의 구조화된 요약을 작성하세요.',
    details: '핵심 요점, 중요한 세부 사항, 결론을 강조하세요. 구간을 언급할 때는 대본의 타임코드를 사용하세요.',
    responseLanguage: '응답 언어', title: '제목', captionLanguage: '자막 언어', transcript: '대본',
  },
  zh: {
    instruction: '请为此 YouTube 视频创建结构化摘要。',
    details: '突出主要观点、重要细节和结论。引用片段时，请使用文字稿中的时间码。',
    responseLanguage: '回复语言', title: '标题', captionLanguage: '字幕语言', transcript: '文字稿',
  },
};

export class TranscriptPreparationError extends Error {
  constructor(public readonly code: 'captions-not-found' | 'caption-fetch-failed') {
    super(code === 'captions-not-found' ? 'Субтитры не найдены' : 'Не удалось получить субтитры');
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

  const xml = await fetchCaption(track.baseUrl);
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
  const copy = PROMPT_COPY[languageCode] ?? PROMPT_COPY.en;
  const transcript = blocks.map((block) => `[${formatTimestamp(block.start)}] ${block.text}`).join('\n\n');

  return [
    copy.instruction,
    copy.details,
    `${copy.responseLanguage}: ${languageName}`,
    '',
    `${copy.title}: ${page.title}`,
    `URL: ${page.url}`,
    `${copy.captionLanguage}: ${track.languageCode}`,
    '',
    `${copy.transcript}:`,
    transcript,
  ].join('\n');
}

function normalizeLanguage(language: string): string {
  return language.trim().replace(/_/g, '-').toLocaleLowerCase();
}
