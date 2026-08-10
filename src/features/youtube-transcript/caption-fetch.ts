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
}): Promise<string> {
  const fetchImpl = options.fetchImpl ?? fetch;
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

  throw new Error('Could not retrieve captions');
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
