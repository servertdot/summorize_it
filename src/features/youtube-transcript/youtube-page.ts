import type { CaptionTrack, YouTubePage } from './transcript-operation';

interface CaptionName {
  simpleText?: string;
  runs?: Array<{ text?: string }>;
}

interface PlayerCaptionTrack {
  vssId?: string;
  languageCode?: string;
  kind?: string;
  name?: CaptionName;
  baseUrl?: string;
}

interface PlayerResponse {
  videoDetails?: { videoId?: string; title?: string };
  playabilityStatus?: { status?: string; reason?: string };
  captions?: {
    playerCaptionsTracklistRenderer?: { captionTracks?: PlayerCaptionTrack[] };
  };
}

export interface YouTubeBridgeSnapshot {
  videoId?: string;
  title?: string;
  activeCaption?: { vssId?: string; languageCode?: string };
  playerResponse?: PlayerResponse;
}

export function readYouTubePage(
  document: Document,
  locationUrl: string,
  bridge: YouTubeBridgeSnapshot,
): YouTubePage {
  const url = new URL(locationUrl);
  const videoId = url.searchParams.get('v') ?? '';
  const candidate = bridge.playerResponse;
  const responseVideoId = candidate?.videoDetails?.videoId ?? bridge.videoId;
  const response = responseVideoId === videoId
    || (!responseVideoId && candidate?.playabilityStatus?.status && candidate.playabilityStatus.status !== 'OK')
    ? candidate
    : undefined;
  const rawTracks = response?.captions?.playerCaptionsTracklistRenderer?.captionTracks ?? [];
  const tracks = rawTracks.flatMap(toCaptionTrack);
  const activeTrackId = findActiveTrackId(tracks, rawTracks, bridge.activeCaption);
  const metadataTitle = document.querySelector('meta[property="og:title"]')?.getAttribute('content')?.trim();
  const title = response?.videoDetails?.title?.trim() || bridge.title?.trim() || metadataTitle || document.title;
  const accessError = accessErrorFrom(response?.playabilityStatus);

  return {
    videoId,
    title,
    url: `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`,
    pageLanguage: normalizeLanguage(document.documentElement.lang || navigator.language || 'en'),
    activeTrackId,
    tracks,
    ...(accessError ? { accessError } : {}),
  };
}

function accessErrorFrom(status?: PlayerResponse['playabilityStatus']): string | undefined {
  if (!status?.status || status.status === 'OK') return undefined;
  const reason = status.reason?.trim();
  return reason ? `Video unavailable: ${reason}` : 'Video unavailable for caption retrieval';
}

function toCaptionTrack(track: PlayerCaptionTrack, index: number): CaptionTrack[] {
  if (!track.baseUrl || !track.languageCode) return [];
  return [{
    id: track.vssId || `${track.languageCode}:${index}`,
    languageCode: track.languageCode,
    label: track.name?.simpleText
      || track.name?.runs?.map((run) => run.text ?? '').join('').trim()
      || track.languageCode,
    kind: track.kind === 'asr' ? 'asr' : 'manual',
    baseUrl: track.baseUrl,
  }];
}

function findActiveTrackId(
  tracks: CaptionTrack[],
  rawTracks: PlayerCaptionTrack[],
  activeCaption?: YouTubeBridgeSnapshot['activeCaption'],
): string | undefined {
  if (!activeCaption) return undefined;
  const exact = tracks.find((track) => track.id === activeCaption.vssId);
  if (exact) return exact.id;

  const index = rawTracks.findIndex((track) => {
    if (activeCaption.vssId && track.vssId === activeCaption.vssId) return true;
    return activeCaption.languageCode && normalizeLanguage(track.languageCode ?? '') === normalizeLanguage(activeCaption.languageCode);
  });
  return index >= 0 ? tracks[index]?.id : undefined;
}

function normalizeLanguage(language: string): string {
  return language.trim().replace(/_/g, '-').toLocaleLowerCase().split('-')[0];
}
