import type { CaptionTrack } from './transcript-operation';

/** Public Innertube key embedded on every YouTube watch page. */
const INNERTUBE_API_KEY = 'AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8';

/** Player clients that still expose usable timedtext URLs when WEB returns none. */
const PLAYER_CLIENTS = [
  { clientName: 'ANDROID', clientVersion: '21.26.364' },
  { clientName: 'IOS', clientVersion: '20.10.4' },
  { clientName: 'TVHTML5_SIMPLY_EMBEDDED_PLAYER', clientVersion: '2.0' },
] as const;

export const PANEL_TRACK_URL = 'youtube-panel:';

export interface AndroidCaptionTrack {
  languageCode?: string;
  kind?: string;
  vssId?: string;
  baseUrl?: string;
  name?: { simpleText?: string; runs?: Array<{ text?: string }> };
}

export type CaptionFetch = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

export type CaptionStrategyName =
  | 'timedtext-direct'
  | 'timedtext-android'
  | 'timedtext-ios'
  | 'timedtext-tv'
  | 'modern-transcript-panel';

/**
 * WEB player caption URLs often include exp=xpe and return HTTP 200 with an empty
 * body unless a PoToken is attached. ANDROID/IOS/TV player track URLs still return captions.
 */
export function webCaptionUrlLikelyBlocked(baseUrl: string): boolean {
  try {
    return new URL(baseUrl).searchParams.has('exp');
  } catch {
    return false;
  }
}

export function isPanelTrackUrl(baseUrl: string): boolean {
  return baseUrl === PANEL_TRACK_URL;
}

export function withCaptionFormat(baseUrl: string, fmt = 'srv3'): string {
  const url = new URL(baseUrl);
  url.searchParams.set('fmt', fmt);
  return url.toString();
}

export function matchAndroidCaptionUrl(
  tracks: AndroidCaptionTrack[],
  selected: Pick<CaptionTrack, 'id' | 'languageCode' | 'kind'>,
): string | undefined {
  const byId = tracks.find((track) => track.vssId && track.vssId === selected.id && track.baseUrl);
  if (byId?.baseUrl) return byId.baseUrl;

  const byLanguageAndKind = tracks.find((track) => {
    if (!track.baseUrl || !track.languageCode) return false;
    if (normalizeLanguage(track.languageCode) !== normalizeLanguage(selected.languageCode)) return false;
    const kind = track.kind === 'asr' ? 'asr' : 'manual';
    return kind === selected.kind;
  });
  if (byLanguageAndKind?.baseUrl) return byLanguageAndKind.baseUrl;

  const byLanguage = tracks.find((track) => (
    track.baseUrl
    && track.languageCode
    && normalizeLanguage(track.languageCode) === normalizeLanguage(selected.languageCode)
  ));
  return byLanguage?.baseUrl ?? (selected.id === 'modern-transcript' ? tracks.find((track) => track.baseUrl)?.baseUrl : undefined);
}

export function playerTracksToCaptionTracks(tracks: AndroidCaptionTrack[]): CaptionTrack[] {
  return tracks.flatMap((track, index) => {
    if (!track.baseUrl || !track.languageCode) return [];
    const label = track.name?.simpleText
      || track.name?.runs?.map((run) => run.text ?? '').join('').trim()
      || track.languageCode;
    return [{
      id: track.vssId || `${track.languageCode}:${index}`,
      languageCode: track.languageCode,
      label,
      kind: track.kind === 'asr' ? 'asr' as const : 'manual' as const,
      baseUrl: track.baseUrl,
    }];
  });
}

export async function fetchAndroidCaptionTracks(
  videoId: string,
  fetchImpl: CaptionFetch = fetch,
  signal?: AbortSignal,
): Promise<AndroidCaptionTrack[]> {
  return fetchPlayerCaptionTracks(videoId, PLAYER_CLIENTS[0], fetchImpl, signal);
}

export async function fetchPlayerCaptionTracks(
  videoId: string,
  client: { clientName: string; clientVersion: string },
  fetchImpl: CaptionFetch = fetch,
  signal?: AbortSignal,
): Promise<AndroidCaptionTrack[]> {
  const response = await fetchImpl(
    `https://www.youtube.com/youtubei/v1/player?key=${INNERTUBE_API_KEY}`,
    {
      method: 'POST',
      signal,
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        context: {
          client: {
            ...client,
            hl: 'en',
            gl: 'US',
          },
        },
        videoId,
      }),
    },
  );
  if (!response.ok) return [];
  const data = await response.json() as {
    captions?: { playerCaptionsTracklistRenderer?: { captionTracks?: AndroidCaptionTrack[] } };
  };
  return data.captions?.playerCaptionsTracklistRenderer?.captionTracks ?? [];
}

/** Try ANDROID → IOS → TV until a client returns caption tracks. */
export async function fetchCaptionTracksFromPlayers(
  videoId: string,
  fetchImpl: CaptionFetch = fetch,
  signal?: AbortSignal,
): Promise<AndroidCaptionTrack[]> {
  for (const client of PLAYER_CLIENTS) {
    try {
      const tracks = await fetchPlayerCaptionTracks(videoId, client, fetchImpl, signal);
      if (tracks.some((track) => track.baseUrl)) return tracks;
    } catch (cause) {
      if (signal?.aborted) throw cause;
    }
  }
  return [];
}

export async function resolveCaptionFetchUrl(
  videoId: string,
  track: CaptionTrack,
  fetchImpl: CaptionFetch = fetch,
  signal?: AbortSignal,
): Promise<string> {
  if (!isPanelTrackUrl(track.baseUrl) && !webCaptionUrlLikelyBlocked(track.baseUrl)) {
    return withCaptionFormat(track.baseUrl);
  }

  const playerTracks = await fetchCaptionTracksFromPlayers(videoId, fetchImpl, signal);
  const matched = matchAndroidCaptionUrl(playerTracks, track);
  if (!matched) {
    if (isPanelTrackUrl(track.baseUrl)) {
      throw new Error('Could not resolve a timedtext URL');
    }
    return withCaptionFormat(track.baseUrl);
  }
  return withCaptionFormat(matched);
}

export async function fetchCaptionTrackXml(options: {
  videoId: string;
  track: CaptionTrack;
  fetchImpl?: CaptionFetch;
  signal?: AbortSignal;
  innertubeApiKey?: string;
  innertubeContext?: unknown;
}): Promise<string> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const signal = options.signal;
  const errors: string[] = [];

  const strategies: Array<{ name: CaptionStrategyName; run: () => Promise<string | undefined> }> = [
    {
      name: 'timedtext-direct',
      run: async () => {
        if (isPanelTrackUrl(options.track.baseUrl)) {
          return undefined;
        }
        return readCaptionBody(withCaptionFormat(options.track.baseUrl), fetchImpl, signal);
      },
    },
    {
      name: 'timedtext-android',
      run: () => fetchTimedtextViaClient(options.videoId, options.track, PLAYER_CLIENTS[0], fetchImpl, signal),
    },
    {
      name: 'timedtext-ios',
      run: () => fetchTimedtextViaClient(options.videoId, options.track, PLAYER_CLIENTS[1], fetchImpl, signal),
    },
    {
      name: 'timedtext-tv',
      run: () => fetchTimedtextViaClient(options.videoId, options.track, PLAYER_CLIENTS[2], fetchImpl, signal),
    },
    {
      name: 'modern-transcript-panel',
      run: async () => {
        try {
          return await fetchModernTranscript(
            options.videoId,
            fetchImpl,
            signal,
            options.innertubeApiKey,
            options.innertubeContext,
          );
        } catch (cause) {
          errors.push(cause instanceof Error ? cause.message : 'modern-transcript-panel failed');
          return undefined;
        }
      },
    },
  ];

  for (const strategy of strategies) {
    try {
      const body = await strategy.run();
      if (body && captionBodyLooksValid(body)) return body;
    } catch (cause) {
      if (signal?.aborted) throw cause;
      errors.push(`${strategy.name}: ${cause instanceof Error ? cause.message : 'failed'}`);
    }
  }

  throw new Error(errors.length > 0 ? `Could not retrieve captions (${errors[0]})` : 'Could not retrieve captions');
}

export async function fetchModernTranscript(
  videoId: string,
  fetchImpl: CaptionFetch = fetch,
  signal?: AbortSignal,
  apiKey = INNERTUBE_API_KEY,
  context?: unknown,
): Promise<string> {
  const response = await fetchImpl(
    `https://www.youtube.com/youtubei/v1/get_panel?key=${encodeURIComponent(apiKey)}&prettyPrint=false`,
    {
      method: 'POST',
      signal,
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        context: context ?? { client: { clientName: 'WEB', clientVersion: '2.20260924.00.00', hl: 'en' } },
        panelId: 'PAmodern_transcript_view',
        params: modernTranscriptParams(videoId),
      }),
    },
  );
  if (!response.ok) throw new Error('Could not retrieve captions');
  const data = await response.json() as unknown;
  const segments = readModernTranscriptSegments(data);
  if (segments.length === 0) throw new Error('Could not retrieve captions');
  return segments.map(({ start, text }) => `<text start="${start}">${escapeXml(text)}</text>`).join('');
}

function modernTranscriptParams(videoId: string): string {
  if (!/^[\w-]{11}$/.test(videoId)) throw new Error('Invalid YouTube video ID');
  // This is the compact protobuf used by YouTube's modern transcript panel.
  const bytes = Uint8Array.from([0xaa, 0x09, 0x0f, 0x0a, 0x0b, ...new TextEncoder().encode(videoId), 0x18, 0x02]);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function readModernTranscriptSegments(value: unknown): Array<{ start: number; text: string }> {
  const result: Array<{ start: number; text: string }> = [];
  const visit = (node: unknown): void => {
    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }
    if (!node || typeof node !== 'object') return;
    const object = node as Record<string, unknown>;
    const segment = object.transcriptSegmentViewModel;
    if (segment && typeof segment === 'object') {
      const item = segment as Record<string, unknown>;
      const timestamp = typeof item.timestamp === 'string' ? parseTranscriptTimestamp(item.timestamp) : undefined;
      const text = typeof item.simpleText === 'string' ? item.simpleText.trim() : '';
      if (timestamp !== undefined && text) result.push({ start: timestamp, text });
    }
    Object.values(object).forEach(visit);
  };
  visit(value);
  return result;
}

function parseTranscriptTimestamp(value: string): number | undefined {
  const parts = value.split(':').map(Number);
  if (parts.length < 2 || parts.length > 3 || parts.some((part) => !Number.isFinite(part))) return undefined;
  return parts.reduce((total, part) => total * 60 + part, 0);
}

function escapeXml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

async function fetchTimedtextViaClient(
  videoId: string,
  track: CaptionTrack,
  client: { clientName: string; clientVersion: string },
  fetchImpl: CaptionFetch,
  signal?: AbortSignal,
): Promise<string | undefined> {
  const tracks = await fetchPlayerCaptionTracks(videoId, client, fetchImpl, signal);
  const matched = matchAndroidCaptionUrl(tracks, track);
  if (!matched) return undefined;
  return readCaptionBody(withCaptionFormat(matched), fetchImpl, signal);
}

async function readCaptionBody(
  url: string,
  fetchImpl: CaptionFetch,
  signal?: AbortSignal,
): Promise<string | undefined> {
  assertYouTubeCaptionUrl(url);
  const response = await fetchImpl(url, { credentials: 'include', signal });
  if (!response.ok) return undefined;
  const text = await response.text();
  return text.trim() ? text : undefined;
}

/** Reject empty / non-caption payloads so the next strategy can run. */
export function captionBodyLooksValid(body: string): boolean {
  const trimmed = body.trim();
  if (!trimmed) return false;
  if (/<(?:text|p)\b/i.test(trimmed)) return true;
  // Modern-transcript conversion emits <text start="..."> rows.
  return false;
}

function assertYouTubeCaptionUrl(baseUrl: string): void {
  const url = new URL(baseUrl);
  if (url.protocol !== 'https:' || !(url.hostname === 'youtube.com' || url.hostname.endsWith('.youtube.com'))) {
    throw new Error('Invalid captions URL');
  }
}

function normalizeLanguage(language: string): string {
  return language.trim().replace(/_/g, '-').toLocaleLowerCase().split('-')[0];
}
