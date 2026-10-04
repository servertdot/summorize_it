import type { CaptionTrack } from './transcript-operation';

/** Public Innertube key embedded on every YouTube watch page. */
const INNERTUBE_API_KEY = 'AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8';
const ANDROID_CLIENT = {
  clientName: 'ANDROID',
  clientVersion: '20.10.38',
} as const;

export interface AndroidCaptionTrack {
  languageCode?: string;
  kind?: string;
  vssId?: string;
  baseUrl?: string;
}

export type CaptionFetch = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

/**
 * WEB player caption URLs often include exp=xpe and return HTTP 200 with an empty
 * body unless a PoToken is attached. ANDROID player track URLs still return captions.
 */
export function webCaptionUrlLikelyBlocked(baseUrl: string): boolean {
  try {
    return new URL(baseUrl).searchParams.has('exp');
  } catch {
    return false;
  }
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
  return byLanguage?.baseUrl ?? tracks.find((track) => track.baseUrl)?.baseUrl;
}

export async function fetchAndroidCaptionTracks(
  videoId: string,
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
            ...ANDROID_CLIENT,
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

export async function resolveCaptionFetchUrl(
  videoId: string,
  track: CaptionTrack,
  fetchImpl: CaptionFetch = fetch,
  signal?: AbortSignal,
): Promise<string> {
  if (!webCaptionUrlLikelyBlocked(track.baseUrl)) {
    return withCaptionFormat(track.baseUrl);
  }

  const androidTracks = await fetchAndroidCaptionTracks(videoId, fetchImpl, signal);
  const matched = matchAndroidCaptionUrl(androidTracks, track);
  if (!matched) {
    // Last resort: still attempt the original URL with an explicit format.
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
  if (options.track.baseUrl === 'youtube-panel:') {
    return fetchModernTranscript(options.videoId, fetchImpl, options.signal, options.innertubeApiKey, options.innertubeContext);
  }
  const primaryUrl = await resolveCaptionFetchUrl(
    options.videoId,
    options.track,
    fetchImpl,
    options.signal,
  );
  const primary = await readCaptionBody(primaryUrl, fetchImpl, options.signal);
  if (primary) return primary;

  // WEB URL without exp can still come back empty; retry via ANDROID once.
  if (!webCaptionUrlLikelyBlocked(options.track.baseUrl)) {
    const androidTracks = await fetchAndroidCaptionTracks(options.videoId, fetchImpl, options.signal);
    const matched = matchAndroidCaptionUrl(androidTracks, options.track);
    if (matched) {
      const fallback = await readCaptionBody(withCaptionFormat(matched), fetchImpl, options.signal);
      if (fallback) return fallback;
    }
  }

  try {
    return await fetchModernTranscript(
      options.videoId,
      fetchImpl,
      options.signal,
      options.innertubeApiKey,
      options.innertubeContext,
    );
  } catch {
    // Keep the caption retrieval error stable if YouTube's panel API is unavailable.
  }

  throw new Error('Could not retrieve captions');
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

function assertYouTubeCaptionUrl(baseUrl: string): void {
  const url = new URL(baseUrl);
  if (url.protocol !== 'https:' || !(url.hostname === 'youtube.com' || url.hostname.endsWith('.youtube.com'))) {
    throw new Error('Invalid captions URL');
  }
}

function normalizeLanguage(language: string): string {
  return language.trim().replace(/_/g, '-').toLocaleLowerCase().split('-')[0];
}
